#include "UAgentSemanticV2.h"
#include "IModelContextProtocolModule.h"
#include "IModelContextProtocolTool.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphPin.h"
#include "Editor.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/Level.h"
#include "Engine/SCS_Node.h"
#include "Engine/Selection.h"
#include "Engine/SimpleConstructionScript.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "HAL/FileManager.h"
#include "K2Node_Event.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/DateTime.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "UObject/Package.h"
#include "UObject/ObjectRedirector.h"
#include "UObject/UObjectHash.h"
#include "UObject/UnrealType.h"

namespace UAgentSemanticV2
{
namespace
{
    FString InstanceId;
    FString ReadRoot;
    bool bScopeEnabled = false;
    FString Digest(const TArray<uint8>& Bytes)
    {
        FMD5 Hash; Hash.Update(Bytes.GetData(), Bytes.Num()); uint8 Result[16]; Hash.Final(Result);
        return BytesToHex(Result, 16).ToLower();
    }
    FString ProjectKey()
    {
        FString Body; const FString File = FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath());
        if (!FFileHelper::LoadFileToString(Body, *File)) return FString();
        FTCHARToUTF8 Text(*(File + TEXT("\n") + Body));
        TArray<uint8> Bytes; Bytes.Append(reinterpret_cast<const uint8*>(Text.Get()), Text.Length());
        return TEXT("project-") + Digest(Bytes); // Public identity hint; never an authorization token.
    }
    TSharedPtr<FJsonObject> Object() { return MakeShared<FJsonObject>(); }
    FModelContextProtocolToolResult Structured(const TSharedPtr<FJsonObject>& Value)
    {
        TSharedPtr<FJsonValue> Content = MakeShared<FJsonValueObject>(Value);
        return UE::ModelContextProtocol::MakeStructuredContentResult(Content);
    }
    TSharedPtr<FJsonObject> Type(const TCHAR* Name) { auto Out = Object(); Out->SetStringField(TEXT("type"), Name); return Out; }
    TArray<TSharedPtr<FJsonValue>> StringArray(const TArray<FString>& Strings)
    {
        TArray<TSharedPtr<FJsonValue>> Out; for (const auto& String : Strings) Out.Add(MakeShared<FJsonValueString>(String)); return Out;
    }
    bool CanonicalPackage(const FString& Package)
    {
        if (Package.Len() > 1024 || !Package.StartsWith(TEXT("/Game/")) || Package.Contains(TEXT("..")) || Package.Contains(TEXT("\\")) || Package.Contains(TEXT(".")) || Package.EndsWith(TEXT("/"))) return false;
        for (TCHAR C : Package) if (!(FChar::IsAlnum(C) || C == TEXT('_') || C == TEXT('/'))) return false;
        return FPackageName::IsValidLongPackageName(Package);
    }
    bool Allowed(const FString& Package) { return bScopeEnabled && CanonicalPackage(Package) && (Package == ReadRoot || Package.StartsWith(ReadRoot + TEXT("/"))); }
    TSharedPtr<FJsonObject> Source(const FString& PackageName, UPackage* Package, bool bMap = false)
    {
        auto Out = Object(); const FString File = FPackageName::LongPackageNameToFilename(PackageName, bMap ? FPackageName::GetMapPackageExtension() : FPackageName::GetAssetPackageExtension());
        const int64 Size = IFileManager::Get().FileSize(*File); FString Hash;
        if (Size >= 0 && Size <= 64 * 1024 * 1024) { TArray<uint8> Bytes; if (FFileHelper::LoadFileToArray(Bytes, *File)) Hash = Digest(Bytes); }
        const bool Dirty = Package && Package->IsDirty();
        Out->SetStringField(TEXT("packageName"), PackageName); Out->SetBoolField(TEXT("diskExists"), Size >= 0);
        Out->SetNumberField(TEXT("diskSize"), FMath::Max<int64>(0, Size)); Out->SetStringField(TEXT("diskHash"), Hash);
        Out->SetStringField(TEXT("revision"), Hash); Out->SetBoolField(TEXT("packageDirty"), Dirty);
        // These are editor/registry observations, not an atomic disk-to-memory index.
        Out->SetBoolField(TEXT("cacheable"), false);
        Out->SetStringField(TEXT("origin"), TEXT("editor_or_asset_registry_observation"));
        Out->SetStringField(TEXT("diskCoherence"), TEXT("not_established"));
        Out->SetStringField(TEXT("diskModifiedUtc"), Size >= 0 ? IFileManager::Get().GetTimeStamp(*File).ToIso8601() : FString());
        return Out;
    }
    TSharedPtr<FJsonObject> PinType(const FEdGraphPinType& Pin)
    {
        auto Out = Object(); Out->SetStringField(TEXT("category"), Pin.PinCategory.ToString()); Out->SetStringField(TEXT("subcategory"), Pin.PinSubCategory.ToString());
        Out->SetStringField(TEXT("typeObjectPath"), (Pin.PinSubCategoryObject.Get() != nullptr) ? Pin.PinSubCategoryObject->GetPathName() : FString());
        const TCHAR* Container = TEXT("none");
        switch (Pin.ContainerType) { case EPinContainerType::Array: Container = TEXT("array"); break; case EPinContainerType::Set: Container = TEXT("set"); break; case EPinContainerType::Map: Container = TEXT("map"); break; default: break; }
        Out->SetStringField(TEXT("container"), Container); Out->SetBoolField(TEXT("isReference"), Pin.bIsReference); Out->SetBoolField(TEXT("isConst"), Pin.bIsConst);
        return Out;
    }
    TSharedPtr<FJsonObject> BoundedString(int32 Max = 4096)
    {
        auto Out = Type(TEXT("string")); Out->SetNumberField(TEXT("minLength"), 1); Out->SetNumberField(TEXT("maxLength"), Max); return Out;
    }
    TSharedPtr<FJsonObject> InputSchema(EQuery Query)
    {
        auto Schema = Type(TEXT("object")); Schema->SetBoolField(TEXT("additionalProperties"), false); auto Properties = Object(); TArray<FString> Required;
        if (Query != EQuery::Capabilities)
        {
            auto Version = Type(TEXT("integer")); Version->SetNumberField(TEXT("const"), 2); Properties->SetObjectField(TEXT("protocolVersion"), Version);
            Properties->SetObjectField(TEXT("expectedProjectKey"), BoundedString()); Properties->SetObjectField(TEXT("expectedInstanceId"), BoundedString());
            Required = { TEXT("protocolVersion"), TEXT("expectedProjectKey"), TEXT("expectedInstanceId") };
            auto Limit = Type(TEXT("integer")); Limit->SetNumberField(TEXT("minimum"), 1); Limit->SetNumberField(TEXT("maximum"), 256); Properties->SetObjectField(TEXT("limit"), Limit);
            const TCHAR* Target = Query == EQuery::World || Query == EQuery::Selection ? TEXT("expectedWorldPackage") : TEXT("packageName");
            Properties->SetObjectField(Target, BoundedString(1024)); Required.Add(Target);
            if (Query == EQuery::Blueprint) { auto Revision = Type(TEXT("string")); Revision->SetStringField(TEXT("pattern"), TEXT("^[0-9a-f]{32}$")); Properties->SetObjectField(TEXT("expectedRevision"), Revision); }
        }
        Schema->SetObjectField(TEXT("properties"), Properties); Schema->SetArrayField(TEXT("required"), StringArray(Required)); return Schema;
    }
    TSharedPtr<FJsonObject> OutputSchema(EQuery Query)
    {
        auto Schema = Type(TEXT("object")); Schema->SetBoolField(TEXT("additionalProperties"), false); auto Properties = Object(); TArray<FString> Required;
        auto Add = [&](const TCHAR* Name, const TCHAR* Kind) { Properties->SetObjectField(Name, Type(Kind)); Required.Add(Name); };
        for (const auto& Field : { TEXT("schemaVersion"), TEXT("projectKey"), TEXT("instanceId") }) Add(Field, TEXT("string"));
        if (Query == EQuery::Capabilities)
        {
            Add(TEXT("protocolVersion"), TEXT("integer")); Add(TEXT("contractVersion"), TEXT("string")); Add(TEXT("engineVersion"), TEXT("string")); Add(TEXT("projectName"), TEXT("string"));
            Add(TEXT("readScopeEnabled"), TEXT("boolean")); Add(TEXT("readRoots"), TEXT("array")); Add(TEXT("legacyV1Contract"), TEXT("string")); Add(TEXT("legacyV1RemainsSeparate"), TEXT("boolean")); Add(TEXT("writeCapabilities"), TEXT("array")); Add(TEXT("capabilities"), TEXT("array"));
        }
        else { Add(TEXT("operation"), TEXT("string")); Add(TEXT("observedAtUtc"), TEXT("string")); Add(TEXT("data"), TEXT("object")); auto Count = Type(TEXT("integer")); Count->SetNumberField(TEXT("const"), 0); Properties->SetObjectField(TEXT("mutationCount"), Count); Required.Add(TEXT("mutationCount")); }
        Schema->SetObjectField(TEXT("properties"), Properties); Schema->SetArrayField(TEXT("required"), StringArray(Required)); return Schema;
    }
    bool Validate(EQuery Query, const TSharedPtr<FJsonObject>& Params, FString& Package, int32& Limit, FString& Error)
    {
        if (!Params.IsValid()) { Error = TEXT("invalid_arguments"); return false; }
        TSet<FString> Keys;
        if (Query != EQuery::Capabilities) { Keys = { TEXT("protocolVersion"), TEXT("expectedProjectKey"), TEXT("expectedInstanceId"), TEXT("limit") }; }
        if (Query == EQuery::Blueprint || Query == EQuery::References) Keys.Add(TEXT("packageName"));
        if (Query == EQuery::World || Query == EQuery::Selection) Keys.Add(TEXT("expectedWorldPackage"));
        if (Query == EQuery::Blueprint) Keys.Add(TEXT("expectedRevision"));
        for (const auto& Pair : Params->Values) if (!Keys.Contains(FString(Pair.Key.ToView()))) { Error = TEXT("unknown_argument"); return false; }
        if (Query == EQuery::Capabilities) return true;
        double Version = 0; if (!Params->TryGetNumberField(TEXT("protocolVersion"), Version) || Version != 2) { Error = TEXT("unsupported_semantic_protocol"); return false; }
        FString Project, Instance;
        if (!Params->TryGetStringField(TEXT("expectedProjectKey"), Project) || Project != ProjectKey()) { Error = TEXT("project_mismatch"); return false; }
        if (!Params->TryGetStringField(TEXT("expectedInstanceId"), Instance) || Instance != InstanceId) { Error = TEXT("instance_mismatch"); return false; }
        if (!bScopeEnabled) { Error = TEXT("semantic_read_scope_disabled"); return false; }
        double Raw = 128;
        if (Params->HasField(TEXT("limit")) && (!Params->TryGetNumberField(TEXT("limit"), Raw) || !FMath::IsFinite(Raw) || Raw < 1 || Raw > 256 || FMath::FloorToDouble(Raw) != Raw)) { Error = TEXT("invalid_limit"); return false; }
        Limit = static_cast<int32>(Raw);
        const TCHAR* Target = Query == EQuery::World || Query == EQuery::Selection ? TEXT("expectedWorldPackage") : TEXT("packageName");
        if (!Params->TryGetStringField(Target, Package) || !Allowed(Package)) { Error = TEXT("package_outside_read_scope"); return false; }
        if (Params->HasField(TEXT("expectedRevision")))
        {
            FString Revision; if (!Params->TryGetStringField(TEXT("expectedRevision"), Revision) || Revision.Len() != 32) { Error = TEXT("invalid_revision"); return false; }
            for (TCHAR C : Revision) if (!((C >= TEXT('0') && C <= TEXT('9')) || (C >= TEXT('a') && C <= TEXT('f')))) { Error = TEXT("invalid_revision"); return false; }
        }
        return true;
    }
    TSharedPtr<FJsonObject> BlueprintData(const FString& Package, int32 Limit, const TSharedPtr<FJsonObject>& Params, FString& Error)
    {
        const FString ObjectPath = Package + TEXT(".") + FPackageName::GetLongPackageAssetName(Package);
        // Find only: LoadObject can follow redirectors and compile/regenerate dependencies.
        // Asset preparation/reload is a separate, explicitly authorized host operation.
        UPackage* LoadedPackage = FindPackage(nullptr, *Package);
        UObject* Existing = LoadedPackage ? FindObject<UObject>(LoadedPackage, *FPackageName::GetLongPackageAssetName(Package)) : nullptr;
        if (Existing && Existing->IsA<UObjectRedirector>()) { Error = TEXT("blueprint_redirector_rejected"); return nullptr; }
        if (Existing && (Existing->GetOutermost() != LoadedPackage || Existing->GetOutermost()->GetName() != Package || Existing->GetPathName() != ObjectPath || !Allowed(Existing->GetOutermost()->GetName()))) { Error = TEXT("blueprint_package_mismatch"); return nullptr; }
        UBlueprint* Blueprint = Cast<UBlueprint>(Existing);
        if (!Blueprint || !LoadedPackage || !LoadedPackage->IsFullyLoaded()) { Error = TEXT("blueprint_not_fully_loaded_requires_authorized_preparation"); return nullptr; }
        bool PendingLoad = false;
        ForEachObjectWithPackage(LoadedPackage, [&](UObject* Item) { PendingLoad |= Item->HasAnyFlags(RF_NeedLoad | RF_NeedPostLoad | RF_NeedPostLoadSubobjects) || Item->HasAnyInternalFlags(EInternalObjectFlags_AsyncLoading); return !PendingLoad; });
        if (PendingLoad || Blueprint->bBeingCompiled || Blueprint->bQueuedForCompilation || Blueprint->bIsRegeneratingOnLoad || !Blueprint->GeneratedClass) { Error = TEXT("blueprint_not_ready"); return nullptr; }
        if (Blueprint->BlueprintType != BPTYPE_Normal) { Error = TEXT("blueprint_kind_unsupported"); return nullptr; }
        auto Snapshot = Source(Package, Blueprint->GetOutermost()); FString Expected;
        if (Params->TryGetStringField(TEXT("expectedRevision"), Expected) && Expected != Snapshot->GetStringField(TEXT("revision"))) { Error = TEXT("asset_revision_changed"); return nullptr; }
        auto Data = Object(); Data->SetStringField(TEXT("packageName"), Package); Data->SetStringField(TEXT("objectPath"), Blueprint->GetPathName());
        Data->SetStringField(TEXT("parentClass"), Blueprint->ParentClass ? Blueprint->ParentClass->GetPathName() : FString());
        Data->SetStringField(TEXT("generatedClass"), Blueprint->GeneratedClass ? Blueprint->GeneratedClass->GetPathName() : FString());
        Data->SetStringField(TEXT("blueprintStatus"), Blueprint->Status == BS_UpToDate ? TEXT("up_to_date") : Blueprint->Status == BS_Error ? TEXT("error") : TEXT("dirty_or_unknown"));
        Data->SetObjectField(TEXT("source"), Snapshot); Data->SetBoolField(TEXT("dirtyBefore"), Blueprint->GetOutermost()->IsDirty());
        Data->SetStringField(TEXT("loadPolicy"), TEXT("already_loaded_only")); Data->SetStringField(TEXT("memberScope"), TEXT("declared_blueprint_graphs_and_scs_only")); bool Truncated = false;
        TArray<TSharedPtr<FJsonValue>> Components, Variables, Functions, Events;
        if (Blueprint->SimpleConstructionScript)
        {
            const auto& Nodes = Blueprint->SimpleConstructionScript->GetAllNodes(); TMap<const USCS_Node*, FString> Parents;
            for (USCS_Node* Node : Nodes) if (Node) for (USCS_Node* Child : Node->GetChildNodes()) Parents.Add(Child, Node->GetVariableName().ToString());
            for (USCS_Node* Node : Nodes)
            {
                if (!Node) continue; if (Components.Num() >= Limit) { Truncated = true; break; }
                auto Item = Object(); Item->SetStringField(TEXT("name"), Node->GetVariableName().ToString()); Item->SetStringField(TEXT("classPath"), Node->ComponentClass ? Node->ComponentClass->GetPathName() : FString());
                Item->SetStringField(TEXT("parent"), Parents.Contains(Node) ? Parents[Node] : Node->ParentComponentOrVariableName.ToString()); Item->SetBoolField(TEXT("inherited"), false);
                Components.Add(MakeShared<FJsonValueObject>(Item));
            }
        }
        for (const FBPVariableDescription& Variable : Blueprint->NewVariables)
        {
            if (Variables.Num() >= Limit) { Truncated = true; break; }
            auto Item = Object(); Item->SetStringField(TEXT("name"), Variable.VarName.ToString()); Item->SetObjectField(TEXT("pinType"), PinType(Variable.VarType));
            Variables.Add(MakeShared<FJsonValueObject>(Item));
        }
        for (UEdGraph* Graph : Blueprint->FunctionGraphs)
        {
            if (!Graph) continue; if (Functions.Num() >= Limit) { Truncated = true; break; }
            auto Item = Object(); Item->SetStringField(TEXT("name"), Graph->GetName()); Item->SetStringField(TEXT("graphGuid"), Graph->GraphGuid.ToString()); Item->SetNumberField(TEXT("nodeCount"), Graph->Nodes.Num());
            TArray<TSharedPtr<FJsonValue>> Parameters;
            UFunction* Function = Blueprint->GeneratedClass ? Blueprint->GeneratedClass->FindFunctionByName(Graph->GetFName()) : nullptr;
            if (Function) for (TFieldIterator<FProperty> It(Function); It; ++It)
            {
                FProperty* Property = *It; if (!Property->HasAnyPropertyFlags(CPF_Parm)) continue;
                auto Parameter = Object(); Parameter->SetStringField(TEXT("name"), Property->GetName()); Parameter->SetStringField(TEXT("cppType"), Property->GetCPPType());
                Parameter->SetStringField(TEXT("direction"), Property->HasAnyPropertyFlags(CPF_ReturnParm) ? TEXT("return") : Property->HasAnyPropertyFlags(CPF_OutParm) ? TEXT("out") : TEXT("in")); Parameters.Add(MakeShared<FJsonValueObject>(Parameter));
                if (Parameters.Num() >= Limit) { Truncated = true; break; }
            }
            Item->SetBoolField(TEXT("generatedSignatureAvailable"), Function != nullptr); Item->SetArrayField(TEXT("parameters"), Parameters); Functions.Add(MakeShared<FJsonValueObject>(Item));
        }
        for (UEdGraph* Graph : Blueprint->UbergraphPages) if (Graph) for (UEdGraphNode* Node : Graph->Nodes)
        {
            UK2Node_Event* Event = Cast<UK2Node_Event>(Node); if (!Event) continue;
            if (Events.Num() >= Limit) { Truncated = true; break; }
            auto Item = Object(); Item->SetStringField(TEXT("name"), Event->GetFunctionName().ToString()); Item->SetStringField(TEXT("graph"), Graph->GetName()); Item->SetStringField(TEXT("nodeGuid"), Event->NodeGuid.ToString()); Events.Add(MakeShared<FJsonValueObject>(Item));
        }
        Data->SetArrayField(TEXT("components"), Components); Data->SetArrayField(TEXT("variables"), Variables); Data->SetArrayField(TEXT("functions"), Functions); Data->SetArrayField(TEXT("events"), Events);
        Data->SetBoolField(TEXT("truncated"), Truncated); Data->SetBoolField(TEXT("dirtyAfter"), Blueprint->GetOutermost()->IsDirty()); return Data;
    }
    UWorld* OrdinaryWorld(const FString& ExpectedPackage, FString& Error)
    {
        UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
        if (!World || World->WorldType != EWorldType::Editor) { Error = TEXT("editor_world_unavailable"); return nullptr; }
        if (World->GetOutermost()->GetName() != ExpectedPackage) { Error = TEXT("editor_world_changed"); return nullptr; }
        if (World->GetWorldPartition() || (World->PersistentLevel && World->PersistentLevel->IsUsingExternalActors())) { Error = TEXT("partition_or_external_actor_world_unsupported"); return nullptr; }
        if (!Allowed(World->GetOutermost()->GetName())) { Error = TEXT("world_outside_read_scope_or_unsaved"); return nullptr; }
        return World;
    }
    TSharedPtr<FJsonObject> WorldData(const FString& ExpectedPackage, bool bSelection, int32 Limit, FString& Error)
    {
        UWorld* World = OrdinaryWorld(ExpectedPackage, Error); if (!World) return nullptr;
        auto Data = Object(); Data->SetStringField(TEXT("packageName"), World->GetOutermost()->GetName()); Data->SetStringField(TEXT("worldType"), TEXT("editor")); Data->SetBoolField(TEXT("worldPartition"), false); Data->SetBoolField(TEXT("externalActors"), false);
        Data->SetObjectField(TEXT("source"), Source(World->GetOutermost()->GetName(), World->GetOutermost(), true));
        TArray<TSharedPtr<FJsonValue>> Actors; bool Truncated = false;
        if (bSelection && GEditor->GetSelectedActors()) for (FSelectionIterator It(*GEditor->GetSelectedActors()); It; ++It)
        {
            AActor* Actor = Cast<AActor>(*It); if (!Actor || Actor->GetWorld() != World) continue;
            if (Actor->GetOutermost() != World->GetOutermost()) { Error = TEXT("selected_actor_package_mismatch"); return nullptr; }
            if (Actors.Num() >= Limit) { Truncated = true; break; }
            auto Item = Object(); Item->SetStringField(TEXT("objectPath"), Actor->GetPathName()); Item->SetStringField(TEXT("label"), Actor->GetActorLabel(false).IsEmpty() ? Actor->GetName() : Actor->GetActorLabel(false)); Item->SetStringField(TEXT("classPath"), Actor->GetClass()->GetPathName());
            const FVector Location = Actor->GetActorLocation(), Scale = Actor->GetActorScale3D(); const FRotator Rotation = Actor->GetActorRotation();
            auto Vector = [](double X, double Y, double Z) { auto Out = Object(); Out->SetNumberField(TEXT("x"), X); Out->SetNumberField(TEXT("y"), Y); Out->SetNumberField(TEXT("z"), Z); return Out; };
            Item->SetObjectField(TEXT("location"), Vector(Location.X, Location.Y, Location.Z)); Item->SetObjectField(TEXT("rotation"), Vector(Rotation.Roll, Rotation.Pitch, Rotation.Yaw)); Item->SetObjectField(TEXT("scale"), Vector(Scale.X, Scale.Y, Scale.Z)); Actors.Add(MakeShared<FJsonValueObject>(Item));
        }
        Data->SetArrayField(TEXT("actors"), Actors); Data->SetBoolField(TEXT("truncated"), Truncated); return Data;
    }
    TSharedPtr<FJsonObject> ReferencesData(const FString& Package, int32 Limit)
    {
        IAssetRegistry& Registry = FModuleManager::GetModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get(); TArray<FName> Dependencies, Referencers;
        Registry.GetDependencies(FName(*Package), Dependencies, UE::AssetRegistry::EDependencyCategory::Package); Registry.GetReferencers(FName(*Package), Referencers, UE::AssetRegistry::EDependencyCategory::Package);
        auto Convert = [Limit](TArray<FName>& Names, bool& Truncated) { Names.Sort(FNameLexicalLess()); TArray<FString> Strings; for (FName Name : Names) { if (Strings.Num() >= Limit) { Truncated = true; break; } Strings.Add(Name.ToString()); } return StringArray(Strings); };
        bool Truncated = false; auto Data = Object(); Data->SetStringField(TEXT("packageName"), Package); Data->SetStringField(TEXT("referenceKind"), TEXT("on_disk_package_dependencies_only"));
        Data->SetBoolField(TEXT("assetRegistryLoading"), Registry.IsLoadingAssets()); Data->SetArrayField(TEXT("dependencies"), Convert(Dependencies, Truncated)); Data->SetArrayField(TEXT("referencers"), Convert(Referencers, Truncated)); Data->SetBoolField(TEXT("truncated"), Truncated); Data->SetObjectField(TEXT("source"), Source(Package, FindPackage(nullptr, *Package))); return Data;
    }
    class FReadTool final : public IModelContextProtocolTool
    {
        EQuery Query;
    public:
        explicit FReadTool(EQuery InQuery) : Query(InQuery) {}
        FString GetName() const override { return ToolName(Query); }
        FString GetDescription() const override { return Query == EQuery::Capabilities ? TEXT("Discover UAgent semantic v2 read-only contract and current project/session identity. This is not write authorization.") : TEXT("Read scoped UE semantic metadata only. Does not create, edit, compile, save, or delete assets."); }
        TSharedPtr<FJsonObject> GetInputJsonSchema() const override { return InputSchema(Query); }
        TSharedPtr<FJsonObject> GetOutputJsonSchema() const override { return OutputSchema(Query); }
        FModelContextProtocolToolResult Run(const TSharedPtr<FJsonObject>& Params) override { return Invoke(Query, Params); }
    };
}
FString ToolName(EQuery Query)
{
    switch (Query) { case EQuery::Capabilities: return TEXT("uagent.v2.capabilities"); case EQuery::Blueprint: return TEXT("uagent.v2.blueprint.describe"); case EQuery::World: return TEXT("uagent.v2.world.describe"); case EQuery::Selection: return TEXT("uagent.v2.selection.describe"); default: return TEXT("uagent.v2.asset.references"); }
}
TSharedPtr<FJsonObject> Capabilities()
{
    auto Result = Object(); Result->SetStringField(TEXT("schemaVersion"), TEXT("uagent.semantic.capabilities.v2")); Result->SetNumberField(TEXT("protocolVersion"), 2); Result->SetStringField(TEXT("contractVersion"), TEXT("2.0.0-readonly"));
    Result->SetStringField(TEXT("projectKey"), ProjectKey()); Result->SetStringField(TEXT("projectName"), FApp::GetProjectName()); Result->SetStringField(TEXT("instanceId"), InstanceId); Result->SetStringField(TEXT("engineVersion"), FEngineVersion::Current().ToString());
    Result->SetBoolField(TEXT("readScopeEnabled"), bScopeEnabled); Result->SetArrayField(TEXT("readRoots"), StringArray(bScopeEnabled ? TArray<FString>{ ReadRoot } : TArray<FString>{}));
    Result->SetStringField(TEXT("legacyV1Contract"), TEXT("mvp15d.asset-tools.v1")); Result->SetBoolField(TEXT("legacyV1RemainsSeparate"), true); Result->SetArrayField(TEXT("writeCapabilities"), {});
    TArray<TSharedPtr<FJsonValue>> Entries;
    for (EQuery Query : { EQuery::Blueprint, EQuery::World, EQuery::Selection, EQuery::References })
    {
        auto Entry = Object(); Entry->SetStringField(TEXT("name"), ToolName(Query)); Entry->SetStringField(TEXT("effect"), TEXT("read_only")); Entry->SetBoolField(TEXT("available"), bScopeEnabled); Entry->SetObjectField(TEXT("inputSchema"), InputSchema(Query)); Entry->SetObjectField(TEXT("outputSchema"), OutputSchema(Query)); Entries.Add(MakeShared<FJsonValueObject>(Entry));
    }
    Result->SetArrayField(TEXT("capabilities"), Entries); return Result;
}
FModelContextProtocolToolResult Invoke(EQuery Query, const TSharedPtr<FJsonObject>& Params)
{
    if (!IsInGameThread()) return UE::ModelContextProtocol::MakeErrorResult(TEXT("game_thread_required"));
    FString Package, Error; int32 Limit = 128; if (!Validate(Query, Params, Package, Limit, Error)) return UE::ModelContextProtocol::MakeErrorResult(Error);
    if (Query == EQuery::Capabilities) return Structured(Capabilities());
    TSharedPtr<FJsonObject> Data;
    if (Query == EQuery::Blueprint) Data = BlueprintData(Package, Limit, Params, Error);
    else if (Query == EQuery::References) Data = ReferencesData(Package, Limit);
    else Data = WorldData(Package, Query == EQuery::Selection, Limit, Error);
    if (!Data.IsValid()) return UE::ModelContextProtocol::MakeErrorResult(Error);
    auto Result = Object(); Result->SetStringField(TEXT("schemaVersion"), TEXT("uagent.semantic.result.v2")); Result->SetStringField(TEXT("projectKey"), ProjectKey()); Result->SetStringField(TEXT("instanceId"), InstanceId); Result->SetStringField(TEXT("operation"), ToolName(Query));
    Result->SetNumberField(TEXT("mutationCount"), 0); Result->SetStringField(TEXT("observedAtUtc"), FDateTime::UtcNow().ToIso8601()); Result->SetObjectField(TEXT("data"), Data);
    return Structured(Result);
}
class FSemanticModule final : public IModuleInterface
{
    TArray<TSharedRef<IModelContextProtocolTool>> Tools; FDelegateHandle RefreshHandle;
    void Register()
    {
        InstanceId = FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens);
        IModelContextProtocolModule& Module = IModelContextProtocolModule::GetChecked();
        for (EQuery Query : { EQuery::Capabilities, EQuery::Blueprint, EQuery::World, EQuery::Selection, EQuery::References }) { auto Tool = MakeShared<FReadTool>(Query); if (Module.AddTool(Tool)) Tools.Add(Tool); }
    }
    void Refresh() { if (auto* Module = IModelContextProtocolModule::Get()) for (auto& Tool : Tools) Module->RemoveTool(Tool); Tools.Reset(); Register(); }
public:
    void StartupModule() override
    {
        FString RequestedRoot;
        bScopeEnabled = FParse::Param(FCommandLine::Get(), TEXT("UAgentEnableSemanticReads")) && FParse::Value(FCommandLine::Get(), TEXT("UAgentSemanticReadRoot="), RequestedRoot) && CanonicalPackage(RequestedRoot);
        ReadRoot = bScopeEnabled ? RequestedRoot : FString();
        RefreshHandle = IModelContextProtocolModule::GetChecked().OnRefreshTools().AddRaw(this, &FSemanticModule::Refresh); Register();
    }
    void ShutdownModule() override { if (auto* Module = IModelContextProtocolModule::Get()) { Module->OnRefreshTools().Remove(RefreshHandle); for (auto& Tool : Tools) Module->RemoveTool(Tool); } Tools.Reset(); bScopeEnabled = false; ReadRoot.Reset(); InstanceId.Reset(); }
};
}
IMPLEMENT_MODULE(UAgentSemanticV2::FSemanticModule, UAgentSemanticToolsV2);
