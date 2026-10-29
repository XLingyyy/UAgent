#include "CoreMinimal.h"
#include "UAgentPickupV2LabTests.h"
#include "IModelContextProtocolModule.h"
#include "IModelContextProtocolTool.h"
#include "ModelContextProtocolToolResults.h"
#include "UAgentSemanticV2.h"
#include "UAgentPickupActorV2.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/Font.h"
#include "Engine/StaticMesh.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformTime.h"
#include "Hash/Blake3.h"
#include "Kismet2/CompilerResultsLog.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Misc/App.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#endif
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/PackagePath.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonWriter.h"
#include "UObject/MetaData.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "Windows/WindowsHWrapper.h"
#include "Windows/AllowWindowsPlatformTypes.h"
#include <winternl.h>
#include "Windows/HideWindowsPlatformTypes.h"
namespace UAgentPickupV2
{
namespace
{
const FString Contract = TEXT("2.1.0-pickup-create-only");
const FString Root = TEXT("/Game/UAgentBuildLab/Pickup_T13");
const FString Parent = TEXT("/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2");
const FString Template = TEXT("actor.pickup.native.v1");
const FString MeshPath = TEXT("/Engine/BasicShapes/Cube.Cube");
const FString FontPath = TEXT("/Engine/EngineFonts/RobotoDistanceField.RobotoDistanceField");
const TArray<FString> Names { TEXT("uagent.v2.pickup.capabilities"), TEXT("uagent.v2.pickup.prepare"), TEXT("uagent.v2.pickup.preview"), TEXT("uagent.v2.pickup.apply"), TEXT("uagent.v2.pickup.query") };
const TArray<FString> PlanKeys { TEXT("operationId"), TEXT("targetPackage"), TEXT("expectedDiskState"), TEXT("templateId"), TEXT("parentClass"), TEXT("itemId"), TEXT("promptText"), TEXT("interactionRadiusCm"), TEXT("interactionKey") };
FString Instance, Project, RootId, PreviewToken, Scratch, ApprovedCanonical;
TSharedPtr<FJsonObject> ApprovedPlan, Receipt;
TArray<HANDLE> DirectoryHandles;
FString Permits[3]; bool Consumed[3] {false,false,false}; bool Enabled = false, Prepared = false;
double Started = 0;
TStrongObjectPtr<UStaticMesh> Mesh; TStrongObjectPtr<UFont> Font;
TStrongObjectPtr<UBlueprint> Preview;
TSharedPtr<FJsonObject> Obj() { return MakeShared<FJsonObject>(); }
TSharedPtr<FJsonObject> Kind(const TCHAR* Type) { auto V=Obj(); V->SetStringField(TEXT("type"), Type); return V; }
TArray<TSharedPtr<FJsonValue>> Strings(const TArray<FString>& Values) { TArray<TSharedPtr<FJsonValue>> Out; for (const FString& V:Values) Out.Add(MakeShared<FJsonValueString>(V)); return Out; }
FString Hash(const TArray<uint8>& Bytes) { const FBlake3Hash H=FBlake3::HashBuffer(Bytes.GetData(), Bytes.Num()); return BytesToHex(H.GetBytes(),32).ToLower(); }
FString HashText(const FString& Text) { FTCHARToUTF8 Utf(*Text); TArray<uint8> B; B.Append(reinterpret_cast<const uint8*>(Utf.Get()),Utf.Length()); return Hash(B); }
bool Guid(const FString& V) { FGuid G; return FGuid::ParseExact(V, EGuidFormats::DigitsWithHyphens, G) && G.ToString(EGuidFormats::DigitsWithHyphens).ToLower()==V; }
bool Exact(const TSharedPtr<FJsonObject>& V, const TArray<FString>& Keys) { if (!V.IsValid() || V->Values.Num()!=Keys.Num()) return false; for (auto& K:Keys) if (!V->HasField(K)) return false; return true; }
bool Word(const FString& S, int32 Max) { if (S.IsEmpty() || S.Len()>Max) return false; for (TCHAR C:S) if (!((C>=TEXT('A')&&C<=TEXT('Z'))||(C>=TEXT('a')&&C<=TEXT('z'))||(C>=TEXT('0')&&C<=TEXT('9'))||C==TEXT('_'))) return false; return true; }
FString Canonical(const TSharedPtr<FJsonObject>& P)
{
 if (!Exact(P,PlanKeys)) return FString();
 FString Op,Target,Expected,Tpl,Base,Item,Prompt,Key; double Radius=0;
 if (!P->TryGetStringField(TEXT("operationId"),Op)||!Guid(Op)||!P->TryGetStringField(TEXT("targetPackage"),Target)||!Target.StartsWith(Root+TEXT("/BP_"))||!Word(Target.RightChop(Root.Len()+1),80)||!P->TryGetStringField(TEXT("expectedDiskState"),Expected)||Expected!=TEXT("absent")||!P->TryGetStringField(TEXT("templateId"),Tpl)||Tpl!=Template||!P->TryGetStringField(TEXT("parentClass"),Base)||Base!=Parent||!P->TryGetStringField(TEXT("itemId"),Item)||!Word(Item,64)||!P->TryGetStringField(TEXT("promptText"),Prompt)||Prompt.IsEmpty()||Prompt.Len()>128||!P->TryGetNumberField(TEXT("interactionRadiusCm"),Radius)||!FMath::IsFinite(Radius)||Radius<50||Radius>1000||FMath::FloorToDouble(Radius)!=Radius||!P->TryGetStringField(TEXT("interactionKey"),Key)||(Key!=TEXT("E")&&Key!=TEXT("F"))) return FString();
 for (TCHAR C:Prompt) if (C<32 || C==127) return FString();
 return Op+TEXT("\n")+Target+TEXT("\nabsent\n")+Tpl+TEXT("\n")+Base+TEXT("\n")+Item+TEXT("\n")+Prompt+TEXT("\n")+FString::FromInt(static_cast<int32>(Radius))+TEXT("\n")+Key;
}
FString TargetFile() { return FPackageName::LongPackageNameToFilename(ApprovedPlan->GetStringField(TEXT("targetPackage")),FPackageName::GetAssetPackageExtension()); }
FString ReceiptFile() { return FPaths::Combine(Scratch,ApprovedPlan->GetStringField(TEXT("operationId"))+TEXT(".receipt.json")); }
bool WriteJson(const FString& File,const TSharedPtr<FJsonObject>& Value) { FString S; FJsonSerializer::Serialize(Value.ToSharedRef(),TJsonWriterFactory<>::Create(&S)); return FFileHelper::SaveStringToFile(S,*File,FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM); }
TSharedPtr<FJsonObject> ReadJson(const FString& File) { FString S; TSharedPtr<FJsonObject> V; if (!FFileHelper::LoadFileToString(S,*File)||!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(S),V)) return nullptr; return V; }
FModelContextProtocolToolResult Success(int32 Tool,const TSharedPtr<FJsonObject>& Data)
{
 auto R=Obj(); R->SetStringField(TEXT("schemaVersion"),TEXT("uagent.pickup.result.v2")); R->SetStringField(TEXT("contractVersion"),Contract); R->SetStringField(TEXT("projectKey"),Project); R->SetStringField(TEXT("instanceId"),Instance); R->SetStringField(TEXT("rootObjectId"),RootId); R->SetObjectField(TEXT("plan"),ApprovedPlan); R->SetStringField(TEXT("operation"),Names[Tool]); R->SetStringField(TEXT("planHash"),HashText(ApprovedCanonical)); R->SetObjectField(TEXT("data"),Data);
 TSharedPtr<FJsonValue> V=MakeShared<FJsonValueObject>(R); return UE::ModelContextProtocol::MakeStructuredContentResult(V);
}
FModelContextProtocolToolResult Fail(const TCHAR* Error) { return UE::ModelContextProtocol::MakeErrorResult(Error); }
bool HoldDirectory(const FString& File,FString* Identity=nullptr)
{
 HANDLE H=CreateFileW(*File,FILE_READ_ATTRIBUTES|FILE_TRAVERSE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
 if (H==INVALID_HANDLE_VALUE) return false; BY_HANDLE_FILE_INFORMATION I{};
 if (!GetFileInformationByHandle(H,&I)||!(I.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)||(I.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)) { CloseHandle(H); return false; }
 if (Identity) *Identity=FString::Printf(TEXT("%u:%llu"),I.dwVolumeSerialNumber,(static_cast<uint64>(I.nFileIndexHigh)<<32)|I.nFileIndexLow);
 DirectoryHandles.Add(H); return true;
}
// No path lookup at final target creation: resolve one validated leaf relative to a held directory object.
HANDLE RelativeTarget(bool Create, LONG& Status)
{
 using FCreate=NTSTATUS (NTAPI*)(PHANDLE,ACCESS_MASK,POBJECT_ATTRIBUTES,PIO_STATUS_BLOCK,PLARGE_INTEGER,ULONG,ULONG,ULONG,ULONG,PVOID,ULONG);
 const auto NtCreate=reinterpret_cast<FCreate>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtCreateFile"));
 if (!NtCreate || DirectoryHandles.Num()!=6) { Status=static_cast<LONG>(0xC0000008); return INVALID_HANDLE_VALUE; }
 const FString Leaf=FPackageName::GetLongPackageAssetName(ApprovedPlan->GetStringField(TEXT("targetPackage")))+TEXT(".uasset");
 UNICODE_STRING Name{}; Name.Length=static_cast<USHORT>(Leaf.Len()*sizeof(WCHAR));Name.MaximumLength=Name.Length;Name.Buffer=const_cast<PWSTR>(*Leaf);
 OBJECT_ATTRIBUTES Attributes{}; Attributes.Length=sizeof(Attributes); Attributes.RootDirectory=DirectoryHandles[3];Attributes.ObjectName=&Name;Attributes.Attributes=OBJ_CASE_INSENSITIVE;
 IO_STATUS_BLOCK IO{};HANDLE File=INVALID_HANDLE_VALUE;
 Status=NtCreate(&File,(Create?GENERIC_WRITE:GENERIC_READ)|SYNCHRONIZE,&Attributes,&IO,nullptr,FILE_ATTRIBUTE_NORMAL,Create?0:(FILE_SHARE_READ|FILE_SHARE_WRITE),Create?FILE_CREATE:FILE_OPEN,FILE_NON_DIRECTORY_FILE|FILE_SYNCHRONOUS_IO_NONALERT|FILE_OPEN_REPARSE_POINT,nullptr,0);
 return Status>=0?File:INVALID_HANDLE_VALUE;
}
bool ReadTarget(TArray<uint8>& Bytes,bool& Exists)
{
 LONG Status=0;HANDLE File=RelativeTarget(false,Status);Exists=static_cast<ULONG>(Status)!=0xC0000034 && static_cast<ULONG>(Status)!=0xC000003A;
 if (File==INVALID_HANDLE_VALUE) return false;Exists=true;
 BY_HANDLE_FILE_INFORMATION Info{};bool OK=GetFileInformationByHandle(File,&Info)&&!(Info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))&&Info.nNumberOfLinks==1&&Info.nFileSizeHigh==0&&Info.nFileSizeLow<=64*1024*1024;
 if (OK) {Bytes.SetNumUninitialized(Info.nFileSizeLow);DWORD Count=0;OK=ReadFile(File,Bytes.GetData(),Info.nFileSizeLow,&Count,nullptr)&&Count==Info.nFileSizeLow;}
 CloseHandle(File);return OK;
}
TSharedPtr<FJsonObject> StringSchema(int32 Max=4096,const FString& Constant=FString()) { auto S=Kind(TEXT("string")); S->SetNumberField(TEXT("minLength"),1); S->SetNumberField(TEXT("maxLength"),Max); if (!Constant.IsEmpty()) S->SetStringField(TEXT("const"),Constant); return S; }
TSharedPtr<FJsonObject> PlanSchema()
{
 auto S=Kind(TEXT("object")); S->SetBoolField(TEXT("additionalProperties"),false); auto P=Obj();
 for (const FString& K:PlanKeys) P->SetObjectField(K,StringSchema());
 P->SetObjectField(TEXT("operationId"),StringSchema(36)); P->SetObjectField(TEXT("targetPackage"),StringSchema(1024)); P->SetObjectField(TEXT("expectedDiskState"),StringSchema(6,TEXT("absent"))); P->SetObjectField(TEXT("templateId"),StringSchema(64,Template)); P->SetObjectField(TEXT("parentClass"),StringSchema(128,Parent)); P->SetObjectField(TEXT("itemId"),StringSchema(64)); P->SetObjectField(TEXT("promptText"),StringSchema(128));
 auto Radius=Kind(TEXT("integer")); Radius->SetNumberField(TEXT("minimum"),50); Radius->SetNumberField(TEXT("maximum"),1000); P->SetObjectField(TEXT("interactionRadiusCm"),Radius);
 auto Key=StringSchema(1); Key->SetArrayField(TEXT("enum"),Strings({TEXT("E"),TEXT("F")})); P->SetObjectField(TEXT("interactionKey"),Key);
 S->SetObjectField(TEXT("properties"),P); S->SetArrayField(TEXT("required"),Strings(PlanKeys)); return S;
}
TSharedPtr<FJsonObject> Input(int32 Tool)
{
 auto S=Kind(TEXT("object")); S->SetBoolField(TEXT("additionalProperties"),false); auto P=Obj(); TArray<FString> Req;
 if (Tool>0) { auto V=Kind(TEXT("integer")); V->SetNumberField(TEXT("const"),2); P->SetObjectField(TEXT("protocolVersion"),V); P->SetObjectField(TEXT("contractVersion"),StringSchema(64,Contract)); P->SetObjectField(TEXT("expectedProjectKey"),StringSchema()); P->SetObjectField(TEXT("expectedInstanceId"),StringSchema()); P->SetObjectField(TEXT("expectedRootObjectId"),StringSchema()); P->SetObjectField(TEXT("plan"),PlanSchema()); Req={TEXT("protocolVersion"),TEXT("contractVersion"),TEXT("expectedProjectKey"),TEXT("expectedInstanceId"),TEXT("expectedRootObjectId"),TEXT("plan")}; if (Tool<4) { P->SetObjectField(TEXT("hostPermit"),StringSchema(36)); Req.Add(TEXT("hostPermit")); } if (Tool==3) { P->SetObjectField(TEXT("previewToken"),StringSchema(36)); Req.Add(TEXT("previewToken")); } }
 S->SetObjectField(TEXT("properties"),P); S->SetArrayField(TEXT("required"),Strings(Req)); return S;
}
TSharedPtr<FJsonObject> Output(int32 Tool)
{
 auto S=Kind(TEXT("object")); S->SetBoolField(TEXT("additionalProperties"),false); auto P=Obj(); TArray<FString> Required;
 auto Add=[&](const TCHAR* K,const TCHAR* Type){P->SetObjectField(K,Kind(Type));Required.Add(K);};
 for (const TCHAR* K:{TEXT("schemaVersion"),TEXT("contractVersion"),TEXT("projectKey"),TEXT("instanceId"),TEXT("rootObjectId")}) Add(K,TEXT("string"));
 if (Tool==0)
 {
  Add(TEXT("protocolVersion"),TEXT("integer")); Add(TEXT("available"),TEXT("boolean")); Add(TEXT("productionSupported"),TEXT("boolean"));
  for (const TCHAR* K:{TEXT("scopeMode"),TEXT("writeRoot"),TEXT("allowedMap"),TEXT("allowedTarget"),TEXT("parentClass"),TEXT("meshDependency"),TEXT("fontDependency"),TEXT("inputDependency"),TEXT("uiDependency"),TEXT("persistence")}) Add(K,TEXT("string"));
  Add(TEXT("tools"),TEXT("array"));
 }
 else { P->SetObjectField(TEXT("plan"),PlanSchema());Required.Add(TEXT("plan"));Add(TEXT("operation"),TEXT("string"));Add(TEXT("planHash"),TEXT("string"));Add(TEXT("data"),TEXT("object")); }
 S->SetObjectField(TEXT("properties"),P);S->SetArrayField(TEXT("required"),Strings(Required));return S;
}
TSharedPtr<FJsonObject> Discovery()
{
 auto R=Obj(); R->SetStringField(TEXT("schemaVersion"),TEXT("uagent.pickup.capabilities.v2")); R->SetNumberField(TEXT("protocolVersion"),2); R->SetStringField(TEXT("contractVersion"),Contract); R->SetStringField(TEXT("projectKey"),Project); R->SetStringField(TEXT("instanceId"),Instance); R->SetStringField(TEXT("rootObjectId"),RootId); R->SetBoolField(TEXT("available"),Enabled); R->SetStringField(TEXT("scopeMode"),TEXT("isolated_lab_only")); R->SetBoolField(TEXT("productionSupported"),false); R->SetStringField(TEXT("writeRoot"),Root); R->SetStringField(TEXT("allowedMap"),Root+TEXT("/L_PickupValidation")); R->SetStringField(TEXT("allowedTarget"),Enabled?ApprovedPlan->GetStringField(TEXT("targetPackage")):FString()); R->SetStringField(TEXT("parentClass"),Parent); R->SetStringField(TEXT("meshDependency"),MeshPath); R->SetStringField(TEXT("fontDependency"),FontPath); R->SetStringField(TEXT("inputDependency"),TEXT("one local PlayerController with a possessed Pawn; direct E/F key binding; no input mappings generated")); R->SetStringField(TEXT("uiDependency"),TEXT("world-space TextRender with explicit engine font; no UMG dependency")); R->SetStringField(TEXT("persistence"),TEXT("per-runtime-instance transient state; not inventory or SaveGame persistence"));
 TArray<TSharedPtr<FJsonValue>> Tools; for (int32 I=1;I<Names.Num();++I) { auto T=Obj(); T->SetStringField(TEXT("name"),Names[I]); T->SetStringField(TEXT("effect"),I==1?TEXT("authorized_asset_preparation_may_load_compile"):I==2?TEXT("transient_copy_compile"):I==3?TEXT("create_compile_save_one_package"):TEXT("query_effect_no_asset_loading")); T->SetObjectField(TEXT("inputSchema"),Input(I)); T->SetObjectField(TEXT("outputSchema"),Output(I)); Tools.Add(MakeShared<FJsonValueObject>(T)); } R->SetArrayField(TEXT("tools"),Tools); return R;
}
bool Validate(int32 Tool,const TSharedPtr<FJsonObject>& Args,FString& Error)
{
 if (!IsInGameThread()) { Error=TEXT("game_thread_required"); return false; }
 if (Tool==0) { if (!Exact(Args,{})) { Error=TEXT("unknown_argument"); return false; } return true; }
 if (!Enabled || (Tool<4 && FPlatformTime::Seconds()-Started>600)) { Error=TEXT("pickup_lab_scope_disabled_or_expired"); return false; }
 TArray<FString> Keys{TEXT("protocolVersion"),TEXT("contractVersion"),TEXT("expectedProjectKey"),TEXT("expectedInstanceId"),TEXT("expectedRootObjectId"),TEXT("plan")}; if (Tool<4) Keys.Add(TEXT("hostPermit")); if (Tool==3) Keys.Add(TEXT("previewToken"));
 if (!Exact(Args,Keys)) { Error=TEXT("unknown_or_missing_argument"); return false; }
 double V=0; FString S; if (!Args->TryGetNumberField(TEXT("protocolVersion"),V)||V!=2||!Args->TryGetStringField(TEXT("contractVersion"),S)||S!=Contract||!Args->TryGetStringField(TEXT("expectedProjectKey"),S)||S!=Project||!Args->TryGetStringField(TEXT("expectedInstanceId"),S)||S!=Instance||!Args->TryGetStringField(TEXT("expectedRootObjectId"),S)||S!=RootId) { Error=TEXT("stale_identity_or_version"); return false; }
 const TSharedPtr<FJsonObject>* P=nullptr; if (!Args->TryGetObjectField(TEXT("plan"),P)||Canonical(*P).IsEmpty()||Canonical(*P)!=ApprovedCanonical) { Error=TEXT("plan_differs_from_exact_host_approval"); return false; }
 return true;
}
bool Consume(int32 Tool,const TSharedPtr<FJsonObject>& Args) { const int32 I=Tool-1; FString Permit; if (I<0||I>2||Consumed[I]||!Args->TryGetStringField(TEXT("hostPermit"),Permit)||Permit!=Permits[I]) return false; Consumed[I]=true; return true; }
const TCHAR* AbsentPrecondition()
{
 const FString Target=ApprovedPlan->GetStringField(TEXT("targetPackage")); UPackage* Existing=FindPackage(nullptr,*Target);
 if (Existing && Existing->IsDirty()) return TEXT("dirty_target_package_rejected");
 TArray<uint8> Ignored; bool Exists=false; ReadTarget(Ignored,Exists);
 if (Existing || Exists) return TEXT("target_exists_or_changed_since_absence_approval");
 return nullptr;
}
TSharedPtr<FJsonObject> Summary()
{
 auto R=Obj(); R->SetStringField(TEXT("parentClass"),Parent); R->SetStringField(TEXT("templateId"),Template); R->SetStringField(TEXT("memberOrigin"),TEXT("inherited_native_parent; no arbitrary graph editing")); R->SetArrayField(TEXT("components"),Strings({TEXT("PickupRoot:SceneComponent"),TEXT("PickupMesh:StaticMeshComponent"),TEXT("InteractionRange:SphereComponent"),TEXT("PickupPrompt:TextRenderComponent")})); R->SetObjectField(TEXT("typedEditableParameters"),ApprovedPlan); R->SetArrayField(TEXT("parameterTypes"),Strings({TEXT("itemId:FName"),TEXT("promptText:FText"),TEXT("interactionRadiusCm:float_cm[50,1000]"),TEXT("interactionKey:FKey[E,F]")})); R->SetArrayField(TEXT("runtimeState"),Strings({TEXT("bPlayerNearby:bool"),TEXT("bCollected:bool"),TEXT("CollectionCount:int32")})); R->SetStringField(TEXT("behavior"),TEXT("local possessed pawn within radius shows world text; configured key collects once, hides actor, disables collision and broadcasts OnCollected")); return R;
}
UBlueprint* Make(const FString& PackageName,TArray<TSharedPtr<FJsonValue>>& Diagnostics)
{
 UPackage* Package=CreatePackage(*PackageName); const FString Name=FPackageName::GetLongPackageAssetName(PackageName);
 UBlueprint* BP=FKismetEditorUtilities::CreateBlueprint(AUAgentPickupActorV2::StaticClass(),Package,*Name,BPTYPE_Normal,UBlueprint::StaticClass(),UBlueprintGeneratedClass::StaticClass(),TEXT("UAgentFixedPickupTemplate"));
 if (!BP) return nullptr;
 auto Configure=[&]() { auto* CDO=Cast<AUAgentPickupActorV2>(BP->GeneratedClass?BP->GeneratedClass->GetDefaultObject():nullptr); if (!CDO) return false; CDO->ItemId=FName(*ApprovedPlan->GetStringField(TEXT("itemId"))); CDO->PromptText=FText::FromString(ApprovedPlan->GetStringField(TEXT("promptText"))); CDO->InteractionRadiusCm=ApprovedPlan->GetNumberField(TEXT("interactionRadiusCm")); CDO->InteractionKey=ApprovedPlan->GetStringField(TEXT("interactionKey"))==TEXT("E")?EKeys::E:EKeys::F; CDO->PickupMesh->SetStaticMesh(Mesh.Get()); CDO->PickupPrompt->SetFont(Font.Get()); return true; };
 if (!Configure()) return nullptr;
 FCompilerResultsLog Log; FKismetEditorUtilities::CompileBlueprint(BP,EBlueprintCompileOptions::SkipGarbageCollection,&Log);
 for (const auto& Message:Log.Messages) Diagnostics.Add(MakeShared<FJsonValueString>(Message->ToText().ToString()));
 if (Log.NumErrors || BP->Status!=BS_UpToDate || !Configure()) return nullptr;
 Package->GetMetaData().SetValue(BP,TEXT("UAgent.Template"),*Template); Package->GetMetaData().SetValue(BP,TEXT("UAgent.OperationId"),*ApprovedPlan->GetStringField(TEXT("operationId"))); Package->GetMetaData().SetValue(BP,TEXT("UAgent.PlanHash"),*HashText(ApprovedCanonical)); BP->MarkPackageDirty(); return BP;
}
FString ObserveEditorEffect(const FString& PackageName)
{
 UPackage* Package=FindPackage(nullptr,*PackageName); if (!Package) return TEXT("none");
 const FString AssetName=FPackageName::GetLongPackageAssetName(PackageName);
 const UBlueprint* BP=FindObject<UBlueprint>(Package,*AssetName);
 if (!BP||BP->GetOutermost()!=Package||BP->GetPathName()!=PackageName+TEXT(".")+AssetName) return TEXT("package_loaded");
 if (BP->Status==BS_Error) return TEXT("compile_failed");
 if (!Package->IsFullyLoaded()||BP->HasAnyFlags(RF_NeedLoad|RF_NeedPostLoad|RF_NeedPostLoadSubobjects)||BP->bBeingCompiled||BP->bQueuedForCompilation||BP->bIsRegeneratingOnLoad) return TEXT("blueprint_not_ready");
 if (!BP->GeneratedClass||BP->GeneratedClass->GetOutermost()!=Package||BP->GeneratedClass->HasAnyFlags(RF_NeedLoad|RF_NeedPostLoad|RF_NeedPostLoadSubobjects)||!BP->GeneratedClass->GetDefaultObject(false)||BP->Status!=BS_UpToDate) return TEXT("blueprint_loaded_uncompiled");
 return Package->IsDirty()?TEXT("dirty_loaded"):TEXT("compiled_loaded");
}
TSharedPtr<FJsonObject> Query()
{
 auto R=Obj(); auto Stored=ReadJson(ReceiptFile()); FString State=TEXT("not_started"),ExpectedHash;
 if (Stored.IsValid() && Stored->HasTypedField<EJson::Object>(TEXT("plan")) && Canonical(Stored->GetObjectField(TEXT("plan")))==ApprovedCanonical) { Stored->TryGetStringField(TEXT("state"),State); Stored->TryGetStringField(TEXT("expectedDiskHash"),ExpectedHash); }
 TArray<uint8> Bytes; bool Exists=false; const bool ReadOK=ReadTarget(Bytes,Exists); const FString Actual=ReadOK?Hash(Bytes):FString();
 if (Exists && (ExpectedHash.IsEmpty()||Actual!=ExpectedHash)) State=TEXT("unknown_external_change");
 else if (Exists && !ExpectedHash.IsEmpty() && Actual==ExpectedHash) State=TEXT("applied");
 else if (State==TEXT("applied")||State==TEXT("committing")) State=TEXT("unknown_missing_target");
 R->SetStringField(TEXT("state"),State); R->SetStringField(TEXT("observedDiskHash"),Actual); R->SetBoolField(TEXT("diskExists"),Exists); R->SetBoolField(TEXT("queryLoadsAssets"),false);
 auto Effect=Obj(); Effect->SetStringField(TEXT("targetPackage"),ApprovedPlan->GetStringField(TEXT("targetPackage"))); Effect->SetStringField(TEXT("diskEffect"),State==TEXT("applied")?TEXT("created"):State.StartsWith(TEXT("unknown"))?TEXT("unknown"):TEXT("not_created")); Effect->SetStringField(TEXT("editorEffect"),ObserveEditorEffect(ApprovedPlan->GetStringField(TEXT("targetPackage")))); R->SetArrayField(TEXT("effects"),{MakeShared<FJsonValueObject>(Effect)}); return R;
}
FModelContextProtocolToolResult Invoke(int32 Tool,const TSharedPtr<FJsonObject>& Args)
{
 FString Error; if (!Validate(Tool,Args,Error)) return Fail(*Error);
 if (Tool==0) { TSharedPtr<FJsonValue> V=MakeShared<FJsonValueObject>(Discovery()); return UE::ModelContextProtocol::MakeStructuredContentResult(V); }
 if (Tool==4) return Success(Tool,Query());
 if (Tool==3 && Query()->GetStringField(TEXT("state"))==TEXT("applied")) { FString Permit; if (!Consumed[2] || !Args->TryGetStringField(TEXT("hostPermit"),Permit) || Permit!=Permits[2]) return Fail(TEXT("original_consumed_apply_permit_required_for_no_write_replay")); auto R=Query(); R->SetBoolField(TEXT("idempotentReplayNoWrite"),true); return Success(Tool,R); }
 if (!Consume(Tool,Args)) return Fail(TEXT("one_use_host_permit_missing_consumed_or_revoked"));
 if (const TCHAR* Reason=AbsentPrecondition()) return Fail(Reason);
 if (Tool==1)
 {
  // Explicit preparation may load engine dependencies and construct native CDOs. Never a read.
  Mesh.Reset(LoadObject<UStaticMesh>(nullptr,*MeshPath)); Font.Reset(LoadObject<UFont>(nullptr,*FontPath)); AUAgentPickupActorV2::StaticClass()->GetDefaultObject();
  Prepared=Mesh.IsValid()&&Font.IsValid(); if (!Prepared) return Fail(TEXT("fixed_parent_mesh_or_font_dependency_missing")); auto R=Obj(); R->SetBoolField(TEXT("prepared"),true); R->SetStringField(TEXT("effect"),TEXT("authorized_engine_dependency_loading_and_native_cdo_preparation")); return Success(Tool,R);
 }
 if (!Prepared) return Fail(TEXT("explicit_asset_preparation_required"));
 if (Tool==2)
 {
  TArray<TSharedPtr<FJsonValue>> Diagnostics; const FString Copy=TEXT("/Temp/UAgentPickupT13/Preview_")+FGuid::NewGuid().ToString(EGuidFormats::Digits); Preview.Reset(Make(Copy,Diagnostics)); if (!Preview.IsValid()) return Fail(TEXT("preview_blueprint_compile_failed")); Preview->SetFlags(RF_Transient); PreviewToken=FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens).ToLower();
  auto R=Obj(); R->SetStringField(TEXT("previewToken"),PreviewToken); R->SetStringField(TEXT("copyObjectPath"),Preview->GetPathName()); R->SetBoolField(TEXT("copySaved"),false); auto Before=Obj(); Before->SetBoolField(TEXT("exists"),false); R->SetObjectField(TEXT("before"),Before); R->SetObjectField(TEXT("after"),Summary()); R->SetArrayField(TEXT("semanticChanges"),Strings({TEXT("create native-parent Blueprint"),TEXT("configure four inherited components"),TEXT("set four typed editable defaults"),TEXT("enable bounded pickup behavior supplied by fixed parent")})); R->SetArrayField(TEXT("compileDiagnostics"),Diagnostics); R->SetStringField(TEXT("compileStatus"),TEXT("up_to_date")); return Success(Tool,R);
 }
 FString Token; if (!Preview.IsValid()||PreviewToken.IsEmpty()||!Args->TryGetStringField(TEXT("previewToken"),Token)||Token!=PreviewToken) return Fail(TEXT("reviewed_copy_preview_required")); PreviewToken.Reset();
 Receipt=Obj(); Receipt->SetObjectField(TEXT("plan"),ApprovedPlan); Receipt->SetStringField(TEXT("state"),TEXT("preparing")); if (!WriteJson(ReceiptFile(),Receipt)) return Fail(TEXT("receipt_intent_persistence_failed"));
 TArray<TSharedPtr<FJsonValue>> Diagnostics; UBlueprint* BP=Make(ApprovedPlan->GetStringField(TEXT("targetPackage")),Diagnostics);
 if (!BP) { Receipt->SetStringField(TEXT("state"),TEXT("failed_editor_only")); WriteJson(ReceiptFile(),Receipt); return Fail(TEXT("target_blueprint_compile_failed_query_effect_before_retry")); }
 const FString Stage=FPaths::Combine(Scratch,FGuid::NewGuid().ToString(EGuidFormats::Digits)+TEXT(".staged.uasset")); FSavePackageArgs Save; Save.TopLevelFlags=RF_Public|RF_Standalone; Save.SaveFlags=SAVE_NoError;
 if (!UPackage::SavePackage(BP->GetOutermost(),BP,*Stage,Save)) { Receipt->SetStringField(TEXT("state"),TEXT("failed_editor_only")); WriteJson(ReceiptFile(),Receipt); return Fail(TEXT("scoped_stage_save_failed_query_effect")); }
 BP->GetOutermost()->SetLoadedPath(FPackagePath::FromPackageNameChecked(ApprovedPlan->GetStringField(TEXT("targetPackage"))));
 TArray<uint8> Bytes; if (!FFileHelper::LoadFileToArray(Bytes,*Stage)||Bytes.IsEmpty()||Bytes.Num()>64*1024*1024) return Fail(TEXT("staged_package_read_failed_query_effect"));
 Receipt->SetStringField(TEXT("expectedDiskHash"),Hash(Bytes)); Receipt->SetStringField(TEXT("state"),TEXT("committing")); if (!WriteJson(ReceiptFile(),Receipt)) return Fail(TEXT("receipt_precommit_persistence_failed"));
 // NT FILE_CREATE relative to held target directory plus an exclusive handle rejects externally created targets.
 LONG CreateStatus=0; HANDLE Output=RelativeTarget(true,CreateStatus);
 if (Output==INVALID_HANDLE_VALUE) { Receipt->SetStringField(TEXT("state"),TEXT("unknown_external_change")); WriteJson(ReceiptFile(),Receipt); return Fail(TEXT("exclusive_create_rejected_external_change_query_effect")); }
 DWORD Written=0; const bool Saved=WriteFile(Output,Bytes.GetData(),Bytes.Num(),&Written,nullptr)&&Written==static_cast<DWORD>(Bytes.Num())&&FlushFileBuffers(Output); CloseHandle(Output);
 Receipt->SetStringField(TEXT("state"),Saved?TEXT("applied"):TEXT("unknown_partial_write")); WriteJson(ReceiptFile(),Receipt);
 if (!Saved) return Fail(TEXT("partial_target_write_query_effect_no_automatic_retry"));
 BP->GetOutermost()->SetDirtyFlag(false); FAssetRegistryModule::AssetCreated(BP); FModuleManager::GetModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get().ScanFilesSynchronous({TargetFile()},true);
 auto R=Query(); R->SetStringField(TEXT("compileStatus"),TEXT("up_to_date")); R->SetArrayField(TEXT("compileDiagnostics"),Diagnostics); R->SetArrayField(TEXT("savedPackages"),Strings({ApprovedPlan->GetStringField(TEXT("targetPackage"))})); R->SetObjectField(TEXT("semanticAfter"),Summary()); return Success(Tool,R);
}
class FTool final:public IModelContextProtocolTool
{
 int32 Id;
public:
 explicit FTool(int32 I):Id(I){} FString GetName() const override { return Names[Id]; }
 FString GetDescription() const override { return Id==0?TEXT("Discover separate scoped pickup template contract. Not authorization; disabled outside explicitly approved isolated Lab."):TEXT("Exact fixed create-only pickup operation. Native host approval required for preparation, transient compilation and one-package creation. Query does not load assets."); }
 TSharedPtr<FJsonObject> GetInputJsonSchema() const override { return Input(Id); }
 TSharedPtr<FJsonObject> GetOutputJsonSchema() const override { return Output(Id); }
 FModelContextProtocolToolResult Run(const TSharedPtr<FJsonObject>& Args) override { return Invoke(Id,Args); }
};
}
bool VerifyIsolatedLabPreconditions(const TSharedPtr<FJsonObject>& Report)
{
#if WITH_DEV_AUTOMATION_TESTS
 if (!Enabled||!IsInGameThread()||!FParse::Param(FCommandLine::Get(),TEXT("UAgentPickupLabSession"))) return false;
 UPackage* Package=FindPackage(nullptr,*ApprovedPlan->GetStringField(TEXT("targetPackage"))); if (!Package) return false;
 const bool Dirty=Package->IsDirty(); Package->SetDirtyFlag(true); const TCHAR* DirtyError=AbsentPrecondition(); const bool DirtyRejected=DirtyError&&FString(DirtyError)==TEXT("dirty_target_package_rejected"); Package->SetDirtyFlag(Dirty);
 const TCHAR* ExistingError=AbsentPrecondition();const bool ExistingRejected=ExistingError&&FString(ExistingError)==TEXT("target_exists_or_changed_since_absence_approval");
 TArray<uint8> Before,After;bool BeforeExists=false,AfterExists=false;const bool BeforeOK=ReadTarget(Before,BeforeExists);
 LONG Status=0;HANDLE Duplicate=RelativeTarget(true,Status);const bool Collision=Duplicate==INVALID_HANDLE_VALUE;if (!Collision) CloseHandle(Duplicate);
 const bool AfterOK=ReadTarget(After,AfterExists);const bool Unchanged=BeforeOK&&AfterOK&&BeforeExists&&AfterExists&&Hash(Before)==Hash(After);
 Report->SetBoolField(TEXT("dirtyPackagePreconditionRejected"),DirtyRejected);Report->SetBoolField(TEXT("existingFileViolatesAbsencePrecondition"),ExistingRejected);Report->SetBoolField(TEXT("relativeExclusiveCreateExistingTargetRejected"),Collision);Report->SetBoolField(TEXT("preconditionTestsDidNotChangeSavedTargetBytes"),Unchanged);
 return DirtyRejected&&ExistingRejected&&Collision&&Unchanged;
#else
 return false;
#endif
}
#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPickupEditorEffectObservationTest,"UAgent.Pickup.EditorEffectObservation",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FPickupEditorEffectObservationTest::RunTest(const FString& Parameters)
{
 const FString Name=TEXT("/Temp/UAgentPickupEffectObservation/BP_Probe");
 TestEqual(TEXT("Absent package is not compiled"),ObserveEditorEffect(Name),FString(TEXT("none")));
 UPackage* Package=CreatePackage(*Name); TestEqual(TEXT("Empty package is only a package"),ObserveEditorEffect(Name),FString(TEXT("package_loaded")));
 UBlueprint* BP=FKismetEditorUtilities::CreateBlueprint(AUAgentPickupActorV2::StaticClass(),Package,TEXT("BP_Probe"),BPTYPE_Normal,UBlueprint::StaticClass(),UBlueprintGeneratedClass::StaticClass(),TEXT("UAgentEffectObservationUnit"));
 if (!TestNotNull(TEXT("Explicit transient test Blueprint"),BP)) return false;
 FKismetEditorUtilities::CompileBlueprint(BP);BP->SetFlags(RF_Transient);Package->MarkAsFullyLoaded();Package->SetDirtyFlag(false);
 TestEqual(TEXT("Real compiled loaded Blueprint"),ObserveEditorEffect(Name),FString(TEXT("compiled_loaded")));
 BP->Status=BS_Error;TestEqual(TEXT("Compile error is never compiled_loaded"),ObserveEditorEffect(Name),FString(TEXT("compile_failed")));BP->Status=BS_UpToDate;
 UClass* Generated=BP->GeneratedClass;BP->GeneratedClass=nullptr;TestEqual(TEXT("Missing generated class is uncompiled"),ObserveEditorEffect(Name),FString(TEXT("blueprint_loaded_uncompiled")));BP->GeneratedClass=Generated;
 BP->bQueuedForCompilation=true;TestEqual(TEXT("Queued compilation is not ready"),ObserveEditorEffect(Name),FString(TEXT("blueprint_not_ready")));BP->bQueuedForCompilation=false;
 Package->SetDirtyFlag(true);TestEqual(TEXT("Dirty compiled object remains dirty"),ObserveEditorEffect(Name),FString(TEXT("dirty_loaded")));Package->SetDirtyFlag(false);
 return true;
}
#endif
class FModule final:public IModuleInterface
{
 TArray<TSharedRef<IModelContextProtocolTool>> Tools;
 void EnableLab()
 {
  FString ApprovedFile,PlanFile; if (!FParse::Param(FCommandLine::Get(),TEXT("UAgentPickupEnableLabWrites"))||!FParse::Value(FCommandLine::Get(),TEXT("UAgentPickupAllowedProjectFile="),ApprovedFile)||!FParse::Value(FCommandLine::Get(),TEXT("UAgentPickupApprovedPlanFile="),PlanFile)||FString(FApp::GetProjectName())!=TEXT("UAgentBuildLab")||!FPaths::IsSamePath(ApprovedFile,FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath()))) return;
  auto Marker=ReadJson(FPaths::Combine(FPaths::ProjectDir(),TEXT(".uagent-isolated-lab.json"))); bool Existing=true; if (!Marker.IsValid()||Marker->GetStringField(TEXT("project"))!=TEXT("UAgentBuildLab")||!Marker->TryGetBoolField(TEXT("existingUserProject"),Existing)||Existing) return;
  Scratch=FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectSavedDir(),TEXT("UAgentPickupT13")));
  if (!FPaths::IsSamePath(FPaths::ConvertRelativePathToFull(PlanFile),FPaths::Combine(Scratch,TEXT("host-approved-plan.json")))) return;
  if (!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::ProjectDir()),&RootId)||!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir()))||!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectContentDir(),TEXT("UAgentBuildLab"))))||!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectContentDir(),TEXT("UAgentBuildLab/Pickup_T13"))))||!HoldDirectory(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()))||!HoldDirectory(Scratch)) return;
  auto Approval=ReadJson(PlanFile); if (!Approval.IsValid()||Approval->GetStringField(TEXT("rootObjectId"))!=RootId) return;
  const TSharedPtr<FJsonObject>* P=nullptr; if (!Approval->TryGetObjectField(TEXT("plan"),P)||(ApprovedCanonical=Canonical(*P)).IsEmpty()) return; ApprovedPlan=*P;
  for (int32 I=0;I<3;++I) { if (!Approval->TryGetStringField(I==0?TEXT("preparePermit"):I==1?TEXT("previewPermit"):TEXT("applyPermit"),Permits[I])||!Guid(Permits[I])) return; }
  if (Permits[0]==Permits[1]||Permits[1]==Permits[2]||Permits[0]==Permits[2]) return;
  Enabled=true; Started=FPlatformTime::Seconds();
 }
public:
 void StartupModule() override { Instance=FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens).ToLower(); Project=UAgentSemanticV2::Capabilities()->GetStringField(TEXT("projectKey")); EnableLab(); for (int32 I=0;I<Names.Num();++I) { auto T=MakeShared<FTool>(I); if (IModelContextProtocolModule::GetChecked().AddTool(T)) Tools.Add(T); } }
 void ShutdownModule() override { Enabled=false; if (auto* M=IModelContextProtocolModule::Get()) for (auto& T:Tools) M->RemoveTool(T); Tools.Reset(); Preview.Reset(); Mesh.Reset(); Font.Reset(); for (int32 I=DirectoryHandles.Num()-1;I>=0;--I) CloseHandle(DirectoryHandles[I]); DirectoryHandles.Reset(); }
};
}
IMPLEMENT_MODULE(UAgentPickupV2::FModule,UAgentPickupToolsV2);
