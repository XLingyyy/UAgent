#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "UAgentPickupActorV2.h"
#include "UAgentPickupV2LabTests.h"
#include "Components/InputComponent.h"
#include "Containers/Ticker.h"
#include "Components/SphereComponent.h"
#include "Components/TextRenderComponent.h"
#include "Editor.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "FileHelpers.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PawnMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerStart.h"
#include "GameFramework/WorldSettings.h"
#include "HAL/FileManager.h"
#include "GenericPlatform/GenericPlatformInputDeviceMapper.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformTime.h"
#include "InputKeyEventArgs.h"
#include "Hash/Blake3.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "PackageTools.h"
#include "PlayInEditorDataTypes.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Settings/LevelEditorPlaySettings.h"
#include "UObject/Package.h"
#include "UObject/UnrealType.h"
namespace
{
FString MapName=TEXT("/Game/UAgentBuildLab/Pickup_T13/L_PickupValidation"),ValidationPlanFile;
bool ValidationSession=false;
FString Saved() { return FPaths::Combine(FPaths::ProjectSavedDir(),TEXT("UAgentPickupT13")); }
FString DiskHash(const FString& File) { TArray<uint8> B; if (!FFileHelper::LoadFileToArray(B,*File)) return FString(); const auto H=FBlake3::HashBuffer(B.GetData(),B.Num()); return BytesToHex(H.GetBytes(),32).ToLower(); }
TSharedPtr<FJsonObject> Read(const FString& File) { FString S; TSharedPtr<FJsonObject> V; if (!FFileHelper::LoadFileToString(S,*File)||!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(S),V)) return nullptr; return V; }
void Write(const TCHAR* Name,const TSharedPtr<FJsonObject>& V) { FString S; FJsonSerializer::Serialize(V.ToSharedRef(),TJsonWriterFactory<>::Create(&S)); FFileHelper::SaveStringToFile(S,*FPaths::Combine(Saved(),Name),FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM); }
bool Authorized()
{
 if (FParse::Param(FCommandLine::Get(),TEXT("UAgentPickupValidationSession")))
 {
  FString Project;
  if (!FParse::Value(FCommandLine::Get(),TEXT("UAgentPickupAllowedProjectFile="),Project)||!FPaths::IsSamePath(Project,FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath()))||!FParse::Value(FCommandLine::Get(),TEXT("UAgentPickupValidationPlanFile="),ValidationPlanFile)||!FParse::Value(FCommandLine::Get(),TEXT("UAgentPickupValidationMap="),MapName)) return false;
  if (!FPaths::IsSamePath(FPaths::GetPath(ValidationPlanFile),FPaths::ConvertRelativePathToFull(Saved()))||!FPackageName::IsValidLongPackageName(MapName)||!FPackageName::GetLongPackageAssetName(MapName).StartsWith(TEXT("L_"))) return false;
  auto Approval=Read(ValidationPlanFile); const TSharedPtr<FJsonObject>* Plan=nullptr;
  if (!Approval.IsValid()||!Approval->TryGetObjectField(TEXT("plan"),Plan)||(*Plan)->GetStringField(TEXT("templateId"))!=TEXT("actor.pickup.blueprint.v2")||FPackageName::GetLongPackagePath(MapName)!=FPackageName::GetLongPackagePath((*Plan)->GetStringField(TEXT("targetPackage")))) return false;
  ValidationSession=true; return true;
 }
 FString Project; if (!FParse::Param(FCommandLine::Get(),TEXT("UAgentPickupLabSession"))||!FParse::Value(FCommandLine::Get(),TEXT("UAgentPickupAllowedProjectFile="),Project)||FString(FApp::GetProjectName())!=TEXT("UAgentBuildLab")||!FPaths::IsSamePath(Project,FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath()))) return false;
 auto Marker=Read(FPaths::Combine(FPaths::ProjectDir(),TEXT(".uagent-isolated-lab.json"))); bool Existing=true; return Marker.IsValid()&&Marker->GetStringField(TEXT("project"))==TEXT("UAgentBuildLab")&&Marker->TryGetBoolField(TEXT("existingUserProject"),Existing)&&!Existing;
}
}
#endif
class FPickupLabSession final:public IModuleInterface
{
#if WITH_DEV_AUTOMATION_TESTS
 FTSTicker::FDelegateHandle Handle; double Started=0,Next=0; int32 Stage=0; bool Finished=false;
 TSharedPtr<FJsonObject> Plan,Report=MakeShared<FJsonObject>(); TStrongObjectPtr<ULevelEditorPlaySettings> Settings;
 TWeakObjectPtr<AUAgentPickupActorV2> Pickup; TWeakObjectPtr<APlayerController> Controller; TWeakObjectPtr<APawn> Pawn;
 void Fail(const TCHAR* Why) { Report->SetBoolField(TEXT("passed"),false); Report->SetStringField(TEXT("failure"),Why); if (GEditor&&GEditor->PlayWorld) GEditor->RequestEndPlayMap(); Write(TEXT("behavior-result.json"),Report); Finished=true; }
 bool Check(const TCHAR* Key,bool Value) { Report->SetBoolField(Key,Value); if (!Value) Fail(Key); return Value; }
 bool PrepareMap()
 {
  auto Approval=Read(ValidationSession?ValidationPlanFile:FPaths::Combine(Saved(),TEXT("host-approved-plan.json"))); if (!Approval.IsValid()) return false; Plan=Approval->GetObjectField(TEXT("plan")); const FString Target=Plan->GetStringField(TEXT("targetPackage"));
  if ((!ValidationSession&&!Target.StartsWith(TEXT("/Game/UAgentBuildLab/Pickup_T13/BP_")))||!Target.StartsWith(TEXT("/Game/"))||!FPackageName::IsValidLongPackageName(Target)) return false;
  const bool Resume=FParse::Param(FCommandLine::Get(),TEXT("UAgentPickupLabResumeBehavior"));
  if (Resume) { auto Prior=Read(FPaths::Combine(Saved(),TEXT("prior-behavior-result.json"))); auto Receipt=Read(FPaths::Combine(Saved(),Plan->GetStringField(TEXT("operationId"))+TEXT(".receipt.json"))); if (!Prior.IsValid()||!Receipt.IsValid()||DiskHash(FPackageName::LongPackageNameToFilename(Target,FPackageName::GetAssetPackageExtension()))!=Receipt->GetStringField(TEXT("expectedDiskHash"))||DiskHash(FPackageName::LongPackageNameToFilename(MapName,FPackageName::GetMapPackageExtension()))!=Prior->GetStringField(TEXT("mapHashBeforePie"))) { Fail(TEXT("resume_assets_changed_requires_reconciliation")); return false; } }
  UBlueprint* Loaded=FindObject<UBlueprint>(nullptr,*(Target+TEXT(".")+FPackageName::GetLongPackageAssetName(Target))); if ((!Loaded&&!Resume&&!ValidationSession)||(Loaded&&Loaded->GetOutermost()->IsDirty())) return false;
  FText Error; if (Loaded&&!UPackageTools::UnloadPackages({Loaded->GetOutermost()},Error,false)) return false;
  // Explicit test preparation reloads only the just-saved target, never a read capability.
  UBlueprint* BP=LoadObject<UBlueprint>(nullptr,*(Target+TEXT(".")+FPackageName::GetLongPackageAssetName(Target))); if (!BP||!BP->GeneratedClass) return false;
  const auto* CDO=Cast<AUAgentPickupActorV2>(BP->GeneratedClass->GetDefaultObject());
  if (!Check(TEXT("savedTypedParametersReloaded"),CDO&&CDO->ItemId.ToString()==Plan->GetStringField(TEXT("itemId"))&&CDO->PromptText.ToString()==Plan->GetStringField(TEXT("promptText"))&&CDO->InteractionRadiusCm==Plan->GetNumberField(TEXT("interactionRadiusCm")))) return false;
  const FString File=FPackageName::LongPackageNameToFilename(MapName,FPackageName::GetMapPackageExtension());
  if (!Resume&&IFileManager::Get().FileExists(*File)) { Fail(TEXT("validation_map_already_exists_requires_explicit_reconciliation")); return false; }
  UWorld* World=Resume?UEditorLoadingAndSavingUtils::LoadMap(MapName):UEditorLoadingAndSavingUtils::NewBlankMap(false); if (!World||World->GetWorldPartition()) return false;
  if (!Resume) { World->GetWorldSettings()->DefaultGameMode=AGameModeBase::StaticClass();
   if (!World->SpawnActor<AActor>(BP->GeneratedClass,FVector::ZeroVector,FRotator::ZeroRotator)||!World->SpawnActor<APlayerStart>(APlayerStart::StaticClass(),FVector(1000,0,0),FRotator::ZeroRotator)) return false;
   if (!UEditorLoadingAndSavingUtils::SaveMap(World,MapName)) return false; }
  Report->SetBoolField(TEXT("resumedExistingSavedAssetsWithoutSaving"),Resume);
  Report->SetStringField(TEXT("mapHashBeforePie"),DiskHash(File)); Report->SetStringField(TEXT("blueprintHashBeforePie"),DiskHash(FPackageName::LongPackageNameToFilename(Target,FPackageName::GetAssetPackageExtension())));
  Report->SetStringField(TEXT("savedMap"),MapName); Report->SetStringField(TEXT("targetBlueprint"),Target); Report->SetStringField(TEXT("inputObservation"),TEXT("real PIE PlayerController::InputKey(CreateSimulated, owning player primary mapped device) then Automation-driven PlayerTick of the actual registered input stack; not physical keyboard/focus validation")); Report->SetStringField(TEXT("uiObservation"),TEXT("real TextRender visibility/text/font state under NullRHI; pixels/glyph appearance not rendered"));
  Settings.Reset(DuplicateObject<ULevelEditorPlaySettings>(GetDefault<ULevelEditorPlaySettings>(),GetTransientPackage())); Settings->SetPlayNetMode(PIE_Standalone); Settings->SetRunUnderOneProcess(true); Settings->SetPlayNumberOfClients(1);
  FRequestPlaySessionParams Params; Params.EditorPlaySettings=Settings.Get(); Params.bAllowOnlineSubsystem=false; GEditor->RequestPlaySession(Params); return true;
 }
 void Key(const FKey& K,EInputEvent Event) { auto Sample=MakeShared<FJsonObject>();Sample->SetStringField(TEXT("key"),K.ToString());Sample->SetStringField(TEXT("event"),Event==IE_Pressed?TEXT("pressed"):TEXT("released"));Sample->SetBoolField(TEXT("registeredBefore"),Controller->IsInputComponentInStack(Pickup->InputComponent));Sample->SetBoolField(TEXT("nearbyBefore"),Pickup->bPlayerNearby);Sample->SetNumberField(TEXT("distanceBeforeCm"),FVector::Dist(Pawn->GetActorLocation(),Pickup->GetActorLocation())); Report->SetBoolField(TEXT("inputRegisteredBeforeEvent"),Controller->IsInputComponentInStack(Pickup->InputComponent)); Report->SetBoolField(TEXT("nearbyBeforeInputEvent"),Pickup->bPlayerNearby); Report->SetNumberField(TEXT("distanceBeforeInputEventCm"),FVector::Dist(Pawn->GetActorLocation(),Pickup->GetActorLocation())); Report->SetNumberField(TEXT("keyBindingCountBeforeInputEvent"),Pickup->InputComponent?Pickup->InputComponent->KeyBindings.Num():-1); Report->SetStringField(TEXT("inputComponentClass"),Pickup->InputComponent?Pickup->InputComponent->GetClass()->GetPathName():TEXT("missing")); auto& Mapper=IPlatformInputDeviceMapper::Get(); const FInputDeviceId Device=Mapper.GetPrimaryInputDeviceForUser(Controller->GetPlatformUserId()); if (!Check(TEXT("owningPlayerInputDeviceMappingObserved"),Mapper.GetUserForInputDevice(Device)==Controller->GetPlatformUserId())) return; Report->SetBoolField(TEXT("inputFilteringWasNotChanged"),true); const bool Accepted=Controller->InputKey(FInputKeyEventArgs::CreateSimulated(K,Event,Event==IE_Pressed?1.0f:0.0f,-1,Device)); Report->SetBoolField(TEXT("lastSimulatedInputAcceptedByController"),Accepted); Controller->PlayerTick(1.0f/60.0f); Report->SetBoolField(TEXT("controllerInputFrameDrivenSynchronouslyByAutomation"),true);
#if !UE_BUILD_TEST && !UE_BUILD_SHIPPING
 bool Registered=false;for (const auto& Entry:Controller->Debug_GetMostRecentInputStack()) if (Entry.Get()==Pickup->InputComponent.Get()) Registered=true; Report->SetBoolField(TEXT("pickupComponentInActualControllerInputStack"),Registered);
#endif
 Report->SetStringField(TEXT("runtimeConfiguredKey"),Pickup->InteractionKey.ToString());Report->SetBoolField(TEXT("collectedAfterLastInputFrame"),Pickup->bCollected);Report->SetNumberField(TEXT("countAfterLastInputFrame"),Pickup->CollectionCount);Report->SetStringField(TEXT("interactionErrorAfterLastInputFrame"),Pickup->LastInteractionError);Sample->SetBoolField(TEXT("collectedAfter"),Pickup->bCollected);Sample->SetNumberField(TEXT("countAfter"),Pickup->CollectionCount);TArray<TSharedPtr<FJsonValue>> Samples;if (Report->HasField(TEXT("inputSamples"))) Samples=Report->GetArrayField(TEXT("inputSamples"));Samples.Add(MakeShared<FJsonValueObject>(Sample));Report->SetArrayField(TEXT("inputSamples"),Samples); }
 bool Tick(float)
 {
  const double Now=FPlatformTime::Seconds();
  if (IFileManager::Get().FileExists(*FPaths::Combine(Saved(),TEXT("RequestQuit.flag")))||Now-Started>300) { if (GEditor&&GEditor->PlayWorld) GEditor->RequestEndPlayMap(); else { FPlatformMisc::RequestExit(false); return false; } }
  if (Finished||Now<Next) return true;
  if (Stage==0)
  {
   if (!GEditor||!GEditor->GetEditorWorldContext().World()) return true;
   auto Ready=MakeShared<FJsonObject>(); Ready->SetBoolField(TEXT("labReady"),true); Write(TEXT("session-ready.json"),Ready);
   if (!IFileManager::Get().FileExists(*FPaths::Combine(Saved(),TEXT("RunBehavior.flag")))) return true;
   if (!PrepareMap()) { if (!Finished) Fail(TEXT("explicit_saved_blueprint_map_preparation_failed")); return true; } Stage=1; Next=Now+0.5; return true;
  }
  if (Stage==1)
  {
   UWorld* W=GEditor->PlayWorld; if (!W) { if (Now-Started>180) Fail(TEXT("PIE_did_not_start")); return true; }
   Controller=W->GetFirstPlayerController(); Pawn=Controller.IsValid()?Controller->GetPawn():nullptr;
   for (TActorIterator<AUAgentPickupActorV2> It(W);It;++It) { Pickup=*It; break; }
   if (!Pickup.IsValid()||!Pawn.IsValid()||!Controller->IsLocalController()) return true;
   Report->SetBoolField(TEXT("realPieWorldObserved"),W->WorldType==EWorldType::PIE);
   Pawn->SetActorLocation(FVector(1000,0,0),false,nullptr,ETeleportType::TeleportPhysics); Stage=2; Next=Now+0.75; return true;
  }
  if (Stage==2)
  {
   if (!Check(TEXT("outsideRangePromptHidden"),!Pickup->bPlayerNearby&&!Pickup->PickupPrompt->IsVisible())||!Check(TEXT("outsideRangeInteractionRejected"),!Pickup->TryCollect(Pawn.Get())&&Pickup->LastInteractionError==TEXT("outside_interaction_radius"))||!Check(TEXT("missingPawnRejected"),!Pickup->TryCollect(nullptr)&&Pickup->LastInteractionError==TEXT("local_possessed_pawn_required"))) return true;
   Pawn->SetActorLocation(FVector(100,0,0),false,nullptr,ETeleportType::TeleportPhysics); Stage=3; Next=Now+0.75; return true;
  }
  if (Stage==3)
  {
   if (!Check(TEXT("enterRangeShowsConfiguredPrompt"),Pickup->bPlayerNearby&&Pickup->PickupPrompt->IsVisible()&&Pickup->PickupPrompt->Text.ToString()==Plan->GetStringField(TEXT("promptText")))||!Check(TEXT("configuredSphereRadiusObserved"),Pickup->InteractionRange->GetUnscaledSphereRadius()==Plan->GetNumberField(TEXT("interactionRadiusCm")))) return true;
   Controller->PopInputComponent(Pickup->InputComponent); Stage=10; Next=Now+0.5; return true;
  }
  if (Stage==10) { if (!Check(TEXT("inputRegistrationRecoversAfterStackRemoval"),Controller->IsInputComponentInStack(Pickup->InputComponent))) return true; Pawn->SetActorLocation(FVector(1000,0,0),false,nullptr,ETeleportType::TeleportPhysics); Stage=4; Next=Now+0.75; return true; }
  if (Stage==4)
  {
   if (!Check(TEXT("leaveRangeHidesPrompt"),!Pickup->bPlayerNearby&&!Pickup->PickupPrompt->IsVisible()&&!Pickup->bCollected)) return true;
   Pawn->SetActorLocation(FVector(100,0,0),false,nullptr,ETeleportType::TeleportPhysics); Stage=5; Next=Now+0.75; return true;
  }
  const FKey Right=Plan->GetStringField(TEXT("interactionKey"))==TEXT("E")?EKeys::E:EKeys::F,Wrong=Right==EKeys::E?EKeys::F:EKeys::E;
  if (Stage==5) { Key(Wrong,IE_Pressed); if (!Check(TEXT("wrongKeyInRangeDoesNotCollect"),Pickup->bPlayerNearby&&!Pickup->bCollected&&Pickup->CollectionCount==0)) return true; Key(Wrong,IE_Released); Pawn->ConsumeMovementInputVector(); if (Pawn->GetMovementComponent()) Pawn->GetMovementComponent()->StopMovementImmediately(); Stage=6; Next=Now+0.5; return true; }
  if (Stage==6) { if (!Check(TEXT("wrongKeyDoesNotCollect"),!Pickup->bCollected&&Pickup->CollectionCount==0)) return true; Pawn->ConsumeMovementInputVector();if (Pawn->GetMovementComponent()) Pawn->GetMovementComponent()->StopMovementImmediately();Pawn->SetActorLocation(FVector(100,0,0),false,nullptr,ETeleportType::TeleportPhysics);Stage=9;Next=Now+0.75;return true; }
  if (Stage==9) { if (!Check(TEXT("rightKeyPreconditionsInRangeAndInputRegistered"),Pickup->bPlayerNearby&&FVector::Dist(Pawn->GetActorLocation(),Pickup->GetActorLocation())<=Pickup->InteractionRadiusCm&&Controller->IsInputComponentInStack(Pickup->InputComponent))) return true; Key(Right,IE_Pressed); Stage=7;Next=Now+0.75;return true; }
  if (Stage==7)
  {
   Key(Right,IE_Released);
   if (!Check(TEXT("configuredInputCollectsHidesAndRecordsState"),Pickup->bCollected&&Pickup->CollectionCount==1&&Pickup->IsHidden()&&!Pickup->GetActorEnableCollision()&&!Pickup->PickupPrompt->IsVisible())||!Check(TEXT("duplicateInteractionRejected"),!Pickup->TryCollect(Pawn.Get())&&Pickup->CollectionCount==1)) return true;
   if (ValidationSession) { const FBoolProperty* State=FindFProperty<FBoolProperty>(Pickup->GetClass(),TEXT("bPickupEventReceived")); if (!Check(TEXT("savedBlueprintEventGraphExecutedAfterInput"),State&&State->GetPropertyValue_InContainer(Pickup.Get()))) return true; }
   GEditor->RequestEndPlayMap(); Stage=8; Next=Now+0.5; return true;
  }
  if (Stage==8 && !GEditor->PlayWorld) { if (!ValidationSession&&!Check(TEXT("nativePreconditionGuardsPassed"),UAgentPickupV2::VerifyIsolatedLabPreconditions(Report))) return true; const FString MapHash=DiskHash(FPackageName::LongPackageNameToFilename(MapName,FPackageName::GetMapPackageExtension())); const FString BPHash=DiskHash(FPackageName::LongPackageNameToFilename(Plan->GetStringField(TEXT("targetPackage")),FPackageName::GetAssetPackageExtension())); if (!Check(TEXT("pieDidNotSaveRuntimeStateToAssets"),MapHash==Report->GetStringField(TEXT("mapHashBeforePie"))&&BPHash==Report->GetStringField(TEXT("blueprintHashBeforePie")))) return true; Report->SetBoolField(TEXT("pieEndedObserved"),true); Report->SetBoolField(TEXT("passed"),true); Write(TEXT("behavior-result.json"),Report); Finished=true; }
  return true;
 }
#endif
public:
 void StartupModule() override
 {
#if WITH_DEV_AUTOMATION_TESTS
  if (!FParse::Param(FCommandLine::Get(),TEXT("UAgentPickupLabSession"))&&!FParse::Param(FCommandLine::Get(),TEXT("UAgentPickupValidationSession"))) return;
  if (!Authorized()) { UE_LOG(LogTemp,Error,TEXT("Pickup Lab session denied: explicit isolated project authorization required")); return; }
  Started=FPlatformTime::Seconds(); Handle=FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this,&FPickupLabSession::Tick),0.25f);
#endif
 }
 void ShutdownModule() override
 {
#if WITH_DEV_AUTOMATION_TESTS
  if (Handle.IsValid()) FTSTicker::GetCoreTicker().RemoveTicker(Handle); Settings.Reset();
#endif
 }
};
IMPLEMENT_MODULE(FPickupLabSession,UAgentPickupToolsV2Tests);
