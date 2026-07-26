#include "Async/TaskGraphInterfaces.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Curves/CurveFloat.h"
#include "EditorAssetLibrary.h"
#include "IModelContextProtocolModule.h"
#include "IModelContextProtocolTool.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "HAL/PlatformTime.h"
#include "Interfaces/IPluginManager.h"
#include "ModelContextProtocolSettings.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Misc/AutomationTest.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UAgentAssetTool.h"
#include "UAgentAssetToolsContract.h"
#include "UAgentAssetToolsD0Probe.h"
#include "UAgentAssetToolsD0Toolset.h"
#include "UAgentAssetToolsModule.h"
#include "ToolsetRegistry/UToolsetRegistry.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"

#if PLATFORM_WINDOWS
#include "Windows/WindowsHWrapper.h"
#include "Windows/AllowWindowsPlatformTypes.h"
#include <winioctl.h>
#include "Windows/HideWindowsPlatformTypes.h"
#endif

namespace
{
#if PLATFORM_WINDOWS
	struct FUAgentMountPointReparseData
	{
		DWORD ReparseTag;
		USHORT ReparseDataLength;
		USHORT Reserved;
		USHORT SubstituteNameOffset;
		USHORT SubstituteNameLength;
		USHORT PrintNameOffset;
		USHORT PrintNameLength;
		WCHAR PathBuffer[1];
	};

	bool CreateDirectoryJunction(const FString& LinkPath, const FString& TargetPath)
	{
		if (!::CreateDirectoryW(*LinkPath, nullptr)) return false;
		const FString AbsoluteTarget = FPaths::ConvertRelativePathToFull(TargetPath).Replace(TEXT("/"), TEXT("\\"));
		const FString SubstituteName = TEXT("\\??\\") + AbsoluteTarget;
		const USHORT SubstituteBytes = static_cast<USHORT>(SubstituteName.Len() * sizeof(WCHAR));
		const USHORT PrintBytes = static_cast<USHORT>(AbsoluteTarget.Len() * sizeof(WCHAR));
		const int32 ReparseDataLength = 4 * sizeof(USHORT)
			+ SubstituteBytes + sizeof(WCHAR)
			+ PrintBytes + sizeof(WCHAR);
		const int32 BufferLength = 2 * sizeof(DWORD) + ReparseDataLength;
		if (BufferLength > MAXIMUM_REPARSE_DATA_BUFFER_SIZE)
		{
			::RemoveDirectoryW(*LinkPath);
			return false;
		}

		TArray<uint8> Buffer;
		Buffer.SetNumZeroed(BufferLength);
		FUAgentMountPointReparseData* Reparse =
			reinterpret_cast<FUAgentMountPointReparseData*>(Buffer.GetData());
		Reparse->ReparseTag = IO_REPARSE_TAG_MOUNT_POINT;
		Reparse->ReparseDataLength = static_cast<USHORT>(ReparseDataLength);
		Reparse->SubstituteNameOffset = 0;
		Reparse->SubstituteNameLength = SubstituteBytes;
		Reparse->PrintNameOffset = SubstituteBytes + sizeof(WCHAR);
		Reparse->PrintNameLength = PrintBytes;
		FMemory::Memcpy(Reparse->PathBuffer, *SubstituteName, SubstituteBytes);
		FMemory::Memcpy(
			reinterpret_cast<uint8*>(Reparse->PathBuffer) + Reparse->PrintNameOffset,
			*AbsoluteTarget,
			PrintBytes);

		HANDLE DirectoryHandle = ::CreateFileW(
			*LinkPath,
			GENERIC_WRITE,
			FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
			nullptr,
			OPEN_EXISTING,
			FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
			nullptr);
		if (DirectoryHandle == INVALID_HANDLE_VALUE)
		{
			::RemoveDirectoryW(*LinkPath);
			return false;
		}
		DWORD BytesReturned = 0;
		const bool bCreated = ::DeviceIoControl(
			DirectoryHandle,
			FSCTL_SET_REPARSE_POINT,
			Reparse,
			BufferLength,
			nullptr,
			0,
			&BytesReturned,
			nullptr) != 0;
		::CloseHandle(DirectoryHandle);
		if (!bCreated) ::RemoveDirectoryW(*LinkPath);
		return bCreated;
	}
#endif

	const TArray<FString>& ExactToolNames()
	{
		static const TArray<FString> Names = {
			TEXT("ue.asset.create_folder"), TEXT("ue.asset.duplicate"), TEXT("ue.asset.rename"),
			TEXT("ue.asset.move"), TEXT("ue.asset.delete"), TEXT("ue.asset.save"),
		};
		return Names;
	}

	const TArray<FString>& EffectStateNames()
	{
		static const TArray<FString> Names = {
			TEXT("known_none"), TEXT("known_effect"), TEXT("known_partial"), TEXT("unknown"),
		};
		return Names;
	}

	TSharedPtr<FJsonObject> LoadPluginJsonResource(const TCHAR* RelativePath);

	TSharedPtr<FJsonObject> LoadNativeBindingVector()
	{
		return LoadPluginJsonResource(TEXT("Resources/mvp15d-native-binding-v2.json"));
	}

	TSharedPtr<FJsonObject> NativeGuardFacts()
	{
		const TSharedPtr<FJsonObject> Vector = LoadNativeBindingVector();
		const TSharedPtr<FJsonObject>* Facts = nullptr;
		return Vector.IsValid()
			&& Vector->TryGetObjectField(TEXT("nativeGuardFacts"), Facts)
			&& Facts
			? *Facts
			: nullptr;
	}

	TSharedPtr<FJsonObject> MakeTestIdentity()
	{
		FString NativeManifestIdentity;
		const TSharedPtr<FJsonObject> GuardFacts = NativeGuardFacts();
		if (GuardFacts.IsValid())
		{
			GuardFacts->TryGetStringField(TEXT("nativeManifestIdentity"), NativeManifestIdentity);
		}
		TSharedPtr<FJsonObject> Identity = MakeShared<FJsonObject>();
		Identity->SetStringField(TEXT("pluginId"), UAgentAssetTools::PluginId);
		Identity->SetStringField(TEXT("pluginVersion"), UAgentAssetTools::PluginVersion);
		Identity->SetStringField(TEXT("contractVersion"), UAgentAssetTools::ContractVersion);
		Identity->SetStringField(TEXT("sourceCommit"), FString::ChrN(40, TEXT('a')));
		Identity->SetStringField(TEXT("sourceTreeSha256"), FString::ChrN(64, TEXT('c')));
		Identity->SetStringField(TEXT("buildManifestSha256"), NativeManifestIdentity);
		Identity->SetStringField(TEXT("buildCommandFingerprint"), FString::ChrN(64, TEXT('d')));
		Identity->SetStringField(TEXT("loadedModuleName"), TEXT("UnrealEditor-UAgentAssetTools.dll"));
		Identity->SetStringField(TEXT("loadedModuleSha256"), FString::ChrN(64, TEXT('e')));
		Identity->SetStringField(TEXT("ueBuildId"), UAgentAssetTools::UeBuildId);
		return Identity;
	}

	TSharedPtr<FJsonObject> MakeAlternateTestIdentity()
	{
		TSharedPtr<FJsonObject> Identity = MakeTestIdentity();
		Identity->SetStringField(TEXT("sourceCommit"), FString::ChrN(40, TEXT('c')));
		return Identity;
	}

	bool SetNativeCallFacts(
		const TSharedPtr<FJsonObject>& Params,
		bool bRollback,
		int32 OperationIndex = 0,
		int32 OperationCount = 1)
	{
		const TSharedPtr<FJsonObject> Facts = NativeGuardFacts();
		if (!Params.IsValid() || !Facts.IsValid()) return false;
		static const TCHAR* RequiredFields[] = {
			TEXT("acceptedPlanBinding"),
			TEXT("nativeRegistrationId"),
			TEXT("nativePhase"),
			TEXT("nativeOperationIndex"),
			TEXT("nativeOperationCount"),
			TEXT("nativeCreatedAt"),
			TEXT("connectionGeneration"),
			TEXT("sessionGeneration"),
			TEXT("nativeSourceIdentity"),
			TEXT("nativeManifestIdentity"),
			TEXT("nativePluginIdentity"),
			TEXT("nativePackageIdentity"),
		};
		for (const TCHAR* Field : RequiredFields)
		{
			const TSharedPtr<FJsonValue>* Value = Facts->Values.Find(Field);
			if (!Value || !Value->IsValid()) return false;
			Params->SetField(Field, *Value);
		}
		Params->SetStringField(TEXT("nativePhase"), bRollback ? TEXT("rollback") : TEXT("execute"));
		Params->SetNumberField(TEXT("nativeOperationIndex"), OperationIndex);
		Params->SetNumberField(TEXT("nativeOperationCount"), OperationCount);
		return true;
	}

	TSharedPtr<FJsonObject> MakeCreateFolderParams(const FString& RunId, bool bDryRun, bool bExecute, bool bRollback)
	{
		TSharedPtr<FJsonObject> Params = MakeShared<FJsonObject>();
		Params->SetStringField(TEXT("changeSetId"), TEXT("cs-ue-automation"));
		Params->SetStringField(TEXT("runId"), RunId);
		Params->SetStringField(TEXT("operationId"), TEXT("op-create-folder"));
		Params->SetBoolField(TEXT("dryRun"), bDryRun);
		Params->SetBoolField(TEXT("execute"), bExecute);
		Params->SetBoolField(TEXT("rollback"), bRollback);
		Params->SetStringField(TEXT("folderPath"), FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *RunId));
		if (!bDryRun) SetNativeCallFacts(Params, bRollback);
		return Params;
	}

	TSharedPtr<FJsonObject> MakeRenameParams(const FString& RunId, bool bDryRun, bool bExecute, bool bRollback)
	{
		TSharedPtr<FJsonObject> Params = MakeCreateFolderParams(RunId, bDryRun, bExecute, bRollback);
		Params->SetStringField(TEXT("operationId"), TEXT("op-rename"));
		Params->RemoveField(TEXT("folderPath"));
		Params->SetStringField(TEXT("assetPath"), FString::Printf(TEXT("/Game/UAgentSandbox/%s/missing"), *RunId));
		Params->SetStringField(TEXT("targetAssetPath"), FString::Printf(TEXT("/Game/UAgentSandbox/%s/target"), *RunId));
		return Params;
	}

	TSharedPtr<FJsonObject> MakeDuplicateParams(const FString& RunId, bool bDryRun, bool bExecute, bool bRollback)
	{
		TSharedPtr<FJsonObject> Params = MakeCreateFolderParams(RunId, bDryRun, bExecute, bRollback);
		Params->SetStringField(TEXT("operationId"), TEXT("op-duplicate"));
		Params->RemoveField(TEXT("folderPath"));
		Params->SetStringField(TEXT("sourceAssetPath"), TEXT("/Game/Test01"));
		Params->SetStringField(TEXT("targetAssetPath"), FString::Printf(TEXT("/Game/UAgentSandbox/%s/duplicate"), *RunId));
		return Params;
	}

	TSharedPtr<FJsonObject> MakeDeleteRollbackParams(const FString& RunId, const FString& OperationId, const FString& DryRunHash)
	{
		TSharedPtr<FJsonObject> Params = MakeCreateFolderParams(RunId, false, false, true);
		Params->SetStringField(TEXT("operationId"), OperationId);
		Params->RemoveField(TEXT("folderPath"));
		Params->SetStringField(TEXT("assetPath"), FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *RunId));
		Params->SetStringField(TEXT("dryRunHash"), DryRunHash);
		return Params;
	}

	TSharedPtr<FJsonObject> MakeAssetPhaseParams(
		const FString& RunId,
		const FString& OperationId,
		bool bDryRun,
		bool bExecute,
		bool bRollback)
	{
		TSharedPtr<FJsonObject> Params = MakeCreateFolderParams(RunId, bDryRun, bExecute, bRollback);
		Params->SetStringField(TEXT("operationId"), OperationId);
		Params->RemoveField(TEXT("folderPath"));
		return Params;
	}

	FString FreshRunId(const TCHAR* Prefix)
	{
		return FString::Printf(TEXT("%s%llu"), Prefix, static_cast<uint64>(FPlatformTime::Cycles64()));
	}

	TSharedPtr<FJsonObject> StructuredContent(const FModelContextProtocolToolResult& Result)
	{
		const TSharedPtr<FJsonObject> ResultObject = Result.JsonObject;
		const TSharedPtr<FJsonObject>* Content = nullptr;
		if (!ResultObject.IsValid() || !ResultObject->TryGetObjectField(TEXT("structuredContent"), Content) || !Content) return nullptr;
		return *Content;
	}

	bool SchemaHasRequiredField(const TSharedPtr<FJsonObject>& Schema, const FString& Field)
	{
		const TArray<TSharedPtr<FJsonValue>>* Required = nullptr;
		if (!Schema.IsValid() || !Schema->TryGetArrayField(TEXT("required"), Required) || !Required) return false;
		for (const TSharedPtr<FJsonValue>& Value : *Required)
		{
			if (Value.IsValid() && Value->Type == EJson::String && Value->AsString() == Field) return true;
		}
		return false;
	}

	bool SchemaEnumMatches(const TSharedPtr<FJsonObject>& Schema, const TArray<FString>& Expected)
	{
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (!Schema.IsValid() || !Schema->TryGetArrayField(TEXT("enum"), Values) || !Values || Values->Num() != Expected.Num()) return false;
		for (int32 Index = 0; Index < Expected.Num(); ++Index)
		{
			if (!(*Values)[Index].IsValid() || (*Values)[Index]->Type != EJson::String || (*Values)[Index]->AsString() != Expected[Index]) return false;
		}
		return true;
	}

	TSharedPtr<FJsonObject> LoadPluginJsonResource(const TCHAR* RelativePath)
	{
		const TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(UAgentAssetTools::PluginId);
		if (!Plugin.IsValid()) return nullptr;
		FString Contents;
		if (!FFileHelper::LoadFileToString(Contents, *FPaths::Combine(Plugin->GetBaseDir(), RelativePath))) return nullptr;
		TSharedPtr<FJsonObject> Parsed;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Contents);
		return FJsonSerializer::Deserialize(Reader, Parsed) && Parsed.IsValid() ? Parsed : nullptr;
	}

	TSharedPtr<FJsonObject> JsonObjectField(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
	{
		const TSharedPtr<FJsonObject>* Value = nullptr;
		return Object.IsValid() && Object->TryGetObjectField(Field, Value) && Value ? *Value : nullptr;
	}

	bool JsonObjectHasField(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
	{
		return Object.IsValid() && Object->HasField(Field);
	}

	struct FManifestCandidate
	{
		FString Root;
		FString ManifestPath;
		FString LoadedModulePath;
		bool bValid = false;
	};

	FManifestCandidate CopyProductionManifestCandidate()
	{
		FManifestCandidate Candidate;
		const TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(UAgentAssetTools::PluginId);
		if (!Plugin.IsValid()) return Candidate;
		const FString SourceRoot = FPaths::ConvertRelativePathToFull(Plugin->GetBaseDir());
		const FString SourceManifest = FPaths::Combine(SourceRoot, TEXT("UAgentAssetTools.build.json"));
		const FString SourceLoadedModule = FPaths::ConvertRelativePathToFull(
			FModuleManager::Get().GetModuleFilename(TEXT("UAgentAssetTools")));
		if (!FPaths::FileExists(SourceManifest) || SourceLoadedModule.IsEmpty()) return Candidate;

		Candidate.Root = FPaths::Combine(
			FPaths::ProjectSavedDir(),
			TEXT("UAgentAssetToolsAutomationCandidates"),
			FreshRunId(TEXT("candidate")));
		const FString CandidateResources = FPaths::Combine(Candidate.Root, TEXT("Resources"));
		const FString CandidateBinaries = FPaths::Combine(Candidate.Root, TEXT("Binaries/Win64"));
		IFileManager& FileManager = IFileManager::Get();
		if (!FileManager.MakeDirectory(*CandidateResources, true)
			|| !FileManager.MakeDirectory(*CandidateBinaries, true))
		{
			return Candidate;
		}

		Candidate.ManifestPath = FPaths::Combine(Candidate.Root, TEXT("UAgentAssetTools.build.json"));
		const FString CandidateUplugin = FPaths::Combine(Candidate.Root, TEXT("UAgentAssetTools.uplugin"));
		const FString CandidateSchema = FPaths::Combine(CandidateResources, TEXT("uagent-asset-tools.schema.json"));
		if (FileManager.Copy(*Candidate.ManifestPath, *SourceManifest) != COPY_OK
			|| FileManager.Copy(*CandidateUplugin, *FPaths::Combine(SourceRoot, TEXT("UAgentAssetTools.uplugin"))) != COPY_OK
			|| FileManager.Copy(*CandidateSchema, *FPaths::Combine(SourceRoot, TEXT("Resources/uagent-asset-tools.schema.json"))) != COPY_OK)
		{
			return Candidate;
		}

		TArray<FString> ModuleFiles;
		FileManager.FindFiles(ModuleFiles, *FPaths::Combine(SourceRoot, TEXT("Binaries/Win64/*.dll")), true, false);
		for (const FString& ModuleFile : ModuleFiles)
		{
			if (FileManager.Copy(
				*FPaths::Combine(CandidateBinaries, ModuleFile),
				*FPaths::Combine(SourceRoot, TEXT("Binaries/Win64"), ModuleFile)) != COPY_OK)
			{
				return Candidate;
			}
		}
		if (FileManager.Copy(
			*FPaths::Combine(CandidateBinaries, TEXT("UnrealEditor.modules")),
			*FPaths::Combine(SourceRoot, TEXT("Binaries/Win64/UnrealEditor.modules"))) != COPY_OK)
		{
			return Candidate;
		}
		Candidate.LoadedModulePath = FPaths::Combine(CandidateBinaries, FPaths::GetCleanFilename(SourceLoadedModule));
		Candidate.bValid = FPaths::FileExists(Candidate.LoadedModulePath);
		return Candidate;
	}

	TSharedPtr<FJsonObject> LoadJsonFile(const FString& Path)
	{
		FString Contents;
		if (!FFileHelper::LoadFileToString(Contents, *Path)) return nullptr;
		TSharedPtr<FJsonObject> Parsed;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Contents);
		return FJsonSerializer::Deserialize(Reader, Parsed) && Parsed.IsValid() ? Parsed : nullptr;
	}

	bool WriteJsonFile(const FString& Path, const TSharedPtr<FJsonObject>& Object)
	{
		if (!Object.IsValid()) return false;
		FString Contents;
		const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Contents);
		return FJsonSerializer::Serialize(Object.ToSharedRef(), Writer)
			&& FFileHelper::SaveStringToFile(Contents, *Path, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	}

	bool ResultStringEquals(const TSharedPtr<FJsonObject>& Result, const TCHAR* Field, const TCHAR* Expected)
	{
		FString Value;
		return Result.IsValid() && Result->TryGetStringField(Field, Value) && Value == Expected;
	}

	bool ResultBoolEquals(const TSharedPtr<FJsonObject>& Result, const TCHAR* Field, bool Expected)
	{
		bool Value = !Expected;
		return Result.IsValid() && Result->TryGetBoolField(Field, Value) && Value == Expected;
	}

	bool IsLowerHexOfLength(const FString& Value, int32 ExpectedLength)
	{
		if (Value.Len() != ExpectedLength) return false;
		for (const TCHAR Character : Value)
		{
			if (!FChar::IsDigit(Character)
				&& (Character < TEXT('a') || Character > TEXT('f')))
			{
				return false;
			}
		}
		return true;
	}

	bool ExtractAcceptedDryRun(
		FAutomationTestBase& Test,
		FUAgentAssetTool& Tool,
		const TSharedPtr<FJsonObject>& Params,
		FString& OutHash)
	{
		const TSharedPtr<FJsonObject> Result = StructuredContent(Tool.Run(Params));
		Test.TestTrue(TEXT("dry run returns structured output"), Result.IsValid());
		Test.TestTrue(TEXT("dry run is accepted"), ResultStringEquals(Result, TEXT("status"), TEXT("dry_run_completed")));
		const bool bHashValid = Result.IsValid() && Result->TryGetStringField(TEXT("dryRunHash"), OutHash) && OutHash.Len() == 40;
		Test.TestTrue(TEXT("dry run returns an accepted hash"), bHashValid);
		return bHashValid;
	}

	bool ExecuteCreatedRunRoot(
		FAutomationTestBase& Test,
		FUAgentAssetTool& Tool,
		const FString& RunId,
		FString& OutHash,
		TSharedPtr<FJsonObject>& OutExecuteResult)
	{
		if (!ExtractAcceptedDryRun(Test, Tool, MakeCreateFolderParams(RunId, true, false, false), OutHash))
		{
			return false;
		}
		TSharedPtr<FJsonObject> Execute = MakeCreateFolderParams(RunId, false, true, false);
		Execute->SetStringField(TEXT("dryRunHash"), OutHash);
		OutExecuteResult = StructuredContent(Tool.Run(Execute));
		Test.TestTrue(TEXT("create-folder execute returns structured output"), OutExecuteResult.IsValid());
		return OutExecuteResult.IsValid();
	}

	FString RunRootDirectory(const FString& RunId)
	{
		FString Directory;
		FPackageName::TryConvertLongPackageNameToFilename(
			FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *RunId),
			Directory,
			TEXT(""));
		return FPaths::ConvertRelativePathToFull(Directory);
	}

	FString DifferentLowerSha1(const FString& Value)
	{
		FString Different = Value;
		if (!Different.IsEmpty()) Different[0] = Different[0] == TEXT('a') ? TEXT('b') : TEXT('a');
		return Different;
	}

	bool CreateGoldenDuplicateSource()
	{
		if (UEditorAssetLibrary::DoesAssetExist(TEXT("/Game/Test01"))) return false;
		UPackage* Package = CreatePackage(TEXT("/Game/Test01"));
		if (!Package) return false;
		UCurveFloat* Asset = NewObject<UCurveFloat>(
			Package,
			TEXT("Test01"),
			RF_Public | RF_Standalone);
		if (!Asset) return false;
		FAssetRegistryModule::AssetCreated(Asset);
		Package->MarkPackageDirty();
		const FString Filename = FPackageName::LongPackageNameToFilename(
			TEXT("/Game/Test01"),
			FPackageName::GetAssetPackageExtension());
		FSavePackageArgs SaveArgs;
		SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
		SaveArgs.SaveFlags = SAVE_NoError;
		return UPackage::SavePackage(Package, Asset, *Filename, SaveArgs);
	}

	bool DeleteGoldenDuplicateSource()
	{
		return UEditorAssetLibrary::DeleteAsset(TEXT("/Game/Test01"));
	}

	bool IsD0ToolsetNoOpResult(
		const FString& Value,
		bool bExpectedToolSearch,
		int32 MinimumGeneration)
	{
		TSharedPtr<FJsonObject> Parsed;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Value);
		if (!FJsonSerializer::Deserialize(Reader, Parsed) || !Parsed.IsValid()) return false;
		FString ReturnValue;
		if (Parsed->Values.Num() == 1 && Parsed->TryGetStringField(TEXT("returnValue"), ReturnValue))
		{
			const TSharedRef<TJsonReader<>> ReturnValueReader = TJsonReaderFactory<>::Create(ReturnValue);
			Parsed.Reset();
			if (!FJsonSerializer::Deserialize(ReturnValueReader, Parsed) || !Parsed.IsValid()) return false;
		}
		FString Status;
		FString Route;
		bool bToolSearchEnabled = !bExpectedToolSearch;
		double Generation = 0.0;
		double MutationCount = -1.0;
		return Parsed->Values.Num() == 5
			&& Parsed->TryGetStringField(TEXT("status"), Status)
			&& Status == TEXT("noop")
			&& Parsed->TryGetStringField(TEXT("route"), Route)
			&& Route == TEXT("toolset_registry")
			&& Parsed->TryGetBoolField(TEXT("toolSearchEnabled"), bToolSearchEnabled)
			&& bToolSearchEnabled == bExpectedToolSearch
			&& Parsed->TryGetNumberField(TEXT("registrationGeneration"), Generation)
			&& Generation >= MinimumGeneration
			&& Parsed->TryGetNumberField(TEXT("mutationCount"), MutationCount)
			&& MutationCount == 0.0;
	}

	bool IsD0DirectNoOpResult(
		const FModelContextProtocolToolResult& ToolResult,
		bool bExpectedToolSearch,
		int32 MinimumGeneration)
	{
		const TSharedPtr<FJsonObject> Result = StructuredContent(ToolResult);
		FString Status;
		FString Route;
		bool bToolSearchEnabled = !bExpectedToolSearch;
		double Generation = 0.0;
		double MutationCount = -1.0;
		return Result.IsValid()
			&& Result->Values.Num() == 5
			&& Result->TryGetStringField(TEXT("status"), Status)
			&& Status == TEXT("noop")
			&& Result->TryGetStringField(TEXT("route"), Route)
			&& Route == TEXT("direct")
			&& Result->TryGetBoolField(TEXT("toolSearchEnabled"), bToolSearchEnabled)
			&& bToolSearchEnabled == bExpectedToolSearch
			&& Result->TryGetNumberField(TEXT("registrationGeneration"), Generation)
			&& Generation >= MinimumGeneration
			&& Result->TryGetNumberField(TEXT("mutationCount"), MutationCount)
			&& MutationCount == 0.0;
	}

	bool WaitForD0ToolsetNoOp(
		UToolCallAsyncResultString* Result,
		bool bExpectedToolSearch,
		int32 MinimumGeneration)
	{
		if (!Result) return false;
		const double Deadline = FPlatformTime::Seconds() + 10.0;
		while (!Result->bIsComplete && FPlatformTime::Seconds() < Deadline)
		{
			FTaskGraphInterface::Get().ProcessThreadUntilIdle(ENamedThreads::GameThread);
			FPlatformProcess::SleepNoStats(0.001f);
		}
		return Result->bIsComplete
			&& Result->Error.IsEmpty()
			&& IsD0ToolsetNoOpResult(Result->Value, bExpectedToolSearch, MinimumGeneration);
	}

	bool VerifyTaskOnlyRegistrationCombination(FAutomationTestBase& Test, bool bExpectedToolsetRegistry, bool bExpectedToolSearch)
	{
		IModelContextProtocolModule& ModelContextProtocol = IModelContextProtocolModule::GetChecked();
		Test.TestTrue(TEXT("task-only registration gate is enabled for the combination session"), UAgentAssetTools::D0::IsEnabled());
		Test.TestEqual(TEXT("combination route matches the command-line gate"), UAgentAssetTools::D0::GetRouteName(), bExpectedToolsetRegistry ? FString(TEXT("toolset_registry")) : FString(TEXT("direct")));
		Test.TestEqual(TEXT("combination observes the configured Tool Search state"), GetDefault<UModelContextProtocolSettings>()->bEnableToolSearch, bExpectedToolSearch);

		// The production post-engine callback must publish the Toolset route before
		// Automation begins; a manual refresh here would mask a startup regression.
		int32 DirectProbeCount = 0;
		bool bDirectNoOpCompleted = false;
		for (const TSharedRef<IModelContextProtocolTool>& Tool : ModelContextProtocol.GetTools())
		{
			if (Tool->GetName() != TEXT("uagent.d0.probe")) continue;
			++DirectProbeCount;
			const FModelContextProtocolToolResult Result = Tool->Run(MakeShared<FJsonObject>());
			bDirectNoOpCompleted = IsD0DirectNoOpResult(
				Result,
				bExpectedToolSearch,
				UAgentAssetTools::D0::GetRegistrationGeneration());
		}

		bool bToolsetRegistered = false;
		bool bToolsetNoOpCompleted = false;
		if (bExpectedToolsetRegistry)
		{
			bToolsetRegistered = UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass());
			Test.TestTrue(TEXT("Toolset Registry class is registered"), bToolsetRegistered);
			const FString Schema = UToolsetRegistry::GetToolsetJsonSchema(UUAgentAssetToolsD0Toolset::StaticClass());
			TSharedPtr<FJsonObject> SchemaObject;
			const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Schema);
			Test.TestTrue(TEXT("Toolset Registry schema parses"), FJsonSerializer::Deserialize(Reader, SchemaObject) && SchemaObject.IsValid());
			FString ToolsetName;
			if (SchemaObject.IsValid() && SchemaObject->TryGetStringField(TEXT("name"), ToolsetName))
			{
				bToolsetNoOpCompleted = WaitForD0ToolsetNoOp(
					UToolsetRegistry::ExecuteTool(ToolsetName, TEXT("Probe"), TEXT("{}")),
					bExpectedToolSearch,
					UAgentAssetTools::D0::GetRegistrationGeneration());
			}
			Test.TestTrue(TEXT("Toolset Registry no-op completed"), bToolsetNoOpCompleted);
			Test.TestEqual(TEXT("Toolset Registry route has no duplicate direct probe"), DirectProbeCount, 0);
		}
		else
		{
			Test.TestEqual(TEXT("Direct route has exactly one no-op probe"), DirectProbeCount, 1);
			Test.TestTrue(TEXT("Direct route no-op completed"), bDirectNoOpCompleted);
			Test.TestFalse(TEXT("Direct route has no Toolset Registry class"), UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass()));
		}

		const int32 GenerationBeforeRefresh = UAgentAssetTools::D0::GetRegistrationGeneration();
		ModelContextProtocol.RefreshTools();
		const int32 GenerationAfterRefresh = UAgentAssetTools::D0::GetRegistrationGeneration();
		Test.TestTrue(TEXT("Refresh retracts and republishes a newer registration generation"), GenerationAfterRefresh > GenerationBeforeRefresh);
		if (bExpectedToolsetRegistry)
		{
			Test.TestTrue(TEXT("Toolset class remains uniquely registered after refresh"), UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass()));
		}
		else
		{
			int32 DirectProbeCountAfterRefresh = 0;
			for (const TSharedRef<IModelContextProtocolTool>& Tool : ModelContextProtocol.GetTools())
			{
				if (Tool->GetName() == TEXT("uagent.d0.probe")) ++DirectProbeCountAfterRefresh;
			}
			Test.TestEqual(TEXT("Direct probe remains unique after refresh"), DirectProbeCountAfterRefresh, 1);
		}

		UE_LOG(
			LogTemp,
			Display,
			TEXT("UAGENT_MVP15D_SUPPORTING_UE_AUTOMATION={\"route\":\"%s\",\"toolSearch\":%s,\"generation\":%d,\"directProbeCount\":%d,\"toolsetRegistered\":%s,\"noOpCompleted\":%s,\"mutationCount\":0}"),
			bExpectedToolsetRegistry ? TEXT("toolset_registry") : TEXT("direct"),
			bExpectedToolSearch ? TEXT("true") : TEXT("false"),
			UAgentAssetTools::D0::GetRegistrationGeneration(),
			DirectProbeCount,
			bToolsetRegistered ? TEXT("true") : TEXT("false"),
			(bDirectNoOpCompleted || bToolsetNoOpCompleted) ? TEXT("true") : TEXT("false"));
		return true;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestSourceCheckpointTest, "UAgentAssetTools.Manifest.SourceCheckpointNoManifest", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestSourceCheckpointTest::RunTest(const FString& Parameters)
{
	const FString CandidateRoot = FPaths::Combine(
		FPaths::ProjectSavedDir(),
		TEXT("UAgentAssetToolsAutomationCandidates"),
		FreshRunId(TEXT("no_manifest")));
	IFileManager::Get().MakeDirectory(*FPaths::Combine(CandidateRoot, TEXT("Binaries/Win64")), true);
	const TArray<TSharedRef<IModelContextProtocolTool>> Tools =
		FUAgentAssetToolsModule::BuildCandidateToolsForAutomation(
			CandidateRoot,
			FPaths::Combine(CandidateRoot, TEXT("UAgentAssetTools.build.json")),
			FPaths::Combine(CandidateRoot, TEXT("Binaries/Win64/UnrealEditor-UAgentAssetTools.dll")));
	TestEqual(TEXT("production registration boundary publishes zero tools for a missing manifest candidate"), Tools.Num(), 0);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestInvalidFieldsContractTest, "UAgentAssetTools.Manifest.InvalidFieldsContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestInvalidFieldsContractTest::RunTest(const FString& Parameters)
{
	const FManifestCandidate Candidate = CopyProductionManifestCandidate();
	TestTrue(TEXT("valid package candidate was copied"), Candidate.bValid);
	TSharedPtr<FJsonObject> Manifest = LoadJsonFile(Candidate.ManifestPath);
	TestTrue(TEXT("valid manifest parses before adversarial mutation"), Manifest.IsValid());
	if (Manifest.IsValid())
	{
		Manifest->RemoveField(TEXT("pluginId"));
		TestTrue(TEXT("invalid candidate manifest was written"), WriteJsonFile(Candidate.ManifestPath, Manifest));
		TestFalse(
			TEXT("production manifest boundary rejects a missing required identity field"),
			FUAgentAssetToolsModule::LoadBuildIdentityCandidate(Candidate.Root, Candidate.ManifestPath, Candidate.LoadedModulePath).IsValid());
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestExtraFieldsContractTest, "UAgentAssetTools.Manifest.ExtraFieldsRejectedContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestExtraFieldsContractTest::RunTest(const FString& Parameters)
{
	const FManifestCandidate Candidate = CopyProductionManifestCandidate();
	TestTrue(TEXT("valid package candidate was copied"), Candidate.bValid);
	TSharedPtr<FJsonObject> Manifest = LoadJsonFile(Candidate.ManifestPath);
	if (Manifest.IsValid())
	{
		Manifest->SetStringField(TEXT("unexpected"), TEXT("blocked"));
		TestTrue(TEXT("extra-field candidate was written"), WriteJsonFile(Candidate.ManifestPath, Manifest));
		TestFalse(
			TEXT("production manifest boundary rejects an extra root field"),
			FUAgentAssetToolsModule::LoadBuildIdentityCandidate(Candidate.Root, Candidate.ManifestPath, Candidate.LoadedModulePath).IsValid());
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestSelfHashContractTest, "UAgentAssetTools.Manifest.SelfHashContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestSelfHashContractTest::RunTest(const FString& Parameters)
{
	const FManifestCandidate Candidate = CopyProductionManifestCandidate();
	TestTrue(TEXT("valid package candidate was copied"), Candidate.bValid);
	TSharedPtr<FJsonObject> Manifest = LoadJsonFile(Candidate.ManifestPath);
	if (Manifest.IsValid())
	{
		Manifest->SetStringField(TEXT("manifestSha256"), FString::ChrN(64, TEXT('0')));
		TestTrue(TEXT("wrong-self-hash candidate was written"), WriteJsonFile(Candidate.ManifestPath, Manifest));
		TestFalse(
			TEXT("production manifest boundary rejects a wrong canonical self hash"),
			FUAgentAssetToolsModule::LoadBuildIdentityCandidate(Candidate.Root, Candidate.ManifestPath, Candidate.LoadedModulePath).IsValid());
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestArtifactContractTest, "UAgentAssetTools.Manifest.ArtifactContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestArtifactContractTest::RunTest(const FString& Parameters)
{
	const FManifestCandidate Candidate = CopyProductionManifestCandidate();
	TestTrue(TEXT("valid package candidate was copied"), Candidate.bValid);
	const FString UpluginPath = FPaths::Combine(Candidate.Root, TEXT("UAgentAssetTools.uplugin"));
	TestTrue(TEXT("candidate artifact was tampered"), FFileHelper::SaveStringToFile(TEXT("\n"), *UpluginPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM, &IFileManager::Get(), FILEWRITE_Append));
	TestFalse(
		TEXT("production manifest boundary rejects artifact byte/hash drift"),
		FUAgentAssetToolsModule::LoadBuildIdentityCandidate(Candidate.Root, Candidate.ManifestPath, Candidate.LoadedModulePath).IsValid());
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestPackageLayoutContractTest, "UAgentAssetTools.Manifest.PackageLayoutContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestPackageLayoutContractTest::RunTest(const FString& Parameters)
{
	const FManifestCandidate Candidate = CopyProductionManifestCandidate();
	TestTrue(TEXT("valid package candidate was copied"), Candidate.bValid);
	const FString UnexpectedModule = FPaths::Combine(Candidate.Root, TEXT("Binaries/Win64/Unexpected.dll"));
	TestTrue(TEXT("foreign package artifact was created"), FFileHelper::SaveStringToFile(TEXT("foreign"), *UnexpectedModule));
	TestFalse(
		TEXT("production manifest boundary rejects undeclared package layout"),
		FUAgentAssetToolsModule::LoadBuildIdentityCandidate(Candidate.Root, Candidate.ManifestPath, Candidate.LoadedModulePath).IsValid());
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestModuleIdentityContractTest, "UAgentAssetTools.Manifest.ModuleIdentityContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestModuleIdentityContractTest::RunTest(const FString& Parameters)
{
	const FManifestCandidate Candidate = CopyProductionManifestCandidate();
	TestTrue(TEXT("valid package candidate was copied"), Candidate.bValid);
	TestTrue(TEXT("candidate loaded module was tampered"), FFileHelper::SaveStringToFile(TEXT("drift"), *Candidate.LoadedModulePath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM, &IFileManager::Get(), FILEWRITE_Append));
	TestFalse(
		TEXT("production manifest boundary rejects loaded module byte drift"),
		FUAgentAssetToolsModule::LoadBuildIdentityCandidate(Candidate.Root, Candidate.ManifestPath, Candidate.LoadedModulePath).IsValid());
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestLoadedModuleCandidateTest, "UAgentAssetTools.Manifest.LoadedModuleCandidateRejected", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestLoadedModuleCandidateTest::RunTest(const FString& Parameters)
{
	const FManifestCandidate Candidate = CopyProductionManifestCandidate();
	TestTrue(TEXT("valid package candidate was copied"), Candidate.bValid);
	const FString UnloadedCandidate = FPaths::Combine(
		Candidate.Root,
		TEXT("Binaries/Win64/UnrealEditor-UAgentAssetTools-Unloaded.dll"));
	TestFalse(
		TEXT("production registration rejects a module path not declared and loaded by the package"),
		FUAgentAssetToolsModule::LoadBuildIdentityCandidate(Candidate.Root, Candidate.ManifestPath, UnloadedCandidate).IsValid());
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsExactSixTest, "UAgentAssetTools.Contract.ExactSix", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsExactSixTest::RunTest(const FString& Parameters)
{
	const TArray<FString>& Expected = ExactToolNames();
	const FManifestCandidate Candidate = CopyProductionManifestCandidate();
	TestTrue(TEXT("valid review-only package candidate was copied"), Candidate.bValid);
	const TArray<TSharedRef<IModelContextProtocolTool>> Tools =
		FUAgentAssetToolsModule::BuildCandidateToolsForAutomation(
			Candidate.Root,
			Candidate.ManifestPath,
			Candidate.LoadedModulePath);
	TestEqual(TEXT("valid manifest registers exactly six production descriptors"), Tools.Num(), 6);
	for (int32 Index = 0; Index < Tools.Num() && Index < Expected.Num(); ++Index)
	{
		TestEqual(FString::Printf(TEXT("registered descriptor %d has exact name"), Index), Tools[Index]->GetName(), Expected[Index]);
	}
	if (!UAgentAssetTools::D0::IsEnabled())
	{
		TArray<FString> PublishedNames;
		for (const TSharedRef<IModelContextProtocolTool>& Tool : IModelContextProtocolModule::GetChecked().GetTools())
		{
			if (UAgentAssetTools::IsExactToolName(Tool->GetName())) PublishedNames.Add(Tool->GetName());
		}
		TestEqual(TEXT("production registry publishes exactly six manifest-backed descriptors"), PublishedNames.Num(), 6);
		for (int32 Index = 0; Index < PublishedNames.Num() && Index < Expected.Num(); ++Index)
		{
			TestEqual(FString::Printf(TEXT("published descriptor %d has exact name"), Index), PublishedNames[Index], Expected[Index]);
		}
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsSandboxValidationTest, "UAgentAssetTools.Contract.SandboxValidation", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsSandboxValidationTest::RunTest(const FString& Parameters)
{
	TSharedPtr<FJsonObject> Valid = MakeShared<FJsonObject>();
	Valid->SetStringField(TEXT("changeSetId"), TEXT("cs-1"));
	Valid->SetStringField(TEXT("runId"), TEXT("run_1"));
	Valid->SetStringField(TEXT("operationId"), TEXT("op-1"));
	Valid->SetBoolField(TEXT("dryRun"), true);
	Valid->SetBoolField(TEXT("execute"), false);
	Valid->SetBoolField(TEXT("rollback"), false);
	Valid->SetStringField(TEXT("folderPath"), TEXT("/Game/UAgentSandbox/run_1"));
	TestTrue(TEXT("exact run root accepted"), UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, Valid).bValid);
	Valid->SetStringField(TEXT("folderPath"), TEXT("/Game/UAgentSandbox"));
	TestFalse(TEXT("global sandbox root blocked"), UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, Valid).bValid);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsStrictMalformedInputTest, "UAgentAssetTools.Contract.StrictMalformedInput", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsStrictMalformedInputTest::RunTest(const FString& Parameters)
{
	const UAgentAssetTools::FValidationResult NullInput = UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, nullptr);
	TestFalse(TEXT("null input is rejected"), NullInput.bValid);
	TestEqual(TEXT("null input has a stable reason"), NullInput.Reason, FString(TEXT("input_not_object")));
	TSharedPtr<FJsonObject> Missing = MakeCreateFolderParams(TEXT("malformed"), true, false, false);
	Missing->RemoveField(TEXT("runId"));
	const UAgentAssetTools::FValidationResult MissingField = UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, Missing);
	TestFalse(TEXT("missing required input is rejected"), MissingField.bValid);
	TestEqual(TEXT("missing run id has a stable reason"), MissingField.Reason, FString(TEXT("unsafe_run_id")));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsStrictWrongTypeTest, "UAgentAssetTools.Contract.StrictWrongType", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsStrictWrongTypeTest::RunTest(const FString& Parameters)
{
	TSharedPtr<FJsonObject> WrongType = MakeCreateFolderParams(TEXT("wrong_type"), true, false, false);
	WrongType->SetStringField(TEXT("dryRun"), TEXT("true"));
	const UAgentAssetTools::FValidationResult Result = UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, WrongType);
	TestFalse(TEXT("string phase flag is rejected"), Result.bValid);
	TestEqual(TEXT("wrong phase flag type has a stable reason"), Result.Reason, FString(TEXT("phase_flags_must_be_boolean")));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsStrictUnknownFieldTest, "UAgentAssetTools.Contract.StrictUnknownField", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsStrictUnknownFieldTest::RunTest(const FString& Parameters)
{
	TSharedPtr<FJsonObject> UnknownField = MakeCreateFolderParams(TEXT("unknown_field"), true, false, false);
	UnknownField->SetStringField(TEXT("untrusted"), TEXT("not_allowed"));
	const UAgentAssetTools::FValidationResult Result = UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, UnknownField);
	TestFalse(TEXT("unknown input field is rejected"), Result.bValid);
	TestEqual(TEXT("unknown field has a stable reason"), Result.Reason, FString(TEXT("unknown_input_field")));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsAcceptedPlanBindingContractTest, "UAgentAssetTools.Contract.AcceptedPlanBinding", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsAcceptedPlanBindingContractTest::RunTest(const FString& Parameters)
{
	const TSharedPtr<FJsonObject> InputSchema = UAgentAssetTools::BuildInputSchema(UAgentAssetTools::EOperation::CreateFolder);
	TestTrue(TEXT("accepted plan binding is an explicit strict input member"), JsonObjectHasField(JsonObjectField(InputSchema, TEXT("properties")), TEXT("acceptedPlanBinding")));

	const TSharedPtr<FJsonObject> Vector = LoadNativeBindingVector();
	const TSharedPtr<FJsonObject>* BindingMaterialField = nullptr;
	const TSharedPtr<FJsonObject>* GuardFactsField = nullptr;
	const TSharedPtr<FJsonObject>* CompanionField = nullptr;
	const TArray<TSharedPtr<FJsonValue>>* Operations = nullptr;
	FString VectorSchema;
	const bool bVectorComplete = Vector.IsValid()
		&& Vector->TryGetStringField(TEXT("schemaVersion"), VectorSchema)
		&& VectorSchema == TEXT("uagent.mvp15d.native-binding-test-vector.v2")
		&& Vector->TryGetObjectField(TEXT("bindingMaterial"), BindingMaterialField)
		&& BindingMaterialField
		&& (*BindingMaterialField).IsValid()
		&& Vector->TryGetObjectField(TEXT("nativeGuardFacts"), GuardFactsField)
		&& GuardFactsField
		&& (*GuardFactsField).IsValid()
		&& (*BindingMaterialField)->TryGetObjectField(TEXT("companion"), CompanionField)
		&& CompanionField
		&& (*CompanionField).IsValid()
		&& (*BindingMaterialField)->TryGetArrayField(TEXT("operations"), Operations)
		&& Operations;
	TestTrue(TEXT("C++ loads the complete generated Rust binding vector"), bVectorComplete);
	if (!bVectorComplete) return false;
	const TSharedPtr<FJsonObject> BindingMaterial = *BindingMaterialField;
	const TSharedPtr<FJsonObject> GuardFacts = *GuardFactsField;
	const TSharedPtr<FJsonObject> Companion = *CompanionField;

	FString Contract;
	FString RegistrationId;
	FString GuardRegistrationId;
	FString ChangeSetId;
	FString RunId;
	FString AcceptedPlanBinding;
	FString AggregateDryRunHash;
	FString AggregateArgsHash;
	double GuardOperationCount = 0.0;
	double GuardConnectionGeneration = 0.0;
	double GuardSessionGeneration = 0.0;
	double CompanionConnectionGeneration = 0.0;
	double CompanionSessionGeneration = 0.0;
	const bool bBindingHeaderComplete =
		BindingMaterial->TryGetStringField(TEXT("contract"), Contract)
		&& Contract == TEXT("mvp15d-native-accepted-plan-v2")
		&& BindingMaterial->TryGetStringField(TEXT("registrationId"), RegistrationId)
		&& GuardFacts->TryGetStringField(TEXT("nativeRegistrationId"), GuardRegistrationId)
		&& RegistrationId == GuardRegistrationId
		&& BindingMaterial->TryGetStringField(TEXT("changeSetId"), ChangeSetId)
		&& BindingMaterial->TryGetStringField(TEXT("runId"), RunId)
		&& BindingMaterial->TryGetStringField(TEXT("aggregateDryRunHash"), AggregateDryRunHash)
		&& IsLowerHexOfLength(AggregateDryRunHash, 64)
		&& BindingMaterial->TryGetStringField(TEXT("aggregateArgsHash"), AggregateArgsHash)
		&& IsLowerHexOfLength(AggregateArgsHash, 64)
		&& GuardFacts->TryGetStringField(TEXT("acceptedPlanBinding"), AcceptedPlanBinding)
		&& IsLowerHexOfLength(AcceptedPlanBinding, 64)
		&& GuardFacts->TryGetNumberField(TEXT("nativeOperationCount"), GuardOperationCount)
		&& GuardOperationCount == Operations->Num()
		&& GuardFacts->TryGetNumberField(TEXT("connectionGeneration"), GuardConnectionGeneration)
		&& GuardFacts->TryGetNumberField(TEXT("sessionGeneration"), GuardSessionGeneration)
		&& Companion->TryGetNumberField(TEXT("connectionGeneration"), CompanionConnectionGeneration)
		&& Companion->TryGetNumberField(TEXT("sessionGeneration"), CompanionSessionGeneration)
		&& GuardConnectionGeneration == CompanionConnectionGeneration
		&& GuardSessionGeneration == CompanionSessionGeneration;
	TestTrue(TEXT("binding header, aggregate hashes, generations and operation count share one tuple"), bBindingHeaderComplete);

	auto GuardIdentityMatchesCompanion = [&GuardFacts, &Companion](
		const TCHAR* GuardField,
		const TCHAR* CompanionFieldName)
	{
		FString GuardValue;
		FString CompanionValue;
		return GuardFacts->TryGetStringField(GuardField, GuardValue)
			&& Companion->TryGetStringField(CompanionFieldName, CompanionValue)
			&& GuardValue == CompanionValue
			&& IsLowerHexOfLength(GuardValue, 64);
	};
	TestTrue(
		TEXT("source, manifest, plugin and package identities share one tuple"),
		GuardIdentityMatchesCompanion(TEXT("nativeSourceIdentity"), TEXT("sourceIdentity"))
			&& GuardIdentityMatchesCompanion(TEXT("nativeManifestIdentity"), TEXT("manifestIdentity"))
			&& GuardIdentityMatchesCompanion(TEXT("nativePluginIdentity"), TEXT("pluginIdentity"))
			&& GuardIdentityMatchesCompanion(TEXT("nativePackageIdentity"), TEXT("packageIdentity")));

	bool bOperationsComplete = Operations->Num() > 0;
	for (const TSharedPtr<FJsonValue>& OperationValue : *Operations)
	{
		if (!OperationValue.IsValid() || OperationValue->Type != EJson::Object)
		{
			bOperationsComplete = false;
			break;
		}
		const TSharedPtr<FJsonObject> Operation = OperationValue->AsObject();
		FString OperationId;
		FString Kind;
		FString ToolName;
		FString PluginDryRunHash;
		FString ArgsHash;
		FString RollbackAction;
		bool bSaveAll = true;
		bool bBulk = true;
		bOperationsComplete = Operation.IsValid()
			&& Operation->TryGetStringField(TEXT("operationId"), OperationId)
			&& !OperationId.IsEmpty()
			&& Operation->TryGetStringField(TEXT("kind"), Kind)
			&& !Kind.IsEmpty()
			&& Operation->TryGetStringField(TEXT("toolName"), ToolName)
			&& UAgentAssetTools::IsExactToolName(ToolName)
			&& Operation->TryGetStringField(TEXT("pluginDryRunHash"), PluginDryRunHash)
			&& IsLowerHexOfLength(PluginDryRunHash, 40)
			&& Operation->TryGetStringField(TEXT("argsHash"), ArgsHash)
			&& IsLowerHexOfLength(ArgsHash, 64)
			&& Operation->TryGetStringField(TEXT("rollbackAction"), RollbackAction)
			&& !RollbackAction.IsEmpty()
			&& Operation->TryGetBoolField(TEXT("saveAll"), bSaveAll)
			&& Operation->TryGetBoolField(TEXT("bulk"), bBulk)
			&& !bBulk;
		if (!bOperationsComplete) break;
	}
	TestTrue(TEXT("C++ consumes every operation and both per-operation hashes"), bOperationsComplete);

	TSharedPtr<FJsonObject> DryRun = MakeCreateFolderParams(TEXT("binding_dry_run"), true, false, false);
	DryRun->SetStringField(TEXT("acceptedPlanBinding"), FString::ChrN(64, TEXT('b')));
	const UAgentAssetTools::FValidationResult DryRunResult = UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, DryRun);
	TestFalse(TEXT("accepted plan binding is forbidden in dry run"), DryRunResult.bValid);
	TestEqual(TEXT("dry run binding has a stable reason"), DryRunResult.Reason, FString(TEXT("accepted_plan_binding_forbidden_in_dry_run")));

	TSharedPtr<FJsonObject> MissingBinding = MakeCreateFolderParams(TEXT("binding_missing"), false, true, false);
	MissingBinding->SetStringField(TEXT("dryRunHash"), FString::ChrN(40, TEXT('a')));
	MissingBinding->RemoveField(TEXT("acceptedPlanBinding"));
	const UAgentAssetTools::FValidationResult MissingBindingResult = UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, MissingBinding);
	TestFalse(TEXT("execute requires a native accepted plan binding"), MissingBindingResult.bValid);
	TestEqual(TEXT("missing execute binding has a stable reason"), MissingBindingResult.Reason, FString(TEXT("accepted_plan_binding_required")));

	TSharedPtr<FJsonObject> Execute = MakeCreateFolderParams(TEXT("binding_execute"), false, true, false);
	Execute->SetStringField(TEXT("dryRunHash"), FString::ChrN(40, TEXT('a')));
	Execute->SetStringField(TEXT("acceptedPlanBinding"), FString::ChrN(64, TEXT('b')));
	TestTrue(TEXT("well-formed execute binding is accepted by input contract"), UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, Execute).bValid);

	TSharedPtr<FJsonObject> InvalidBinding = MakeCreateFolderParams(TEXT("binding_invalid"), false, true, false);
	InvalidBinding->SetStringField(TEXT("dryRunHash"), FString::ChrN(40, TEXT('a')));
	InvalidBinding->SetStringField(TEXT("acceptedPlanBinding"), FString::ChrN(64, TEXT('B')));
	const UAgentAssetTools::FValidationResult InvalidResult = UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::CreateFolder, InvalidBinding);
	TestFalse(TEXT("noncanonical execute binding is rejected"), InvalidResult.bValid);
	TestEqual(TEXT("noncanonical binding has a stable reason"), InvalidResult.Reason, FString(TEXT("accepted_plan_binding_invalid")));

	TSharedPtr<FJsonObject> AlternateBinding = MakeCreateFolderParams(TEXT("binding_execute"), false, true, false);
	AlternateBinding->SetStringField(TEXT("dryRunHash"), FString::ChrN(40, TEXT('a')));
	AlternateBinding->SetStringField(TEXT("acceptedPlanBinding"), FString::ChrN(64, TEXT('c')));
	TestEqual(TEXT("accepted plan binding is excluded from dry-run hash"), UAgentAssetTools::ComputeDryRunHash(Execute), UAgentAssetTools::ComputeDryRunHash(AlternateBinding));

	UAgentAssetTools::InvalidateOperationLedger();
	const bool bGoldenSourceCreated = CreateGoldenDuplicateSource();
	TestTrue(TEXT("canonical vector source was created"), bGoldenSourceCreated);
	if (!bGoldenSourceCreated) return false;

	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	FUAgentAssetTool DuplicateTool(UAgentAssetTools::EOperation::Duplicate, MakeTestIdentity());
	FUAgentAssetTool RenameTool(UAgentAssetTools::EOperation::Rename, MakeTestIdentity());
	FUAgentAssetTool MoveTool(UAgentAssetTools::EOperation::Move, MakeTestIdentity());
	FUAgentAssetTool SaveTool(UAgentAssetTools::EOperation::Save, MakeTestIdentity());
	FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
	auto ToolForKind = [
		&CreateTool,
		&DuplicateTool,
		&RenameTool,
		&MoveTool,
		&SaveTool](const FString& Kind) -> FUAgentAssetTool*
	{
		if (Kind == TEXT("create_folder")) return &CreateTool;
		if (Kind == TEXT("duplicate")) return &DuplicateTool;
		if (Kind == TEXT("rename")) return &RenameTool;
		if (Kind == TEXT("move")) return &MoveTool;
		if (Kind == TEXT("save")) return &SaveTool;
		return nullptr;
	};
	auto MakeVectorDryRun = [&ChangeSetId, &RunId](const TSharedPtr<FJsonObject>& Operation)
	{
		if (!Operation.IsValid()) return TSharedPtr<FJsonObject>();
		FString OperationId;
		FString Kind;
		if (!Operation->TryGetStringField(TEXT("operationId"), OperationId)
			|| !Operation->TryGetStringField(TEXT("kind"), Kind))
		{
			return TSharedPtr<FJsonObject>();
		}
		TSharedPtr<FJsonObject> Params = MakeShared<FJsonObject>();
		Params->SetStringField(TEXT("changeSetId"), ChangeSetId);
		Params->SetStringField(TEXT("runId"), RunId);
		Params->SetStringField(TEXT("operationId"), OperationId);
		Params->SetBoolField(TEXT("dryRun"), true);
		Params->SetBoolField(TEXT("execute"), false);
		Params->SetBoolField(TEXT("rollback"), false);
		FString Value;
		if (Kind == TEXT("create_folder")
			&& Operation->TryGetStringField(TEXT("assetPath"), Value))
		{
			Params->SetStringField(TEXT("folderPath"), Value);
		}
		else if (Kind == TEXT("duplicate"))
		{
			if (!Operation->TryGetStringField(TEXT("sourceAssetPath"), Value)) return TSharedPtr<FJsonObject>();
			Params->SetStringField(TEXT("sourceAssetPath"), Value);
			if (!Operation->TryGetStringField(TEXT("targetAssetPath"), Value)) return TSharedPtr<FJsonObject>();
			Params->SetStringField(TEXT("targetAssetPath"), Value);
		}
		else if (Kind == TEXT("rename") || Kind == TEXT("move"))
		{
			if (!Operation->TryGetStringField(TEXT("assetPath"), Value)) return TSharedPtr<FJsonObject>();
			Params->SetStringField(TEXT("assetPath"), Value);
			if (!Operation->TryGetStringField(TEXT("targetAssetPath"), Value)) return TSharedPtr<FJsonObject>();
			Params->SetStringField(TEXT("targetAssetPath"), Value);
		}
		else if (Kind == TEXT("save"))
		{
			bool bSaveAll = false;
			if (!Operation->TryGetStringField(TEXT("assetPath"), Value)
				|| !Operation->TryGetBoolField(TEXT("saveAll"), bSaveAll))
			{
				return TSharedPtr<FJsonObject>();
			}
			Params->SetStringField(TEXT("assetPath"), Value);
			Params->SetBoolField(TEXT("saveAll"), bSaveAll);
		}
		else
		{
			return TSharedPtr<FJsonObject>();
		}
		return Params;
	};

	TArray<TSharedPtr<FJsonObject>> VectorDryRuns;
	TArray<FString> AcceptedHashes;
	bool bVectorDryRunsAccepted = true;
	for (const TSharedPtr<FJsonValue>& OperationValue : *Operations)
	{
		const TSharedPtr<FJsonObject> Operation = OperationValue->AsObject();
		FString Kind;
		Operation->TryGetStringField(TEXT("kind"), Kind);
		FUAgentAssetTool* Tool = ToolForKind(Kind);
		TSharedPtr<FJsonObject> Params = MakeVectorDryRun(Operation);
		FString Hash;
		if (!Tool || !Params.IsValid() || !ExtractAcceptedDryRun(*this, *Tool, Params, Hash))
		{
			bVectorDryRunsAccepted = false;
			break;
		}
		VectorDryRuns.Add(Params);
		AcceptedHashes.Add(Hash);
	}
	TestTrue(TEXT("the complete canonical operation list is accepted as one C++ plan"), bVectorDryRunsAccepted);
	if (bVectorDryRunsAccepted && VectorDryRuns.Num() == Operations->Num())
	{
		bool bAllVectorOperationsExecuted = true;
		for (int32 Index = 0; Index < VectorDryRuns.Num(); ++Index)
		{
			const TSharedPtr<FJsonObject> Operation = (*Operations)[Index]->AsObject();
			FString Kind;
			Operation->TryGetStringField(TEXT("kind"), Kind);
			FUAgentAssetTool* Tool = ToolForKind(Kind);
			TSharedPtr<FJsonObject> ExecuteParams = MakeShared<FJsonObject>();
			for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : VectorDryRuns[Index]->Values)
			{
				ExecuteParams->SetField(Pair.Key, Pair.Value);
			}
			ExecuteParams->SetBoolField(TEXT("dryRun"), false);
			ExecuteParams->SetBoolField(TEXT("execute"), true);
			ExecuteParams->SetBoolField(TEXT("rollback"), false);
			ExecuteParams->SetStringField(TEXT("dryRunHash"), AcceptedHashes[Index]);
			const bool bFactsCopied = SetNativeCallFacts(
				ExecuteParams,
				false,
				Index,
				Operations->Num());
			TestTrue(
				FString::Printf(TEXT("operation %d copies the canonical native guard facts"), Index),
				bFactsCopied);
			const TSharedPtr<FJsonObject> ExecuteResult =
				Tool ? StructuredContent(Tool->Run(ExecuteParams)) : nullptr;
			const bool bExecuted = ResultStringEquals(ExecuteResult, TEXT("status"), TEXT("executed"));
			TestTrue(
				FString::Printf(TEXT("C++ accepts canonical operation %d under the Rust-produced binding"), Index),
				bExecuted);
			if (!bFactsCopied || !bExecuted)
			{
				bAllVectorOperationsExecuted = false;
				break;
			}
		}

		const TSharedPtr<FJsonObject> Ledger = UAgentAssetTools::GetOperationLedgerSnapshot(
			ChangeSetId,
			RunId,
			TEXT("op-0"));
		FString LedgerCreatedAt;
		FString ExpectedNativeRegistration;
		FString ExpectedSourceIdentity;
		FString ExpectedManifestIdentity;
		FString ExpectedPluginIdentity;
		FString ExpectedPackageIdentity;
		double NativeCreatedAt = 0.0;
		double ConnectionGeneration = 0.0;
		double SessionGeneration = 0.0;
		double NativeOperationCount = 0.0;
		double ExpectedNativeCreatedAt = 0.0;
		GuardFacts->TryGetStringField(TEXT("nativeRegistrationId"), ExpectedNativeRegistration);
		GuardFacts->TryGetStringField(TEXT("nativeSourceIdentity"), ExpectedSourceIdentity);
		GuardFacts->TryGetStringField(TEXT("nativeManifestIdentity"), ExpectedManifestIdentity);
		GuardFacts->TryGetStringField(TEXT("nativePluginIdentity"), ExpectedPluginIdentity);
		GuardFacts->TryGetStringField(TEXT("nativePackageIdentity"), ExpectedPackageIdentity);
		GuardFacts->TryGetNumberField(TEXT("nativeCreatedAt"), ExpectedNativeCreatedAt);
		TestTrue(TEXT("actual ledger stores created time"), Ledger.IsValid() && Ledger->TryGetStringField(TEXT("createdAt"), LedgerCreatedAt) && !LedgerCreatedAt.IsEmpty());
		TestTrue(TEXT("actual ledger stores canonical accepted binding"), ResultStringEquals(Ledger, TEXT("acceptedPlanBinding"), *AcceptedPlanBinding));
		TestTrue(TEXT("actual ledger stores canonical native registration"), ResultStringEquals(Ledger, TEXT("nativeRegistrationId"), *ExpectedNativeRegistration));
		TestTrue(TEXT("actual ledger stores execute phase separately"), ResultStringEquals(Ledger, TEXT("nativePhase"), TEXT("execute")));
		TestTrue(TEXT("actual ledger stores native creation time"), Ledger.IsValid() && Ledger->TryGetNumberField(TEXT("nativeCreatedAt"), NativeCreatedAt) && NativeCreatedAt == ExpectedNativeCreatedAt);
		TestTrue(TEXT("actual ledger stores connection generation"), Ledger.IsValid() && Ledger->TryGetNumberField(TEXT("connectionGeneration"), ConnectionGeneration) && ConnectionGeneration == GuardConnectionGeneration);
		TestTrue(TEXT("actual ledger stores session generation"), Ledger.IsValid() && Ledger->TryGetNumberField(TEXT("sessionGeneration"), SessionGeneration) && SessionGeneration == GuardSessionGeneration);
		TestTrue(TEXT("actual ledger stores canonical operation count"), Ledger.IsValid() && Ledger->TryGetNumberField(TEXT("nativeOperationCount"), NativeOperationCount) && NativeOperationCount == Operations->Num());
		TestTrue(TEXT("actual ledger stores immutable manifest identity"), ResultStringEquals(Ledger, TEXT("nativeManifestIdentity"), *ExpectedManifestIdentity));
		TestTrue(TEXT("actual ledger stores immutable source identity"), ResultStringEquals(Ledger, TEXT("nativeSourceIdentity"), *ExpectedSourceIdentity));
		TestTrue(TEXT("actual ledger stores immutable plugin identity"), ResultStringEquals(Ledger, TEXT("nativePluginIdentity"), *ExpectedPluginIdentity));
		TestTrue(TEXT("actual ledger stores immutable package identity"), ResultStringEquals(Ledger, TEXT("nativePackageIdentity"), *ExpectedPackageIdentity));
		TestTrue(TEXT("actual ledger stores plugin identity"), ResultStringEquals(Ledger, TEXT("pluginId"), UAgentAssetTools::PluginId));
		TestTrue(TEXT("actual ledger stores physical identity"), ResultBoolEquals(Ledger, TEXT("runRootPhysicalIdentityCaptured"), true));

		auto MakeVectorRollback = [&VectorDryRuns, &AcceptedHashes, Operations](int32 Index)
		{
			if (!Operations->IsValidIndex(Index)
				|| !VectorDryRuns.IsValidIndex(Index)
				|| !AcceptedHashes.IsValidIndex(Index))
			{
				return TSharedPtr<FJsonObject>();
			}
			TSharedPtr<FJsonObject> Rollback = MakeShared<FJsonObject>();
			for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : VectorDryRuns[Index]->Values)
			{
				Rollback->SetField(Pair.Key, Pair.Value);
			}
			Rollback->SetBoolField(TEXT("dryRun"), false);
			Rollback->SetBoolField(TEXT("execute"), false);
			Rollback->SetBoolField(TEXT("rollback"), true);
			const TSharedPtr<FJsonObject> Operation = (*Operations)[Index]->AsObject();
			FString Kind;
			FString BeforePath;
			FString AfterPath;
			Operation->TryGetStringField(TEXT("kind"), Kind);
			if (Kind == TEXT("create_folder"))
			{
				Rollback->TryGetStringField(TEXT("folderPath"), AfterPath);
				Rollback->RemoveField(TEXT("folderPath"));
				Rollback->SetStringField(TEXT("assetPath"), AfterPath);
			}
			else if (Kind == TEXT("duplicate"))
			{
				Rollback->TryGetStringField(TEXT("targetAssetPath"), AfterPath);
				Rollback->RemoveField(TEXT("sourceAssetPath"));
				Rollback->RemoveField(TEXT("targetAssetPath"));
				Rollback->SetStringField(TEXT("assetPath"), AfterPath);
			}
			else if (Kind == TEXT("rename") || Kind == TEXT("move"))
			{
				Rollback->TryGetStringField(TEXT("assetPath"), BeforePath);
				Rollback->TryGetStringField(TEXT("targetAssetPath"), AfterPath);
				Rollback->SetStringField(TEXT("assetPath"), AfterPath);
				Rollback->SetStringField(TEXT("targetAssetPath"), BeforePath);
			}
			else
			{
				return TSharedPtr<FJsonObject>();
			}
			Rollback->SetStringField(TEXT("dryRunHash"), AcceptedHashes[Index]);
			SetNativeCallFacts(Rollback, true, Index, Operations->Num());
			return Rollback;
		};
		auto RollbackToolForIndex = [
			Operations,
			&DeleteTool,
			&RenameTool,
			&MoveTool](int32 Index) -> FUAgentAssetTool*
		{
			if (!Operations->IsValidIndex(Index)) return nullptr;
			FString Kind;
			(*Operations)[Index]->AsObject()->TryGetStringField(TEXT("kind"), Kind);
			if (Kind == TEXT("create_folder") || Kind == TEXT("duplicate")) return &DeleteTool;
			if (Kind == TEXT("rename")) return &RenameTool;
			if (Kind == TEXT("move")) return &MoveTool;
			return nullptr;
		};
		constexpr int32 BoundFactProbeIndex = 3;
		auto RejectRollbackFact = [
			this,
			&MakeVectorRollback,
			&RollbackToolForIndex](
			const TCHAR* Field,
			const TSharedPtr<FJsonValue>& Value,
			const TCHAR* ExpectedReason)
		{
			TSharedPtr<FJsonObject> Rollback = MakeVectorRollback(BoundFactProbeIndex);
			Rollback->SetField(FString(Field), Value);
			FUAgentAssetTool* Tool = RollbackToolForIndex(BoundFactProbeIndex);
			const TSharedPtr<FJsonObject> Result =
				Tool ? StructuredContent(Tool->Run(Rollback)) : nullptr;
			FString ActualReason;
			if (Result.IsValid()) Result->TryGetStringField(TEXT("reasonCode"), ActualReason);
			TestTrue(
				FString::Printf(
					TEXT("wrong %s is rejected (actual=%s)"),
					Field,
					*ActualReason),
				ResultStringEquals(Result, TEXT("reasonCode"), ExpectedReason));
		};
		if (bAllVectorOperationsExecuted)
		{
			RejectRollbackFact(TEXT("nativePhase"), MakeShared<FJsonValueString>(TEXT("execute")), TEXT("native_phase_mismatch"));
			RejectRollbackFact(TEXT("nativeOperationIndex"), MakeShared<FJsonValueNumber>(BoundFactProbeIndex + 1), TEXT("native_operation_index_mismatch"));
			RejectRollbackFact(TEXT("nativeOperationCount"), MakeShared<FJsonValueNumber>(Operations->Num() + 1), TEXT("native_operation_count_mismatch"));
			RejectRollbackFact(TEXT("nativeRegistrationId"), MakeShared<FJsonValueString>(ExpectedNativeRegistration + TEXT(":foreign")), TEXT("native_registration_mismatch"));
			RejectRollbackFact(TEXT("nativeCreatedAt"), MakeShared<FJsonValueNumber>(ExpectedNativeCreatedAt + 1.0), TEXT("native_created_at_mismatch"));
			RejectRollbackFact(TEXT("sessionGeneration"), MakeShared<FJsonValueNumber>(GuardSessionGeneration + 1.0), TEXT("native_generation_mismatch"));
			RejectRollbackFact(TEXT("connectionGeneration"), MakeShared<FJsonValueNumber>(GuardConnectionGeneration + 1.0), TEXT("native_generation_mismatch"));
			RejectRollbackFact(TEXT("nativeSourceIdentity"), MakeShared<FJsonValueString>(DifferentLowerSha1(ExpectedSourceIdentity)), TEXT("native_identity_mismatch"));
			RejectRollbackFact(TEXT("nativeManifestIdentity"), MakeShared<FJsonValueString>(DifferentLowerSha1(ExpectedManifestIdentity)), TEXT("native_manifest_identity_mismatch"));
			RejectRollbackFact(TEXT("nativePluginIdentity"), MakeShared<FJsonValueString>(DifferentLowerSha1(ExpectedPluginIdentity)), TEXT("native_identity_mismatch"));
			RejectRollbackFact(TEXT("nativePackageIdentity"), MakeShared<FJsonValueString>(DifferentLowerSha1(ExpectedPackageIdentity)), TEXT("native_identity_mismatch"));
			RejectRollbackFact(TEXT("acceptedPlanBinding"), MakeShared<FJsonValueString>(DifferentLowerSha1(AcceptedPlanBinding)), TEXT("accepted_plan_binding_mismatch"));

			FUAgentAssetTool* MoveRollbackTool = RollbackToolForIndex(BoundFactProbeIndex);
			const TSharedPtr<FJsonObject> MoveRollbackResult =
				MoveRollbackTool
					? StructuredContent(MoveRollbackTool->Run(MakeVectorRollback(BoundFactProbeIndex)))
					: nullptr;
			TestTrue(TEXT("canonical move rollback accepts the same binding"), ResultStringEquals(MoveRollbackResult, TEXT("status"), TEXT("rolled_back")));
			const TSharedPtr<FJsonObject> ReplayResult =
				MoveRollbackTool
					? StructuredContent(MoveRollbackTool->Run(MakeVectorRollback(BoundFactProbeIndex)))
					: nullptr;
			TestTrue(TEXT("rollback replay is literal and does not execute again"), ResultStringEquals(ReplayResult, TEXT("reasonCode"), TEXT("already_rolled_back")));

			for (const int32 RollbackIndex : { 2, 1, 0 })
			{
				FUAgentAssetTool* Tool = RollbackToolForIndex(RollbackIndex);
				const TSharedPtr<FJsonObject> Result =
					Tool ? StructuredContent(Tool->Run(MakeVectorRollback(RollbackIndex))) : nullptr;
				TestTrue(
					FString::Printf(TEXT("canonical operation %d rolls back"), RollbackIndex),
					ResultStringEquals(Result, TEXT("status"), TEXT("rolled_back")));
			}
		}
	}
	IFileManager::Get().DeleteDirectory(*RunRootDirectory(RunId), false, false);
	TestTrue(TEXT("canonical vector source was removed"), DeleteGoldenDuplicateSource());
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsDescriptorSchemaTest, "UAgentAssetTools.Contract.DescriptorSchema", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsDescriptorSchemaTest::RunTest(const FString& Parameters)
{
	for (const UAgentAssetTools::EOperation Operation : {
		UAgentAssetTools::EOperation::CreateFolder,
		UAgentAssetTools::EOperation::Duplicate,
		UAgentAssetTools::EOperation::Rename,
		UAgentAssetTools::EOperation::Move,
		UAgentAssetTools::EOperation::Delete,
		UAgentAssetTools::EOperation::Save,
	})
	{
		const FString ToolName = UAgentAssetTools::GetToolName(Operation);
		const TSharedPtr<FJsonObject> Input = UAgentAssetTools::BuildInputSchema(Operation);
		const TSharedPtr<FJsonObject> Output = UAgentAssetTools::BuildOutputSchema(Operation, MakeTestIdentity());
		bool bInputClosed = false;
		bool bOutputClosed = false;
		TestTrue(FString::Printf(TEXT("%s input schema exists"), *ToolName), Input.IsValid());
		TestTrue(FString::Printf(TEXT("%s output schema exists"), *ToolName), Output.IsValid());
		if (Input.IsValid()) TestTrue(FString::Printf(TEXT("%s input schema forbids extra fields"), *ToolName), Input->TryGetBoolField(TEXT("additionalProperties"), bInputClosed) && !bInputClosed);
		if (Output.IsValid()) TestTrue(FString::Printf(TEXT("%s output schema forbids extra fields"), *ToolName), Output->TryGetBoolField(TEXT("additionalProperties"), bOutputClosed) && !bOutputClosed);
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsStrictOutputSchemaTest, "UAgentAssetTools.Contract.StrictOutputSchema", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsStrictOutputSchemaTest::RunTest(const FString& Parameters)
{
	const TSharedPtr<FJsonObject> Schema = UAgentAssetTools::BuildOutputSchema(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const TSharedPtr<FJsonObject>* Properties = nullptr;
	TestTrue(TEXT("output contract has a properties object"), Schema.IsValid() && Schema->TryGetObjectField(TEXT("properties"), Properties) && Properties && Properties->IsValid());
	TestTrue(TEXT("strict output requires effect state"), SchemaHasRequiredField(Schema, TEXT("effectState")));
	if (Properties && Properties->IsValid())
	{
		const TSharedPtr<FJsonObject>* EffectState = nullptr;
		TestTrue(TEXT("effect state schema exists"), (*Properties)->TryGetObjectField(TEXT("effectState"), EffectState) && EffectState && EffectState->IsValid());
		if (EffectState && EffectState->IsValid())
		{
			TestTrue(TEXT("effect state enum is closed"), SchemaEnumMatches(*EffectState, EffectStateNames()));
		}
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsKnownNoneOutcomeTest, "UAgentAssetTools.Outcome.KnownNone", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsKnownNoneOutcomeTest::RunTest(const FString& Parameters)
{
	FUAgentAssetTool Tool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	TSharedPtr<FJsonObject> Invalid = MakeCreateFolderParams(TEXT("known_none"), true, false, false);
	Invalid->SetStringField(TEXT("folderPath"), TEXT("/Game/UAgentSandbox"));
	const TSharedPtr<FJsonObject> Result = StructuredContent(Tool.Run(Invalid));
	bool bBlocked = false;
	bool bSideEffectObserved = true;
	bool bRollbackAvailable = true;
	FString EffectState;
	TestTrue(TEXT("rejected input returns structured output"), Result.IsValid());
	if (Result.IsValid())
	{
		TestTrue(TEXT("rejected input is blocked before execution"), Result->TryGetBoolField(TEXT("blocked"), bBlocked) && bBlocked);
		TestTrue(TEXT("rejected input reports no observed effect"), Result->TryGetBoolField(TEXT("sideEffectObserved"), bSideEffectObserved) && !bSideEffectObserved);
		TestTrue(TEXT("rejected input has no rollback authority"), Result->TryGetBoolField(TEXT("rollbackAvailable"), bRollbackAvailable) && !bRollbackAvailable);
		TestTrue(TEXT("rejected input is a known zero-effect outcome"), Result->TryGetStringField(TEXT("effectState"), EffectState) && EffectState == TEXT("known_none"));
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsDryRunPreconditionTest, "UAgentAssetTools.DryRun.PreconditionMissingSource", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsDryRunPreconditionTest::RunTest(const FString& Parameters)
{
	// A unique nonexistent sandbox path exercises the native read-only
	// precondition branch.  It cannot create, rename, save, or delete an asset.
	FUAgentAssetTool Tool(UAgentAssetTools::EOperation::Rename, MakeTestIdentity());
	const TSharedPtr<FJsonObject> Result = StructuredContent(Tool.Run(MakeRenameParams(FreshRunId(TEXT("precondition")), true, false, false)));
	TestTrue(TEXT("missing source returns structured output"), Result.IsValid());
	TestTrue(TEXT("missing source is blocked in dry run"), ResultBoolEquals(Result, TEXT("blocked"), true));
	TestTrue(TEXT("missing source uses the read-only precondition reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("rename_or_move_source_missing")));
	TestTrue(TEXT("missing source is a known zero-effect result"), ResultStringEquals(Result, TEXT("effectState"), TEXT("known_none")));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsKnownPartialContractTest, "UAgentAssetTools.Outcome.KnownPartialContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsKnownPartialContractTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::ForwardReportedFailureAfterEffect);
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("known_partial"));
	FString AcceptedHash;
	TSharedPtr<FJsonObject> ExecuteResult;
	if (ExecuteCreatedRunRoot(*this, CreateTool, RunId, AcceptedHash, ExecuteResult))
	{
		TestTrue(TEXT("reported failure after a real owned effect reaches partial branch"), ResultStringEquals(ExecuteResult, TEXT("status"), TEXT("partial_failure")));
		TestTrue(TEXT("observed partial branch is literal known_partial"), ResultStringEquals(ExecuteResult, TEXT("effectState"), TEXT("known_partial")));
		TestTrue(TEXT("observed partial branch retains rollback authority"), ResultBoolEquals(ExecuteResult, TEXT("rollbackAvailable"), true));
		UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
		FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
		const TSharedPtr<FJsonObject> RollbackResult = StructuredContent(
			DeleteTool.Run(MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), AcceptedHash)));
		TestTrue(TEXT("known partial owned root is recovered through production cleanup"), ResultStringEquals(RollbackResult, TEXT("status"), TEXT("rolled_back")));
	}
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsUnknownCallObservationContractTest, "UAgentAssetTools.Outcome.UnknownCallSuccessObservationFailedContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsUnknownCallObservationContractTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::ForwardObservationFailure);
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("unknown_observation"));
	FString AcceptedHash;
	TSharedPtr<FJsonObject> ExecuteResult;
	if (ExecuteCreatedRunRoot(*this, CreateTool, RunId, AcceptedHash, ExecuteResult))
	{
		TestTrue(TEXT("successful call with failed observation reaches partial branch"), ResultStringEquals(ExecuteResult, TEXT("status"), TEXT("partial_failure")));
		TestTrue(TEXT("failed observation is reported literally as unknown"), ResultStringEquals(ExecuteResult, TEXT("effectState"), TEXT("unknown")));
		TestTrue(TEXT("unknown effect retires rollback authority"), ResultBoolEquals(ExecuteResult, TEXT("rollbackAvailable"), false));
	}
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
	IFileManager::Get().DeleteDirectory(*RunRootDirectory(RunId), false, false);
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsUnknownCleanupObservationContractTest, "UAgentAssetTools.Outcome.UnknownCleanupObservationFailedContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsUnknownCleanupObservationContractTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("unknown_cleanup"));
	FString AcceptedHash;
	TSharedPtr<FJsonObject> ExecuteResult;
	if (ExecuteCreatedRunRoot(*this, CreateTool, RunId, AcceptedHash, ExecuteResult)
		&& ResultStringEquals(ExecuteResult, TEXT("status"), TEXT("executed")))
	{
		UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::RunRootEnumerationFailure);
		FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
		const TSharedPtr<FJsonObject> Rollback = MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), AcceptedHash);
		const TSharedPtr<FJsonObject> RollbackResult = StructuredContent(DeleteTool.Run(Rollback));
		TestTrue(TEXT("enumeration failure reaches production cleanup rejection"), ResultStringEquals(RollbackResult, TEXT("reasonCode"), TEXT("run_root_directory_enumeration_failed")));
		TestTrue(TEXT("failed cleanup observation reports unknown"), ResultStringEquals(RollbackResult, TEXT("effectState"), TEXT("unknown")));
		TestTrue(TEXT("unknown cleanup retires rollback authority"), ResultBoolEquals(RollbackResult, TEXT("rollbackAvailable"), false));
		UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
		const TSharedPtr<FJsonObject> RetryResult = StructuredContent(DeleteTool.Run(Rollback));
		TestTrue(TEXT("unknown cleanup is never retried"), ResultStringEquals(RetryResult, TEXT("reasonCode"), TEXT("rollback_not_available")));
		TestTrue(TEXT("unknown cleanup leaves the exact root untouched"), IFileManager::Get().DirectoryExists(*RunRootDirectory(RunId)));
	}
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
	IFileManager::Get().DeleteDirectory(*RunRootDirectory(RunId), false, false);
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsForwardInverseProductionTest, "UAgentAssetTools.Operation.ForwardInverseProduction", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsForwardInverseProductionTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	const bool bGoldenSourceCreated = CreateGoldenDuplicateSource();
	TestTrue(TEXT("task-owned golden duplicate source was created"), bGoldenSourceCreated);
	if (!bGoldenSourceCreated) return false;
	const FString RunId = FreshRunId(TEXT("forward_inverse"));
	const FString RunRoot = FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *RunId);
	const FString DuplicatePath = RunRoot + TEXT("/HeroCopy");
	const FString RenamedPath = RunRoot + TEXT("/HeroRenamed");
	const FString MovedPath = RunRoot + TEXT("/Sub/Nested/HeroRenamed");
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	FUAgentAssetTool DuplicateTool(UAgentAssetTools::EOperation::Duplicate, MakeTestIdentity());
	FUAgentAssetTool RenameTool(UAgentAssetTools::EOperation::Rename, MakeTestIdentity());
	FUAgentAssetTool MoveTool(UAgentAssetTools::EOperation::Move, MakeTestIdentity());
	FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
	FUAgentAssetTool SaveTool(UAgentAssetTools::EOperation::Save, MakeTestIdentity());

	TSharedPtr<FJsonObject> CreateDryRun = MakeCreateFolderParams(RunId, true, false, false);
	TSharedPtr<FJsonObject> DuplicateDryRun = MakeAssetPhaseParams(RunId, TEXT("op-duplicate"), true, false, false);
	DuplicateDryRun->SetStringField(TEXT("sourceAssetPath"), TEXT("/Game/Test01"));
	DuplicateDryRun->SetStringField(TEXT("targetAssetPath"), DuplicatePath);
	TSharedPtr<FJsonObject> RenameDryRun = MakeAssetPhaseParams(RunId, TEXT("op-rename"), true, false, false);
	RenameDryRun->SetStringField(TEXT("assetPath"), DuplicatePath);
	RenameDryRun->SetStringField(TEXT("targetAssetPath"), RenamedPath);
	TSharedPtr<FJsonObject> MoveDryRun = MakeAssetPhaseParams(RunId, TEXT("op-move"), true, false, false);
	MoveDryRun->SetStringField(TEXT("assetPath"), RenamedPath);
	MoveDryRun->SetStringField(TEXT("targetAssetPath"), MovedPath);
	TSharedPtr<FJsonObject> SaveDryRun = MakeAssetPhaseParams(RunId, TEXT("op-save"), true, false, false);
	SaveDryRun->SetStringField(TEXT("assetPath"), MovedPath);
	SaveDryRun->SetBoolField(TEXT("saveAll"), false);

	FString Hashes[5];
	const bool bDryRunsAccepted =
		ExtractAcceptedDryRun(*this, CreateTool, CreateDryRun, Hashes[0])
		&& ExtractAcceptedDryRun(*this, DuplicateTool, DuplicateDryRun, Hashes[1])
		&& ExtractAcceptedDryRun(*this, RenameTool, RenameDryRun, Hashes[2])
		&& ExtractAcceptedDryRun(*this, MoveTool, MoveDryRun, Hashes[3])
		&& ExtractAcceptedDryRun(*this, SaveTool, SaveDryRun, Hashes[4]);
	TestTrue(TEXT("five production dry-run boundaries accepted the ordered plan"), bDryRunsAccepted);
	if (!bDryRunsAccepted)
	{
		TestTrue(TEXT("task-owned golden duplicate source was removed"), DeleteGoldenDuplicateSource());
		UAgentAssetTools::InvalidateOperationLedger();
		return false;
	}

	auto Execute = [this, &RunId](FUAgentAssetTool& Tool, const TSharedPtr<FJsonObject>& DryRun, const FString& Hash, int32 Index)
	{
		TSharedPtr<FJsonObject> Params = MakeShared<FJsonObject>();
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : DryRun->Values) Params->SetField(Pair.Key, Pair.Value);
		Params->SetBoolField(TEXT("dryRun"), false);
		Params->SetBoolField(TEXT("execute"), true);
		Params->SetBoolField(TEXT("rollback"), false);
		Params->SetStringField(TEXT("dryRunHash"), Hash);
		SetNativeCallFacts(Params, false, Index, 5);
		const TSharedPtr<FJsonObject> Result = StructuredContent(Tool.Run(Params));
		TestTrue(FString::Printf(TEXT("forward operation %d executed"), Index), ResultStringEquals(Result, TEXT("status"), TEXT("executed")));
		return Result;
	};
	Execute(CreateTool, CreateDryRun, Hashes[0], 0);
	Execute(DuplicateTool, DuplicateDryRun, Hashes[1], 1);
	const TSharedPtr<FJsonObject> DuplicateLedger = UAgentAssetTools::GetOperationLedgerSnapshot(
		TEXT("cs-ue-automation"),
		RunId,
		TEXT("op-duplicate"));
	FString EffectPackageGuid;
	TestTrue(
		TEXT("duplicate ledger captures package/effect identity facts"),
		DuplicateLedger.IsValid()
			&& DuplicateLedger->TryGetStringField(TEXT("effectPackageGuid"), EffectPackageGuid)
			&& !EffectPackageGuid.IsEmpty());
	Execute(RenameTool, RenameDryRun, Hashes[2], 2);
	Execute(MoveTool, MoveDryRun, Hashes[3], 3);
	const TSharedPtr<FJsonObject> MoveLedger = UAgentAssetTools::GetOperationLedgerSnapshot(
		TEXT("cs-ue-automation"),
		RunId,
		TEXT("op-move"));
	double EffectDirectoryCount = 0.0;
	double EffectDirectoryIdentityCount = 0.0;
	TestTrue(
		TEXT("move ledger captures each explicitly created directory physical identity"),
		MoveLedger.IsValid()
			&& MoveLedger->TryGetNumberField(TEXT("effectCreatedDirectoryCount"), EffectDirectoryCount)
			&& MoveLedger->TryGetNumberField(TEXT("effectCreatedDirectoryIdentityCount"), EffectDirectoryIdentityCount)
			&& EffectDirectoryCount == 2.0
			&& EffectDirectoryIdentityCount == EffectDirectoryCount);
	Execute(SaveTool, SaveDryRun, Hashes[4], 4);

	auto RollbackRenameOrMove = [this, &RunId](
		FUAgentAssetTool& Tool,
		const FString& OperationId,
		const FString& Hash,
		const FString& AssetPath,
		const FString& TargetPath,
		int32 Index,
		bool bExerciseCleanupRetry)
	{
		TSharedPtr<FJsonObject> Params = MakeAssetPhaseParams(RunId, OperationId, false, false, true);
		Params->SetStringField(TEXT("assetPath"), AssetPath);
		Params->SetStringField(TEXT("targetAssetPath"), TargetPath);
		Params->SetStringField(TEXT("dryRunHash"), Hash);
		SetNativeCallFacts(Params, true, Index, 5);
		if (bExerciseCleanupRetry)
		{
			UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::RunRootEnumerationFailure);
			const TSharedPtr<FJsonObject> FirstResult = StructuredContent(Tool.Run(Params));
			TestTrue(
				TEXT("settled inverse with deterministic directory cleanup failure remains retryable"),
				ResultStringEquals(FirstResult, TEXT("status"), TEXT("partial_failure"))
					&& ResultBoolEquals(FirstResult, TEXT("rollbackAvailable"), true)
					&& ResultStringEquals(FirstResult, TEXT("reasonCode"), TEXT("run_root_directory_enumeration_failed")));
			TestTrue(
				TEXT("move inverse settled before cleanup retry"),
				UEditorAssetLibrary::DoesAssetExist(TargetPath)
					&& !UEditorAssetLibrary::DoesAssetExist(AssetPath));
			FString EffectDirectory;
			TestTrue(
				TEXT("owned move directory remains until cleanup retry"),
				FPackageName::TryConvertLongPackageNameToFilename(
					FPackageName::GetLongPackagePath(AssetPath),
					EffectDirectory,
					TEXT(""))
					&& IFileManager::Get().DirectoryExists(*EffectDirectory));
			UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
		}
		const TSharedPtr<FJsonObject> Result = StructuredContent(Tool.Run(Params));
		FString Reason;
		if (Result.IsValid()) Result->TryGetStringField(TEXT("reasonCode"), Reason);
		TestTrue(
			FString::Printf(TEXT("inverse operation %d rolled back (reason=%s)"), Index, *Reason),
			ResultStringEquals(Result, TEXT("status"), TEXT("rolled_back")));
		if (bExerciseCleanupRetry)
		{
			TestTrue(TEXT("cleanup-only replay preserves the successful rollback reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("none")));
			TestTrue(
				TEXT("cleanup-only replay does not execute the inverse asset write again"),
				UEditorAssetLibrary::DoesAssetExist(TargetPath)
					&& !UEditorAssetLibrary::DoesAssetExist(AssetPath));
			FString EffectDirectory;
			TestTrue(
				TEXT("cleanup-only replay resolves the deepest owned move directory"),
				FPackageName::TryConvertLongPackageNameToFilename(
					FPackageName::GetLongPackagePath(AssetPath),
					EffectDirectory,
					TEXT("")));
			const FString ParentEffectDirectory = FPaths::GetPath(EffectDirectory);
			TestTrue(
				TEXT("cleanup-only replay removes the exact owned parent move directory"),
				!IFileManager::Get().DirectoryExists(*EffectDirectory)
					&& !IFileManager::Get().DirectoryExists(*ParentEffectDirectory));
		}
	};
	RollbackRenameOrMove(MoveTool, TEXT("op-move"), Hashes[3], MovedPath, RenamedPath, 3, true);
	RollbackRenameOrMove(RenameTool, TEXT("op-rename"), Hashes[2], RenamedPath, DuplicatePath, 2, false);
	TSharedPtr<FJsonObject> DuplicateRollback = MakeDeleteRollbackParams(RunId, TEXT("op-duplicate"), Hashes[1]);
	DuplicateRollback->SetStringField(TEXT("assetPath"), DuplicatePath);
	SetNativeCallFacts(DuplicateRollback, true, 1, 5);
	const TSharedPtr<FJsonObject> DuplicateRollbackResult = StructuredContent(DeleteTool.Run(DuplicateRollback));
	FString DuplicateRollbackReason;
	if (DuplicateRollbackResult.IsValid()) DuplicateRollbackResult->TryGetStringField(TEXT("reasonCode"), DuplicateRollbackReason);
	TestTrue(
		FString::Printf(TEXT("duplicate inverse deletes the exact owned effect (reason=%s)"), *DuplicateRollbackReason),
		ResultStringEquals(DuplicateRollbackResult, TEXT("status"), TEXT("rolled_back")));
	TSharedPtr<FJsonObject> RootRollback = MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), Hashes[0]);
	SetNativeCallFacts(RootRollback, true, 0, 5);
	const TSharedPtr<FJsonObject> RootRollbackResult = StructuredContent(DeleteTool.Run(RootRollback));
	FString RootRollbackReason;
	if (RootRollbackResult.IsValid()) RootRollbackResult->TryGetStringField(TEXT("reasonCode"), RootRollbackReason);
	TestTrue(
		FString::Printf(TEXT("final inverse deletes the exact empty owned leaf (reason=%s)"), *RootRollbackReason),
		ResultStringEquals(RootRollbackResult, TEXT("status"), TEXT("rolled_back")));
	TestFalse(TEXT("forward/inverse lifecycle restores the run root"), IFileManager::Get().DirectoryExists(*RunRootDirectory(RunId)));
	TestTrue(TEXT("task-owned golden duplicate source was removed"), DeleteGoldenDuplicateSource());
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsRunRootCreateToIdentityRaceTest, "UAgentAssetTools.Ownership.RunRootCreateToIdentityRace", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsRunRootCreateToIdentityRaceTest::RunTest(const FString& Parameters)
{
#if PLATFORM_WINDOWS
	UAgentAssetTools::InvalidateOperationLedger();
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("create_identity_root"));
	const FString RunRoot = FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *RunId);
	const FString Directory = RunRootDirectory(RunId);
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(
		*this,
		CreateTool,
		MakeCreateFolderParams(RunId, true, false, false),
		AcceptedHash))
	{
		TSharedPtr<FJsonObject> Execute = MakeCreateFolderParams(RunId, false, true, false);
		Execute->SetStringField(TEXT("dryRunHash"), AcceptedHash);
		UAgentAssetTools::SetAutomationFault(
			UAgentAssetTools::EAutomationFault::RunRootCreateToIdentityReplacement);
		const TSharedPtr<FJsonObject> Result = StructuredContent(CreateTool.Run(Execute));
		UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);

		TestTrue(TEXT("run-root create-to-identity replacement is blocked"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("run-root race has a stable fail-closed reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("run_root_create_identity_race_detected")));
		TestTrue(TEXT("run-root replacement residue is reported as an observed side effect"), ResultBoolEquals(Result, TEXT("sideEffectObserved"), true));
		TestTrue(TEXT("run-root replacement residue is truthfully unknown"), ResultStringEquals(Result, TEXT("effectState"), TEXT("unknown")));
		TestTrue(TEXT("run-root race grants no rollback authority"), ResultBoolEquals(Result, TEXT("rollbackAvailable"), false));

		const TSharedPtr<FJsonObject> Ledger = UAgentAssetTools::GetOperationLedgerSnapshot(
			TEXT("cs-ue-automation"),
			RunId,
			TEXT("op-create-folder"));
		TestTrue(TEXT("foreign run-root identity is never recorded"), ResultBoolEquals(Ledger, TEXT("runRootPhysicalIdentityCaptured"), false));
		TestTrue(TEXT("foreign replacement directory remains after refusal"), IFileManager::Get().DirectoryExists(*Directory));

		FAssetRegistryModule& RegistryModule =
			FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
		TArray<FAssetData> Assets;
		RegistryModule.Get().GetAssetsByPath(FName(*RunRoot), Assets, true);
		TestFalse(TEXT("no asset-registry path write follows the identity race"), RegistryModule.Get().PathExists(RunRoot));
		TestEqual(TEXT("no asset write follows the identity race"), Assets.Num(), 0);
	}
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
	TestTrue(
		TEXT("task-owned foreign replacement cleanup succeeds"),
		!IFileManager::Get().DirectoryExists(*Directory)
			|| IFileManager::Get().DeleteDirectory(*Directory, false, false));
	UAgentAssetTools::InvalidateOperationLedger();
#else
	AddInfo(TEXT("Run-root physical identity acquisition is Windows-only."));
#endif
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsEffectDirectoryCreateToIdentityRaceTest, "UAgentAssetTools.Ownership.EffectDirectoryCreateToIdentityRace", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsEffectDirectoryCreateToIdentityRaceTest::RunTest(const FString& Parameters)
{
#if PLATFORM_WINDOWS
	UAgentAssetTools::InvalidateOperationLedger();
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
	const bool bGoldenSourceCreated = CreateGoldenDuplicateSource();
	TestTrue(TEXT("task-owned race-test source was created"), bGoldenSourceCreated);
	if (!bGoldenSourceCreated)
	{
		UAgentAssetTools::InvalidateOperationLedger();
		return false;
	}

	const FString RunId = FreshRunId(TEXT("create_identity_effect"));
	const FString RunRoot = FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *RunId);
	const FString DuplicatePath = RunRoot + TEXT("/RaceSource");
	const FString TargetDirectoryPath = RunRoot + TEXT("/ForeignIntermediate");
	const FString MovedPath = TargetDirectoryPath + TEXT("/RaceSource");
	FString TargetDirectory;
	TestTrue(
		TEXT("effect race target resolves to a physical directory"),
		FPackageName::TryConvertLongPackageNameToFilename(TargetDirectoryPath, TargetDirectory, TEXT("")));

	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	FUAgentAssetTool DuplicateTool(UAgentAssetTools::EOperation::Duplicate, MakeTestIdentity());
	FUAgentAssetTool MoveTool(UAgentAssetTools::EOperation::Move, MakeTestIdentity());
	TSharedPtr<FJsonObject> CreateDryRun = MakeCreateFolderParams(RunId, true, false, false);
	TSharedPtr<FJsonObject> DuplicateDryRun = MakeAssetPhaseParams(RunId, TEXT("op-race-duplicate"), true, false, false);
	DuplicateDryRun->SetStringField(TEXT("sourceAssetPath"), TEXT("/Game/Test01"));
	DuplicateDryRun->SetStringField(TEXT("targetAssetPath"), DuplicatePath);
	TSharedPtr<FJsonObject> MoveDryRun = MakeAssetPhaseParams(RunId, TEXT("op-race-move"), true, false, false);
	MoveDryRun->SetStringField(TEXT("assetPath"), DuplicatePath);
	MoveDryRun->SetStringField(TEXT("targetAssetPath"), MovedPath);

	FString Hashes[3];
	const bool bDryRunsAccepted =
		ExtractAcceptedDryRun(*this, CreateTool, CreateDryRun, Hashes[0])
		&& ExtractAcceptedDryRun(*this, DuplicateTool, DuplicateDryRun, Hashes[1])
		&& ExtractAcceptedDryRun(*this, MoveTool, MoveDryRun, Hashes[2]);
	TestTrue(TEXT("race-test plan dry runs are accepted"), bDryRunsAccepted);
	if (bDryRunsAccepted)
	{
		auto Execute = [](FUAgentAssetTool& Tool, const TSharedPtr<FJsonObject>& DryRun, const FString& Hash, int32 Index)
		{
			TSharedPtr<FJsonObject> Params = MakeShared<FJsonObject>();
			for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : DryRun->Values)
			{
				Params->SetField(Pair.Key, Pair.Value);
			}
			Params->SetBoolField(TEXT("dryRun"), false);
			Params->SetBoolField(TEXT("execute"), true);
			Params->SetBoolField(TEXT("rollback"), false);
			Params->SetStringField(TEXT("dryRunHash"), Hash);
			SetNativeCallFacts(Params, false, Index, 3);
			return StructuredContent(Tool.Run(Params));
		};

		const TSharedPtr<FJsonObject> CreateResult = Execute(CreateTool, CreateDryRun, Hashes[0], 0);
		const TSharedPtr<FJsonObject> DuplicateResult = Execute(DuplicateTool, DuplicateDryRun, Hashes[1], 1);
		TestTrue(TEXT("race-test run root executes"), ResultStringEquals(CreateResult, TEXT("status"), TEXT("executed")));
		TestTrue(TEXT("race-test source duplicate executes"), ResultStringEquals(DuplicateResult, TEXT("status"), TEXT("executed")));
		if (ResultStringEquals(CreateResult, TEXT("status"), TEXT("executed"))
			&& ResultStringEquals(DuplicateResult, TEXT("status"), TEXT("executed")))
		{
			UAgentAssetTools::SetAutomationFault(
				UAgentAssetTools::EAutomationFault::EffectDirectoryCreateToIdentityReplacement);
			const TSharedPtr<FJsonObject> MoveResult = Execute(MoveTool, MoveDryRun, Hashes[2], 2);
			UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);

			TestTrue(TEXT("effect-directory create-to-identity replacement is blocked"), ResultBoolEquals(MoveResult, TEXT("blocked"), true));
			TestTrue(TEXT("effect-directory race has a stable fail-closed reason"), ResultStringEquals(MoveResult, TEXT("reasonCode"), TEXT("effect_directory_create_identity_race_detected")));
			TestTrue(TEXT("effect-directory replacement residue is reported"), ResultBoolEquals(MoveResult, TEXT("sideEffectObserved"), true));
			TestTrue(TEXT("effect-directory replacement residue is truthfully unknown"), ResultStringEquals(MoveResult, TEXT("effectState"), TEXT("unknown")));
			TestTrue(TEXT("effect-directory race grants no rollback authority"), ResultBoolEquals(MoveResult, TEXT("rollbackAvailable"), false));
			TestTrue(TEXT("no move asset write follows the identity race"), UEditorAssetLibrary::DoesAssetExist(DuplicatePath) && !UEditorAssetLibrary::DoesAssetExist(MovedPath));
			TestTrue(TEXT("foreign intermediate directory is never deleted"), IFileManager::Get().DirectoryExists(*TargetDirectory));

			const TSharedPtr<FJsonObject> MoveLedger = UAgentAssetTools::GetOperationLedgerSnapshot(
				TEXT("cs-ue-automation"),
				RunId,
				TEXT("op-race-move"));
			double CreatedDirectoryCount = -1.0;
			double CreatedIdentityCount = -1.0;
			TestTrue(
				TEXT("foreign intermediate identity is never recorded"),
				MoveLedger.IsValid()
					&& MoveLedger->TryGetNumberField(TEXT("effectCreatedDirectoryCount"), CreatedDirectoryCount)
					&& MoveLedger->TryGetNumberField(TEXT("effectCreatedDirectoryIdentityCount"), CreatedIdentityCount)
					&& CreatedDirectoryCount == 0.0
					&& CreatedIdentityCount == 0.0);
		}
	}

	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
	if (UEditorAssetLibrary::DoesAssetExist(MovedPath))
	{
		UEditorAssetLibrary::DeleteAsset(MovedPath);
	}
	if (UEditorAssetLibrary::DoesAssetExist(DuplicatePath))
	{
		UEditorAssetLibrary::DeleteAsset(DuplicatePath);
	}
	if (!TargetDirectory.IsEmpty())
	{
		IFileManager::Get().DeleteDirectory(*TargetDirectory, false, false);
	}
	IFileManager::Get().DeleteDirectory(*RunRootDirectory(RunId), false, false);
	TestTrue(TEXT("task-owned race-test source was removed"), DeleteGoldenDuplicateSource());
	UAgentAssetTools::InvalidateOperationLedger();
#else
	AddInfo(TEXT("Effect-directory physical identity acquisition is Windows-only."));
#endif
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsForwardHashMismatchTest, "UAgentAssetTools.Ownership.ForwardHashMismatch", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsForwardHashMismatchTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool Tool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("hash_mismatch"));
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, Tool, MakeCreateFolderParams(RunId, true, false, false), AcceptedHash))
	{
		const TSharedPtr<FJsonObject> Execute = MakeCreateFolderParams(RunId, false, true, false);
		Execute->SetStringField(TEXT("dryRunHash"), DifferentLowerSha1(AcceptedHash));
		const TSharedPtr<FJsonObject> Result = StructuredContent(Tool.Run(Execute));
		TestTrue(TEXT("forward hash mismatch is blocked"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("forward hash mismatch has a stable reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("accepted_plan_identity_mismatch")));
		TestTrue(TEXT("forward hash mismatch has no effect"), ResultStringEquals(Result, TEXT("effectState"), TEXT("known_none")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsForwardToolMismatchTest, "UAgentAssetTools.Ownership.ForwardToolMismatch", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsForwardToolMismatchTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("tool_mismatch"));
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, CreateTool, MakeCreateFolderParams(RunId, true, false, false), AcceptedHash))
	{
		FUAgentAssetTool DuplicateTool(UAgentAssetTools::EOperation::Duplicate, MakeTestIdentity());
		const TSharedPtr<FJsonObject> Execute = MakeDuplicateParams(RunId, false, true, false);
		Execute->SetStringField(TEXT("operationId"), TEXT("op-create-folder"));
		Execute->SetStringField(TEXT("dryRunHash"), AcceptedHash);
		const TSharedPtr<FJsonObject> Result = StructuredContent(DuplicateTool.Run(Execute));
		TestTrue(TEXT("forward tool mismatch is blocked"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("forward tool mismatch has a stable reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("accepted_plan_arguments_mismatch")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsForwardArgumentsMismatchContractTest, "UAgentAssetTools.Ownership.ForwardArgumentsMismatchContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsForwardArgumentsMismatchContractTest::RunTest(const FString& Parameters)
{
	// The create-folder forward has one canonical target derived from runId.
	// Its exact argument equality is therefore represented by the closed input
	// schema plus the dry-run hash, without manufacturing a second target.
	const TSharedPtr<FJsonObject> Input = UAgentAssetTools::BuildInputSchema(UAgentAssetTools::EOperation::CreateFolder);
	bool bClosed = false;
	TestTrue(TEXT("forward input rejects extra arguments"), Input.IsValid() && Input->TryGetBoolField(TEXT("additionalProperties"), bClosed) && !bClosed);
	TestTrue(TEXT("forward input requires the canonical folder target"), SchemaHasRequiredField(Input, TEXT("folderPath")));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsInverseToolMismatchTest, "UAgentAssetTools.Ownership.InverseToolMismatch", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsInverseToolMismatchTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("inverse_mismatch"));
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, CreateTool, MakeCreateFolderParams(RunId, true, false, false), AcceptedHash))
	{
		FUAgentAssetTool RenameTool(UAgentAssetTools::EOperation::Rename, MakeTestIdentity());
		const TSharedPtr<FJsonObject> Rollback = MakeRenameParams(RunId, false, false, true);
		Rollback->SetStringField(TEXT("operationId"), TEXT("op-create-folder"));
		Rollback->SetStringField(TEXT("dryRunHash"), AcceptedHash);
		const TSharedPtr<FJsonObject> Result = StructuredContent(RenameTool.Run(Rollback));
		TestTrue(TEXT("inverse tool mismatch is blocked"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("inverse tool mismatch has a stable reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("native_rollback_tool_binding_invalid")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsInverseHashMismatchTest, "UAgentAssetTools.Ownership.InverseHashMismatch", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsInverseHashMismatchTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("inverse_hash"));
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, CreateTool, MakeCreateFolderParams(RunId, true, false, false), AcceptedHash))
	{
		FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
		const TSharedPtr<FJsonObject> Rollback = MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), DifferentLowerSha1(AcceptedHash));
		const TSharedPtr<FJsonObject> Result = StructuredContent(DeleteTool.Run(Rollback));
		TestTrue(TEXT("inverse hash mismatch is blocked"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("inverse hash mismatch has a stable reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("accepted_plan_identity_mismatch")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsInverseArgumentsMismatchTest, "UAgentAssetTools.Ownership.InverseArgumentsMismatch", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsInverseArgumentsMismatchTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("inverse_args"));
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, CreateTool, MakeCreateFolderParams(RunId, true, false, false), AcceptedHash))
	{
		FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
		const TSharedPtr<FJsonObject> Rollback = MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), AcceptedHash);
		Rollback->SetStringField(TEXT("assetPath"), FString::Printf(TEXT("/Game/UAgentSandbox/%s/replacement"), *RunId));
		const TSharedPtr<FJsonObject> Result = StructuredContent(DeleteTool.Run(Rollback));
		TestTrue(TEXT("inverse argument mismatch is blocked"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("inverse argument mismatch has a stable reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("rollback_inverse_arguments_mismatch")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsResultContractMismatchTest, "UAgentAssetTools.Ownership.ResultContractMismatch", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsResultContractMismatchTest::RunTest(const FString& Parameters)
{
	const TSharedPtr<FJsonObject> Schema = UAgentAssetTools::BuildOutputSchema(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	bool bClosed = false;
	TestTrue(TEXT("unexpected result fields are rejected by strict output schema"), Schema.IsValid() && Schema->TryGetBoolField(TEXT("additionalProperties"), bClosed) && !bClosed);
	TestTrue(TEXT("result effect classification is required"), SchemaHasRequiredField(Schema, TEXT("effectState")));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsTargetCollisionTest, "UAgentAssetTools.Ownership.TargetCollisionNoReplacement", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsTargetCollisionTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool Tool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("target_collision"));
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, Tool, MakeCreateFolderParams(RunId, true, false, false), AcceptedHash))
	{
		const TSharedPtr<FJsonObject> Replacement = MakeCreateFolderParams(RunId, true, false, false);
		Replacement->SetStringField(TEXT("operationId"), TEXT("op-replacement"));
		const TSharedPtr<FJsonObject> Result = StructuredContent(Tool.Run(Replacement));
		TestTrue(TEXT("planned target cannot be replaced by a second dry run"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("planned target collision has a stable reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("run_root_already_present")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsRunMismatchTest, "UAgentAssetTools.Ownership.RunMismatch", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsRunMismatchTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool Tool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, Tool, MakeCreateFolderParams(FreshRunId(TEXT("source_run")), true, false, false), AcceptedHash))
	{
		const TSharedPtr<FJsonObject> Execute = MakeCreateFolderParams(FreshRunId(TEXT("other_run")), false, true, false);
		Execute->SetStringField(TEXT("dryRunHash"), AcceptedHash);
		const TSharedPtr<FJsonObject> Result = StructuredContent(Tool.Run(Execute));
		TestTrue(TEXT("different run cannot reuse accepted plan"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("different run has no ledger record"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("accepted_dry_run_missing")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsManifestIdentityMismatchTest, "UAgentAssetTools.Ownership.ManifestIdentityMismatch", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsManifestIdentityMismatchTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool OriginalTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("identity_mismatch"));
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, OriginalTool, MakeCreateFolderParams(RunId, true, false, false), AcceptedHash))
	{
		FUAgentAssetTool ReplacedIdentityTool(UAgentAssetTools::EOperation::CreateFolder, MakeAlternateTestIdentity());
		const TSharedPtr<FJsonObject> Execute = MakeCreateFolderParams(RunId, false, true, false);
		Execute->SetStringField(TEXT("dryRunHash"), AcceptedHash);
		const TSharedPtr<FJsonObject> Result = StructuredContent(ReplacedIdentityTool.Run(Execute));
		TestTrue(TEXT("changed manifest identity blocks the accepted plan"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("changed manifest identity has a stable reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("accepted_plan_identity_mismatch")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsDryRunReplayIdempotenceTest, "UAgentAssetTools.Ownership.DryRunReplayIdempotence", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsDryRunReplayIdempotenceTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool Tool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const TSharedPtr<FJsonObject> Params = MakeCreateFolderParams(FreshRunId(TEXT("idempotent")), true, false, false);
	FString FirstHash;
	if (ExtractAcceptedDryRun(*this, Tool, Params, FirstHash))
	{
		const TSharedPtr<FJsonObject> Replay = StructuredContent(Tool.Run(Params));
		FString ReplayHash;
		TestTrue(TEXT("same dry run remains accepted"), ResultStringEquals(Replay, TEXT("status"), TEXT("dry_run_completed")));
		TestTrue(TEXT("same dry run keeps the accepted hash"), Replay.IsValid() && Replay->TryGetStringField(TEXT("dryRunHash"), ReplayHash) && ReplayHash == FirstHash);
		TestTrue(TEXT("same dry run remains a known zero-effect result"), ResultStringEquals(Replay, TEXT("effectState"), TEXT("known_none")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsWrongOrderRollbackTest, "UAgentAssetTools.Ownership.WrongOrderRollback", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsWrongOrderRollbackTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("wrong_order"));
	FString AcceptedHash;
	if (ExtractAcceptedDryRun(*this, CreateTool, MakeCreateFolderParams(RunId, true, false, false), AcceptedHash))
	{
		FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
		const TSharedPtr<FJsonObject> Rollback = MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), AcceptedHash);
		const TSharedPtr<FJsonObject> Result = StructuredContent(DeleteTool.Run(Rollback));
		TestTrue(TEXT("rollback before execute is blocked"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("rollback before execute has a stable reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("rollback_order_or_ownership_invalid")));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsReconnectRestartRetractionTest, "UAgentAssetTools.Lifecycle.ReconnectRestartRetractionContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsReconnectRestartRetractionTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool Tool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const TSharedPtr<FJsonObject> Params = MakeCreateFolderParams(FreshRunId(TEXT("retraction")), true, false, false);
	FString FirstHash;
	const bool bFirstAccepted = ExtractAcceptedDryRun(*this, Tool, Params, FirstHash);
	IModelContextProtocolModule& ModelContextProtocol = IModelContextProtocolModule::GetChecked();
	const int32 GenerationBefore = UAgentAssetTools::D0::GetRegistrationGeneration();
	ModelContextProtocol.RefreshTools();
	const int32 GenerationAfter = UAgentAssetTools::D0::GetRegistrationGeneration();
	if (UAgentAssetTools::D0::IsEnabled())
	{
		TestTrue(TEXT("actual unregister/re-register lifecycle advances registration generation"), GenerationAfter > GenerationBefore);
	}
	FString FreshHash;
	if (bFirstAccepted)
	{
		FString RunId;
		Params->TryGetStringField(TEXT("runId"), RunId);
		TSharedPtr<FJsonObject> StaleExecute = MakeCreateFolderParams(RunId, false, true, false);
		StaleExecute->SetStringField(TEXT("dryRunHash"), FirstHash);
		const TSharedPtr<FJsonObject> StaleResult = StructuredContent(Tool.Run(StaleExecute));
		TestTrue(TEXT("actual Refresh retracts the pre-refresh accepted plan"), ResultStringEquals(StaleResult, TEXT("reasonCode"), TEXT("accepted_dry_run_missing")));
		TestTrue(TEXT("retracted plan can only be reintroduced by a new dry run"), ExtractAcceptedDryRun(*this, Tool, Params, FreshHash));
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsLedgerInvalidationTest, "UAgentAssetTools.Ownership.GenerationRegistrationRetraction", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsLedgerInvalidationTest::RunTest(const FString& Parameters)
{
	// This creates an accepted dry-run record only.  The test invalidates it
	// before the execute request, so it cannot create a folder or mutate an
	// asset while still proving stale plan authority is not reusable.
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool Tool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FString::Printf(TEXT("ledger%llu"), static_cast<uint64>(FPlatformTime::Cycles64()));
	const TSharedPtr<FJsonObject> DryRunParams = MakeCreateFolderParams(RunId, true, false, false);
	const TSharedPtr<FJsonObject> DryRunResult = StructuredContent(Tool.Run(DryRunParams));
	FString DryRunHash;
	FString DryRunStatus;
	TestTrue(TEXT("dry run produces structured ledger evidence"), DryRunResult.IsValid());
	if (DryRunResult.IsValid())
	{
		TestTrue(TEXT("dry run was accepted without a side effect"), DryRunResult->TryGetStringField(TEXT("status"), DryRunStatus) && DryRunStatus == TEXT("dry_run_completed"));
		TestTrue(TEXT("dry run yields an accepted hash"), DryRunResult->TryGetStringField(TEXT("dryRunHash"), DryRunHash) && DryRunHash.Len() == 40);
	}

	UAgentAssetTools::InvalidateOperationLedger();
	if (!DryRunHash.IsEmpty())
	{
		const TSharedPtr<FJsonObject> ExecuteParams = MakeCreateFolderParams(RunId, false, true, false);
		ExecuteParams->SetStringField(TEXT("dryRunHash"), DryRunHash);
		const TSharedPtr<FJsonObject> ExecuteResult = StructuredContent(Tool.Run(ExecuteParams));
		bool bBlocked = false;
		FString Reason;
		FString EffectState;
		TestTrue(TEXT("invalidated plan returns structured output"), ExecuteResult.IsValid());
		if (ExecuteResult.IsValid())
		{
			TestTrue(TEXT("invalidated plan cannot execute"), ExecuteResult->TryGetBoolField(TEXT("blocked"), bBlocked) && bBlocked);
			TestTrue(TEXT("invalidated plan reports its missing ownership record"), ExecuteResult->TryGetStringField(TEXT("reasonCode"), Reason) && Reason == TEXT("accepted_dry_run_missing"));
			TestTrue(TEXT("invalidated plan has a known zero-effect outcome"), ExecuteResult->TryGetStringField(TEXT("effectState"), EffectState) && EffectState == TEXT("known_none"));
		}
	}
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsRollbackDeleteBindingValidationTest, "UAgentAssetTools.Cleanup.ExactEmptyRootContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsRollbackDeleteBindingValidationTest::RunTest(const FString& Parameters)
{
	// ue.asset.delete is the single native dispatcher for the two delete-shaped
	// inverses.  The ledger subsequently proves ownership and checks the exact
	// stored inverse paths; this contract test only verifies that the root-shaped
	// cleanup invocation can reach that native binding without relaxing forwards.
	TSharedPtr<FJsonObject> CleanupRollback = MakeShared<FJsonObject>();
	CleanupRollback->SetStringField(TEXT("changeSetId"), TEXT("cs-rollback"));
	CleanupRollback->SetStringField(TEXT("runId"), TEXT("run_rollback"));
	CleanupRollback->SetStringField(TEXT("operationId"), TEXT("op-create"));
	CleanupRollback->SetBoolField(TEXT("dryRun"), false);
	CleanupRollback->SetBoolField(TEXT("execute"), false);
	CleanupRollback->SetBoolField(TEXT("rollback"), true);
	CleanupRollback->SetStringField(TEXT("dryRunHash"), TEXT("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
	CleanupRollback->SetStringField(TEXT("assetPath"), TEXT("/Game/UAgentSandbox/run_rollback"));
	SetNativeCallFacts(CleanupRollback, true);
	TestTrue(TEXT("exact run root accepted for cleanup rollback dispatcher"), UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::Delete, CleanupRollback).bValid);

	CleanupRollback->SetBoolField(TEXT("rollback"), false);
	CleanupRollback->SetBoolField(TEXT("execute"), true);
	TestFalse(TEXT("forward delete remains forbidden even at an exact run root"), UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::Delete, CleanupRollback).bValid);

	CleanupRollback->SetBoolField(TEXT("execute"), false);
	CleanupRollback->SetBoolField(TEXT("rollback"), true);
	CleanupRollback->SetStringField(TEXT("assetPath"), TEXT("/Game/UAgentSandbox"));
	TestFalse(TEXT("global sandbox root is never a cleanup target"), UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::Delete, CleanupRollback).bValid);

	CleanupRollback->SetStringField(TEXT("assetPath"), TEXT("/Game/UAgentSandbox/run_rollback"));
	CleanupRollback->SetStringField(TEXT("dryRunHash"), TEXT("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
	TestFalse(TEXT("accepted forward hash must be canonical lower-case SHA-1"), UAgentAssetTools::ValidateArguments(UAgentAssetTools::EOperation::Delete, CleanupRollback).bValid);

	TArray<uint8> ZeroFileId;
	ZeroFileId.SetNumZeroed(16);
	TestFalse(
		TEXT("an all-zero FILE_ID_128 is never admitted as physical ownership"),
		UAgentAssetTools::IsUsablePhysicalFileIdForAutomation(ZeroFileId));

	TArray<uint8> UsableFileId = ZeroFileId;
	UsableFileId[15] = 1;
	TestTrue(
		TEXT("a correctly sized nonzero FILE_ID_128 remains usable"),
		UAgentAssetTools::IsUsablePhysicalFileIdForAutomation(UsableFileId));

	TArray<uint8> WrongSizedFileId;
	WrongSizedFileId.SetNumZeroed(8);
	WrongSizedFileId[0] = 1;
	TestFalse(
		TEXT("a non-128-bit identifier is rejected"),
		UAgentAssetTools::IsUsablePhysicalFileIdForAutomation(WrongSizedFileId));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsCleanupNonEmptyContractTest, "UAgentAssetTools.Cleanup.PhysicalNonEmptyRootNoRecursiveContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsCleanupNonEmptyContractTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("cleanup_nonempty"));
	FString AcceptedHash;
	TSharedPtr<FJsonObject> ExecuteResult;
	const FString Directory = RunRootDirectory(RunId);
	const FString ForeignFile = FPaths::Combine(Directory, TEXT("foreign.txt"));
	if (ExecuteCreatedRunRoot(*this, CreateTool, RunId, AcceptedHash, ExecuteResult)
		&& ResultStringEquals(ExecuteResult, TEXT("status"), TEXT("executed")))
	{
		TestTrue(TEXT("real foreign child was created"), FFileHelper::SaveStringToFile(TEXT("foreign"), *ForeignFile));
		FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
		const TSharedPtr<FJsonObject> RollbackResult = StructuredContent(
			DeleteTool.Run(MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), AcceptedHash)));
		TestTrue(TEXT("production cleanup rejects a physically nonempty owned root"), ResultStringEquals(RollbackResult, TEXT("reasonCode"), TEXT("non_empty_run_root")));
		TestTrue(TEXT("nonrecursive cleanup leaves the foreign child present"), FPaths::FileExists(ForeignFile));
	}
	IFileManager::Get().Delete(*ForeignFile, false, true, true);
	IFileManager::Get().DeleteDirectory(*Directory, false, false);
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsCleanupLinkReparseContractTest, "UAgentAssetTools.Cleanup.LinkReparsePathContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsCleanupLinkReparseContractTest::RunTest(const FString& Parameters)
{
#if PLATFORM_WINDOWS
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("cleanup_reparse"));
	FString AcceptedHash;
	TSharedPtr<FJsonObject> ExecuteResult;
	const FString Directory = RunRootDirectory(RunId);
	const FString ForeignDirectory = FPaths::Combine(
		FPaths::ProjectSavedDir(),
		TEXT("UAgentAssetToolsAutomationCandidates"),
		FreshRunId(TEXT("reparse_target")));
	if (ExecuteCreatedRunRoot(*this, CreateTool, RunId, AcceptedHash, ExecuteResult)
		&& ResultStringEquals(ExecuteResult, TEXT("status"), TEXT("executed")))
	{
		TestTrue(TEXT("owned run root was removed before link replacement"), IFileManager::Get().DeleteDirectory(*Directory, false, false));
		TestTrue(TEXT("foreign link target was created"), IFileManager::Get().MakeDirectory(*ForeignDirectory, true));
		const DWORD Flags = SYMBOLIC_LINK_FLAG_DIRECTORY | 0x2;
		bool bLinkCreated = ::CreateSymbolicLinkW(*Directory, *ForeignDirectory, Flags) != 0;
		if (!bLinkCreated && ::GetLastError() == ERROR_INVALID_PARAMETER)
		{
			bLinkCreated = ::CreateSymbolicLinkW(*Directory, *ForeignDirectory, SYMBOLIC_LINK_FLAG_DIRECTORY) != 0;
		}
		if (!bLinkCreated)
		{
			bLinkCreated = CreateDirectoryJunction(Directory, ForeignDirectory);
		}
		TestTrue(TEXT("real directory link or reparse point was created"), bLinkCreated);
		if (bLinkCreated)
		{
			FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
			const TSharedPtr<FJsonObject> RollbackResult = StructuredContent(
				DeleteTool.Run(MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), AcceptedHash)));
			TestTrue(TEXT("production cleanup rejects the link/reparse replacement"), ResultStringEquals(RollbackResult, TEXT("reasonCode"), TEXT("run_root_link_or_reparse_blocked")));
			TestTrue(TEXT("foreign link target remains present"), IFileManager::Get().DirectoryExists(*ForeignDirectory));
		}
	}
	IFileManager::Get().DeleteDirectory(*Directory, false, false);
	IFileManager::Get().DeleteDirectory(*ForeignDirectory, false, false);
	UAgentAssetTools::InvalidateOperationLedger();
#else
	AddInfo(TEXT("Windows reparse creation is conditionally excluded; production cleanup fails closed because physical identity is unsupported."));
#endif
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsCleanupReplacementOwnershipTest, "UAgentAssetTools.Cleanup.ReplacementOwnershipContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsCleanupReplacementOwnershipTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("cleanup_replacement"));
	FString AcceptedHash;
	TSharedPtr<FJsonObject> ExecuteResult;
	const FString Directory = RunRootDirectory(RunId);
	if (ExecuteCreatedRunRoot(*this, CreateTool, RunId, AcceptedHash, ExecuteResult)
		&& ResultStringEquals(ExecuteResult, TEXT("status"), TEXT("executed")))
	{
		const TSharedPtr<FJsonObject> Ledger = UAgentAssetTools::GetOperationLedgerSnapshot(
			TEXT("cs-ue-automation"),
			RunId,
			TEXT("op-create-folder"));
		TestTrue(TEXT("actual ledger captured a handle-derived physical identity"), ResultBoolEquals(Ledger, TEXT("runRootPhysicalIdentityCaptured"), true));
		TestTrue(TEXT("original owned root was removed"), IFileManager::Get().DeleteDirectory(*Directory, false, false));
		TestTrue(TEXT("empty same-path replacement was created"), IFileManager::Get().MakeDirectory(*Directory, false));
		FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
		const TSharedPtr<FJsonObject> Rollback = MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), AcceptedHash);
		const TSharedPtr<FJsonObject> Result = StructuredContent(DeleteTool.Run(Rollback));
		TestTrue(TEXT("same-path replacement is blocked before cleanup"), ResultBoolEquals(Result, TEXT("blocked"), true));
		TestTrue(TEXT("handle-derived identity drift has an exact reason"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("run_root_physical_identity_mismatch")));
		TestTrue(TEXT("replacement leaf remains after refused cleanup"), IFileManager::Get().DirectoryExists(*Directory));
	}
	IFileManager::Get().DeleteDirectory(*Directory, false, false);
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsCleanupObservationFailureContractTest, "UAgentAssetTools.Cleanup.ObservationFailureContract", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsCleanupObservationFailureContractTest::RunTest(const FString& Parameters)
{
	UAgentAssetTools::InvalidateOperationLedger();
	FUAgentAssetTool CreateTool(UAgentAssetTools::EOperation::CreateFolder, MakeTestIdentity());
	const FString RunId = FreshRunId(TEXT("cleanup_enumeration_failure"));
	FString AcceptedHash;
	TSharedPtr<FJsonObject> ExecuteResult;
	if (ExecuteCreatedRunRoot(*this, CreateTool, RunId, AcceptedHash, ExecuteResult)
		&& ResultStringEquals(ExecuteResult, TEXT("status"), TEXT("executed")))
	{
		UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::RunRootEnumerationFailure);
		FUAgentAssetTool DeleteTool(UAgentAssetTools::EOperation::Delete, MakeTestIdentity());
		const TSharedPtr<FJsonObject> Result = StructuredContent(
			DeleteTool.Run(MakeDeleteRollbackParams(RunId, TEXT("op-create-folder"), AcceptedHash)));
		TestTrue(TEXT("production cleanup fails closed on enumeration failure"), ResultStringEquals(Result, TEXT("reasonCode"), TEXT("run_root_directory_enumeration_failed")));
		TestTrue(TEXT("enumeration failure never deletes the exact leaf"), IFileManager::Get().DirectoryExists(*RunRootDirectory(RunId)));
	}
	UAgentAssetTools::SetAutomationFault(UAgentAssetTools::EAutomationFault::None);
	IFileManager::Get().DeleteDirectory(*RunRootDirectory(RunId), false, false);
	UAgentAssetTools::InvalidateOperationLedger();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsTaskOnlyRegistrationProbeTest, "UAgentAssetTools.Lifecycle.TaskOnlyRegistrationProbe", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsTaskOnlyRegistrationProbeTest::RunTest(const FString& Parameters)
{
	// This is supporting source-side UE Automation only.  It is deliberately
	// not product-adapter evidence and it has no mutation-capable descriptor.  Without
	// its explicit task-only gate, production startup must contain neither probe.
	IModelContextProtocolModule& ModelContextProtocol = IModelContextProtocolModule::GetChecked();
	if (!UAgentAssetTools::D0::IsEnabled())
	{
		int32 DirectProbeCount = 0;
		for (const TSharedRef<IModelContextProtocolTool>& Tool : ModelContextProtocol.GetTools())
		{
			if (Tool->GetName() == TEXT("uagent.d0.probe")) ++DirectProbeCount;
		}
		TestEqual(TEXT("production startup has no task-only direct probe"), DirectProbeCount, 0);
		TestFalse(TEXT("production startup has no task-only Toolset Registry class"), UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass()));
		return true;
	}

	const FString Route = UAgentAssetTools::D0::GetRouteName();
	const bool bToolSearch = UAgentAssetTools::D0::IsToolSearchEnabled();
	TestEqual(TEXT("D0 route is explicit"), Route, UAgentAssetTools::D0::UsesToolsetRegistry() ? FString(TEXT("toolset_registry")) : FString(TEXT("direct")));
	TestEqual(TEXT("D0 observes the actual MCP tool-search setting"), GetDefault<UModelContextProtocolSettings>()->bEnableToolSearch, bToolSearch);

	// The production post-engine refresh must have completed before this
	// PostEngineInit test module runs.  Assert that publication directly.
	int32 DirectProbeCount = 0;
	bool bDirectNoOpCompleted = false;
	for (const TSharedRef<IModelContextProtocolTool>& Tool : ModelContextProtocol.GetTools())
	{
		if (Tool->GetName() != TEXT("uagent.d0.probe")) continue;
		++DirectProbeCount;
		FModelContextProtocolToolResult Result = Tool->Run(MakeShared<FJsonObject>());
		bDirectNoOpCompleted = IsD0DirectNoOpResult(
			Result,
			bToolSearch,
			UAgentAssetTools::D0::GetRegistrationGeneration());
	}

	bool bToolsetRegistered = false;
	bool bToolsetNoOpCompleted = false;
	if (UAgentAssetTools::D0::UsesToolsetRegistry())
	{
		bToolsetRegistered = UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass());
		TestTrue(TEXT("D0 Toolset Registry class is registered"), bToolsetRegistered);
		const FString Schema = UToolsetRegistry::GetToolsetJsonSchema(UUAgentAssetToolsD0Toolset::StaticClass());
		TSharedPtr<FJsonObject> SchemaObject;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Schema);
		TestTrue(TEXT("D0 Toolset schema parses"), FJsonSerializer::Deserialize(Reader, SchemaObject) && SchemaObject.IsValid());
		FString ToolsetName;
		if (SchemaObject.IsValid() && SchemaObject->TryGetStringField(TEXT("name"), ToolsetName))
		{
			bToolsetNoOpCompleted = WaitForD0ToolsetNoOp(
				UToolsetRegistry::ExecuteTool(ToolsetName, TEXT("Probe"), TEXT("{}")),
				bToolSearch,
				UAgentAssetTools::D0::GetRegistrationGeneration());
		}
		TestTrue(TEXT("D0 Toolset Registry no-op completed"), bToolsetNoOpCompleted);
		TestEqual(TEXT("D0 Toolset route never registers the direct probe"), DirectProbeCount, 0);
	}
	else
	{
		TestEqual(TEXT("D0 Direct route registers one direct no-op"), DirectProbeCount, 1);
		TestTrue(TEXT("D0 Direct no-op completed"), bDirectNoOpCompleted);
		TestFalse(TEXT("D0 Direct route does not register a Toolset class"), UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass()));
	}

	const int32 GenerationBeforeRefresh = UAgentAssetTools::D0::GetRegistrationGeneration();
	ModelContextProtocol.RefreshTools();
	const int32 GenerationAfterRefresh = UAgentAssetTools::D0::GetRegistrationGeneration();
	TestTrue(TEXT("D0 Refresh retracts and republishes a new generation"), GenerationAfterRefresh > GenerationBeforeRefresh);
	if (UAgentAssetTools::D0::UsesToolsetRegistry())
	{
		TestTrue(TEXT("D0 Toolset class remains registered after Refresh"), UToolsetRegistry::IsToolsetClassRegistered(UUAgentAssetToolsD0Toolset::StaticClass()));
	}
	else
	{
		int32 DirectProbeCountAfterRefresh = 0;
		for (const TSharedRef<IModelContextProtocolTool>& Tool : ModelContextProtocol.GetTools())
		{
			if (Tool->GetName() == TEXT("uagent.d0.probe")) ++DirectProbeCountAfterRefresh;
		}
		TestEqual(TEXT("D0 Direct probe remains unique after Refresh"), DirectProbeCountAfterRefresh, 1);
	}

	UE_LOG(
		LogTemp,
		Display,
		TEXT("UAGENT_MVP15D_SUPPORTING_UE_AUTOMATION={\"route\":\"%s\",\"toolSearch\":%s,\"generation\":%d,\"directProbeCount\":%d,\"toolsetRegistered\":%s,\"noOpCompleted\":%s,\"mutationCount\":0}"),
		*Route,
		bToolSearch ? TEXT("true") : TEXT("false"),
		UAgentAssetTools::D0::GetRegistrationGeneration(),
		DirectProbeCount,
		bToolsetRegistered ? TEXT("true") : TEXT("false"),
		(bDirectNoOpCompleted || bToolsetNoOpCompleted) ? TEXT("true") : TEXT("false"));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsDirectToolSearchOnTest, "UAgentMvp15D0Matrix.DirectToolSearchOn", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsDirectToolSearchOnTest::RunTest(const FString& Parameters)
{
	return VerifyTaskOnlyRegistrationCombination(*this, false, true);
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsDirectToolSearchOffTest, "UAgentMvp15D0Matrix.DirectToolSearchOff", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsDirectToolSearchOffTest::RunTest(const FString& Parameters)
{
	return VerifyTaskOnlyRegistrationCombination(*this, false, false);
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsToolsetToolSearchOnTest, "UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOn", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsToolsetToolSearchOnTest::RunTest(const FString& Parameters)
{
	return VerifyTaskOnlyRegistrationCombination(*this, true, true);
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUAgentAssetToolsToolsetToolSearchOffTest, "UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOff", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FUAgentAssetToolsToolsetToolSearchOffTest::RunTest(const FString& Parameters)
{
	return VerifyTaskOnlyRegistrationCombination(*this, true, false);
}
