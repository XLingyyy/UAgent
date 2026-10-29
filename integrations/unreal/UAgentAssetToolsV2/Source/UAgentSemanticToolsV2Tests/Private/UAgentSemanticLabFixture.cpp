#include "Modules/ModuleManager.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "AssetRegistry/AssetRegistryModule.h"
#include "Components/SceneComponent.h"
#include "Components/SphereComponent.h"
#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"
#include "EdGraph/EdGraph.h"
#include "EdGraphSchema_K2.h"
#include "Editor.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/Level.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "Engine/World.h"
#include "FileHelpers.h"
#include "GameFramework/Actor.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformTime.h"
#include "K2Node_CustomEvent.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"

bool PrepareSemanticReviewFixture();
bool WriteSemanticReviewFinalObservations();
namespace
{
const FString FixturePackage = TEXT("/Game/UAgentBuildLab/BP_ReadFixture");
const FString MapPackage = TEXT("/Game/UAgentBuildLab/L_ReadFixture");
bool LabAuthorized()
{
    FString ApprovedFile;
    if (!(FParse::Param(FCommandLine::Get(), TEXT("UAgentSemanticLabFixture")) || FParse::Param(FCommandLine::Get(), TEXT("UAgentSemanticLabReview"))) || !FParse::Value(FCommandLine::Get(), TEXT("UAgentSemanticLabAllowedProjectFile="), ApprovedFile)) return false;
    if (FString(FApp::GetProjectName()) != TEXT("UAgentBuildLab") || !FPaths::IsSamePath(FPaths::ConvertRelativePathToFull(ApprovedFile), FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath()))) return false;
    FString Marker; if (!FFileHelper::LoadFileToString(Marker, *FPaths::Combine(FPaths::ProjectDir(), TEXT(".uagent-isolated-lab.json")))) return false;
    TSharedPtr<FJsonObject> Parsed; if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Marker), Parsed) || !Parsed.IsValid()) return false;
    FString Project; bool Existing = true;
    return Parsed->TryGetStringField(TEXT("project"), Project) && Project == TEXT("UAgentBuildLab") && Parsed->TryGetBoolField(TEXT("existingUserProject"), Existing) && !Existing;
}
bool CreateFixture()
{
    UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *(FixturePackage + TEXT(".BP_ReadFixture")));
    if (!Blueprint)
    {
        UPackage* Package = CreatePackage(*FixturePackage);
        Blueprint = FKismetEditorUtilities::CreateBlueprint(AActor::StaticClass(), Package, TEXT("BP_ReadFixture"), BPTYPE_Normal, UBlueprint::StaticClass(), UBlueprintGeneratedClass::StaticClass(), TEXT("UAgentSemanticIsolatedFixture"));
        if (!Blueprint || !Blueprint->SimpleConstructionScript) return false;
        const auto ExistingRoots = Blueprint->SimpleConstructionScript->GetRootNodes();
        for (USCS_Node* Node : ExistingRoots) if (Node && Node->GetVariableName() == TEXT("DefaultSceneRoot")) Blueprint->SimpleConstructionScript->RemoveNode(Node);
        USCS_Node* SceneRoot = Blueprint->SimpleConstructionScript->CreateNode(USceneComponent::StaticClass(), TEXT("FixtureRoot")); Blueprint->SimpleConstructionScript->AddNode(SceneRoot);
        USCS_Node* Sphere = Blueprint->SimpleConstructionScript->CreateNode(USphereComponent::StaticClass(), TEXT("Trigger")); SceneRoot->AddChildNode(Sphere);
        FEdGraphPinType Integer; Integer.PinCategory = UEdGraphSchema_K2::PC_Int;
        if (!FBlueprintEditorUtils::AddMemberVariable(Blueprint, TEXT("PickupCount"), Integer, TEXT("7"))) return false;
        FEdGraphPinType Boolean; Boolean.PinCategory = UEdGraphSchema_K2::PC_Boolean;
        if (!FBlueprintEditorUtils::AddMemberVariable(Blueprint, TEXT("bEnabled"), Boolean, TEXT("true"))) return false;
        UEdGraph* Function = FBlueprintEditorUtils::CreateNewGraph(Blueprint, TEXT("InspectFixture"), UEdGraph::StaticClass(), UEdGraphSchema_K2::StaticClass());
        FBlueprintEditorUtils::AddFunctionGraph<UClass>(Blueprint, Function, true, nullptr);
        UEdGraph* EventGraph = FBlueprintEditorUtils::FindEventGraph(Blueprint);
        if (!EventGraph) { EventGraph = FBlueprintEditorUtils::CreateNewGraph(Blueprint, TEXT("EventGraph"), UEdGraph::StaticClass(), UEdGraphSchema_K2::StaticClass()); FBlueprintEditorUtils::AddUbergraphPage(Blueprint, EventGraph); }
        UK2Node_CustomEvent* Event = NewObject<UK2Node_CustomEvent>(EventGraph); Event->CustomFunctionName = TEXT("OnCollected"); EventGraph->AddNode(Event, false, false); Event->CreateNewGuid(); Event->PostPlacedNewNode(); Event->AllocateDefaultPins();
        FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint); FKismetEditorUtilities::CompileBlueprint(Blueprint);
        if (Blueprint->Status != BS_UpToDate) return false;
        FAssetRegistryModule::AssetCreated(Blueprint); const FString File = FPackageName::LongPackageNameToFilename(FixturePackage, FPackageName::GetAssetPackageExtension());
        IFileManager::Get().MakeDirectory(*FPaths::GetPath(File), true); FSavePackageArgs Args; Args.TopLevelFlags = RF_Public | RF_Standalone; Args.SaveFlags = SAVE_NoError;
        if (!UPackage::SavePackage(Package, Blueprint, *File, Args)) return false;
    }
    const FString MapFile = FPackageName::LongPackageNameToFilename(MapPackage, FPackageName::GetMapPackageExtension());
    UWorld* World = IFileManager::Get().FileExists(*MapFile) ? UEditorLoadingAndSavingUtils::LoadMap(MapPackage) : UEditorLoadingAndSavingUtils::NewBlankMap(false);
    if (!World || World->GetWorldPartition()) return false;
    AActor* Selected = nullptr;
    for (AActor* Actor : World->PersistentLevel->Actors) if (Actor && Actor->GetClass() == Blueprint->GeneratedClass) { Selected = Actor; break; }
    if (!Selected) { Selected = World->SpawnActor<AActor>(Blueprint->GeneratedClass, FVector(125, -30, 42), FRotator(0, 45, 0)); if (!Selected) return false; Selected->SetActorLabel(TEXT("SemanticReadFixtureActor")); }
    if (!UEditorLoadingAndSavingUtils::SaveMap(World, MapPackage)) return false;
    GEditor->SelectNone(false, true); GEditor->SelectActor(Selected, true, false, true);
    TArray<FString> Files{ FPackageName::LongPackageNameToFilename(FixturePackage, FPackageName::GetAssetPackageExtension()), MapFile };
    FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get().ScanFilesSynchronous(Files, true);
    auto Ready = MakeShared<FJsonObject>(); Ready->SetStringField(TEXT("blueprint"), FixturePackage); Ready->SetStringField(TEXT("map"), MapPackage); Ready->SetStringField(TEXT("selectedLabel"), TEXT("SemanticReadFixtureActor")); Ready->SetBoolField(TEXT("fixtureIsNotAdvertisedCapability"), true);
    FString Json; auto Writer = TJsonWriterFactory<>::Create(&Json); FJsonSerializer::Serialize(Ready, Writer);
    const FString Directory = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("UAgentSemanticV2")); IFileManager::Get().MakeDirectory(*Directory, true);
    return FFileHelper::SaveStringToFile(Json, *FPaths::Combine(Directory, TEXT("fixture-ready.json")));
}
}
#endif

class FSemanticLabModule : public IModuleInterface
{
#if WITH_DEV_AUTOMATION_TESTS
    FTSTicker::FDelegateHandle TickHandle; bool Ready = false; bool Review = false; double Started = 0;
#endif
public:
    void StartupModule() override
    {
#if WITH_DEV_AUTOMATION_TESTS
        Review = FParse::Param(FCommandLine::Get(), TEXT("UAgentSemanticLabReview"));
        if (!Review && !FParse::Param(FCommandLine::Get(), TEXT("UAgentSemanticLabFixture"))) return;
        if (!LabAuthorized()) { UE_LOG(LogTemp, Error, TEXT("Semantic Lab fixture rejected: explicit isolated project marker/approval required")); FPlatformMisc::RequestExitWithStatus(false, 31); return; }
        Started = FPlatformTime::Seconds();
        TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([this](float)
        {
            if (!Ready && GEditor && GEditor->GetEditorWorldContext().World()) { Ready = CreateFixture(); if (Ready && Review) Ready = PrepareSemanticReviewFixture(); if (!Ready) { UE_LOG(LogTemp, Error, TEXT("Semantic Lab fixture creation failed")); FPlatformMisc::RequestExitWithStatus(false, 32); return false; } }
            const FString Quit = FPaths::Combine(FPaths::ProjectSavedDir(), Review ? TEXT("UAgentSemanticReview/RequestQuit.flag") : TEXT("UAgentSemanticV2/RequestQuit.flag"));
            if (IFileManager::Get().FileExists(*Quit) || FPlatformTime::Seconds() - Started > 300) { if (Review) WriteSemanticReviewFinalObservations(); FPlatformMisc::RequestExit(false); return false; }
            return true;
        }), 0.25f);
#endif
    }
    void ShutdownModule() override
    {
#if WITH_DEV_AUTOMATION_TESTS
        if (TickHandle.IsValid()) FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
#endif
    }
};
IMPLEMENT_MODULE(FSemanticLabModule, UAgentSemanticToolsV2Tests);
