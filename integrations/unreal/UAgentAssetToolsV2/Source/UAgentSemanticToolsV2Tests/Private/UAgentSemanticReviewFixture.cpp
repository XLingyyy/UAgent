#include "CoreMinimal.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "UAgentSemanticV2.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Editor.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/Level.h"
#include "Engine/Selection.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "HAL/FileManager.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Misc/CoreDelegates.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "PackageTools.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/ObjectRedirector.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "UObject/UnrealType.h"

namespace
{
const FString LoadedName = TEXT("/Game/UAgentBuildLab/BP_ReadFixture");
const FString ColdName = TEXT("/Game/UAgentBuildLab/BP_ColdReadFixture");
const FString RedirectName = TEXT("/Game/UAgentBuildLab/BP_ReadRedirect");
const FString PrivateName = TEXT("/Game/UAgentBuildLabPrivate/BP_PrivateReadFixture");
const FString WorldName = TEXT("/Game/UAgentBuildLab/L_ReadFixture");
TWeakObjectPtr<AActor> Selected;
FDelegateHandle LabelHandle;
int32 LabelBroadcasts = 0;
bool DirtyBefore = false;
FString ObjectPath(const FString& Name) { return Name + TEXT(".") + FPackageName::GetLongPackageAssetName(Name); }
bool Save(const FString& Name, UObject* Asset)
{
    const FString File = FPackageName::LongPackageNameToFilename(Name, FPackageName::GetAssetPackageExtension());
    IFileManager::Get().MakeDirectory(*FPaths::GetPath(File), true);
    FSavePackageArgs Args; Args.TopLevelFlags = RF_Public | RF_Standalone; Args.SaveFlags = SAVE_NoError;
    return UPackage::SavePackage(Asset->GetOutermost(), Asset, *File, Args);
}
UBlueprint* PrepareBlueprint(const FString& Name)
{
    UBlueprint* BP = LoadObject<UBlueprint>(nullptr, *ObjectPath(Name)); // Explicit isolated test preparation, never a read tool.
    if (BP) return BP;
    UPackage* Package = CreatePackage(*Name);
    BP = FKismetEditorUtilities::CreateBlueprint(AActor::StaticClass(), Package, *FPackageName::GetLongPackageAssetName(Name), BPTYPE_Normal, UBlueprint::StaticClass(), UBlueprintGeneratedClass::StaticClass(), TEXT("UAgentSemanticReviewPreparation"));
    if (!BP) return nullptr;
    FKismetEditorUtilities::CompileBlueprint(BP); if (BP->Status != BS_UpToDate) return nullptr;
    FAssetRegistryModule::AssetCreated(BP); return Save(Name, BP) ? BP : nullptr;
}
bool WriteJson(const TCHAR* File, const TSharedPtr<FJsonObject>& Value)
{
    FString Json; FJsonSerializer::Serialize(Value.ToSharedRef(), TJsonWriterFactory<>::Create(&Json));
    const FString Directory = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("UAgentSemanticReview")); IFileManager::Get().MakeDirectory(*Directory, true);
    return FFileHelper::SaveStringToFile(Json, *FPaths::Combine(Directory, File));
}
bool HasError(const FModelContextProtocolToolResult& Result, const FString& Error)
{
    if (!Result.JsonObject.IsValid()) return false;
    bool Failed = false; if (!Result.JsonObject->TryGetBoolField(TEXT("isError"), Failed) || !Failed) return false;
    const auto& Content = Result.JsonObject->GetArrayField(TEXT("content"));
    return Content.Num() == 1 && Content[0]->AsObject()->GetStringField(TEXT("text")) == Error && !Result.JsonObject->HasField(TEXT("structuredContent"));
}
}

bool PrepareSemanticReviewFixture()
{
    // Called only after the original fixture's explicit project/marker/CLI authorization.
    UBlueprint* Cold = PrepareBlueprint(ColdName); UBlueprint* Private = PrepareBlueprint(PrivateName);
    if (!Cold || !Private) { UE_LOG(LogTemp, Error, TEXT("Review Blueprint preparation failed")); return false; }
    UObjectRedirector* Redirect = LoadObject<UObjectRedirector>(nullptr, *ObjectPath(RedirectName)); // Explicit test preparation only.
    if (!Redirect) Redirect = NewObject<UObjectRedirector>(CreatePackage(*RedirectName), TEXT("BP_ReadRedirect"), RF_Public | RF_Standalone);
    Redirect->DestinationObject = Private; if (!Save(RedirectName, Redirect)) { UE_LOG(LogTemp, Error, TEXT("Review redirector save failed")); return false; }
    FText UnloadError; if (!UPackageTools::UnloadPackages({ Cold->GetOutermost() }, UnloadError, false)) { UE_LOG(LogTemp, Error, TEXT("Cold fixture unload failed: %s"), *UnloadError.ToString()); return false; }
    if (FindObject<UBlueprint>(nullptr, *ObjectPath(ColdName))) { UE_LOG(LogTemp, Error, TEXT("Review cold fixture remained loaded")); return false; }
    UWorld* World = GEditor->GetEditorWorldContext().World();
    UBlueprint* Loaded = FindObject<UBlueprint>(nullptr, *ObjectPath(LoadedName));
    // UnloadPackages deliberately clears editor selection during authorized preparation.
    if (World && Loaded) for (AActor* Actor : World->PersistentLevel->Actors) if (Actor && Actor->GetClass() == Loaded->GeneratedClass) { Selected = Actor; break; }
    if (!World || !Selected.IsValid()) { UE_LOG(LogTemp, Error, TEXT("Review selected fixture actor unavailable after package unload")); return false; }
    GEditor->SelectActor(Selected.Get(), true, false, true);
    DirtyBefore = World->GetOutermost()->IsDirty(); LabelBroadcasts = 0;
    const auto Manifest = UAgentSemanticV2::Capabilities();
    auto Params = [&]() { auto Value = MakeShared<FJsonObject>(); Value->SetNumberField(TEXT("protocolVersion"), 2); Value->SetStringField(TEXT("expectedProjectKey"), Manifest->GetStringField(TEXT("projectKey"))); Value->SetStringField(TEXT("expectedInstanceId"), Manifest->GetStringField(TEXT("instanceId"))); return Value; };
    auto BPParams = [&](const FString& Name) { auto Value = Params(); Value->SetStringField(TEXT("packageName"), Name); return Value; };
    auto Report = MakeShared<FJsonObject>(); bool Passed = true;
    auto Check = [&](const TCHAR* Name, bool OK) { Report->SetBoolField(Name, OK); Passed &= OK; };
    const auto LoadedResult = UAgentSemanticV2::Invoke(UAgentSemanticV2::EQuery::Blueprint, BPParams(LoadedName));
    Check(TEXT("loadedBlueprintAccepted"), LoadedResult.JsonObject.IsValid() && LoadedResult.JsonObject->HasField(TEXT("structuredContent")));
    const auto ColdResult = UAgentSemanticV2::Invoke(UAgentSemanticV2::EQuery::Blueprint, BPParams(ColdName));
    Check(TEXT("coldDiskBlueprintRejectedWithoutLoading"), HasError(ColdResult, TEXT("blueprint_not_fully_loaded_requires_authorized_preparation")) && !FindObject<UBlueprint>(nullptr, *ObjectPath(ColdName)) && IFileManager::Get().FileExists(*FPackageName::LongPackageNameToFilename(ColdName, FPackageName::GetAssetPackageExtension())));
    const auto RedirectResult = UAgentSemanticV2::Invoke(UAgentSemanticV2::EQuery::Blueprint, BPParams(RedirectName));
    Check(TEXT("redirectorToPrivatePackageRejected"), HasError(RedirectResult, TEXT("blueprint_redirector_rejected")) && Redirect->DestinationObject->GetOutermost()->GetName() == PrivateName);
    auto SelectionParams = Params(); SelectionParams->SetStringField(TEXT("expectedWorldPackage"), WorldName);
    FStrProperty* LabelProperty = FindFProperty<FStrProperty>(AActor::StaticClass(), TEXT("ActorLabel"));
    if (!LabelProperty) { UE_LOG(LogTemp, Error, TEXT("Review actor-label property unavailable")); return false; }
    const FString OriginalLabel = Selected->GetActorLabel(false);
    // Intentional synchronous test setup: no UI tick/broadcast may refill the empty label.
    LabelProperty->SetPropertyValue_InContainer(Selected.Get(), FString());
    LabelHandle = FCoreDelegates::OnActorLabelChanged.AddLambda([](AActor* Actor) { if (Actor == Selected.Get()) ++LabelBroadcasts; });
    const auto Selection = UAgentSemanticV2::Invoke(UAgentSemanticV2::EQuery::Selection, SelectionParams);
    Check(TEXT("emptyLabelQueryAccepted"), Selection.JsonObject.IsValid() && Selection.JsonObject->HasField(TEXT("structuredContent")));
    Check(TEXT("emptyLabelUnchangedNoBroadcast"), Selected->GetActorLabel(false).IsEmpty() && LabelBroadcasts == 0);
    FCoreDelegates::OnActorLabelChanged.Remove(LabelHandle);
    LabelProperty->SetPropertyValue_InContainer(Selected.Get(), OriginalLabel); // Restore test setup before normal UI ticks.
    Check(TEXT("mapDirtyStateUnchanged"), World->GetOutermost()->IsDirty() == DirtyBefore);
    SelectionParams->SetStringField(TEXT("expectedWorldPackage"), TEXT("/Game/UAgentBuildLab/NarrowOnly/L_Expected"));
    Check(TEXT("differentExpectedWorldRejected"), HasError(UAgentSemanticV2::Invoke(UAgentSemanticV2::EQuery::World, SelectionParams), TEXT("editor_world_changed")));
    SelectionParams->SetStringField(TEXT("expectedWorldPackage"), TEXT("/Game/UAgentBuildLabPrivate/L_Private"));
    Check(TEXT("outOfLaunchScopeWorldRejected"), HasError(UAgentSemanticV2::Invoke(UAgentSemanticV2::EQuery::Selection, SelectionParams), TEXT("package_outside_read_scope")));
    Report->SetStringField(TEXT("privateDestinationPackage"), PrivateName); Report->SetBoolField(TEXT("testPreparationExplicitlyLoadsCreatesAndCompiles"), true); Report->SetBoolField(TEXT("testPreparationIsNotAReadTool"), true);
    Report->SetBoolField(TEXT("passed"), Passed); return WriteJson(TEXT("review-checks.json"), Report) && Passed;
}
bool WriteSemanticReviewFinalObservations()
{
    auto Report = MakeShared<FJsonObject>();
    const bool SelectedStillValid = Selected.IsValid();
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    const bool MapUnchanged = World && World->GetOutermost()->GetName() == WorldName && World->GetOutermost()->IsDirty() == DirtyBefore;
    const bool ColdStillUnloaded = !FindObject<UBlueprint>(nullptr, *ObjectPath(ColdName));
    Report->SetBoolField(TEXT("selectedActorStillValid"), SelectedStillValid); Report->SetNumberField(TEXT("labelChangedBroadcasts"), LabelBroadcasts); Report->SetBoolField(TEXT("mapDirtyStateUnchanged"), MapUnchanged); Report->SetBoolField(TEXT("coldBlueprintStillUnloaded"), ColdStillUnloaded);
    Report->SetBoolField(TEXT("passed"), SelectedStillValid && LabelBroadcasts == 0 && MapUnchanged && ColdStillUnloaded);
    FCoreDelegates::OnActorLabelChanged.Remove(LabelHandle);
    return WriteJson(TEXT("final-observations.json"), Report);
}
#endif
