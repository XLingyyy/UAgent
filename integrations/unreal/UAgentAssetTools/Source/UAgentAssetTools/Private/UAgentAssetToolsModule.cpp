#include "UAgentAssetToolsModule.h"

#include "IModelContextProtocolModule.h"
#include "IModelContextProtocolTool.h"
#include "ModelContextProtocolSettings.h"
#include "ModelContextProtocolToolResults.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "Dom/JsonValue.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/CommandLine.h"
#include "Misc/CoreDelegates.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UAgentAssetTool.h"
#include "UAgentAssetToolsContract.h"
#include "UAgentAssetToolsD0Probe.h"
#include "UAgentAssetToolsD0Toolset.h"
#include "ToolsetRegistry/UToolsetRegistry.h"

#if PLATFORM_WINDOWS
#include "Windows/AllowWindowsPlatformTypes.h"
#include <bcrypt.h>
#include "Windows/HideWindowsPlatformTypes.h"
#endif

namespace
{
	enum class ED0ProbeRoute : uint8
	{
		None,
		Direct,
		ToolsetRegistry,
	};

	struct FD0ProbeState
	{
		bool bEnabled = false;
		bool bToolSearchEnabled = false;
		bool bToolsetRegistered = false;
		bool bSettingsOverridden = false;
		bool bOriginalToolSearchEnabled = false;
		int32 RegistrationGeneration = 0;
		ED0ProbeRoute Route = ED0ProbeRoute::None;
	};

	FD0ProbeState GD0Probe;

	/**
	 * This tool exists only behind the explicit D0 command-line gate.  It has no
	 * parameters and produces a structured acknowledgement, so it cannot name or
	 * mutate any UE asset even if accidentally discovered by an MCP client.
	 */
	class FUAgentAssetToolsD0DirectProbe final : public IModelContextProtocolTool
	{
	public:
		virtual FString GetName() const override { return TEXT("uagent.d0.probe"); }
		virtual FString GetDescription() const override { return TEXT("Task-only MVP15D registration no-op; no UE asset capability."); }

		virtual TSharedPtr<FJsonObject> GetInputJsonSchema() const override
		{
			TSharedPtr<FJsonObject> Schema = MakeShared<FJsonObject>();
			Schema->SetStringField(TEXT("type"), TEXT("object"));
			Schema->SetBoolField(TEXT("additionalProperties"), false);
			Schema->SetObjectField(TEXT("properties"), MakeShared<FJsonObject>());
			TArray<TSharedPtr<FJsonValue>> Required;
			Schema->SetArrayField(TEXT("required"), Required);
			return Schema;
		}

		virtual TSharedPtr<FJsonObject> GetOutputJsonSchema() const override
		{
			TSharedPtr<FJsonObject> Schema = MakeShared<FJsonObject>();
			Schema->SetStringField(TEXT("type"), TEXT("object"));
			Schema->SetBoolField(TEXT("additionalProperties"), false);
			TSharedPtr<FJsonObject> Properties = MakeShared<FJsonObject>();
			for (const TCHAR* Field : { TEXT("status"), TEXT("route") })
			{
				TSharedPtr<FJsonObject> StringSchema = MakeShared<FJsonObject>();
				StringSchema->SetStringField(TEXT("type"), TEXT("string"));
				Properties->SetObjectField(Field, StringSchema);
			}
			TSharedPtr<FJsonObject> MutationCount = MakeShared<FJsonObject>();
			MutationCount->SetStringField(TEXT("type"), TEXT("integer"));
			Properties->SetObjectField(TEXT("mutationCount"), MutationCount);
			TSharedPtr<FJsonObject> RegistrationGeneration = MakeShared<FJsonObject>();
			RegistrationGeneration->SetStringField(TEXT("type"), TEXT("integer"));
			Properties->SetObjectField(TEXT("registrationGeneration"), RegistrationGeneration);
			TSharedPtr<FJsonObject> ToolSearchEnabled = MakeShared<FJsonObject>();
			ToolSearchEnabled->SetStringField(TEXT("type"), TEXT("boolean"));
			Properties->SetObjectField(TEXT("toolSearchEnabled"), ToolSearchEnabled);
			Schema->SetObjectField(TEXT("properties"), Properties);
			TArray<TSharedPtr<FJsonValue>> Required;
			for (const TCHAR* Field : { TEXT("status"), TEXT("route"), TEXT("toolSearchEnabled"), TEXT("registrationGeneration"), TEXT("mutationCount") })
			{
				Required.Add(MakeShared<FJsonValueString>(Field));
			}
			Schema->SetArrayField(TEXT("required"), Required);
			return Schema;
		}

		virtual FModelContextProtocolToolResult Run(const TSharedPtr<FJsonObject>& Params) override
		{
			if (!Params.IsValid() || Params->Values.Num() != 0)
			{
				return UE::ModelContextProtocol::MakeErrorResult(TEXT("uagent_d0_probe_requires_empty_object"));
			}
			TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
			Result->SetStringField(TEXT("status"), TEXT("noop"));
			Result->SetStringField(TEXT("route"), TEXT("direct"));
			Result->SetBoolField(TEXT("toolSearchEnabled"), GD0Probe.bToolSearchEnabled);
			Result->SetNumberField(TEXT("registrationGeneration"), GD0Probe.RegistrationGeneration);
			Result->SetNumberField(TEXT("mutationCount"), 0);
			TSharedPtr<FJsonValue> StructuredContent = MakeShared<FJsonValueObject>(Result);
			return UE::ModelContextProtocol::MakeStructuredContentResult(StructuredContent);
		}
	};

	FString D0RouteName(ED0ProbeRoute Route)
	{
		switch (Route)
		{
		case ED0ProbeRoute::Direct: return TEXT("direct");
		case ED0ProbeRoute::ToolsetRegistry: return TEXT("toolset_registry");
		default: return TEXT("none");
		}
	}

	bool IsLowerHex(const FString& Value, int32 Length)
	{
		if (Value.Len() != Length) return false;
		for (const TCHAR Character : Value)
		{
			if (!((Character >= TEXT('0') && Character <= TEXT('9')) || (Character >= TEXT('a') && Character <= TEXT('f')))) return false;
		}
		return true;
	}

	bool IsSafeFileName(const FString& Value)
	{
		return !Value.IsEmpty()
			&& FPaths::GetCleanFilename(Value) == Value
			&& !Value.Contains(TEXT(".."))
			&& !Value.Contains(TEXT("\\"))
			&& !Value.Contains(TEXT("/"));
	}

	bool HashBytes(const void* Bytes, int64 Size, FString& OutHash)
	{
		if (Size < 0 || Size > MAX_uint32 || (Size > 0 && !Bytes)) return false;
#if PLATFORM_WINDOWS
		BCRYPT_ALG_HANDLE Algorithm = nullptr;
		if (::BCryptOpenAlgorithmProvider(&Algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0)
		{
			return false;
		}
		DWORD HashSize = 0;
		DWORD ResultSize = 0;
		const NTSTATUS PropertyStatus = ::BCryptGetProperty(
			Algorithm,
			BCRYPT_HASH_LENGTH,
			reinterpret_cast<PUCHAR>(&HashSize),
			sizeof(HashSize),
			&ResultSize,
			0);
		if (PropertyStatus < 0 || HashSize == 0)
		{
			::BCryptCloseAlgorithmProvider(Algorithm, 0);
			return false;
		}
		TArray<uint8> Hash;
		Hash.SetNumUninitialized(static_cast<int32>(HashSize));
		const NTSTATUS HashStatus = ::BCryptHash(
			Algorithm,
			nullptr,
			0,
			reinterpret_cast<PUCHAR>(const_cast<void*>(Bytes)),
			static_cast<ULONG>(Size),
			Hash.GetData(),
			HashSize);
		::BCryptCloseAlgorithmProvider(Algorithm, 0);
		if (HashStatus < 0) return false;
		OutHash = BytesToHex(Hash.GetData(), Hash.Num()).ToLower();
		return true;
#else
		return false;
#endif
	}

	bool HashFile(const FString& Path, FString& OutHash, int64& OutSize)
	{
		TArray<uint8> Bytes;
		if (!FFileHelper::LoadFileToArray(Bytes, *Path)) return false;
		OutSize = Bytes.Num();
		return HashBytes(Bytes.GetData(), OutSize, OutHash);
	}

	bool AppendJsonString(const FString& Value, FString& Out)
	{
		FString Encoded;
		TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Encoded);
		Writer->WriteValue(Value);
		Writer->Close();
		if (Encoded.IsEmpty()) return false;
		Out += Encoded;
		return true;
	}

	bool AppendCanonicalJsonValue(const TSharedPtr<FJsonValue>& Value, FString& Out);

	bool AppendCanonicalJsonObject(const TSharedPtr<FJsonObject>& Object, FString& Out)
	{
		if (!Object.IsValid()) return false;
		TArray<FString> Keys;
		for (const auto& Pair : Object->Values)
		{
			Keys.Add(FString(Pair.Key.ToView()));
		}
		Keys.Sort();
		Out += TEXT("{");
		for (int32 Index = 0; Index < Keys.Num(); ++Index)
		{
			if (Index > 0) Out += TEXT(",");
			const TSharedPtr<FJsonValue> Value = Object->TryGetField(Keys[Index]);
			if (!Value.IsValid() || !AppendJsonString(Keys[Index], Out)) return false;
			Out += TEXT(":");
			if (!AppendCanonicalJsonValue(Value, Out)) return false;
		}
		Out += TEXT("}");
		return true;
	}

	bool AppendCanonicalJsonValue(const TSharedPtr<FJsonValue>& Value, FString& Out)
	{
		if (!Value.IsValid()) return false;
		switch (Value->Type)
		{
		case EJson::String:
			return AppendJsonString(Value->AsString(), Out);
		case EJson::Boolean:
			Out += Value->AsBool() ? TEXT("true") : TEXT("false");
			return true;
		case EJson::Number:
		{
			const double Number = Value->AsNumber();
			if (!FMath::IsFinite(Number) || FMath::FloorToDouble(Number) != Number || Number < 0.0 || Number > 9007199254740991.0) return false;
			Out += FString::Printf(TEXT("%.0f"), Number);
			return true;
		}
		case EJson::Array:
		{
			Out += TEXT("[");
			const TArray<TSharedPtr<FJsonValue>>& Items = Value->AsArray();
			for (int32 Index = 0; Index < Items.Num(); ++Index)
			{
				if (Index > 0) Out += TEXT(",");
				if (!AppendCanonicalJsonValue(Items[Index], Out)) return false;
			}
			Out += TEXT("]");
			return true;
		}
		case EJson::Object:
			return AppendCanonicalJsonObject(Value->AsObject(), Out);
		default:
			return false;
		}
	}

	bool VerifyArtifact(const TSharedPtr<FJsonObject>& Artifact, const FString& ExpectedLogicalPath, const FString& Path, FString& OutSha256)
	{
		if (!Artifact.IsValid() || Artifact->Values.Num() != 3) return false;
		FString LogicalPath;
		FString Sha256;
		double DeclaredSize = -1.0;
		if (!Artifact->TryGetStringField(TEXT("path"), LogicalPath)
			|| !Artifact->TryGetStringField(TEXT("sha256"), Sha256)
			|| !Artifact->TryGetNumberField(TEXT("size"), DeclaredSize)
			|| LogicalPath != ExpectedLogicalPath
			|| LogicalPath.IsEmpty()
			|| LogicalPath.StartsWith(TEXT("/"))
			|| LogicalPath.Contains(TEXT("\\"))
			|| LogicalPath.Contains(TEXT(".."))
			|| !IsLowerHex(Sha256, 64)
			|| !FMath::IsFinite(DeclaredSize)
			|| FMath::FloorToDouble(DeclaredSize) != DeclaredSize
			|| DeclaredSize < 0.0)
		{
			return false;
		}
		int64 ActualSize = -1;
		if (!HashFile(Path, OutSha256, ActualSize) || ActualSize != static_cast<int64>(DeclaredSize) || OutSha256 != Sha256) return false;
		return true;
	}

	bool HasExactKeys(const TSharedPtr<FJsonObject>& Object, const TSet<FString>& Expected)
	{
		if (!Object.IsValid() || Object->Values.Num() != Expected.Num()) return false;
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : Object->Values)
		{
			if (!Expected.Contains(Pair.Key)) return false;
		}
		return true;
	}
}

bool UAgentAssetTools::D0::IsEnabled()
{
	return GD0Probe.bEnabled;
}

bool UAgentAssetTools::D0::UsesToolsetRegistry()
{
	return GD0Probe.bEnabled && GD0Probe.Route == ED0ProbeRoute::ToolsetRegistry;
}

bool UAgentAssetTools::D0::IsToolSearchEnabled()
{
	return GD0Probe.bEnabled && GD0Probe.bToolSearchEnabled;
}

int32 UAgentAssetTools::D0::GetRegistrationGeneration()
{
	return GD0Probe.RegistrationGeneration;
}

FString UAgentAssetTools::D0::GetRouteName()
{
	return D0RouteName(GD0Probe.Route);
}

void FUAgentAssetToolsModule::StartupModule()
{
	IModelContextProtocolModule& ModelContextProtocol = IModelContextProtocolModule::GetChecked();
	ConfigureD0ProbeFromCommandLine();
	RefreshToolsHandle = ModelContextProtocol.OnRefreshTools().AddRaw(this, &FUAgentAssetToolsModule::OnRefreshTools);
	RegisterTools();
	// A Toolset Registry class becomes visible to the MCP bridge only after a
	// refresh after editor initialization.  Keep the immediate refresh for the
	// direct route and schedule one post-init refresh for the task-only Toolset
	// route when its registry is not available during module startup.
	if (GD0Probe.bEnabled)
	{
		if (GD0Probe.Route == ED0ProbeRoute::ToolsetRegistry && !UToolsetRegistry::IsAvailable())
		{
			PostEngineInitHandle = FCoreDelegates::GetOnPostEngineInit().AddRaw(this, &FUAgentAssetToolsModule::OnPostEngineInit);
		}
		ModelContextProtocol.RefreshTools();
	}
}

void FUAgentAssetToolsModule::ShutdownModule()
{
	if (IModelContextProtocolModule* ModelContextProtocol = IModelContextProtocolModule::Get())
	{
		if (PostEngineInitHandle.IsValid()) FCoreDelegates::GetOnPostEngineInit().Remove(PostEngineInitHandle);
		if (RefreshToolsHandle.IsValid()) ModelContextProtocol->OnRefreshTools().Remove(RefreshToolsHandle);
		UnregisterTools(*ModelContextProtocol);
		RestoreD0ProbeSettings();
		if (GD0Probe.bEnabled)
		{
			ModelContextProtocol->RefreshTools();
		}
	}
	PostEngineInitHandle.Reset();
	RefreshToolsHandle.Reset();
	RegisteredTools.Reset();
}

void FUAgentAssetToolsModule::OnPostEngineInit()
{
	if (PostEngineInitHandle.IsValid())
	{
		FCoreDelegates::GetOnPostEngineInit().Remove(PostEngineInitHandle);
		PostEngineInitHandle.Reset();
	}
	if (GD0Probe.bEnabled
		&& GD0Probe.Route == ED0ProbeRoute::ToolsetRegistry
		&& UToolsetRegistry::IsAvailable())
	{
		IModelContextProtocolModule::GetChecked().RefreshTools();
	}
}

void FUAgentAssetToolsModule::OnRefreshTools()
{
	IModelContextProtocolModule& ModelContextProtocol = IModelContextProtocolModule::GetChecked();
	UnregisterTools(ModelContextProtocol);
	RegisterTools();
}

void FUAgentAssetToolsModule::ConfigureD0ProbeFromCommandLine()
{
	GD0Probe = {};
	if (!FParse::Param(FCommandLine::Get(), TEXT("UAgentMvp15D0Probe"))) return;

	FString RouteValue;
	FString ToolSearchValue;
	if (!FParse::Value(FCommandLine::Get(), TEXT("UAgentMvp15D0Route="), RouteValue)
		|| !FParse::Value(FCommandLine::Get(), TEXT("UAgentMvp15D0ToolSearch="), ToolSearchValue))
	{
		UE_LOG(LogTemp, Error, TEXT("UAgent MVP15D D0 probe ignored: route and tool-search arguments are both required."));
		return;
	}
	RouteValue = RouteValue.ToLower();
	ToolSearchValue = ToolSearchValue.ToLower();
	if (RouteValue == TEXT("direct")) GD0Probe.Route = ED0ProbeRoute::Direct;
	else if (RouteValue == TEXT("toolset_registry")) GD0Probe.Route = ED0ProbeRoute::ToolsetRegistry;
	else
	{
		UE_LOG(LogTemp, Error, TEXT("UAgent MVP15D D0 probe ignored: unsupported route."));
		return;
	}
	if (ToolSearchValue == TEXT("on")) GD0Probe.bToolSearchEnabled = true;
	else if (ToolSearchValue == TEXT("off")) GD0Probe.bToolSearchEnabled = false;
	else
	{
		UE_LOG(LogTemp, Error, TEXT("UAgent MVP15D D0 probe ignored: tool-search must be on or off."));
		GD0Probe.Route = ED0ProbeRoute::None;
		return;
	}

	UModelContextProtocolSettings* Settings = GetMutableDefault<UModelContextProtocolSettings>();
	if (!Settings)
	{
		UE_LOG(LogTemp, Error, TEXT("UAgent MVP15D D0 probe ignored: MCP settings are unavailable."));
		GD0Probe.Route = ED0ProbeRoute::None;
		return;
	}
	GD0Probe.bOriginalToolSearchEnabled = Settings->bEnableToolSearch;
	Settings->bEnableToolSearch = GD0Probe.bToolSearchEnabled;
	GD0Probe.bSettingsOverridden = true;
	GD0Probe.bEnabled = true;
}

void FUAgentAssetToolsModule::RestoreD0ProbeSettings()
{
	if (GD0Probe.bSettingsOverridden)
	{
		if (UModelContextProtocolSettings* Settings = GetMutableDefault<UModelContextProtocolSettings>())
		{
			Settings->bEnableToolSearch = GD0Probe.bOriginalToolSearchEnabled;
		}
		GD0Probe.bSettingsOverridden = false;
	}
}

void FUAgentAssetToolsModule::UnregisterTools(IModelContextProtocolModule& ModelContextProtocol)
{
	// A Refresh/reconnect/restart invalidates every dry-run admission before any
	// descriptor is re-published.  Do this even if the registry was already empty.
	UAgentAssetTools::InvalidateOperationLedger();
	for (const TSharedRef<IModelContextProtocolTool>& Tool : RegisteredTools)
	{
		ModelContextProtocol.RemoveTool(Tool);
	}
	RegisteredTools.Reset();
	if (GD0Probe.bToolsetRegistered)
	{
		UToolsetRegistry::UnregisterToolsetClass(UUAgentAssetToolsD0Toolset::StaticClass());
		GD0Probe.bToolsetRegistered = false;
	}
	if (GD0Probe.bEnabled) ++GD0Probe.RegistrationGeneration;
}

void FUAgentAssetToolsModule::RegisterTools()
{
	IModelContextProtocolModule& ModelContextProtocol = IModelContextProtocolModule::GetChecked();
	if (GD0Probe.bEnabled)
	{
		if (GD0Probe.Route == ED0ProbeRoute::Direct)
		{
			TSharedRef<IModelContextProtocolTool> Probe = MakeShared<FUAgentAssetToolsD0DirectProbe>();
			if (ModelContextProtocol.AddTool(Probe)) RegisteredTools.Add(Probe);
		}
		else if (GD0Probe.Route == ED0ProbeRoute::ToolsetRegistry && UToolsetRegistry::IsAvailable())
		{
			if (!UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass()))
			{
				UToolsetRegistry::RegisterToolsetClass(UUAgentAssetToolsD0Toolset::StaticClass());
			}
			GD0Probe.bToolsetRegistered = UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass());
		}
		else
		{
		UE_LOG(LogTemp, Warning, TEXT("UAgent MVP15D D0 Toolset Registry route deferred until MCP refresh."));
		}
		++GD0Probe.RegistrationGeneration;
		return;
	}
	const TSharedPtr<FJsonObject> Identity = LoadBuildIdentity();
	// A companion without a complete identity is never published.  In particular,
	// do not let a missing manifest turn into six unattributed mutation-capable
	// descriptors during startup or a RefreshTools cycle.
	if (!Identity.IsValid()) return;
	for (const UAgentAssetTools::EOperation Operation : {
		UAgentAssetTools::EOperation::CreateFolder,
		UAgentAssetTools::EOperation::Duplicate,
		UAgentAssetTools::EOperation::Rename,
		UAgentAssetTools::EOperation::Move,
		UAgentAssetTools::EOperation::Delete,
		UAgentAssetTools::EOperation::Save,
	})
	{
		TSharedRef<IModelContextProtocolTool> Tool = MakeShared<FUAgentAssetTool>(Operation, Identity);
		if (ModelContextProtocol.AddTool(Tool)) RegisteredTools.Add(Tool);
	}
}

TSharedPtr<FJsonObject> FUAgentAssetToolsModule::LoadBuildIdentity() const
{
	const TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(UAgentAssetTools::PluginId);
	if (!Plugin.IsValid()) return nullptr;
	const FString PluginRoot = FPaths::ConvertRelativePathToFull(Plugin->GetBaseDir());
	const FString ManifestPath = FPaths::Combine(PluginRoot, TEXT("UAgentAssetTools.build.json"));
	const FString LoadedModulePath = FPaths::ConvertRelativePathToFull(
		FModuleManager::Get().GetModuleFilename(TEXT("UAgentAssetTools")));
	return LoadBuildIdentityCandidateInternal(PluginRoot, ManifestPath, LoadedModulePath);
}

TSharedPtr<FJsonObject> FUAgentAssetToolsModule::LoadBuildIdentityCandidateInternal(
	const FString& InPluginRoot,
	const FString& InManifestPath,
	const FString& InLoadedModulePath)
{
	const auto Reject = [](const TCHAR* Reason) -> TSharedPtr<FJsonObject>
	{
		UE_LOG(LogTemp, Display, TEXT("UAgent companion identity rejected: %s"), Reason);
		return nullptr;
	};
	const FString PluginRoot = FPaths::ConvertRelativePathToFull(InPluginRoot);
	const FString ManifestPath = FPaths::ConvertRelativePathToFull(InManifestPath);
	const FString LoadedModulePath = FPaths::ConvertRelativePathToFull(InLoadedModulePath);
	if (PluginRoot.IsEmpty()
		|| ManifestPath.IsEmpty()
		|| LoadedModulePath.IsEmpty()
		|| !FPaths::IsSamePath(ManifestPath, FPaths::Combine(PluginRoot, TEXT("UAgentAssetTools.build.json")))
		|| !FPaths::IsUnderDirectory(LoadedModulePath, FPaths::Combine(PluginRoot, TEXT("Binaries/Win64"))))
	{
		return Reject(TEXT("noncanonical_path"));
	}
	FString ManifestText;
	if (!FFileHelper::LoadFileToString(ManifestText, *ManifestPath)) return Reject(TEXT("manifest_unreadable"));
	TSharedPtr<FJsonObject> Manifest;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(ManifestText);
	if (!FJsonSerializer::Deserialize(Reader, Manifest) || !Manifest.IsValid()) return Reject(TEXT("manifest_json_invalid"));
	const TSet<FString> ExpectedManifestKeys = {
		TEXT("schemaVersion"), TEXT("taskGeneration"), TEXT("taskId"), TEXT("pluginId"), TEXT("pluginVersion"), TEXT("contractVersion"),
		TEXT("sourceCommit"), TEXT("sourceTreeSha256"), TEXT("physicalFixtures"), TEXT("dirty"), TEXT("engineVersion"),
		TEXT("engineChangelist"), TEXT("compatibleChangelist"), TEXT("moduleBuildId"), TEXT("targetPlatform"), TEXT("configuration"),
		TEXT("compiler"), TEXT("windowsSdk"), TEXT("buildCommandFingerprint"), TEXT("buildEvidenceArtifacts"), TEXT("artifacts"),
		TEXT("modules"), TEXT("toolNames"), TEXT("generatedAt"), TEXT("builder"), TEXT("manifestSelfSha256"),
	};
	if (!HasExactKeys(Manifest, ExpectedManifestKeys)) return Reject(TEXT("manifest_fields_invalid"));
	FString PluginId;
	FString PluginVersion;
	FString ContractVersionValue;
	FString SourceCommit;
	FString SourceTreeSha256;
	FString ManifestSha256;
	FString ModuleBuildId;
	FString BuildCommandFingerprint;
	FString SchemaVersion;
	FString EngineVersion;
	FString TaskGeneration;
	FString TaskId;
	FString TargetPlatform;
	FString Configuration;
	FString GeneratedAt;
	double EngineChangelist = -1.0;
	double CompatibleChangelist = -1.0;
	bool bDirty = true;
	if (!Manifest->TryGetStringField(TEXT("pluginId"), PluginId)
		|| !Manifest->TryGetStringField(TEXT("schemaVersion"), SchemaVersion)
		|| !Manifest->TryGetStringField(TEXT("pluginVersion"), PluginVersion)
		|| !Manifest->TryGetStringField(TEXT("contractVersion"), ContractVersionValue)
		|| !Manifest->TryGetStringField(TEXT("sourceCommit"), SourceCommit)
		|| !Manifest->TryGetStringField(TEXT("sourceTreeSha256"), SourceTreeSha256)
		|| !Manifest->TryGetStringField(TEXT("manifestSelfSha256"), ManifestSha256)
		|| !Manifest->TryGetStringField(TEXT("moduleBuildId"), ModuleBuildId)
		|| !Manifest->TryGetStringField(TEXT("engineVersion"), EngineVersion)
		|| !Manifest->TryGetStringField(TEXT("taskGeneration"), TaskGeneration)
		|| !Manifest->TryGetStringField(TEXT("taskId"), TaskId)
		|| !Manifest->TryGetNumberField(TEXT("engineChangelist"), EngineChangelist)
		|| !Manifest->TryGetNumberField(TEXT("compatibleChangelist"), CompatibleChangelist)
		|| !Manifest->TryGetStringField(TEXT("targetPlatform"), TargetPlatform)
		|| !Manifest->TryGetStringField(TEXT("configuration"), Configuration)
		|| !Manifest->TryGetStringField(TEXT("buildCommandFingerprint"), BuildCommandFingerprint)
		|| !Manifest->TryGetStringField(TEXT("generatedAt"), GeneratedAt)
		|| !Manifest->TryGetBoolField(TEXT("dirty"), bDirty)
		|| SchemaVersion != UAgentAssetTools::ManifestSchemaVersion
		|| PluginId != UAgentAssetTools::PluginId
		|| PluginVersion != UAgentAssetTools::PluginVersion
		|| ContractVersionValue != UAgentAssetTools::ContractVersion
		|| TaskGeneration != TEXT("final-d13-d16")
		|| !TaskId.StartsWith(TEXT("TASK-MVP15D-"))
		|| EngineVersion != UAgentAssetTools::EngineVersion
		|| EngineChangelist != UAgentAssetTools::EngineChangelist
		|| CompatibleChangelist != UAgentAssetTools::CompatibleChangelist
		|| ModuleBuildId != UAgentAssetTools::ModuleBuildId
		|| TargetPlatform != TEXT("Win64")
		|| Configuration != TEXT("Development")
		|| bDirty
		|| !IsLowerHex(SourceCommit, 40)
		|| !IsLowerHex(SourceTreeSha256, 64)
		|| !IsLowerHex(ManifestSha256, 64))
	{
		return Reject(TEXT("manifest_identity_invalid"));
	}
	if (!IsLowerHex(BuildCommandFingerprint, 64) || GeneratedAt.Len() < 20 || !GeneratedAt.EndsWith(TEXT("Z"))) return Reject(TEXT("manifest_metadata_invalid"));

	const TSharedPtr<FJsonObject>* Builder = nullptr;
	const TSharedPtr<FJsonObject>* Compiler = nullptr;
	const TSharedPtr<FJsonObject>* WindowsSdk = nullptr;
	const TArray<TSharedPtr<FJsonValue>>* PhysicalFixtures = nullptr;
	const TArray<TSharedPtr<FJsonValue>>* BuildEvidenceArtifacts = nullptr;
	const TArray<TSharedPtr<FJsonValue>>* PackageArtifacts = nullptr;
	const TArray<TSharedPtr<FJsonValue>>* ModuleArtifacts = nullptr;
	const TArray<TSharedPtr<FJsonValue>>* ToolNames = nullptr;
	if (!Manifest->TryGetObjectField(TEXT("builder"), Builder)
		|| !Manifest->TryGetObjectField(TEXT("compiler"), Compiler)
		|| !Manifest->TryGetObjectField(TEXT("windowsSdk"), WindowsSdk)
		|| !Manifest->TryGetArrayField(TEXT("physicalFixtures"), PhysicalFixtures)
		|| !Manifest->TryGetArrayField(TEXT("buildEvidenceArtifacts"), BuildEvidenceArtifacts)
		|| !Manifest->TryGetArrayField(TEXT("artifacts"), PackageArtifacts)
		|| !Manifest->TryGetArrayField(TEXT("modules"), ModuleArtifacts)
		|| !Manifest->TryGetArrayField(TEXT("toolNames"), ToolNames)
		|| !Builder || !Compiler || !WindowsSdk || !PhysicalFixtures || !BuildEvidenceArtifacts
		|| !PackageArtifacts || !ModuleArtifacts || !ToolNames)
	{
		return Reject(TEXT("manifest_artifact_shape_invalid"));
	}
	const TSet<FString> BuilderKeys = { TEXT("kind"), TEXT("name") };
	const TSet<FString> ToolchainKeys = { TEXT("name"), TEXT("version") };
	FString BuilderKind;
	FString BuilderName;
	FString CompilerName;
	FString CompilerVersion;
	FString WindowsSdkName;
	FString WindowsSdkVersion;
	if (!HasExactKeys(*Builder, BuilderKeys)
		|| !(*Builder)->TryGetStringField(TEXT("kind"), BuilderKind)
		|| !(*Builder)->TryGetStringField(TEXT("name"), BuilderName)
		|| (BuilderKind != TEXT("local") && BuilderKind != TEXT("ci"))
		|| BuilderName.IsEmpty() || BuilderName.Len() > 128
		|| !HasExactKeys(*Compiler, ToolchainKeys)
		|| !(*Compiler)->TryGetStringField(TEXT("name"), CompilerName)
		|| !(*Compiler)->TryGetStringField(TEXT("version"), CompilerVersion)
		|| CompilerName != TEXT("MSVC") || CompilerVersion.IsEmpty()
		|| !HasExactKeys(*WindowsSdk, ToolchainKeys)
		|| !(*WindowsSdk)->TryGetStringField(TEXT("name"), WindowsSdkName)
		|| !(*WindowsSdk)->TryGetStringField(TEXT("version"), WindowsSdkVersion)
		|| WindowsSdkName != TEXT("Windows SDK") || WindowsSdkVersion.IsEmpty()
		|| PhysicalFixtures->Num() != 2
		|| BuildEvidenceArtifacts->Num() < 3)
	{
		return Reject(TEXT("manifest_builder_invalid"));
	}

	const TArray<FString> ExpectedTools = {
		TEXT("ue.asset.create_folder"), TEXT("ue.asset.duplicate"), TEXT("ue.asset.rename"),
		TEXT("ue.asset.move"), TEXT("ue.asset.delete"), TEXT("ue.asset.save"),
	};
	if (ToolNames->Num() != ExpectedTools.Num()) return Reject(TEXT("manifest_tool_list_invalid"));
	for (int32 Index = 0; Index < ExpectedTools.Num(); ++Index)
	{
		if (!(*ToolNames)[Index].IsValid() || (*ToolNames)[Index]->Type != EJson::String || (*ToolNames)[Index]->AsString() != ExpectedTools[Index]) return Reject(TEXT("manifest_tool_list_invalid"));
	}

	const FString BinariesDirectory = FPaths::Combine(PluginRoot, TEXT("Binaries/Win64"));
	TSet<FString> DeclaredModuleNames;
	FString LoadedModuleSha256;
	FString LoadedModuleName;
	FString PreviousModuleName;
	if (ModuleArtifacts->Num() == 0 || LoadedModulePath.IsEmpty()) return Reject(TEXT("manifest_module_list_invalid"));
	for (const TSharedPtr<FJsonValue>& Value : *ModuleArtifacts)
	{
		if (!Value.IsValid() || Value->Type != EJson::Object) return nullptr;
		const TSharedPtr<FJsonObject> Artifact = Value->AsObject();
		FString ModuleLogicalPath;
		if (!Artifact.IsValid() || !Artifact->TryGetStringField(TEXT("path"), ModuleLogicalPath)
			|| !ModuleLogicalPath.StartsWith(TEXT("Binaries/Win64/UnrealEditor-"))
			|| !ModuleLogicalPath.EndsWith(TEXT(".dll")))
		{
			return Reject(TEXT("manifest_module_list_invalid"));
		}
		const FString ModuleName = FPaths::GetCleanFilename(ModuleLogicalPath);
		if (!IsSafeFileName(ModuleName)
			|| ModuleLogicalPath != FString(TEXT("Binaries/Win64/")) + ModuleName
			|| (!PreviousModuleName.IsEmpty() && ModuleName <= PreviousModuleName)
			|| DeclaredModuleNames.Contains(ModuleName))
		{
			return Reject(TEXT("manifest_module_list_invalid"));
		}
		PreviousModuleName = ModuleName;
		FString ModuleSha256;
		if (!VerifyArtifact(Artifact, ModuleLogicalPath, FPaths::Combine(BinariesDirectory, ModuleName), ModuleSha256)) return Reject(TEXT("manifest_module_hash_mismatch"));
		DeclaredModuleNames.Add(ModuleName);
		const FString CandidateModulePath = FPaths::ConvertRelativePathToFull(FPaths::Combine(BinariesDirectory, ModuleName));
		if (FPaths::IsSamePath(LoadedModulePath, CandidateModulePath))
		{
			LoadedModuleName = ModuleName;
			LoadedModuleSha256 = ModuleSha256;
		}
	}
	TSet<FString> ExpectedPackagePaths = {
		TEXT("UAgentAssetTools.uplugin"),
		TEXT("Resources/uagent-asset-tools.schema.json"),
		TEXT("Binaries/Win64/UnrealEditor.modules"),
	};
	for (const FString& ModuleName : DeclaredModuleNames)
	{
		ExpectedPackagePaths.Add(FString(TEXT("Binaries/Win64/")) + ModuleName);
	}
	TSet<FString> ObservedPackagePaths;
	if (PackageArtifacts->Num() != ExpectedPackagePaths.Num()) return Reject(TEXT("manifest_artifact_list_invalid"));
	for (const TSharedPtr<FJsonValue>& Value : *PackageArtifacts)
	{
		if (!Value.IsValid() || Value->Type != EJson::Object) return Reject(TEXT("manifest_artifact_list_invalid"));
		const TSharedPtr<FJsonObject> Artifact = Value->AsObject();
		FString LogicalPath;
		if (!Artifact.IsValid()
			|| !Artifact->TryGetStringField(TEXT("path"), LogicalPath)
			|| !ExpectedPackagePaths.Contains(LogicalPath)
			|| ObservedPackagePaths.Contains(LogicalPath))
		{
			return Reject(TEXT("manifest_artifact_list_invalid"));
		}
		FString ArtifactSha256;
		if (!VerifyArtifact(
			Artifact,
			LogicalPath,
			FPaths::Combine(PluginRoot, LogicalPath),
			ArtifactSha256))
		{
			return Reject(TEXT("manifest_artifact_hash_mismatch"));
		}
		ObservedPackagePaths.Add(LogicalPath);
	}
	FString ModuleIndexText;
	TSharedPtr<FJsonObject> ModuleIndex;
	const FString ModuleIndexPath = FPaths::Combine(BinariesDirectory, TEXT("UnrealEditor.modules"));
	if (!FFileHelper::LoadFileToString(ModuleIndexText, *ModuleIndexPath))
	{
		return Reject(TEXT("module_index_unreadable"));
	}
	const TSharedRef<TJsonReader<>> ModuleIndexReader = TJsonReaderFactory<>::Create(ModuleIndexText);
	const TSet<FString> ModuleIndexKeys = { TEXT("BuildId"), TEXT("Modules") };
	const TSharedPtr<FJsonObject>* ModuleMappings = nullptr;
	FString ObservedModuleBuildId;
	if (!FJsonSerializer::Deserialize(ModuleIndexReader, ModuleIndex)
		|| !ModuleIndex.IsValid()
		|| !HasExactKeys(ModuleIndex, ModuleIndexKeys)
		|| !ModuleIndex->TryGetStringField(TEXT("BuildId"), ObservedModuleBuildId)
		|| ObservedModuleBuildId != ModuleBuildId
		|| !ModuleIndex->TryGetObjectField(TEXT("Modules"), ModuleMappings)
		|| !ModuleMappings
		|| (*ModuleMappings)->Values.Num() != DeclaredModuleNames.Num())
	{
		return Reject(TEXT("module_index_invalid"));
	}
	for (const FString& ModuleFileName : DeclaredModuleNames)
	{
		FString ModuleName = FPaths::GetBaseFilename(ModuleFileName);
		if (!ModuleName.RemoveFromStart(TEXT("UnrealEditor-")))
		{
			return Reject(TEXT("module_index_mapping_invalid"));
		}
		FString MappedFileName;
		if (!(*ModuleMappings)->TryGetStringField(ModuleName, MappedFileName)
			|| MappedFileName != ModuleFileName)
		{
			return Reject(TEXT("module_index_mapping_invalid"));
		}
	}
	TArray<FString> PackagedFiles;
	IFileManager::Get().FindFiles(PackagedFiles, *FPaths::Combine(BinariesDirectory, TEXT("*")), true, false);
	if (PackagedFiles.Num() != DeclaredModuleNames.Num() + 1) return Reject(TEXT("package_layout_invalid"));
	for (const FString& FileName : PackagedFiles)
	{
		if (FileName != TEXT("UnrealEditor.modules") && !DeclaredModuleNames.Contains(FileName)) return Reject(TEXT("package_layout_invalid"));
	}
	if (LoadedModuleName.IsEmpty() || !IsLowerHex(LoadedModuleSha256, 64)) return Reject(TEXT("loaded_module_identity_invalid"));

	TSharedPtr<FJsonObject> ManifestWithoutSelfHash = MakeShared<FJsonObject>();
	for (const auto& Pair : Manifest->Values)
	{
		const FString FieldName(Pair.Key.ToView());
		if (FieldName != TEXT("manifestSelfSha256")) ManifestWithoutSelfHash->SetField(FieldName, Pair.Value);
	}
	FString CanonicalManifest;
	FString ComputedManifestSha256;
	if (!AppendCanonicalJsonObject(ManifestWithoutSelfHash, CanonicalManifest)) return Reject(TEXT("manifest_canonicalization_failed"));
	FTCHARToUTF8 CanonicalManifestUtf8(*CanonicalManifest);
	if (!HashBytes(CanonicalManifestUtf8.Get(), CanonicalManifestUtf8.Length(), ComputedManifestSha256)
		|| ComputedManifestSha256 != ManifestSha256)
	{
		return Reject(TEXT("manifest_self_hash_mismatch"));
	}
	TSharedPtr<FJsonObject> Identity = MakeShared<FJsonObject>();
	Identity->SetStringField(TEXT("schemaVersion"), UAgentAssetTools::IdentitySchemaVersion);
	Identity->SetStringField(TEXT("pluginId"), PluginId);
	Identity->SetStringField(TEXT("pluginVersion"), PluginVersion);
	Identity->SetStringField(TEXT("contractVersion"), ContractVersionValue);
	Identity->SetStringField(TEXT("sourceCommit"), SourceCommit);
	Identity->SetStringField(TEXT("sourceTreeSha256"), SourceTreeSha256);
	Identity->SetStringField(TEXT("buildManifestSha256"), ManifestSha256);
	Identity->SetStringField(TEXT("buildCommandFingerprint"), BuildCommandFingerprint);
	Identity->SetStringField(TEXT("loadedModuleName"), LoadedModuleName);
	Identity->SetStringField(TEXT("loadedModuleSha256"), LoadedModuleSha256);
	Identity->SetStringField(TEXT("engineVersion"), EngineVersion);
	Identity->SetNumberField(TEXT("engineChangelist"), EngineChangelist);
	Identity->SetNumberField(TEXT("compatibleChangelist"), CompatibleChangelist);
	Identity->SetStringField(TEXT("moduleBuildId"), ModuleBuildId);
	return Identity;
}

#if WITH_DEV_AUTOMATION_TESTS
TSharedPtr<FJsonObject> FUAgentAssetToolsModule::LoadBuildIdentityCandidate(
	const FString& PluginRoot,
	const FString& ManifestPath,
	const FString& LoadedModulePath)
{
	return LoadBuildIdentityCandidateInternal(PluginRoot, ManifestPath, LoadedModulePath);
}

TArray<TSharedRef<IModelContextProtocolTool>> FUAgentAssetToolsModule::BuildCandidateToolsForAutomation(
	const FString& PluginRoot,
	const FString& ManifestPath,
	const FString& LoadedModulePath)
{
	TArray<TSharedRef<IModelContextProtocolTool>> Tools;
	const TSharedPtr<FJsonObject> Identity = LoadBuildIdentityCandidateInternal(
		PluginRoot,
		ManifestPath,
		LoadedModulePath);
	if (!Identity.IsValid()) return Tools;
	for (const UAgentAssetTools::EOperation Operation : {
		UAgentAssetTools::EOperation::CreateFolder,
		UAgentAssetTools::EOperation::Duplicate,
		UAgentAssetTools::EOperation::Rename,
		UAgentAssetTools::EOperation::Move,
		UAgentAssetTools::EOperation::Delete,
		UAgentAssetTools::EOperation::Save,
	})
	{
		Tools.Add(MakeShared<FUAgentAssetTool>(Operation, Identity));
	}
	return Tools;
}
#endif

IMPLEMENT_MODULE(FUAgentAssetToolsModule, UAgentAssetTools);
