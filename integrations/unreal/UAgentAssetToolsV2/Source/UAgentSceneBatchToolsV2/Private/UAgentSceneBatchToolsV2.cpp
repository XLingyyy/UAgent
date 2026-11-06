#include "CoreMinimal.h"
#include "IModelContextProtocolModule.h"
#include "Interfaces/IPluginManager.h"
#include "IModelContextProtocolTool.h"
#include "ModelContextProtocolToolResults.h"
#include "UAgentSemanticV2.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Components/StaticMeshComponent.h"
#include "Containers/Ticker.h"
#include "Editor.h"
#include "Engine/Engine.h"
#include "Engine/Level.h"
#include "Engine/LevelStreamingDynamic.h"
#include "Engine/MapBuildDataRegistry.h"
#include "Misc/AutomationTest.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "FileHelpers.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformTime.h"
#include "Hash/Blake3.h"
#include "Materials/MaterialInterface.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/PackagePath.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "UObject/UObjectGlobals.h"
#include "Windows/WindowsHWrapper.h"
#include "Windows/AllowWindowsPlatformTypes.h"
#include <winternl.h>
#include "Windows/HideWindowsPlatformTypes.h"
namespace UAgentSceneV2
{
namespace
{
const FString Contract=TEXT("2.4.0-scene-batch-current-run");
const FString Root=TEXT("/Game/UAgentBuildLab/Scene_T14");
const FString MaterialPath=TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
const TArray<FString> ToolNames{TEXT("uagent.v2.scene.capabilities"),TEXT("uagent.v2.scene.prepare"),TEXT("uagent.v2.scene.execute"),TEXT("uagent.v2.scene.cancel"),TEXT("uagent.v2.scene.query"),TEXT("uagent.v2.scene.resume"),TEXT("uagent.v2.scene.save")};
const TArray<FString> PurposeKeys{TEXT("preparePermit"),TEXT("executePermit"),TEXT("cancelPermit"),TEXT("resumePermit"),TEXT("savePermit")};
TSharedPtr<FJsonObject> Obj(){return MakeShared<FJsonObject>();}
TSharedPtr<FJsonObject> Kind(const TCHAR* Type){auto O=Obj();O->SetStringField(TEXT("type"),Type);return O;}
TArray<TSharedPtr<FJsonValue>> Strings(const TArray<FString>& Values){TArray<TSharedPtr<FJsonValue>> R;for(const auto& V:Values)R.Add(MakeShared<FJsonValueString>(V));return R;}
FString Hash(const TArray<uint8>& Bytes){const auto H=FBlake3::HashBuffer(Bytes.GetData(),Bytes.Num());return BytesToHex(H.GetBytes(),32).ToLower();}
FString HashText(const FString& S){FTCHARToUTF8 U(*S);TArray<uint8>B;B.Append(reinterpret_cast<const uint8*>(U.Get()),U.Length());return Hash(B);}
bool Guid(const FString& S){FGuid G;return FGuid::ParseExact(S,EGuidFormats::DigitsWithHyphens,G)&&G.IsValid()&&G.ToString(EGuidFormats::DigitsWithHyphens).ToLower()==S;}
bool Word(const FString& S,int32 Max){if(S.IsEmpty()||S.Len()>Max)return false;for(TCHAR C:S)if(!((C>=TEXT('A')&&C<=TEXT('Z'))||(C>=TEXT('a')&&C<=TEXT('z'))||(C>=TEXT('0')&&C<=TEXT('9'))||C==TEXT('_')))return false;return true;}
bool Exact(const TSharedPtr<FJsonObject>& O,const TArray<FString>& Keys){if(!O||O->Values.Num()!=Keys.Num())return false;for(const auto& K:Keys)if(!O->HasField(K))return false;return true;}
TSharedPtr<FJsonObject> ReadJson(const FString& File){FString S;TSharedPtr<FJsonObject> O;if(!FFileHelper::LoadFileToString(S,*File)||!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(S),O))return nullptr;return O;}
struct FItem
{
 FString Id,Name,MeshPath,Material,Status=TEXT("not_started"),Reason;FTransform Transform;
 TWeakObjectPtr<AStaticMeshActor> Actor;FGuid ActorGuid;
};
struct FBatch
{
 TSharedPtr<FJsonObject> Plan;FString Id,Map,Canonical,State=TEXT("not_started"),ConflictReason,SavedHash,QueryToken,QueryDigest;
 TArray<FItem> Items;FString Permits[5];bool Consumed[5]{false,false,false,false,false};
 TWeakObjectPtr<UWorld> World;TArray<TWeakObjectPtr<AActor>> Baseline;
 TMap<FString,TStrongObjectPtr<UStaticMesh>> Meshes;TStrongObjectPtr<UMaterialInterface> Material;
 bool Conflict=false,Saved=false,CancelRequested=false,TestPauseUsed=false;int32 PauseAfter=0,NextIndex=0;
};
TArray<TUniquePtr<FBatch>> Batches;TArray<HANDLE> Directories;
FString Instance,Project,RootId,RunId,ActiveId,Scratch;bool Enabled=false,OwnMutation=false;double Started=0;
FBatch* Find(const FString& Id){for(auto& B:Batches)if(B->Id==Id)return B.Get();return nullptr;}
FBatch* Active(){return Find(ActiveId);}
void Conflict(FBatch& B,const TCHAR* Reason){B.Conflict=true;B.ConflictReason=Reason;B.State=TEXT("conflicted");B.QueryToken.Reset();B.QueryDigest.Reset();}
bool Vector(const TSharedPtr<FJsonObject>& O,const TArray<FString>& Keys,double Min,double Max,FVector& Out)
{
 if(!Exact(O,Keys))return false;double V[3]{0,0,0};for(int32 I=0;I<3;++I)if(!O->TryGetNumberField(Keys[I],V[I])||!FMath::IsFinite(V[I])||V[I]<Min||V[I]>Max)return false;
 Out=FVector(V[0],V[1],V[2]);return true;
}
bool ParsePlan(const TSharedPtr<FJsonObject>& P,FBatch& B)
{
 if(!Exact(P,{TEXT("operationId"),TEXT("targetMap"),TEXT("expectedDiskState"),TEXT("items")}))return false;
 FString Expected;if(!P->TryGetStringField(TEXT("operationId"),B.Id)||!Guid(B.Id)||!P->TryGetStringField(TEXT("targetMap"),B.Map)||!B.Map.StartsWith(Root+TEXT("/L_"))||!Word(B.Map.RightChop(Root.Len()+1),80)||!P->TryGetStringField(TEXT("expectedDiskState"),Expected)||Expected!=TEXT("absent"))return false;
 const TArray<TSharedPtr<FJsonValue>>* Items=nullptr;if(!P->TryGetArrayField(TEXT("items"),Items)||(Items->Num()<1||Items->Num()>20))return false;
 TSet<FString> Ids;TSet<FName> Names;B.Canonical=B.Id+TEXT("\n")+B.Map+TEXT("\nabsent");
 for(const auto& Value:*Items)
 {
  const auto I=Value->AsObject();if(!Exact(I,{TEXT("itemId"),TEXT("objectName"),TEXT("mesh"),TEXT("material"),TEXT("transform")}))return false;
  FItem Item;if(!I->TryGetStringField(TEXT("itemId"),Item.Id)||!Word(Item.Id,64)||Ids.Contains(Item.Id)||!I->TryGetStringField(TEXT("objectName"),Item.Name)||!Word(Item.Name,64)||!Item.Name.StartsWith(TEXT("UA14_"))||Names.Contains(FName(*Item.Name))||!I->TryGetStringField(TEXT("mesh"),Item.MeshPath)||!I->TryGetStringField(TEXT("material"),Item.Material)||Item.Material!=MaterialPath)return false;
  bool MeshAllowed=false;for(const TCHAR* Name:{TEXT("Cube"),TEXT("Sphere"),TEXT("Cylinder")})if(Item.MeshPath==FString(TEXT("/Engine/BasicShapes/"))+Name+TEXT(".")+Name)MeshAllowed=true;if(!MeshAllowed)return false;
  const TSharedPtr<FJsonObject>* T=nullptr;if(!I->TryGetObjectField(TEXT("transform"),T)||!Exact(*T,{TEXT("location"),TEXT("rotation"),TEXT("scale")}))return false;
  const TSharedPtr<FJsonObject>* L=nullptr;const TSharedPtr<FJsonObject>* R=nullptr;const TSharedPtr<FJsonObject>* S=nullptr;FVector Location=FVector::ZeroVector,Rotation=FVector::ZeroVector,Scale=FVector::OneVector;
  if(!(*T)->TryGetObjectField(TEXT("location"),L)||!(*T)->TryGetObjectField(TEXT("rotation"),R)||!(*T)->TryGetObjectField(TEXT("scale"),S)||!Vector(*L,{TEXT("x"),TEXT("y"),TEXT("z")},-10000,10000,Location)||!Vector(*R,{TEXT("pitch"),TEXT("yaw"),TEXT("roll")},-180,180,Rotation)||!Vector(*S,{TEXT("x"),TEXT("y"),TEXT("z")},0.1,10,Scale))return false;
  Item.Transform=FTransform(FRotator(Rotation.X,Rotation.Y,Rotation.Z),Location,Scale);Ids.Add(Item.Id);Names.Add(FName(*Item.Name));
  B.Canonical+=TEXT("\n")+Item.Id+TEXT("|")+Item.Name+TEXT("|")+Item.MeshPath+TEXT("|")+Item.Material;
  for(double N:{Location.X,Location.Y,Location.Z,Rotation.X,Rotation.Y,Rotation.Z,Scale.X,Scale.Y,Scale.Z})B.Canonical+=TEXT("|")+FString::Printf(TEXT("%.17g"),N);
  B.Items.Add(MoveTemp(Item));
 }
 B.Plan=P;return true;
}
bool HoldDirectory(const FString& Path,FString* Identity=nullptr)
{
 HANDLE H=CreateFileW(*Path,FILE_READ_ATTRIBUTES|FILE_TRAVERSE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
 if(H==INVALID_HANDLE_VALUE)return false;BY_HANDLE_FILE_INFORMATION I{};if(!GetFileInformationByHandle(H,&I)||!(I.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)||(I.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)){CloseHandle(H);return false;}
 if(Identity)*Identity=FString::Printf(TEXT("%u:%llu"),I.dwVolumeSerialNumber,(static_cast<uint64>(I.nFileIndexHigh)<<32)|I.nFileIndexLow);Directories.Add(H);return true;
}
HANDLE MapFile(FBatch& B,bool Create,LONG& Status)
{
 using FCreate=NTSTATUS(NTAPI*)(PHANDLE,ACCESS_MASK,POBJECT_ATTRIBUTES,PIO_STATUS_BLOCK,PLARGE_INTEGER,ULONG,ULONG,ULONG,ULONG,PVOID,ULONG);
 const auto Fn=reinterpret_cast<FCreate>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtCreateFile"));if(!Fn||Directories.Num()!=6){Status=static_cast<LONG>(0xC0000008);return INVALID_HANDLE_VALUE;}
 const FString Leaf=FPackageName::GetLongPackageAssetName(B.Map)+TEXT(".umap");UNICODE_STRING Name{};Name.Length=static_cast<USHORT>(Leaf.Len()*sizeof(WCHAR));Name.MaximumLength=Name.Length;Name.Buffer=const_cast<PWSTR>(*Leaf);
 OBJECT_ATTRIBUTES A{};A.Length=sizeof(A);A.RootDirectory=Directories[3];A.ObjectName=&Name;A.Attributes=OBJ_CASE_INSENSITIVE;IO_STATUS_BLOCK IO{};HANDLE H=INVALID_HANDLE_VALUE;
 Status=Fn(&H,(Create?GENERIC_READ|GENERIC_WRITE:GENERIC_READ)|SYNCHRONIZE,&A,&IO,nullptr,FILE_ATTRIBUTE_NORMAL,Create?0:FILE_SHARE_READ|FILE_SHARE_WRITE,Create?FILE_CREATE:FILE_OPEN,FILE_NON_DIRECTORY_FILE|FILE_SYNCHRONOUS_IO_NONALERT|FILE_OPEN_REPARSE_POINT,nullptr,0);return Status>=0?H:INVALID_HANDLE_VALUE;
}
bool ReadMap(FBatch& B,TArray<uint8>& Bytes,bool& Exists)
{
 LONG Status=0;HANDLE H=MapFile(B,false,Status);Exists=static_cast<ULONG>(Status)!=0xC0000034&&static_cast<ULONG>(Status)!=0xC000003A;if(H==INVALID_HANDLE_VALUE)return false;Exists=true;
 BY_HANDLE_FILE_INFORMATION I{};bool OK=GetFileInformationByHandle(H,&I)&&I.nNumberOfLinks==1&&!(I.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))&&I.nFileSizeHigh==0&&I.nFileSizeLow<=64*1024*1024;
 if(OK){Bytes.SetNumUninitialized(I.nFileSizeLow);DWORD Count=0;OK=ReadFile(H,Bytes.GetData(),I.nFileSizeLow,&Count,nullptr)&&Count==I.nFileSizeLow;}CloseHandle(H);return OK;
}
// No preparation side effects before checking every loaded map-related package.
// GetDirtyWorldPackages is intentionally not used: its implementation may mark built data dirty.
const TCHAR* CurrentWorldPreparationRejection(UWorld* World)
{
 if(!World||World->WorldType!=EWorldType::Editor||!World->PersistentLevel||!GEditor||GEditor->PlayWorld)return TEXT("current_editor_world_unavailable_or_playing");
 TSet<UPackage*> Packages;Packages.Add(World->GetOutermost());
 bool Unsupported=World->GetWorldPartition()!=nullptr||World->GetStreamingLevels().Num()!=0||World->GetLevels().Num()!=1;
 for(ULevel* Level:World->GetLevels())
 {
  if(!Level)return TEXT("loaded_level_unavailable");
  Packages.Add(Level->GetOutermost());Packages.Add(Level->GetPackage());
  const auto External=Level->GetLoadedExternalObjectPackages();
  Unsupported|=Level!=World->PersistentLevel||Level->IsUsingExternalActors()||External.Num()!=0;
  for(UPackage* Package:External)Packages.Add(Package);
  if(Level->MapBuildData)Packages.Add(Level->MapBuildData->GetOutermost());
  for(AActor* Actor:Level->Actors)if(Actor){Packages.Add(Actor->GetPackage());Packages.Add(Actor->GetOutermost());}
 }
 for(UPackage* Package:Packages)if(Package&&Package->IsDirty())return TEXT("dirty_current_or_related_map_package_rejected");
 return Unsupported?TEXT("current_world_structure_unsupported_no_unload"):nullptr;
}
bool SameWorld(FBatch& B)
{
 UWorld* W=GEditor?GEditor->GetEditorWorldContext().World():nullptr;
 return B.World.IsValid()&&W==B.World.Get()&&W->WorldType==EWorldType::Editor&&W->GetOutermost()->GetName()==B.Map&&!W->GetWorldPartition()&&W->GetStreamingLevels().Num()==0&&W->PersistentLevel&&!W->PersistentLevel->IsUsingExternalActors();
}
bool Match(FBatch& B,FItem& I)
{
 AStaticMeshActor* A=I.Actor.Get();if(!A||A->GetClass()!=AStaticMeshActor::StaticClass()||A->GetWorld()!=B.World.Get()||A->GetOutermost()!=B.World->GetOutermost()||A->GetActorGuid()!=I.ActorGuid||!I.ActorGuid.IsValid()||A->GetName()!=I.Name||A->GetActorLabel(false)!=I.Name||!A->Tags.Contains(FName(*(TEXT("UAgentOperation_")+B.Id)))||!A->Tags.Contains(FName(*(TEXT("UAgentItem_")+I.Id))))return false;
 const UStaticMeshComponent* C=A->GetStaticMeshComponent();if(!C||!C->GetStaticMesh()||C->GetStaticMesh()->GetPathName()!=I.MeshPath||C->OverrideMaterials.Num()!=1||!C->OverrideMaterials[0]||C->OverrideMaterials[0]->GetPathName()!=I.Material)return false;
 const FTransform T=A->GetActorTransform();
 return T.GetLocation().Equals(I.Transform.GetLocation(),0.001)&&T.GetScale3D().Equals(I.Transform.GetScale3D(),0.001)&&T.GetRotation().AngularDistance(I.Transform.GetRotation())<=FMath::DegreesToRadians(0.001);
}
bool Verify(FBatch& B)
{
 if(!SameWorld(B)){Conflict(B,TEXT("current_world_changed_or_unsupported"));for(auto& I:B.Items)if(I.Status==TEXT("applied")){I.Status=TEXT("unknown");I.Reason=TEXT("world_unavailable_no_adoption");}return false;}
 TSet<const AActor*> Expected;for(const auto& A:B.Baseline){if(!A.IsValid())Conflict(B,TEXT("baseline_actor_removed"));else Expected.Add(A.Get());}
 for(auto& I:B.Items)
 {
  if(I.Actor.IsValid())Expected.Add(I.Actor.Get());
  if(I.Status==TEXT("applied")&&!Match(B,I)){I.Status=TEXT("unknown");I.Reason=TEXT("owned_object_identity_or_properties_changed");Conflict(B,TEXT("owned_object_changed"));}
  if(I.Status==TEXT("not_started")&&FindObject<AActor>(B.World->PersistentLevel,*I.Name)){I.Status=TEXT("failed");I.Reason=TEXT("unowned_name_conflict");Conflict(B,TEXT("unowned_name_conflict"));}
 }
 for(AActor* A:B.World->PersistentLevel->Actors)if(A&&!Expected.Contains(A))Conflict(B,TEXT("unapproved_actor_added"));
 if(B.Saved&&B.World->GetOutermost()->IsDirty())Conflict(B,TEXT("saved_map_became_dirty_external"));
 if(!B.Saved&&!B.World->GetOutermost()->IsDirty())Conflict(B,TEXT("owned_unsaved_dirty_state_cleared"));
 TArray<uint8> Bytes;bool Exists=false;const bool Read=ReadMap(B,Bytes,Exists);
 if((!B.Saved&&Exists)||(B.Saved&&(!Exists||!Read||Hash(Bytes)!=B.SavedHash)))Conflict(B,TEXT("map_disk_state_changed"));
 return !B.Conflict;
}
TSharedPtr<FJsonObject> Vec(double X,double Y,double Z,const TArray<FString>& Names){auto O=Obj();O->SetNumberField(Names[0],X);O->SetNumberField(Names[1],Y);O->SetNumberField(Names[2],Z);return O;}
TSharedPtr<FJsonObject> TransformJson(const FTransform& T){auto O=Obj();const auto P=T.GetLocation(),S=T.GetScale3D();const auto R=T.Rotator();O->SetObjectField(TEXT("location"),Vec(P.X,P.Y,P.Z,{TEXT("x"),TEXT("y"),TEXT("z")}));O->SetObjectField(TEXT("rotation"),Vec(R.Pitch,R.Yaw,R.Roll,{TEXT("pitch"),TEXT("yaw"),TEXT("roll")}));O->SetObjectField(TEXT("scale"),Vec(S.X,S.Y,S.Z,{TEXT("x"),TEXT("y"),TEXT("z")}));return O;}
TSharedPtr<FJsonObject> Data(FBatch& B,bool IssueToken=false)
{
 const bool Current=SameWorld(B);if(B.State!=TEXT("not_started"))Verify(B);
 auto D=Obj();D->SetStringField(TEXT("state"),B.State);D->SetStringField(TEXT("targetMap"),B.Map);D->SetBoolField(TEXT("currentWorldMatches"),Current);D->SetBoolField(TEXT("packageDirty"),Current&&B.World->GetOutermost()->IsDirty());D->SetBoolField(TEXT("saved"),B.Saved&&Current&&!B.Conflict);D->SetBoolField(TEXT("conflict"),B.Conflict);D->SetBoolField(TEXT("cancelIsRollback"),false);D->SetStringField(TEXT("conflictReason"),B.ConflictReason);
 TArray<uint8> Bytes;bool Exists=false;const bool Read=ReadMap(B,Bytes,Exists);D->SetBoolField(TEXT("diskExists"),Exists);D->SetStringField(TEXT("diskHash"),Read?Hash(Bytes):FString());
 TArray<TSharedPtr<FJsonValue>> Results;FString Digest;int32 Count=0;
 for(auto& I:B.Items)
 {
  const bool Owned=Current&&I.Status==TEXT("applied")&&Match(B,I);auto R=Obj();R->SetStringField(TEXT("itemId"),I.Id);R->SetStringField(TEXT("objectName"),I.Name);R->SetStringField(TEXT("status"),I.Status);R->SetStringField(TEXT("reason"),I.Reason);R->SetBoolField(TEXT("owned"),Owned);R->SetStringField(TEXT("actorGuid"),Owned?I.ActorGuid.ToString(EGuidFormats::DigitsWithHyphens).ToLower():FString());R->SetStringField(TEXT("objectPath"),Owned?I.Actor->GetPathName():FString());R->SetStringField(TEXT("mesh"),I.MeshPath);R->SetStringField(TEXT("material"),I.Material);if(Owned){R->SetObjectField(TEXT("transform"),TransformJson(I.Actor->GetActorTransform()));++Count;}
  FString Serialized;FJsonSerializer::Serialize(R.ToSharedRef(),TJsonWriterFactory<>::Create(&Serialized));Digest+=Serialized;Results.Add(MakeShared<FJsonValueObject>(R));
 }
 D->SetArrayField(TEXT("items"),Results);D->SetNumberField(TEXT("appliedCount"),Count);Digest+=B.Map+B.State+(B.Conflict?TEXT("conflict"):TEXT("verified"))+(Read?Hash(Bytes):TEXT("absent"));
 if(IssueToken&&Current&&!B.Conflict&&(B.State==TEXT("cancelled")||B.State==TEXT("completed"))){B.QueryToken=FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens).ToLower();B.QueryDigest=HashText(Digest);D->SetStringField(TEXT("queryToken"),B.QueryToken);}return D;
}
FString ObservationDigest(FBatch& B){const auto D=Data(B);FString Digest;for(auto& V:D->GetArrayField(TEXT("items"))){FString S;FJsonSerializer::Serialize(V->AsObject().ToSharedRef(),TJsonWriterFactory<>::Create(&S));Digest+=S;}Digest+=B.Map+B.State+(B.Conflict?TEXT("conflict"):TEXT("verified"))+(!D->GetStringField(TEXT("diskHash")).IsEmpty()?D->GetStringField(TEXT("diskHash")):TEXT("absent"));return HashText(Digest);}
FModelContextProtocolToolResult Result(int32 Tool,FBatch& B){auto R=Obj();R->SetStringField(TEXT("schemaVersion"),TEXT("uagent.scene.result.v2"));R->SetStringField(TEXT("contractVersion"),Contract);R->SetStringField(TEXT("projectKey"),Project);R->SetStringField(TEXT("instanceId"),Instance);R->SetStringField(TEXT("rootObjectId"),RootId);R->SetStringField(TEXT("runId"),RunId);R->SetStringField(TEXT("operation"),ToolNames[Tool]);R->SetObjectField(TEXT("plan"),B.Plan);R->SetStringField(TEXT("planHash"),HashText(B.Canonical));auto Snapshot=Data(B,Tool==4);if(Snapshot->GetBoolField(TEXT("diskExists"))&&Snapshot->GetStringField(TEXT("diskHash")).IsEmpty())return UE::ModelContextProtocol::MakeErrorResult(TEXT("map_disk_unreadable_unknown_effect_no_resume"));R->SetObjectField(TEXT("data"),Snapshot);TSharedPtr<FJsonValue> V=MakeShared<FJsonValueObject>(R);return UE::ModelContextProtocol::MakeStructuredContentResult(V);}
FModelContextProtocolToolResult Error(const TCHAR* S){return UE::ModelContextProtocol::MakeErrorResult(S);}
int32 Purpose(int32 Tool){return Tool==1?0:Tool==2?1:Tool==3?2:Tool==5?3:4;}
bool Consume(int32 Tool,FBatch& B,const TSharedPtr<FJsonObject>& A){const int32 I=Purpose(Tool);FString P;if(B.Consumed[I]||!A->TryGetStringField(TEXT("hostPermit"),P)||P!=B.Permits[I])return false;B.Consumed[I]=true;B.QueryToken.Reset();B.QueryDigest.Reset();return true;}
TMap<FString,TSharedPtr<FJsonObject>> SchemaCatalogue;
bool LoadSchemas()
{
 const auto Plugin=IPluginManager::Get().FindPlugin(TEXT("UAgentAssetToolsV2"));if(!Plugin)return false;
 const auto Schema=ReadJson(FPaths::Combine(Plugin->GetBaseDir(),TEXT("Resources/scene-batch-v2-schemas.json")));if(!Schema||Schema->GetStringField(TEXT("contractVersion"))!=Contract)return false;
 const TArray<TSharedPtr<FJsonValue>>* Entries=nullptr;if(!Schema->TryGetArrayField(TEXT("tools"),Entries)||Entries->Num()!=ToolNames.Num())return false;
 for(auto& V:*Entries){auto E=V->AsObject();FString Name;const TSharedPtr<FJsonObject>* I=nullptr;const TSharedPtr<FJsonObject>* O=nullptr;if(!E||!E->TryGetStringField(TEXT("name"),Name)||!ToolNames.Contains(Name)||SchemaCatalogue.Contains(Name)||!E->TryGetObjectField(TEXT("inputSchema"),I)||!E->TryGetObjectField(TEXT("outputSchema"),O))return false;SchemaCatalogue.Add(Name,E);}
 return SchemaCatalogue.Num()==ToolNames.Num();
}
TSharedPtr<FJsonObject> Input(int32 Tool){return SchemaCatalogue.FindChecked(ToolNames[Tool])->GetObjectField(TEXT("inputSchema"));}
TSharedPtr<FJsonObject> Output(int32 Tool){return SchemaCatalogue.FindChecked(ToolNames[Tool])->GetObjectField(TEXT("outputSchema"));}
TSharedPtr<FJsonObject> Capabilities()
{
 auto R=Obj();R->SetStringField(TEXT("schemaVersion"),TEXT("uagent.scene.capabilities.v2"));R->SetNumberField(TEXT("protocolVersion"),2);R->SetStringField(TEXT("contractVersion"),Contract);R->SetStringField(TEXT("projectKey"),Project);R->SetStringField(TEXT("instanceId"),Instance);R->SetStringField(TEXT("rootObjectId"),RootId);R->SetStringField(TEXT("runId"),RunId);R->SetBoolField(TEXT("available"),Enabled);R->SetBoolField(TEXT("productionSupported"),false);R->SetStringField(TEXT("scopeMode"),TEXT("approved_project_new_map_current_run"));R->SetStringField(TEXT("writeRoot"),Root);
 TArray<TSharedPtr<FJsonValue>> Plans;for(auto& B:Batches)Plans.Add(MakeShared<FJsonValueObject>(B->Plan));R->SetArrayField(TEXT("approvedPlans"),Plans);TArray<TSharedPtr<FJsonValue>> Tools;for(int32 I=1;I<ToolNames.Num();++I){auto T=Obj();T->SetStringField(TEXT("name"),ToolNames[I]);T->SetObjectField(TEXT("inputSchema"),Input(I));T->SetObjectField(TEXT("outputSchema"),Output(I));T->SetStringField(TEXT("effect"),I==4?TEXT("query_current_loaded_world_no_asset_loading"):I==1?TEXT("explicit_world_preparation_and_fixed_engine_asset_loading"):I==3?TEXT("request_stop_without_rollback"):I==6?TEXT("save_only_approved_new_map"):TEXT("mutate_approved_static_objects_only"));Tools.Add(MakeShared<FJsonValueObject>(T));}R->SetArrayField(TEXT("tools"),Tools);return R;
}
bool Tick(float)
{
 if(Enabled&&FParse::Param(FCommandLine::Get(),TEXT("UAgentSceneLabSession"))&&IFileManager::Get().FileExists(*FPaths::Combine(Scratch,TEXT("RequestQuit.flag")))){if(auto* B=Active()){B->CancelRequested=true;if(B->State==TEXT("running"))B->State=TEXT("cancelled");}FPlatformMisc::RequestExit(false);return false;}
 FBatch* B=Active();if(!Enabled||!B||B->State!=TEXT("running"))return true;
 if(FPlatformTime::Seconds()-Started>600){B->State=TEXT("cancelled");B->CancelRequested=true;return true;}
 if(B->CancelRequested){B->State=TEXT("cancelled");return true;}if(!Verify(*B))return true;
 if(B->NextIndex>=B->Items.Num()){B->State=TEXT("completed");return true;}
 FItem& I=B->Items[B->NextIndex];if(I.Status!=TEXT("not_started")){Conflict(*B,TEXT("unexpected_item_state_before_spawn"));return true;}
 TGuardValue<bool> Own(OwnMutation,true);FActorSpawnParameters P;P.Name=FName(*I.Name);P.NameMode=FActorSpawnParameters::ESpawnActorNameMode::Required_ErrorAndReturnNull;P.OverrideLevel=B->World->PersistentLevel;P.SpawnCollisionHandlingOverride=ESpawnActorCollisionHandlingMethod::AlwaysSpawn;P.ObjectFlags=RF_Transactional;
 AStaticMeshActor* A=B->World->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(),I.Transform,P);if(!A){I.Status=TEXT("failed");I.Reason=TEXT("spawn_failed_no_name_adoption");B->State=TEXT("failed");return true;}
 I.Actor=A;I.ActorGuid=A->GetActorGuid();A->SetActorLabel(I.Name,true);A->Tags.Add(FName(*(TEXT("UAgentOperation_")+B->Id)));A->Tags.Add(FName(*(TEXT("UAgentItem_")+I.Id)));A->GetStaticMeshComponent()->SetStaticMesh(B->Meshes.FindChecked(I.MeshPath).Get());A->GetStaticMeshComponent()->OverrideMaterials.Reset();A->GetStaticMeshComponent()->SetMaterial(0,B->Material.Get());B->World->MarkPackageDirty();I.Status=TEXT("applied");if(!Match(*B,I)){I.Status=TEXT("unknown");I.Reason=TEXT("post_spawn_verification_failed");Conflict(*B,TEXT("post_spawn_verification_failed"));return true;}++B->NextIndex;
 if(B->PauseAfter>0&&!B->TestPauseUsed&&B->NextIndex==B->PauseAfter){B->TestPauseUsed=true;B->State=TEXT("paused_for_test_cancel");}
 else if(B->NextIndex==B->Items.Num())B->State=TEXT("completed");return true;
}
FModelContextProtocolToolResult Invoke(int32 Tool,const TSharedPtr<FJsonObject>& A)
{
 if(!IsInGameThread())return Error(TEXT("game_thread_required"));if(Tool==0){if(!Exact(A,{}))return Error(TEXT("unknown_argument"));TSharedPtr<FJsonValue> V=MakeShared<FJsonValueObject>(Capabilities());return UE::ModelContextProtocol::MakeStructuredContentResult(V);}
 if(!Enabled||(Tool!=3&&Tool!=4&&FPlatformTime::Seconds()-Started>600))return Error(TEXT("scene_scope_disabled_or_expired"));
 TArray<FString> Keys{TEXT("protocolVersion"),TEXT("contractVersion"),TEXT("expectedProjectKey"),TEXT("expectedInstanceId"),TEXT("expectedRootObjectId"),TEXT("runId"),TEXT("plan")};if(Tool!=4)Keys.Add(TEXT("hostPermit"));if(Tool==5||Tool==6)Keys.Add(TEXT("queryToken"));if(!Exact(A,Keys))return Error(TEXT("unknown_or_missing_argument"));
 FString S;double V=0;if(!A->TryGetNumberField(TEXT("protocolVersion"),V)||V!=2||!A->TryGetStringField(TEXT("contractVersion"),S)||S!=Contract||!A->TryGetStringField(TEXT("expectedProjectKey"),S)||S!=Project||UAgentSemanticV2::Capabilities()->GetStringField(TEXT("projectKey"))!=Project||!A->TryGetStringField(TEXT("expectedInstanceId"),S)||S!=Instance||!A->TryGetStringField(TEXT("expectedRootObjectId"),S)||S!=RootId||!A->TryGetStringField(TEXT("runId"),S)||S!=RunId)return Error(TEXT("stale_identity_run_or_project_descriptor"));
 const TSharedPtr<FJsonObject>* P=nullptr;FBatch Parsed;if(!A->TryGetObjectField(TEXT("plan"),P)||!ParsePlan(*P,Parsed))return Error(TEXT("invalid_exact_bounded_item_plan"));FBatch* B=Find(Parsed.Id);if(!B||Parsed.Canonical!=B->Canonical)return Error(TEXT("plan_differs_from_exact_batch_approval"));
 if(Tool==4)return Result(Tool,*B);
 if(!ActiveId.IsEmpty()&&ActiveId!=B->Id)return Error(TEXT("editor_resource_owned_by_another_batch"));
 if(Tool==1)
 {
  if(B->State!=TEXT("not_started"))return Error(TEXT("prepare_not_repeatable_current_run_only"));
  UWorld* Old=GEditor?GEditor->GetEditorWorldContext().World():nullptr;if(const TCHAR* Rejected=CurrentWorldPreparationRejection(Old))return Error(Rejected);
  TArray<uint8> Bytes;bool Exists=false;ReadMap(*B,Bytes,Exists);if(Exists||FindPackage(nullptr,*B->Map))return Error(TEXT("target_map_not_absent"));
  if(!Consume(Tool,*B,A))return Error(TEXT("one_use_host_permit_missing_consumed_or_revoked"));
  TGuardValue<bool> Own(OwnMutation,true);ActiveId=B->Id;
  for(const auto& I:B->Items)if(!B->Meshes.Contains(I.MeshPath)){UStaticMesh* M=LoadObject<UStaticMesh>(nullptr,*I.MeshPath);if(!M){B->State=TEXT("failed");return Error(TEXT("fixed_mesh_dependency_missing"));}B->Meshes.Add(I.MeshPath,TStrongObjectPtr<UStaticMesh>(M));}
  B->Material.Reset(LoadObject<UMaterialInterface>(nullptr,*MaterialPath));if(!B->Material.IsValid()){B->State=TEXT("failed");return Error(TEXT("fixed_material_dependency_missing"));}
  if(GEditor->GetEditorWorldContext().World()!=Old){B->State=TEXT("failed");return Error(TEXT("current_world_changed_during_preparation"));}if(const TCHAR* Rejected=CurrentWorldPreparationRejection(Old)){B->State=TEXT("failed");return Error(Rejected);}
  UWorld* W=UEditorLoadingAndSavingUtils::NewBlankMap(false);if(!W||W->GetWorldPartition()||!W->PersistentLevel||W->PersistentLevel->IsUsingExternalActors()){B->State=TEXT("failed");return Error(TEXT("ordinary_blank_map_preparation_failed"));}
  UPackage* Package=W->GetOutermost();if(!Package->Rename(*B->Map,nullptr,REN_NonTransactional|REN_DontCreateRedirectors|REN_AllowPackageLinkerMismatch)||!W->Rename(*FPackageName::GetLongPackageAssetName(B->Map),nullptr,REN_NonTransactional|REN_DontCreateRedirectors|REN_AllowPackageLinkerMismatch)){B->State=TEXT("failed");return Error(TEXT("approved_world_naming_failed"));}
  Package->MarkAsFullyLoaded();Package->SetPackageFlags(PKG_ContainsMap);Package->SetDirtyFlag(true);B->World=W;for(AActor* Actor:W->PersistentLevel->Actors)if(Actor)B->Baseline.Add(Actor);B->State=TEXT("prepared");return Result(Tool,*B);
 }
 if(!Verify(*B))return Error(TEXT("batch_conflicted_query_individual_effects"));
 if(Tool==3){if(!Consume(Tool,*B,A))return Error(TEXT("one_use_cancel_permit_required"));B->CancelRequested=true;if(B->State==TEXT("running")||B->State==TEXT("paused_for_test_cancel")||B->State==TEXT("prepared"))B->State=TEXT("cancelled");return Result(Tool,*B);}
 if(Tool==2){if(B->State!=TEXT("prepared")||!Consume(Tool,*B,A))return Error(TEXT("approved_prepared_execute_permit_required"));B->State=TEXT("running");return Result(Tool,*B);}
 FString Token;if(!A->TryGetStringField(TEXT("queryToken"),Token)||!Guid(Token)||B->QueryToken.IsEmpty()||Token!=B->QueryToken||B->QueryDigest!=ObservationDigest(*B))return Error(TEXT("fresh_owned_query_checkpoint_required"));
 if(Tool==5){if(B->State!=TEXT("cancelled")||!Consume(Tool,*B,A))return Error(TEXT("cancelled_batch_and_one_use_resume_permission_required"));B->CancelRequested=false;B->State=TEXT("running");return Result(Tool,*B);}
 if(Tool!=6||B->State!=TEXT("completed")||B->NextIndex!=B->Items.Num())return Error(TEXT("save_requires_verified_complete_plan"));for(const auto& I:B->Items)if(I.Status!=TEXT("applied"))return Error(TEXT("save_contains_unverified_item"));if(!Consume(Tool,*B,A))return Error(TEXT("explicit_one_use_map_save_permission_required"));
 TGuardValue<bool> Own(OwnMutation,true);const FString Stage=FPaths::Combine(Scratch,FGuid::NewGuid().ToString(EGuidFormats::Digits)+TEXT(".staged.umap"));FSavePackageArgs Args;Args.TopLevelFlags=RF_Public|RF_Standalone;Args.SaveFlags=SAVE_NoError;
 if(!UPackage::SavePackage(B->World->GetOutermost(),B->World.Get(),*Stage,Args)){B->World->MarkPackageDirty();B->State=TEXT("failed");return Error(TEXT("scoped_map_stage_save_failed"));}B->World->GetOutermost()->SetLoadedPath(FPackagePath::FromPackageNameChecked(B->Map));
 TArray<uint8> Bytes;if(!FFileHelper::LoadFileToArray(Bytes,*Stage)||Bytes.IsEmpty()||Bytes.Num()>64*1024*1024){B->World->MarkPackageDirty();B->State=TEXT("failed");return Error(TEXT("staged_map_read_failed"));}LONG Status=0;HANDLE File=MapFile(*B,true,Status);if(File==INVALID_HANDLE_VALUE){B->World->MarkPackageDirty();Conflict(*B,TEXT("exclusive_map_create_rejected_external_change"));return Error(TEXT("exclusive_map_create_rejected_query_before_retry"));}
 DWORD Count=0;const bool Written=WriteFile(File,Bytes.GetData(),Bytes.Num(),&Count,nullptr)&&Count==static_cast<DWORD>(Bytes.Num())&&FlushFileBuffers(File);CloseHandle(File);B->SavedHash=Hash(Bytes);
 TArray<uint8> ReadBytes;bool Exists=false;if(!Written||!ReadMap(*B,ReadBytes,Exists)||!Exists||Hash(ReadBytes)!=B->SavedHash){B->World->MarkPackageDirty();Conflict(*B,TEXT("unknown_partial_map_save"));return Error(TEXT("unknown_partial_map_save_query_required"));}
 B->Saved=true;B->State=TEXT("saved");B->World->GetOutermost()->SetDirtyFlag(false);FAssetRegistryModule::AssetCreated(B->World.Get());ActiveId.Reset();return Result(Tool,*B);
}
#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FScenePrepareOldWorldGuardTest,"UAgent.Scene.PrepareOldWorldGuard",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FScenePrepareOldWorldGuardTest::RunTest(const FString&)
{
 FString ApprovedFile;auto Marker=ReadJson(FPaths::Combine(FPaths::ProjectDir(),TEXT(".uagent-isolated-lab.json")));bool Existing=true;
 if(!FParse::Param(FCommandLine::Get(),TEXT("UAgentSceneReviewFixture"))||!FParse::Value(FCommandLine::Get(),TEXT("UAgentSceneAllowedProjectFile="),ApprovedFile)||FString(FApp::GetProjectName())!=TEXT("UAgentBuildLab")||!FPaths::IsSamePath(ApprovedFile,FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath()))||!Marker||!Marker->TryGetBoolField(TEXT("existingUserProject"),Existing)||Existing||Marker->GetStringField(TEXT("project"))!=TEXT("UAgentBuildLab")){AddError(TEXT("Explicit isolated Lab review fixture authorization required"));return false;}
 UWorld* World=GEditor?GEditor->GetEditorWorldContext().World():nullptr;
 if(!TestNotNull(TEXT("Actual isolated Editor world"),World)||Enabled||!Batches.IsEmpty()||!ActiveId.IsEmpty())return false;
 const bool MainWasDirty=World->GetOutermost()->IsDirty();World->GetOutermost()->SetDirtyFlag(false);
 if(!TestTrue(TEXT("Starting world is supported and clean"),CurrentWorldPreparationRejection(World)==nullptr)){World->GetOutermost()->SetDirtyFlag(MainWasDirty);return false;}
 auto Plan=Obj();Plan->SetStringField(TEXT("operationId"),FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens).ToLower());Plan->SetStringField(TEXT("targetMap"),Root+TEXT("/L_ReviewGuardNeverCreated"));Plan->SetStringField(TEXT("expectedDiskState"),TEXT("absent"));TArray<TSharedPtr<FJsonValue>> Items;
 for(int32 I=0;I<20;++I){auto Item=Obj();Item->SetStringField(TEXT("itemId"),FString::Printf(TEXT("guard_%02d"),I));Item->SetStringField(TEXT("objectName"),FString::Printf(TEXT("UA14_Guard_%02d"),I));Item->SetStringField(TEXT("mesh"),TEXT("/Engine/BasicShapes/Cube.Cube"));Item->SetStringField(TEXT("material"),MaterialPath);Item->SetObjectField(TEXT("transform"),TransformJson(FTransform::Identity));Items.Add(MakeShared<FJsonValueObject>(Item));}Plan->SetArrayField(TEXT("items"),Items);
 auto Batch=MakeUnique<FBatch>();if(!ParsePlan(Plan,*Batch)){AddError(TEXT("Valid exact test plan"));World->GetOutermost()->SetDirtyFlag(MainWasDirty);return false;}Batch->Permits[0]=FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens).ToLower();FBatch* B=Batch.Get();Batches.Add(MoveTemp(Batch));
 TGuardValue<bool> TestEnabled(Enabled,true);TGuardValue<double> TestStarted(Started,FPlatformTime::Seconds());
 auto Args=Obj();Args->SetNumberField(TEXT("protocolVersion"),2);Args->SetStringField(TEXT("contractVersion"),Contract);Args->SetStringField(TEXT("expectedProjectKey"),Project);Args->SetStringField(TEXT("expectedInstanceId"),Instance);Args->SetStringField(TEXT("expectedRootObjectId"),RootId);Args->SetStringField(TEXT("runId"),RunId);Args->SetObjectField(TEXT("plan"),Plan);Args->SetStringField(TEXT("hostPermit"),B->Permits[0]);
 auto CheckRejected=[&](const TCHAR* Case,const TCHAR* Expected)
 {
  const auto Response=Invoke(1,Args);bool IsError=false;const auto Json=Response.JsonObject;
  TestTrue(Case,Json.IsValid()&&Json->TryGetBoolField(TEXT("isError"),IsError)&&IsError);
  FString Serialized;if(Json)FJsonSerializer::Serialize(Json.ToSharedRef(),TJsonWriterFactory<>::Create(&Serialized));TestTrue(TEXT("Exact old-world precondition error"),Serialized.Contains(Expected));
  TestFalse(TEXT("Rejected prepare does not consume its permit"),B->Consumed[0]);TestEqual(TEXT("Rejected batch stays not_started"),B->State,FString(TEXT("not_started")));TestTrue(TEXT("No resource load before rejection"),B->Meshes.IsEmpty()&&!B->Material.IsValid());TestTrue(TEXT("Editor world and level objects retained"),GEditor->GetEditorWorldContext().World()==World&&IsValid(World->PersistentLevel));TestTrue(TEXT("No map resource ownership acquired"),ActiveId.IsEmpty());
 };
 const FString ChildName=TEXT("/Temp/UAgentSceneReview/DirtyChild");UPackage* ChildPackage=CreatePackage(*ChildName);UWorld* Child=UWorld::CreateWorld(EWorldType::Inactive,false,TEXT("DirtyChild"),ChildPackage,false);ULevel* ChildLevel=Child?Child->PersistentLevel:nullptr;
 if(TestNotNull(TEXT("Real in-memory child level"),ChildLevel))
 {
  World->AddLevel(ChildLevel);ChildPackage->SetDirtyFlag(true);World->GetOutermost()->SetDirtyFlag(false);
  TestFalse(TEXT("Main package clean while child dirty"),World->GetOutermost()->IsDirty());TestTrue(TEXT("Child package really dirty"),ChildPackage->IsDirty());CheckRejected(TEXT("Clean main with dirty loaded child rejected"),TEXT("dirty_current_or_related_map_package_rejected"));TestTrue(TEXT("Dirty child still loaded and dirty after rejection"),World->GetLevels().Contains(ChildLevel)&&ChildPackage->IsDirty());
  ChildPackage->SetDirtyFlag(false);CheckRejected(TEXT("Clean extra loaded level also unsupported"),TEXT("current_world_structure_unsupported_no_unload"));World->RemoveLevel(ChildLevel);Child->DestroyWorld(false);
 }
 ULevelStreamingDynamic* Streaming=NewObject<ULevelStreamingDynamic>(World);World->AddStreamingLevel(Streaming);World->GetOutermost()->SetDirtyFlag(false);CheckRejected(TEXT("Streaming structure rejected before permit"),TEXT("current_world_structure_unsupported_no_unload"));World->RemoveStreamingLevel(Streaming);
 World->PersistentLevel->SetUseExternalActors(true);World->GetOutermost()->SetDirtyFlag(false);CheckRejected(TEXT("External actors structure rejected before permit"),TEXT("current_world_structure_unsupported_no_unload"));World->PersistentLevel->SetUseExternalActors(false);
 World->GetOutermost()->SetDirtyFlag(MainWasDirty);Batches.Pop();return true;
}
#endif
class FTool final:public IModelContextProtocolTool
{
 int32 Id;
public:
 explicit FTool(int32 I):Id(I){}FString GetName()const override{return ToolNames[Id];}FString GetDescription()const override{return Id==0?TEXT("Discover separate current-run scoped static scene batch contract. No production permission."):TEXT("Exact 1–20 item ordinary-map batch. Explicit prepare/write/save authority; query reads actual owned objects without asset loading; cancel is not rollback; resume only after verified current-run query.");}TSharedPtr<FJsonObject> GetInputJsonSchema()const override{return Input(Id);}TSharedPtr<FJsonObject> GetOutputJsonSchema()const override{return Output(Id);}FModelContextProtocolToolResult Run(const TSharedPtr<FJsonObject>& A)override{return Invoke(Id,A);}
};
}
class FModule final:public IModuleInterface
{
 TArray<TSharedRef<IModelContextProtocolTool>> Tools;FTSTicker::FDelegateHandle TickHandle;FDelegateHandle Modified,Added,Deleted;
 void External(UObject* Object){FBatch* B=Active();if(!OwnMutation&&B&&B->World.IsValid()&&Object&&Object->GetOutermost()==B->World->GetOutermost())Conflict(*B,TEXT("external_editor_object_modification"));}
 void ExternalActor(AActor* A){External(A);}
 void EnableApprovedProject()
 {
  FString ApprovedFile,PlanFile;if(!FParse::Param(FCommandLine::Get(),TEXT("UAgentSceneEnableApprovedProjectWrites"))||!FParse::Value(FCommandLine::Get(),TEXT("UAgentSceneAllowedProjectFile="),ApprovedFile)||!FParse::Value(FCommandLine::Get(),TEXT("UAgentSceneApprovedPlansFile="),PlanFile)||!FPaths::IsSamePath(ApprovedFile,FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath())))return;
  Scratch=FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectSavedDir(),TEXT("UAgentSceneT14")));if(!FPaths::IsSamePath(FPaths::ConvertRelativePathToFull(PlanFile),FPaths::Combine(Scratch,TEXT("host-approved-plans.json"))))return;
  if(!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::ProjectDir()),&RootId)||!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir()))||!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectContentDir(),TEXT("UAgentBuildLab"))))||!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectContentDir(),TEXT("UAgentBuildLab/Scene_T14"))))||!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()))||!HoldDirectory(Scratch))return;
  auto Approval=ReadJson(PlanFile);if(!Approval||!Approval->HasTypedField<EJson::String>(TEXT("projectFile"))||Approval->GetStringField(TEXT("projectFile"))!=FPaths::GetCleanFilename(ApprovedFile)||Approval->GetStringField(TEXT("rootObjectId"))!=RootId||!Approval->TryGetStringField(TEXT("runId"),RunId)||!Guid(RunId))return;
  const TArray<TSharedPtr<FJsonValue>>* Operations=nullptr;if(!Approval->TryGetArrayField(TEXT("operations"),Operations)||(Operations->Num()<1||Operations->Num()>2))return;TSet<FString> Ids,Maps,Tokens;
  for(auto& Value:*Operations){auto O=Value->AsObject();const TSharedPtr<FJsonObject>* P=nullptr;if(!O||!O->TryGetObjectField(TEXT("plan"),P))return;auto B=MakeUnique<FBatch>();if(!ParsePlan(*P,*B)||Ids.Contains(B->Id)||Maps.Contains(B->Map))return;Ids.Add(B->Id);Maps.Add(B->Map);for(int32 I=0;I<5;++I){if(!O->TryGetStringField(PurposeKeys[I],B->Permits[I])||!Guid(B->Permits[I])||Tokens.Contains(B->Permits[I]))return;Tokens.Add(B->Permits[I]);}double Pause=0;if(O->HasField(TEXT("pauseAfterItem"))&&(!O->TryGetNumberField(TEXT("pauseAfterItem"),Pause)||(Pause!=0&&Pause!=7)))return;B->PauseAfter=static_cast<int32>(Pause);Batches.Add(MoveTemp(B));}
  Enabled=true;Started=FPlatformTime::Seconds();
 }
public:
 void StartupModule()override{Instance=FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens).ToLower();RootId=TEXT("unverified-root");RunId=TEXT("00000000-0000-0000-0000-000000000000");Project=UAgentSemanticV2::Capabilities()->GetStringField(TEXT("projectKey"));if(!LoadSchemas()){UE_LOG(LogTemp,Error,TEXT("Scene v2 exact schema resource missing or invalid; tools unavailable"));return;}EnableApprovedProject();for(int32 I=0;I<ToolNames.Num();++I){auto T=MakeShared<FTool>(I);if(IModelContextProtocolModule::GetChecked().AddTool(T))Tools.Add(T);}TickHandle=FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick),0.05f);Modified=FCoreUObjectDelegates::OnObjectModified.AddRaw(this,&FModule::External);if(GEngine){Added=GEngine->OnLevelActorAdded().AddRaw(this,&FModule::ExternalActor);Deleted=GEngine->OnLevelActorDeleted().AddRaw(this,&FModule::ExternalActor);}}
 void ShutdownModule()override{Enabled=false;FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);FCoreUObjectDelegates::OnObjectModified.Remove(Modified);if(GEngine){GEngine->OnLevelActorAdded().Remove(Added);GEngine->OnLevelActorDeleted().Remove(Deleted);}if(auto* M=IModelContextProtocolModule::Get())for(auto& T:Tools)M->RemoveTool(T);Tools.Reset();SchemaCatalogue.Reset();Batches.Reset();for(int32 I=Directories.Num()-1;I>=0;--I)CloseHandle(Directories[I]);Directories.Reset();}
};
}
IMPLEMENT_MODULE(UAgentSceneV2::FModule,UAgentSceneBatchToolsV2);
