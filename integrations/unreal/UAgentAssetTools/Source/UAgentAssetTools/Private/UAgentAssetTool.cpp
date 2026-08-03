#include "UAgentAssetTool.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetToolsModule.h"
#include "Dom/JsonValue.h"
#include "Editor.h"
#include "EditorAssetLibrary.h"
#include "FileHelpers.h"
#include "HAL/FileManager.h"
#include "IAssetTools.h"
#include "Misc/DateTime.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Misc/ScopeLock.h"
#include "Misc/SecureHash.h"
#include "UObject/Package.h"
#include "UObject/SoftObjectPath.h"

#if PLATFORM_WINDOWS
#include "Windows/WindowsHWrapper.h"
#include "Windows/AllowWindowsPlatformTypes.h"
#include <winternl.h>
#include "Windows/HideWindowsPlatformTypes.h"
#endif

namespace
{
	FCriticalSection GOperationMutex;

	struct FPhysicalDirectoryIdentity
	{
		uint64 VolumeSerialNumber = 0;
		uint8 FileId[16] = {};
		bool bValid = false;

		bool operator==(const FPhysicalDirectoryIdentity& Other) const
		{
			return bValid
				&& Other.bValid
				&& VolumeSerialNumber == Other.VolumeSerialNumber
				&& FMemory::Memcmp(FileId, Other.FileId, UE_ARRAY_COUNT(FileId)) == 0;
		}
	};

	/**
	 * The companion deliberately keeps its own per-run operation ledger instead of
	 * treating a path as ownership.  A path can legitimately be renamed several
	 * times during one accepted plan, so the run, exact tool input hash and current
	 * operation state are all part of the authorization key.
	 */
	enum class ELedgerState : uint8
	{
		DryRunAccepted,
		Executed,
		PartialFailure,
		RollbackCleanupPending,
		RolledBack,
	};

	enum class EEffectDirectoryCleanupFailure : uint8
	{
		None,
		Retryable,
		Unknown,
		Terminal,
	};

	struct FOperationLedgerEntry
	{
		FString Scope;
		FString Key;
		FString ChangeSetId;
		FString RunId;
		FString OperationId;
		FString DryRunHash;
		FString AcceptedPlanBinding;
		FString LedgerCreatedAt;
		int64 NativeCreatedAt = 0;
		int64 ConnectionGeneration = 0;
		int64 SessionGeneration = 0;
		int32 NativeOperationIndex = INDEX_NONE;
		int32 NativeOperationCount = 0;
		FString NativeRegistrationId;
		FString LastNativePhase;
		FString NativeSourceIdentity;
		FString NativeManifestIdentity;
		FString NativePluginIdentity;
		FString NativePackageIdentity;
		FString IdentityFingerprint;
		FString PluginId;
		FString PluginVersion;
		FString ContractVersion;
		FString SourceCommit;
		FString SourceTreeSha256;
		FString BuildManifestSha256;
		FString LoadedModuleName;
		FString LoadedModuleSha256;
		FString ForwardToolName;
		FString EvidenceId;
		UAgentAssetTools::EOperation Operation = UAgentAssetTools::EOperation::CreateFolder;
		FString BeforePath;
		FString AfterPath;
		FString EffectPackageName;
		FString EffectObjectName;
		FString EffectClassPath;
		FString EffectPackageGuid;
		FPhysicalDirectoryIdentity RunRootPhysicalIdentity;
		TArray<FString> EffectCreatedDirectoryPaths;
		TArray<FPhysicalDirectoryIdentity> EffectCreatedDirectoryIdentities;
		bool bSideEffectObserved = false;
		bool bRollbackAvailable = false;
		ELedgerState State = ELedgerState::DryRunAccepted;
	};

	TMap<FString, FOperationLedgerEntry> GOperationLedger;
	TMap<FString, TArray<FString>> GRunLedgerOrder;

	struct FRunAuthorityLedger
	{
		bool bBound = false;
		FString AcceptedPlanBinding;
		FString NativeRegistrationId;
		int64 NativeCreatedAt = 0;
		int64 ConnectionGeneration = 0;
		int64 SessionGeneration = 0;
		int32 NativeOperationCount = 0;
		FString NativeSourceIdentity;
		FString NativeManifestIdentity;
		FString NativePluginIdentity;
		FString NativePackageIdentity;
	};

	TMap<FString, FRunAuthorityLedger> GRunAuthorityLedger;

#if WITH_DEV_AUTOMATION_TESTS
	UAgentAssetTools::EAutomationFault GAutomationFault = UAgentAssetTools::EAutomationFault::None;
#endif

	/**
	 * `sideEffectObserved=false` is not enough to prove that an attempted editor
	 * operation had zero effect.  Keep that distinction in the native descriptor
	 * so callers can stop and recover rather than silently treating an
	 * observation failure as a no-op.
	 */
	enum class EEffectState : uint8
	{
		Infer,
		KnownNone,
		KnownEffect,
		KnownPartial,
		Unknown,
	};

	FString EffectStateName(EEffectState State, bool bBlocked, const FString& Status, bool bSideEffectObserved)
	{
		switch (State)
		{
		case EEffectState::KnownNone: return TEXT("known_none");
		case EEffectState::KnownEffect: return TEXT("known_effect");
		case EEffectState::KnownPartial: return TEXT("known_partial");
		case EEffectState::Unknown: return TEXT("unknown");
		case EEffectState::Infer:
		default:
			if (bSideEffectObserved) return Status == TEXT("partial_failure") ? TEXT("known_partial") : TEXT("known_effect");
			// A partial result with no observed effect is intentionally not a
			// known no-op: the observation itself failed.
			if (!bBlocked && Status == TEXT("partial_failure")) return TEXT("unknown");
			return TEXT("known_none");
		}
	}

	FString PathFromParams(const TSharedPtr<FJsonObject>& Params, const TCHAR* Field)
	{
		FString Value;
		return Params.IsValid() && Params->TryGetStringField(Field, Value) ? Value : FString();
	}

	bool BoolFromParams(const TSharedPtr<FJsonObject>& Params, const TCHAR* Field, bool DefaultValue = false)
	{
		bool Value = DefaultValue;
		return Params.IsValid() && Params->TryGetBoolField(Field, Value) ? Value : DefaultValue;
	}

	int64 IntegerFromParams(const TSharedPtr<FJsonObject>& Params, const TCHAR* Field, int64 DefaultValue = 0)
	{
		double Value = static_cast<double>(DefaultValue);
		return Params.IsValid() && Params->TryGetNumberField(Field, Value)
			? static_cast<int64>(Value)
			: DefaultValue;
	}

	FString LedgerScope(const TSharedPtr<FJsonObject>& Params)
	{
		return PathFromParams(Params, TEXT("changeSetId")) + TEXT("|") + PathFromParams(Params, TEXT("runId"));
	}

	FString LedgerKey(const TSharedPtr<FJsonObject>& Params)
	{
		// The operation id names the accepted *forward* plan.  Do not include the
		// dispatch tool or inverse arguments here: cleanup and duplicate rollback
		// deliberately dispatch through ue.asset.delete while retaining the forward
		// operation's canonical hash as their authorization token.
		return LedgerScope(Params) + TEXT("|") + PathFromParams(Params, TEXT("operationId"));
	}

	FString IdentityFingerprint(const TSharedPtr<FJsonObject>& Identity)
	{
		if (!Identity.IsValid()) return FString();
		FString PluginId;
		FString PluginVersion;
		FString ContractVersion;
		FString SourceCommit;
		FString SourceTreeSha256;
		FString ManifestSha256;
		FString BuildCommandFingerprint;
		FString LoadedModuleName;
		FString LoadedModuleSha256;
		FString EngineVersion;
		FString ModuleBuildId;
		double EngineChangelist = -1.0;
		double CompatibleChangelist = -1.0;
		if (!Identity->TryGetStringField(TEXT("pluginId"), PluginId)
			|| !Identity->TryGetStringField(TEXT("pluginVersion"), PluginVersion)
			|| !Identity->TryGetStringField(TEXT("contractVersion"), ContractVersion)
			|| !Identity->TryGetStringField(TEXT("sourceCommit"), SourceCommit)
			|| !Identity->TryGetStringField(TEXT("sourceTreeSha256"), SourceTreeSha256)
			|| !Identity->TryGetStringField(TEXT("buildManifestSha256"), ManifestSha256)
			|| !Identity->TryGetStringField(TEXT("buildCommandFingerprint"), BuildCommandFingerprint)
			|| !Identity->TryGetStringField(TEXT("loadedModuleName"), LoadedModuleName)
			|| !Identity->TryGetStringField(TEXT("loadedModuleSha256"), LoadedModuleSha256)
			|| !Identity->TryGetStringField(TEXT("engineVersion"), EngineVersion)
			|| !Identity->TryGetNumberField(TEXT("engineChangelist"), EngineChangelist)
			|| !Identity->TryGetNumberField(TEXT("compatibleChangelist"), CompatibleChangelist)
			|| !Identity->TryGetStringField(TEXT("moduleBuildId"), ModuleBuildId))
		{
			return FString();
		}
		return PluginId + TEXT("|") + PluginVersion + TEXT("|") + ContractVersion + TEXT("|")
			+ SourceCommit + TEXT("|") + SourceTreeSha256 + TEXT("|") + ManifestSha256 + TEXT("|")
			+ BuildCommandFingerprint + TEXT("|") + LoadedModuleName + TEXT("|") + LoadedModuleSha256 + TEXT("|")
			+ EngineVersion + TEXT("|") + FString::Printf(TEXT("%.0f|%.0f|"), EngineChangelist, CompatibleChangelist) + ModuleBuildId;
	}

	void ResolveOperationPaths(UAgentAssetTools::EOperation Operation, const TSharedPtr<FJsonObject>& Params, FString& OutBeforePath, FString& OutAfterPath)
	{
		OutBeforePath.Reset();
		OutAfterPath.Reset();
		switch (Operation)
		{
		case UAgentAssetTools::EOperation::CreateFolder:
			OutAfterPath = PathFromParams(Params, TEXT("folderPath"));
			break;
		case UAgentAssetTools::EOperation::Duplicate:
			OutBeforePath = PathFromParams(Params, TEXT("sourceAssetPath"));
			OutAfterPath = PathFromParams(Params, TEXT("targetAssetPath"));
			break;
		case UAgentAssetTools::EOperation::Rename:
		case UAgentAssetTools::EOperation::Move:
			OutBeforePath = PathFromParams(Params, TEXT("assetPath"));
			OutAfterPath = PathFromParams(Params, TEXT("targetAssetPath"));
			break;
		case UAgentAssetTools::EOperation::Save:
		case UAgentAssetTools::EOperation::Delete:
			OutBeforePath = PathFromParams(Params, TEXT("assetPath"));
			OutAfterPath = OutBeforePath;
			break;
		}
	}

	TSharedPtr<FJsonValue> JsonString(const FString& Value)
	{
		return MakeShared<FJsonValueString>(Value);
	}

	TArray<TSharedPtr<FJsonValue>> JsonStrings(const TArray<FString>& Values)
	{
		TArray<TSharedPtr<FJsonValue>> Result;
		for (const FString& Value : Values) Result.Add(JsonString(Value));
		return Result;
	}

	TSharedPtr<FJsonObject> MakeObject(const TArray<FString>& ReadPaths, const TArray<FString>& ModifyPaths)
	{
		TSharedPtr<FJsonObject> Affected = MakeShared<FJsonObject>();
		Affected->SetArrayField(TEXT("readOnlySources"), JsonStrings(ReadPaths));
		Affected->SetArrayField(TEXT("sandboxTargets"), JsonStrings(ModifyPaths));
		TArray<TSharedPtr<FJsonValue>> ExternalTargets;
		Affected->SetArrayField(TEXT("externalTargets"), ExternalTargets);
		return Affected;
	}

	void AddUniquePath(TArray<FString>& Paths, const FString& Path)
	{
		if (!Path.IsEmpty() && !Paths.Contains(Path)) Paths.Add(Path);
	}

	void ResolveForwardResultPaths(
		const FString& Operation,
		const TSharedPtr<FJsonObject>& Params,
		TArray<FString>& OutReadPaths,
		TArray<FString>& OutModifyPaths)
	{
		if (Operation == TEXT("duplicate")) AddUniquePath(OutReadPaths, PathFromParams(Params, TEXT("sourceAssetPath")));
		if (Operation == TEXT("create_folder")) AddUniquePath(OutModifyPaths, PathFromParams(Params, TEXT("folderPath")));
		else if (Operation == TEXT("duplicate")) AddUniquePath(OutModifyPaths, PathFromParams(Params, TEXT("targetAssetPath")));
		else if (Operation == TEXT("rename") || Operation == TEXT("move"))
		{
			AddUniquePath(OutModifyPaths, PathFromParams(Params, TEXT("assetPath")));
			AddUniquePath(OutModifyPaths, PathFromParams(Params, TEXT("targetAssetPath")));
		}
		else if (Operation == TEXT("save")) AddUniquePath(OutModifyPaths, PathFromParams(Params, TEXT("assetPath")));
	}

	void ResolveRollbackResultPaths(
		const FOperationLedgerEntry& Entry,
		TArray<FString>& OutReadPaths,
		TArray<FString>& OutModifyPaths)
	{
		// A rollback observes and changes the exact effect recorded for the accepted
		// forward plan.  Its dispatch tool can differ from Entry.Operation, so never
		// infer these paths from the inverse request alone.
		if (Entry.Operation == UAgentAssetTools::EOperation::Duplicate)
		{
			AddUniquePath(OutReadPaths, Entry.AfterPath);
			AddUniquePath(OutModifyPaths, Entry.AfterPath);
		}
		else if (Entry.Operation == UAgentAssetTools::EOperation::CreateFolder)
		{
			AddUniquePath(OutReadPaths, Entry.AfterPath);
			AddUniquePath(OutModifyPaths, Entry.AfterPath);
		}
		else if (Entry.Operation == UAgentAssetTools::EOperation::Rename || Entry.Operation == UAgentAssetTools::EOperation::Move)
		{
			AddUniquePath(OutReadPaths, Entry.AfterPath);
			AddUniquePath(OutModifyPaths, Entry.AfterPath);
			AddUniquePath(OutModifyPaths, Entry.BeforePath);
		}
	}

	FModelContextProtocolToolResult MakeStructuredResult(
		const FString& ToolName,
		const FString& Operation,
		const TSharedPtr<FJsonObject>& Params,
		const UAgentAssetTools::FValidationResult& Validation,
		bool bBlocked,
		const FString& Status,
		const FString& ReasonCode,
		bool bSideEffectObserved,
		bool bRollbackAvailable,
		const FString& EvidenceId,
		const FString& DryRunHash,
		const FOperationLedgerEntry* LedgerEntry = nullptr,
		bool bWouldChange = true,
		EEffectState EffectState = EEffectState::Infer)
	{
		const bool bRollback = BoolFromParams(Params, TEXT("rollback"));
		const FString RunId = PathFromParams(Params, TEXT("runId"));
		const FString ChangeSetId = PathFromParams(Params, TEXT("changeSetId"));
		const FString OperationId = PathFromParams(Params, TEXT("operationId"));
		const FString RunRoot = Validation.RunRoot.IsEmpty() ? FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *RunId) : Validation.RunRoot;
		TArray<FString> ReadPaths;
		TArray<FString> ModifyPaths;
		if (!bBlocked && bWouldChange)
		{
			if (bRollback && LedgerEntry)
			{
				ResolveRollbackResultPaths(*LedgerEntry, ReadPaths, ModifyPaths);
			}
			else if (!bRollback)
			{
				ResolveForwardResultPaths(Operation, Params, ReadPaths, ModifyPaths);
			}
		}
		TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
		Result->SetBoolField(TEXT("blocked"), bBlocked);
		Result->SetStringField(TEXT("status"), Status);
		Result->SetStringField(TEXT("reasonCode"), ReasonCode);
		Result->SetStringField(TEXT("toolName"), ToolName);
		Result->SetStringField(TEXT("operation"), Operation);
		const bool bDryRun = BoolFromParams(Params, TEXT("dryRun"));
		Result->SetStringField(TEXT("phase"), bRollback ? TEXT("rollback") : bDryRun ? TEXT("dry_run") : TEXT("execute"));
		Result->SetStringField(TEXT("changeSetId"), ChangeSetId);
		Result->SetStringField(TEXT("runId"), RunId);
		Result->SetStringField(TEXT("operationId"), OperationId);
		Result->SetStringField(TEXT("sandboxRoot"), RunRoot);
		Result->SetBoolField(TEXT("wouldChange"), !bBlocked && bWouldChange);
		Result->SetArrayField(TEXT("wouldRead"), JsonStrings(ReadPaths));
		Result->SetArrayField(TEXT("wouldModify"), JsonStrings(ModifyPaths));
		Result->SetObjectField(TEXT("affectedAssets"), MakeObject(ReadPaths, ModifyPaths));
		TSharedPtr<FJsonObject> RollbackPlan = MakeShared<FJsonObject>();
		RollbackPlan->SetStringField(TEXT("strategy"), TEXT("ledger_inverse"));
		RollbackPlan->SetStringField(TEXT("inverseOperation"), bRollback && LedgerEntry
			? UAgentAssetTools::GetRollbackAction(LedgerEntry->Operation)
			: (Operation == TEXT("create_folder") ? TEXT("cleanup_empty_folder") : Operation == TEXT("duplicate") ? TEXT("delete_duplicate") : Operation == TEXT("rename") ? TEXT("rename_back") : Operation == TEXT("move") ? TEXT("move_back") : TEXT("none")));
		RollbackPlan->SetBoolField(TEXT("executionEnabled"), !bBlocked && !bDryRun && bRollbackAvailable && !bRollback);
		Result->SetObjectField(TEXT("rollbackPlan"), RollbackPlan);
		TSharedPtr<FJsonObject> Query = MakeShared<FJsonObject>();
		Query->SetStringField(TEXT("queryKind"), TEXT("asset_registry_snapshot"));
		Query->SetBoolField(TEXT("readOnly"), true);
		TArray<FString> EvidencePaths = ReadPaths;
		for (const FString& ModifyPath : ModifyPaths) AddUniquePath(EvidencePaths, ModifyPath);
		Query->SetArrayField(TEXT("paths"), JsonStrings(EvidencePaths));
		TArray<TSharedPtr<FJsonValue>> EvidenceQueries;
		EvidenceQueries.Add(MakeShared<FJsonValueObject>(Query));
		Result->SetArrayField(TEXT("externalEvidenceQueries"), EvidenceQueries);
		Result->SetStringField(TEXT("dryRunHash"), DryRunHash);
		Result->SetStringField(TEXT("hashAlgorithm"), TEXT("sha1"));
		Result->SetStringField(TEXT("schemaVersion"), UAgentAssetTools::DryRunSchemaVersion);
		Result->SetBoolField(TEXT("approvalRequired"), true);
		Result->SetBoolField(TEXT("sideEffectObserved"), bSideEffectObserved);
		Result->SetStringField(TEXT("effectState"), EffectStateName(EffectState, bBlocked, Status, bSideEffectObserved));
		Result->SetBoolField(TEXT("rollbackAvailable"), bRollbackAvailable);
		Result->SetStringField(TEXT("rollbackStatus"), bBlocked ? TEXT("not_available") : bRollback ? TEXT("completed") : bRollbackAvailable ? TEXT("available") : TEXT("none"));
		Result->SetStringField(TEXT("implementationStatus"), TEXT("execution_capable"));
		Result->SetStringField(TEXT("evidenceId"), EvidenceId);
		TSharedPtr<FJsonValue> StructuredContent = MakeShared<FJsonValueObject>(Result);
		return UE::ModelContextProtocol::MakeStructuredContentResult(StructuredContent);
	}

	UObject* FindAsset(const FString& AssetPath)
	{
		FAssetRegistryModule& RegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
		const FString ObjectPath = AssetPath.Contains(TEXT("."))
			? AssetPath
			: AssetPath + TEXT(".") + FPackageName::GetLongPackageAssetName(AssetPath);
		const FAssetData Data = RegistryModule.Get().GetAssetByObjectPath(FSoftObjectPath(ObjectPath));
		return Data.IsValid() ? Data.GetAsset() : nullptr;
	}

	bool IsPlannedOutput(const FString& Scope, const FString& AssetPath)
	{
		const TArray<FString>* OrderedKeys = GRunLedgerOrder.Find(Scope);
		if (!OrderedKeys) return false;
		for (const FString& Key : *OrderedKeys)
		{
			const FOperationLedgerEntry* Entry = GOperationLedger.Find(Key);
			if (Entry && Entry->State != ELedgerState::RolledBack && Entry->AfterPath == AssetPath) return true;
		}
		return false;
	}

	bool IsKnownOrPlannedAsset(const FString& Scope, const FString& AssetPath)
	{
		return FindAsset(AssetPath) != nullptr || IsPlannedOutput(Scope, AssetPath);
	}

	bool IsTargetAbsent(const FString& Scope, const FString& AssetPath)
	{
		return FindAsset(AssetPath) == nullptr && !IsPlannedOutput(Scope, AssetPath);
	}

	bool IsRunRootDirectoryPresent(const FString& RunRoot)
	{
		FString Directory;
		return FPackageName::TryConvertLongPackageNameToFilename(RunRoot, Directory, TEXT(""))
			&& IFileManager::Get().DirectoryExists(*Directory);
	}

	bool CheckDryRunPreconditions(
		UAgentAssetTools::EOperation Operation,
		const TSharedPtr<FJsonObject>& Params,
		const UAgentAssetTools::FValidationResult& Validation,
		FString& OutReason)
	{
		const FString Scope = LedgerScope(Params);
		FString BeforePath;
		FString AfterPath;
		ResolveOperationPaths(Operation, Params, BeforePath, AfterPath);
		if (Operation == UAgentAssetTools::EOperation::CreateFolder)
		{
			if (IsRunRootDirectoryPresent(Validation.RunRoot) || IsPlannedOutput(Scope, AfterPath))
			{
				OutReason = TEXT("run_root_already_present");
				return false;
			}
			return true;
		}
		if (Operation == UAgentAssetTools::EOperation::Duplicate)
		{
			if (FindAsset(BeforePath) == nullptr) { OutReason = TEXT("duplicate_source_missing"); return false; }
			if (!IsTargetAbsent(Scope, AfterPath)) { OutReason = TEXT("duplicate_target_present"); return false; }
			return true;
		}
		if (Operation == UAgentAssetTools::EOperation::Rename || Operation == UAgentAssetTools::EOperation::Move)
		{
			if (!IsKnownOrPlannedAsset(Scope, BeforePath)) { OutReason = TEXT("rename_or_move_source_missing"); return false; }
			if (!IsTargetAbsent(Scope, AfterPath)) { OutReason = TEXT("rename_or_move_target_present"); return false; }
			return true;
		}
		if (Operation == UAgentAssetTools::EOperation::Save)
		{
			if (!IsKnownOrPlannedAsset(Scope, BeforePath)) { OutReason = TEXT("save_source_missing"); return false; }
			return true;
		}
		OutReason = TEXT("forward_delete_forbidden");
		return false;
	}

	bool IsNextExecution(const FOperationLedgerEntry& Entry)
	{
		const TArray<FString>* OrderedKeys = GRunLedgerOrder.Find(Entry.Scope);
		if (!OrderedKeys) return false;
		for (const FString& Key : *OrderedKeys)
		{
			if (Key == Entry.Key) return true;
			const FOperationLedgerEntry* Previous = GOperationLedger.Find(Key);
			if (!Previous || Previous->State != ELedgerState::Executed) return false;
		}
		return false;
	}

	bool IsNextRollback(const FOperationLedgerEntry& Entry)
	{
		const TArray<FString>* OrderedKeys = GRunLedgerOrder.Find(Entry.Scope);
		if (!OrderedKeys) return false;
		for (int32 Index = OrderedKeys->Num() - 1; Index >= 0; --Index)
		{
			const FString& Key = (*OrderedKeys)[Index];
			if (Key == Entry.Key) return true;
			const FOperationLedgerEntry* Later = GOperationLedger.Find(Key);
			if (!Later) return false;
			if (Later->State == ELedgerState::PartialFailure) return false;
			if (Later->bRollbackAvailable && Later->State != ELedgerState::RolledBack) return false;
		}
		return false;
	}

	bool IsExpectedRollbackDispatcher(UAgentAssetTools::EOperation ForwardOperation, UAgentAssetTools::EOperation DispatchOperation)
	{
		switch (ForwardOperation)
		{
		case UAgentAssetTools::EOperation::CreateFolder:
		case UAgentAssetTools::EOperation::Duplicate:
			return DispatchOperation == UAgentAssetTools::EOperation::Delete;
		case UAgentAssetTools::EOperation::Rename:
			return DispatchOperation == UAgentAssetTools::EOperation::Rename;
		case UAgentAssetTools::EOperation::Move:
			return DispatchOperation == UAgentAssetTools::EOperation::Move;
		default:
			return false;
		}
	}

	bool HasExactRollbackArguments(
		const FOperationLedgerEntry& Entry,
		UAgentAssetTools::EOperation DispatchOperation,
		const TSharedPtr<FJsonObject>& Params,
		FString& OutReason)
	{
		if (PathFromParams(Params, TEXT("changeSetId")) != Entry.ChangeSetId
			|| PathFromParams(Params, TEXT("runId")) != Entry.RunId
			|| PathFromParams(Params, TEXT("operationId")) != Entry.OperationId)
		{
			OutReason = TEXT("rollback_scope_mismatch");
			return false;
		}
		if (!IsExpectedRollbackDispatcher(Entry.Operation, DispatchOperation))
		{
			OutReason = TEXT("native_rollback_tool_binding_invalid");
			return false;
		}
		if (PathFromParams(Params, TEXT("dryRunHash")) != Entry.DryRunHash)
		{
			OutReason = TEXT("accepted_dry_run_hash_mismatch");
			return false;
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::CreateFolder || Entry.Operation == UAgentAssetTools::EOperation::Duplicate)
		{
			if (PathFromParams(Params, TEXT("assetPath")) != Entry.AfterPath)
			{
				OutReason = TEXT("rollback_inverse_arguments_mismatch");
				return false;
			}
			return true;
		}
		if ((Entry.Operation == UAgentAssetTools::EOperation::Rename || Entry.Operation == UAgentAssetTools::EOperation::Move)
			&& PathFromParams(Params, TEXT("assetPath")) == Entry.AfterPath
			&& PathFromParams(Params, TEXT("targetAssetPath")) == Entry.BeforePath)
		{
			return true;
		}
		OutReason = TEXT("rollback_inverse_arguments_mismatch");
		return false;
	}

	bool HasExactForwardArguments(const FOperationLedgerEntry& Entry, const TSharedPtr<FJsonObject>& Params)
	{
		FString BeforePath;
		FString AfterPath;
		ResolveOperationPaths(Entry.Operation, Params, BeforePath, AfterPath);
		return PathFromParams(Params, TEXT("changeSetId")) == Entry.ChangeSetId
			&& PathFromParams(Params, TEXT("runId")) == Entry.RunId
			&& PathFromParams(Params, TEXT("operationId")) == Entry.OperationId
			&& BeforePath == Entry.BeforePath && AfterPath == Entry.AfterPath
			&& UAgentAssetTools::ComputeDryRunHash(Params) == Entry.DryRunHash;
	}

	bool VerifyStoredNativeAuthorityFacts(
		const FOperationLedgerEntry& Entry,
		const TSharedPtr<FJsonObject>& Params,
		bool bRollback,
		FString& OutReason)
	{
		const FString ProvidedBinding = PathFromParams(Params, TEXT("acceptedPlanBinding"));
		const FString ProvidedRegistrationId = PathFromParams(Params, TEXT("nativeRegistrationId"));
		const FString ProvidedPhase = PathFromParams(Params, TEXT("nativePhase"));
		const int64 ProvidedOperationIndex = IntegerFromParams(Params, TEXT("nativeOperationIndex"), INDEX_NONE);
		const int64 ProvidedOperationCount = IntegerFromParams(Params, TEXT("nativeOperationCount"));
		const int64 ProvidedCreatedAt = IntegerFromParams(Params, TEXT("nativeCreatedAt"));
		const int64 ProvidedConnectionGeneration = IntegerFromParams(Params, TEXT("connectionGeneration"));
		const int64 ProvidedSessionGeneration = IntegerFromParams(Params, TEXT("sessionGeneration"));
		const FString ProvidedSourceIdentity = PathFromParams(Params, TEXT("nativeSourceIdentity"));
		const FString ProvidedManifestIdentity = PathFromParams(Params, TEXT("nativeManifestIdentity"));
		const FString ProvidedPluginIdentity = PathFromParams(Params, TEXT("nativePluginIdentity"));
		const FString ProvidedPackageIdentity = PathFromParams(Params, TEXT("nativePackageIdentity"));

		if (ProvidedPhase != (bRollback ? TEXT("rollback") : TEXT("execute")))
		{
			OutReason = TEXT("native_phase_mismatch");
			return false;
		}
		if (Entry.NativeOperationIndex == INDEX_NONE || ProvidedOperationIndex != Entry.NativeOperationIndex)
		{
			OutReason = TEXT("native_operation_index_mismatch");
			return false;
		}
		if (Entry.NativeOperationCount <= 0 || ProvidedOperationCount != Entry.NativeOperationCount)
		{
			OutReason = TEXT("native_operation_count_mismatch");
			return false;
		}
		if (ProvidedManifestIdentity != Entry.BuildManifestSha256)
		{
			OutReason = TEXT("native_manifest_identity_mismatch");
			return false;
		}
		if (ProvidedBinding != Entry.AcceptedPlanBinding)
		{
			OutReason = TEXT("accepted_plan_binding_mismatch");
			return false;
		}
		if (ProvidedRegistrationId != Entry.NativeRegistrationId)
		{
			OutReason = TEXT("native_registration_mismatch");
			return false;
		}
		if (ProvidedCreatedAt != Entry.NativeCreatedAt)
		{
			OutReason = TEXT("native_created_at_mismatch");
			return false;
		}
		if (ProvidedConnectionGeneration != Entry.ConnectionGeneration
			|| ProvidedSessionGeneration != Entry.SessionGeneration)
		{
			OutReason = TEXT("native_generation_mismatch");
			return false;
		}
		if (ProvidedSourceIdentity != Entry.NativeSourceIdentity
			|| ProvidedManifestIdentity != Entry.NativeManifestIdentity
			|| ProvidedPluginIdentity != Entry.NativePluginIdentity
			|| ProvidedPackageIdentity != Entry.NativePackageIdentity)
		{
			OutReason = TEXT("native_identity_mismatch");
			return false;
		}
		return true;
	}

	bool VerifyAndBindNativeAuthority(
		FOperationLedgerEntry& Entry,
		const TSharedPtr<FJsonObject>& Params,
		bool bRollback,
		FString& OutReason)
	{
		const FString ProvidedBinding = PathFromParams(Params, TEXT("acceptedPlanBinding"));
		const FString ProvidedRegistrationId = PathFromParams(Params, TEXT("nativeRegistrationId"));
		const FString ProvidedPhase = PathFromParams(Params, TEXT("nativePhase"));
		const int64 ProvidedOperationIndex = IntegerFromParams(Params, TEXT("nativeOperationIndex"), INDEX_NONE);
		const int64 ProvidedOperationCount = IntegerFromParams(Params, TEXT("nativeOperationCount"));
		const int64 ProvidedCreatedAt = IntegerFromParams(Params, TEXT("nativeCreatedAt"));
		const int64 ProvidedConnectionGeneration = IntegerFromParams(Params, TEXT("connectionGeneration"));
		const int64 ProvidedSessionGeneration = IntegerFromParams(Params, TEXT("sessionGeneration"));
		const FString ProvidedSourceIdentity = PathFromParams(Params, TEXT("nativeSourceIdentity"));
		const FString ProvidedManifestIdentity = PathFromParams(Params, TEXT("nativeManifestIdentity"));
		const FString ProvidedPluginIdentity = PathFromParams(Params, TEXT("nativePluginIdentity"));
		const FString ProvidedPackageIdentity = PathFromParams(Params, TEXT("nativePackageIdentity"));
		const TArray<FString>* OrderedKeys = GRunLedgerOrder.Find(Entry.Scope);
		const int32 ExpectedOperationIndex = OrderedKeys ? OrderedKeys->IndexOfByKey(Entry.Key) : INDEX_NONE;
		const int32 ExpectedOperationCount = OrderedKeys ? OrderedKeys->Num() : 0;

		if (ProvidedPhase != (bRollback ? TEXT("rollback") : TEXT("execute")))
		{
			OutReason = TEXT("native_phase_mismatch");
			return false;
		}
		if (ExpectedOperationIndex == INDEX_NONE || ProvidedOperationIndex != ExpectedOperationIndex)
		{
			OutReason = TEXT("native_operation_index_mismatch");
			return false;
		}
		if (ExpectedOperationCount <= 0 || ProvidedOperationCount != ExpectedOperationCount)
		{
			OutReason = TEXT("native_operation_count_mismatch");
			return false;
		}
		if (ProvidedManifestIdentity != Entry.BuildManifestSha256)
		{
			OutReason = TEXT("native_manifest_identity_mismatch");
			return false;
		}

		FRunAuthorityLedger& RunAuthority = GRunAuthorityLedger.FindOrAdd(Entry.Scope);
		if (!RunAuthority.bBound)
		{
			RunAuthority.bBound = true;
			RunAuthority.AcceptedPlanBinding = ProvidedBinding;
			RunAuthority.NativeRegistrationId = ProvidedRegistrationId;
			RunAuthority.NativeCreatedAt = ProvidedCreatedAt;
			RunAuthority.ConnectionGeneration = ProvidedConnectionGeneration;
			RunAuthority.SessionGeneration = ProvidedSessionGeneration;
			RunAuthority.NativeOperationCount = static_cast<int32>(ProvidedOperationCount);
			RunAuthority.NativeSourceIdentity = ProvidedSourceIdentity;
			RunAuthority.NativeManifestIdentity = ProvidedManifestIdentity;
			RunAuthority.NativePluginIdentity = ProvidedPluginIdentity;
			RunAuthority.NativePackageIdentity = ProvidedPackageIdentity;
		}
		if (ProvidedBinding != RunAuthority.AcceptedPlanBinding)
		{
			OutReason = TEXT("accepted_plan_binding_mismatch");
			return false;
		}
		if (ProvidedRegistrationId != RunAuthority.NativeRegistrationId)
		{
			OutReason = TEXT("native_registration_mismatch");
			return false;
		}
		if (ProvidedCreatedAt != RunAuthority.NativeCreatedAt)
		{
			OutReason = TEXT("native_created_at_mismatch");
			return false;
		}
		if (ProvidedConnectionGeneration != RunAuthority.ConnectionGeneration
			|| ProvidedSessionGeneration != RunAuthority.SessionGeneration)
		{
			OutReason = TEXT("native_generation_mismatch");
			return false;
		}
		if (ProvidedOperationCount != RunAuthority.NativeOperationCount)
		{
			OutReason = TEXT("native_operation_count_mismatch");
			return false;
		}
		if (ProvidedSourceIdentity != RunAuthority.NativeSourceIdentity
			|| ProvidedManifestIdentity != RunAuthority.NativeManifestIdentity
			|| ProvidedPluginIdentity != RunAuthority.NativePluginIdentity
			|| ProvidedPackageIdentity != RunAuthority.NativePackageIdentity)
		{
			OutReason = TEXT("native_identity_mismatch");
			return false;
		}

		Entry.AcceptedPlanBinding = RunAuthority.AcceptedPlanBinding;
		Entry.NativeRegistrationId = RunAuthority.NativeRegistrationId;
		Entry.NativeCreatedAt = RunAuthority.NativeCreatedAt;
		Entry.ConnectionGeneration = RunAuthority.ConnectionGeneration;
		Entry.SessionGeneration = RunAuthority.SessionGeneration;
		Entry.NativeOperationIndex = ExpectedOperationIndex;
		Entry.NativeOperationCount = ExpectedOperationCount;
		Entry.LastNativePhase = ProvidedPhase;
		Entry.NativeSourceIdentity = RunAuthority.NativeSourceIdentity;
		Entry.NativeManifestIdentity = RunAuthority.NativeManifestIdentity;
		Entry.NativePluginIdentity = RunAuthority.NativePluginIdentity;
		Entry.NativePackageIdentity = RunAuthority.NativePackageIdentity;
		return true;
	}

	bool CheckForwardExecutePreconditions(const FOperationLedgerEntry& Entry, const UAgentAssetTools::FValidationResult& Validation, FString& OutReason)
	{
		if (Entry.Operation == UAgentAssetTools::EOperation::CreateFolder)
		{
#if !PLATFORM_WINDOWS
			OutReason = TEXT("run_root_physical_identity_unsupported");
			return false;
#endif
			if (IsRunRootDirectoryPresent(Validation.RunRoot)) { OutReason = TEXT("run_root_present_at_execute"); return false; }
			return true;
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::Duplicate)
		{
			if (FindAsset(Entry.BeforePath) == nullptr) { OutReason = TEXT("duplicate_source_missing_at_execute"); return false; }
			if (FindAsset(Entry.AfterPath) != nullptr) { OutReason = TEXT("duplicate_target_present_at_execute"); return false; }
			return true;
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::Rename || Entry.Operation == UAgentAssetTools::EOperation::Move)
		{
			if (FindAsset(Entry.BeforePath) == nullptr) { OutReason = TEXT("rename_or_move_source_missing_at_execute"); return false; }
			if (FindAsset(Entry.AfterPath) != nullptr) { OutReason = TEXT("rename_or_move_target_present_at_execute"); return false; }
			return true;
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::Save)
		{
			if (FindAsset(Entry.BeforePath) == nullptr) { OutReason = TEXT("save_source_missing_at_execute"); return false; }
			return true;
		}
		OutReason = TEXT("forward_delete_forbidden");
		return false;
	}

	class FRejectAnyDirectoryEntryVisitor final : public IPlatformFile::FDirectoryVisitor
	{
	public:
		bool bSawEntry = false;

		virtual bool Visit(const TCHAR* FilenameOrDirectory, bool bIsDirectory) override
		{
			bSawEntry = true;
			return false;
		}
	};

	bool HasUsablePhysicalFileId(const uint8* FileId, int32 FileIdLength)
	{
		if (!FileId || FileIdLength != 16) return false;
		for (int32 Index = 0; Index < FileIdLength; ++Index)
		{
			if (FileId[Index] != 0) return true;
		}
		return false;
	}

#if PLATFORM_WINDOWS
	class FScopedDirectoryHandle final
	{
	public:
		explicit FScopedDirectoryHandle(HANDLE InHandle)
			: Handle(InHandle)
		{
		}

		FScopedDirectoryHandle(const FScopedDirectoryHandle&) = delete;
		FScopedDirectoryHandle& operator=(const FScopedDirectoryHandle&) = delete;

		FScopedDirectoryHandle(FScopedDirectoryHandle&& Other)
			: Handle(Other.Handle)
		{
			Other.Handle = INVALID_HANDLE_VALUE;
		}

		FScopedDirectoryHandle& operator=(FScopedDirectoryHandle&& Other)
		{
			if (this != &Other)
			{
				Close();
				Handle = Other.Handle;
				Other.Handle = INVALID_HANDLE_VALUE;
			}
			return *this;
		}

		~FScopedDirectoryHandle()
		{
			Close();
		}

		bool IsValid() const
		{
			return Handle != INVALID_HANDLE_VALUE && Handle != nullptr;
		}

		HANDLE Get() const
		{
			return Handle;
		}

	private:
		void Close()
		{
			if (IsValid()) ::CloseHandle(Handle);
			Handle = INVALID_HANDLE_VALUE;
		}

		HANDLE Handle = INVALID_HANDLE_VALUE;
	};

	enum class EOwnedDirectoryCreationKind : uint8
	{
		RunRoot,
		EffectDirectory,
	};

	bool QueryPhysicalDirectoryIdentity(
		HANDLE DirectoryHandle,
		FPhysicalDirectoryIdentity& OutIdentity,
		FString& OutReason)
	{
		FILE_ATTRIBUTE_TAG_INFO AttributeInfo = {};
		if (!::GetFileInformationByHandleEx(
			DirectoryHandle,
			FileAttributeTagInfo,
			&AttributeInfo,
			sizeof(AttributeInfo)))
		{
			OutReason = TEXT("run_root_attribute_query_failed");
			return false;
		}
		if ((AttributeInfo.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0)
		{
			OutReason = TEXT("owned_run_root_not_directory");
			return false;
		}
		if ((AttributeInfo.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
		{
			OutReason = TEXT("run_root_link_or_reparse_blocked");
			return false;
		}

		FILE_ID_INFO IdentityInfo = {};
		if (!::GetFileInformationByHandleEx(
			DirectoryHandle,
			FileIdInfo,
			&IdentityInfo,
			sizeof(IdentityInfo)))
		{
			OutReason = TEXT("run_root_physical_identity_unavailable");
			return false;
		}
		OutIdentity.VolumeSerialNumber = IdentityInfo.VolumeSerialNumber;
		FMemory::Memcpy(
			OutIdentity.FileId,
			IdentityInfo.FileId.Identifier,
			UE_ARRAY_COUNT(OutIdentity.FileId));
		// Windows documents an all-zero FILE_ID_128 for file systems that do not
		// provide a usable 128-bit identity.  Treating it as valid would make every
		// directory on the volume compare equal and could authorize a replacement.
		if (!HasUsablePhysicalFileId(OutIdentity.FileId, UE_ARRAY_COUNT(OutIdentity.FileId)))
		{
			OutReason = TEXT("run_root_physical_identity_unavailable");
			return false;
		}
		OutIdentity.bValid = true;
		return true;
	}

	bool IsSafeRelativeDirectoryLeaf(const FString& LeafName)
	{
		const int64 NameBytes = static_cast<int64>(LeafName.Len()) * sizeof(WCHAR);
		return !LeafName.IsEmpty()
			&& LeafName != TEXT(".")
			&& LeafName != TEXT("..")
			&& !LeafName.Contains(TEXT("/"))
			&& !LeafName.Contains(TEXT("\\"))
			&& NameBytes <= MAX_uint16;
	}

	void InitializeRelativeDirectoryObjectAttributes(
		const FString& LeafName,
		HANDLE ParentHandle,
		UNICODE_STRING& OutName,
		OBJECT_ATTRIBUTES& OutAttributes)
	{
		OutName.Buffer = const_cast<WCHAR*>(*LeafName);
		OutName.Length = static_cast<USHORT>(LeafName.Len() * sizeof(WCHAR));
		OutName.MaximumLength = OutName.Length;
		OutAttributes = {};
		OutAttributes.Length = sizeof(OBJECT_ATTRIBUTES);
		OutAttributes.RootDirectory = ParentHandle;
		OutAttributes.ObjectName = &OutName;
		OutAttributes.Attributes = OBJ_CASE_INSENSITIVE;
	}

	bool OpenPhysicalDirectoryRelative(
		HANDLE ParentHandle,
		const FString& LeafName,
		DWORD DesiredAccess,
		DWORD ShareMode,
		FScopedDirectoryHandle& OutHandle,
		FPhysicalDirectoryIdentity& OutIdentity,
		FString& OutReason)
	{
		if ((ParentHandle == INVALID_HANDLE_VALUE || ParentHandle == nullptr)
			|| !IsSafeRelativeDirectoryLeaf(LeafName))
		{
			OutReason = TEXT("relative_directory_open_invalid");
			return false;
		}

		UNICODE_STRING Name = {};
		OBJECT_ATTRIBUTES Attributes = {};
		InitializeRelativeDirectoryObjectAttributes(LeafName, ParentHandle, Name, Attributes);
		IO_STATUS_BLOCK IoStatus = {};
		HANDLE RawHandle = INVALID_HANDLE_VALUE;
		const NTSTATUS Status = ::NtCreateFile(
			&RawHandle,
			DesiredAccess | SYNCHRONIZE,
			&Attributes,
			&IoStatus,
			nullptr,
			FILE_ATTRIBUTE_NORMAL,
			ShareMode,
			FILE_OPEN,
			FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
			nullptr,
			0);
		FScopedDirectoryHandle Handle(RawHandle);
		if (Status < 0 || !Handle.IsValid() || IoStatus.Information != FILE_OPENED)
		{
			OutReason = TEXT("relative_directory_handle_open_failed");
			return false;
		}
		if (!QueryPhysicalDirectoryIdentity(Handle.Get(), OutIdentity, OutReason)) return false;
		OutHandle = MoveTemp(Handle);
		return true;
	}

	bool ShouldInjectCreateToIdentityReplacement(EOwnedDirectoryCreationKind Kind)
	{
#if WITH_DEV_AUTOMATION_TESTS
		return (Kind == EOwnedDirectoryCreationKind::RunRoot
				&& GAutomationFault == UAgentAssetTools::EAutomationFault::RunRootCreateToIdentityReplacement)
			|| (Kind == EOwnedDirectoryCreationKind::EffectDirectory
				&& GAutomationFault == UAgentAssetTools::EAutomationFault::EffectDirectoryCreateToIdentityReplacement);
#else
		return false;
#endif
	}

	bool CreateOwnedPhysicalDirectoryAtomic(
		HANDLE ParentHandle,
		const FString& LeafName,
		const FString& FullDirectory,
		EOwnedDirectoryCreationKind Kind,
		FScopedDirectoryHandle& OutHandle,
		FPhysicalDirectoryIdentity& OutIdentity,
		FString& OutReason,
		EEffectDirectoryCleanupFailure& OutCleanupFailure)
	{
		const bool bRunRoot = Kind == EOwnedDirectoryCreationKind::RunRoot;
		if ((ParentHandle == INVALID_HANDLE_VALUE || ParentHandle == nullptr)
			|| !IsSafeRelativeDirectoryLeaf(LeafName))
		{
			OutReason = bRunRoot
				? TEXT("run_root_creation_target_invalid")
				: TEXT("effect_directory_creation_target_invalid");
			return false;
		}

		UNICODE_STRING Name = {};
		OBJECT_ATTRIBUTES Attributes = {};
		InitializeRelativeDirectoryObjectAttributes(LeafName, ParentHandle, Name, Attributes);
		IO_STATUS_BLOCK IoStatus = {};
		HANDLE RawHandle = INVALID_HANDLE_VALUE;
		const NTSTATUS Status = ::NtCreateFile(
			&RawHandle,
			FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
			&Attributes,
			&IoStatus,
			nullptr,
			FILE_ATTRIBUTE_NORMAL,
			FILE_SHARE_READ | FILE_SHARE_WRITE,
			FILE_CREATE,
			FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
			nullptr,
			0);
		FScopedDirectoryHandle CreatedHandle(RawHandle);
		constexpr NTSTATUS ObjectNameCollision = static_cast<NTSTATUS>(0xC0000035UL);
		if (Status < 0 || !CreatedHandle.IsValid())
		{
			OutReason = Status == ObjectNameCollision
				? (bRunRoot ? TEXT("run_root_creation_raced") : TEXT("effect_directory_creation_raced"))
				: (bRunRoot ? TEXT("run_root_creation_failed") : TEXT("effect_directory_creation_failed"));
			return false;
		}
		if (IoStatus.Information != FILE_CREATED)
		{
			OutReason = bRunRoot
				? TEXT("run_root_creation_result_invalid")
				: TEXT("effect_directory_creation_result_invalid");
			OutCleanupFailure = EEffectDirectoryCleanupFailure::Unknown;
			return false;
		}

		if (ShouldInjectCreateToIdentityReplacement(Kind))
		{
			// Production keeps this exact create handle open through identity
			// capture.  The task-only hook deliberately drops that lease and
			// replaces the same path at the historical gap, then returns without
			// reopening by path.  This proves the replacement cannot be adopted.
			CreatedHandle = FScopedDirectoryHandle(INVALID_HANDLE_VALUE);
			if (!::RemoveDirectoryW(*FullDirectory))
			{
				OutReason = bRunRoot
					? TEXT("run_root_create_identity_injection_remove_failed")
					: TEXT("effect_directory_create_identity_injection_remove_failed");
				OutCleanupFailure = EEffectDirectoryCleanupFailure::Unknown;
				return false;
			}
			if (!::CreateDirectoryW(*FullDirectory, nullptr))
			{
				OutReason = bRunRoot
					? TEXT("run_root_create_identity_injection_replace_failed")
					: TEXT("effect_directory_create_identity_injection_replace_failed");
				OutCleanupFailure = EEffectDirectoryCleanupFailure::Unknown;
				return false;
			}
			OutReason = bRunRoot
				? TEXT("run_root_create_identity_race_detected")
				: TEXT("effect_directory_create_identity_race_detected");
			OutCleanupFailure = EEffectDirectoryCleanupFailure::Unknown;
			return false;
		}

		FPhysicalDirectoryIdentity CreatedIdentity;
		FString IdentityReason;
		if (!QueryPhysicalDirectoryIdentity(CreatedHandle.Get(), CreatedIdentity, IdentityReason))
		{
			// Without a physical identity there is no safe path-based cleanup
			// authority.  Leave the exact created object in place and report the
			// residue as unknown instead of risking deletion of a replacement.
			OutReason = bRunRoot
				? TEXT("run_root_identity_capture_failed")
				: TEXT("effect_directory_identity_capture_failed");
			OutCleanupFailure = EEffectDirectoryCleanupFailure::Unknown;
			return false;
		}
		OutIdentity = CreatedIdentity;
		OutHandle = MoveTemp(CreatedHandle);
		return true;
	}

	bool OpenPhysicalDirectory(
		const FString& Directory,
		DWORD DesiredAccess,
		DWORD ShareMode,
		FScopedDirectoryHandle& OutHandle,
		FPhysicalDirectoryIdentity& OutIdentity,
		FString& OutReason)
	{
		FScopedDirectoryHandle Handle(::CreateFileW(
			*Directory,
			DesiredAccess,
			ShareMode,
			nullptr,
			OPEN_EXISTING,
			FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
			nullptr));
		if (!Handle.IsValid())
		{
			OutReason = TEXT("run_root_handle_open_failed");
			return false;
		}
		if (!QueryPhysicalDirectoryIdentity(Handle.Get(), OutIdentity, OutReason)) return false;
		OutHandle = MoveTemp(Handle);
		return true;
	}
#endif

	bool ResolveSafeOwnedRunRootDirectory(const FString& FolderPath, FString& OutDirectory, FString& OutReason)
	{
		FString ContentDirectory = FPaths::ProjectContentDir();
		FString SandboxDirectory = FPaths::Combine(ContentDirectory, TEXT("UAgentSandbox"));
		if (!FPackageName::TryConvertLongPackageNameToFilename(FolderPath, OutDirectory, TEXT("")))
		{
			OutReason = TEXT("run_root_directory_invalid");
			return false;
		}
		ContentDirectory = FPaths::ConvertRelativePathToFull(ContentDirectory);
		SandboxDirectory = FPaths::ConvertRelativePathToFull(SandboxDirectory);
		OutDirectory = FPaths::ConvertRelativePathToFull(OutDirectory);
		if (!FPaths::IsUnderDirectory(OutDirectory, SandboxDirectory) || OutDirectory == SandboxDirectory)
		{
			OutReason = TEXT("run_root_directory_escape");
			return false;
		}
		IFileManager& FileManager = IFileManager::Get();
		if (!FileManager.DirectoryExists(*OutDirectory))
		{
			OutReason = TEXT("owned_run_root_missing");
			return false;
		}
		// IFileManager::IsSymlink delegates to the platform file implementation.  On
		// Windows that treats FILE_ATTRIBUTE_REPARSE_POINT as a symlink, so this is a
		// fail-closed check for junctions/reparse points as well as ordinary links.
		if (FileManager.IsSymlink(*ContentDirectory) || FileManager.IsSymlink(*SandboxDirectory) || FileManager.IsSymlink(*OutDirectory))
		{
			OutReason = TEXT("run_root_link_or_reparse_blocked");
			return false;
		}
		return true;
	}

	bool CaptureOwnedRunRootPhysicalIdentity(
		const FString& FolderPath,
		FPhysicalDirectoryIdentity& OutIdentity,
		FString& OutReason)
	{
		FString Directory;
		if (!ResolveSafeOwnedRunRootDirectory(FolderPath, Directory, OutReason)) return false;
#if PLATFORM_WINDOWS
		FScopedDirectoryHandle Handle(INVALID_HANDLE_VALUE);
		return OpenPhysicalDirectory(
			Directory,
			FILE_READ_ATTRIBUTES,
			FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
			Handle,
			OutIdentity,
			OutReason);
#else
		OutReason = TEXT("run_root_physical_identity_unsupported");
		return false;
#endif
	}

	bool IsOwnedRunRootPhysicallyEmpty(
		const FOperationLedgerEntry& Entry,
		FString& OutDirectory,
		FString& OutReason
#if PLATFORM_WINDOWS
		, FScopedDirectoryHandle* OutDeletionHandle = nullptr
#endif
	)
	{
		if (!ResolveSafeOwnedRunRootDirectory(Entry.AfterPath, OutDirectory, OutReason)) return false;
		if (!Entry.RunRootPhysicalIdentity.bValid)
		{
			OutReason = TEXT("run_root_physical_identity_missing");
			return false;
		}
#if PLATFORM_WINDOWS
		FScopedDirectoryHandle Handle(INVALID_HANDLE_VALUE);
		FPhysicalDirectoryIdentity CurrentIdentity;
		if (!OpenPhysicalDirectory(
			OutDirectory,
			FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | (OutDeletionHandle ? DELETE : 0),
			FILE_SHARE_READ | FILE_SHARE_WRITE,
			Handle,
			CurrentIdentity,
			OutReason))
		{
			return false;
		}
		if (!(CurrentIdentity == Entry.RunRootPhysicalIdentity))
		{
			OutReason = TEXT("run_root_physical_identity_mismatch");
			return false;
		}
#else
		OutReason = TEXT("run_root_physical_identity_unsupported");
		return false;
#endif
		FAssetRegistryModule& RegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
		TArray<FAssetData> Assets;
		RegistryModule.Get().GetAssetsByPath(FName(*Entry.AfterPath), Assets, true);
		if (Assets.Num() > 0)
		{
			OutReason = TEXT("non_empty_run_root");
			return false;
		}
		FRejectAnyDirectoryEntryVisitor Visitor;
#if WITH_DEV_AUTOMATION_TESTS
		if (GAutomationFault == UAgentAssetTools::EAutomationFault::RunRootEnumerationFailure)
		{
			OutReason = TEXT("run_root_directory_enumeration_failed");
			return false;
		}
#endif
		if (!IFileManager::Get().IterateDirectory(*OutDirectory, Visitor) || Visitor.bSawEntry)
		{
			OutReason = Visitor.bSawEntry ? TEXT("non_empty_run_root") : TEXT("run_root_directory_enumeration_failed");
			return false;
		}
#if PLATFORM_WINDOWS
		if (OutDeletionHandle) *OutDeletionHandle = MoveTemp(Handle);
#endif
		return true;
	}

	bool CleanupOwnedEmptyRunRoot(const FOperationLedgerEntry& Entry, FString& OutReason)
	{
		FString Directory;
#if PLATFORM_WINDOWS
		FScopedDirectoryHandle DeletionHandle(INVALID_HANDLE_VALUE);
		if (!IsOwnedRunRootPhysicallyEmpty(Entry, Directory, OutReason, &DeletionHandle)) return false;
		FILE_DISPOSITION_INFO Disposition = { 1 };
		if (!::SetFileInformationByHandle(
			DeletionHandle.Get(),
			FileDispositionInfo,
			&Disposition,
			sizeof(Disposition)))
		{
			OutReason = TEXT("run_root_cleanup_failed");
			return false;
		}
		// Closing completes the handle-targeted delete.  No path-recursive delete
		// API is used, and the no-share-delete handle prevents same-path replacement
		// between the identity comparison and disposition.
		DeletionHandle = FScopedDirectoryHandle(INVALID_HANDLE_VALUE);
#else
		if (!IsOwnedRunRootPhysicallyEmpty(Entry, Directory, OutReason)) return false;
		OutReason = TEXT("run_root_physical_identity_unsupported");
		return false;
#endif
		if (IFileManager::Get().DirectoryExists(*Directory))
		{
			OutReason = TEXT("run_root_cleanup_not_observed");
			return false;
		}
		return true;
	}

	const FOperationLedgerEntry* FindExecutedRunRootEntry(const FOperationLedgerEntry& Entry)
	{
		const FString ExpectedRunRoot = FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *Entry.RunId);
		const TArray<FString>* OrderedKeys = GRunLedgerOrder.Find(Entry.Scope);
		if (!OrderedKeys) return nullptr;
		for (const FString& Key : *OrderedKeys)
		{
			const FOperationLedgerEntry* Candidate = GOperationLedger.Find(Key);
			if (Candidate
				&& Candidate->Operation == UAgentAssetTools::EOperation::CreateFolder
				&& Candidate->RunId == Entry.RunId
				&& Candidate->AfterPath == ExpectedRunRoot
				&& Candidate->State == ELedgerState::Executed)
			{
				return Candidate;
			}
		}
		return nullptr;
	}

#if PLATFORM_WINDOWS
	bool ResolveOwnedRunRootCreationTarget(
		const FOperationLedgerEntry& Entry,
		FString& OutSandboxDirectory,
		FString& OutRunRootDirectory,
		FString& OutLeafName,
		FString& OutReason)
	{
		const FString ExpectedRunRoot = FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *Entry.RunId);
		if (Entry.AfterPath != ExpectedRunRoot
			|| !FPackageName::TryConvertLongPackageNameToFilename(Entry.AfterPath, OutRunRootDirectory, TEXT("")))
		{
			OutReason = TEXT("run_root_creation_target_invalid");
			return false;
		}

		FString ProjectDirectory = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir());
		FString ContentDirectory = FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir());
		OutSandboxDirectory = FPaths::ConvertRelativePathToFull(
			FPaths::Combine(ContentDirectory, TEXT("UAgentSandbox")));
		OutRunRootDirectory = FPaths::ConvertRelativePathToFull(OutRunRootDirectory);
		FPaths::NormalizeDirectoryName(ProjectDirectory);
		FPaths::NormalizeDirectoryName(ContentDirectory);
		FPaths::NormalizeDirectoryName(OutSandboxDirectory);
		FPaths::NormalizeDirectoryName(OutRunRootDirectory);
		OutLeafName = FPaths::GetCleanFilename(OutRunRootDirectory);
		if (FPaths::GetPath(OutRunRootDirectory) != OutSandboxDirectory
			|| OutLeafName != Entry.RunId
			|| !IsSafeRelativeDirectoryLeaf(OutLeafName))
		{
			OutReason = TEXT("run_root_directory_escape");
			return false;
		}

		IFileManager& FileManager = IFileManager::Get();
		if (!FileManager.DirectoryExists(*ProjectDirectory)
			|| FileManager.IsSymlink(*ProjectDirectory))
		{
			OutReason = TEXT("project_directory_invalid");
			return false;
		}
		if (!FileManager.DirectoryExists(*ContentDirectory)
			&& !FileManager.MakeDirectory(*ContentDirectory, false))
		{
			OutReason = TEXT("project_content_directory_creation_failed");
			return false;
		}
		if (FileManager.IsSymlink(*ContentDirectory))
		{
			OutReason = TEXT("run_root_link_or_reparse_blocked");
			return false;
		}
		if (!FileManager.DirectoryExists(*OutSandboxDirectory)
			&& !FileManager.MakeDirectory(*OutSandboxDirectory, false))
		{
			OutReason = TEXT("sandbox_parent_creation_failed");
			return false;
		}
		if (FileManager.IsSymlink(*OutSandboxDirectory))
		{
			OutReason = TEXT("run_root_link_or_reparse_blocked");
			return false;
		}
		return true;
	}

	bool PrepareOwnedRunRoot(
		FOperationLedgerEntry& Entry,
		FString& OutReason,
		EEffectDirectoryCleanupFailure& OutCleanupFailure,
		TArray<FScopedDirectoryHandle>& OutDirectoryLeases)
	{
		Entry.RunRootPhysicalIdentity = {};
		FString SandboxDirectory;
		FString RunRootDirectory;
		FString RunRootLeaf;
		if (!ResolveOwnedRunRootCreationTarget(
			Entry,
			SandboxDirectory,
			RunRootDirectory,
			RunRootLeaf,
			OutReason))
		{
			return false;
		}

		FScopedDirectoryHandle SandboxHandle(INVALID_HANDLE_VALUE);
		FPhysicalDirectoryIdentity SandboxIdentity;
		if (!OpenPhysicalDirectory(
			SandboxDirectory,
			FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
			FILE_SHARE_READ | FILE_SHARE_WRITE,
			SandboxHandle,
			SandboxIdentity,
			OutReason))
		{
			OutReason = TEXT("sandbox_parent_handle_open_failed");
			return false;
		}

		FScopedDirectoryHandle RunRootHandle(INVALID_HANDLE_VALUE);
		FPhysicalDirectoryIdentity RunRootIdentity;
		if (!CreateOwnedPhysicalDirectoryAtomic(
			SandboxHandle.Get(),
			RunRootLeaf,
			RunRootDirectory,
			EOwnedDirectoryCreationKind::RunRoot,
			RunRootHandle,
			RunRootIdentity,
			OutReason,
			OutCleanupFailure))
		{
			return false;
		}
		Entry.RunRootPhysicalIdentity = RunRootIdentity;

		FAssetRegistryModule& RegistryModule =
			FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
		if (!RegistryModule.Get().AddPath(Entry.AfterPath))
		{
			// AddPath is the only editor-side bookkeeping formerly supplied by
			// UEditorAssetLibrary::MakeDirectory.  On failure, release the lease
			// and use the stored create identity for exact handle-targeted cleanup.
			RunRootHandle = FScopedDirectoryHandle(INVALID_HANDLE_VALUE);
			FString CleanupReason;
			if (CleanupOwnedEmptyRunRoot(Entry, CleanupReason))
			{
				Entry.RunRootPhysicalIdentity = {};
				OutReason = TEXT("run_root_registry_registration_failed");
				return false;
			}
			OutReason = CleanupReason;
			OutCleanupFailure = EEffectDirectoryCleanupFailure::Unknown;
			return false;
		}

		// Keep the stable sandbox parent and the exact create handle alive until
		// the forward observation completes.
		OutDirectoryLeases.Add(MoveTemp(SandboxHandle));
		OutDirectoryLeases.Add(MoveTemp(RunRootHandle));
		return true;
	}

	bool OpenOwnedRunRootForEffect(
		const FOperationLedgerEntry& Entry,
		FString& OutReason,
		TArray<FScopedDirectoryHandle>& OutDirectoryLeases)
	{
		const FOperationLedgerEntry* RunRootEntry = FindExecutedRunRootEntry(Entry);
		if (!RunRootEntry || !RunRootEntry->RunRootPhysicalIdentity.bValid)
		{
			OutReason = TEXT("run_root_ownership_evidence_missing");
			return false;
		}

		FString RunRootDirectory;
		if (!ResolveSafeOwnedRunRootDirectory(RunRootEntry->AfterPath, RunRootDirectory, OutReason))
		{
			return false;
		}
		FString SandboxDirectory = FPaths::ConvertRelativePathToFull(
			FPaths::Combine(FPaths::ProjectContentDir(), TEXT("UAgentSandbox")));
		FPaths::NormalizeDirectoryName(SandboxDirectory);

		FScopedDirectoryHandle SandboxHandle(INVALID_HANDLE_VALUE);
		FPhysicalDirectoryIdentity SandboxIdentity;
		if (!OpenPhysicalDirectory(
			SandboxDirectory,
			FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
			FILE_SHARE_READ | FILE_SHARE_WRITE,
			SandboxHandle,
			SandboxIdentity,
			OutReason))
		{
			OutReason = TEXT("sandbox_parent_handle_open_failed");
			return false;
		}

		FScopedDirectoryHandle RunRootHandle(INVALID_HANDLE_VALUE);
		FPhysicalDirectoryIdentity CurrentRunRootIdentity;
		if (!OpenPhysicalDirectoryRelative(
			SandboxHandle.Get(),
			Entry.RunId,
			FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
			FILE_SHARE_READ | FILE_SHARE_WRITE,
			RunRootHandle,
			CurrentRunRootIdentity,
			OutReason))
		{
			OutReason = TEXT("run_root_handle_open_failed");
			return false;
		}
		if (!(CurrentRunRootIdentity == RunRootEntry->RunRootPhysicalIdentity))
		{
			OutReason = TEXT("run_root_physical_identity_mismatch");
			return false;
		}
		OutDirectoryLeases.Add(MoveTemp(SandboxHandle));
		OutDirectoryLeases.Add(MoveTemp(RunRootHandle));
		return true;
	}
#endif

	bool CleanupOwnedEffectDirectories(
		FOperationLedgerEntry& Entry,
		FString& OutReason,
		EEffectDirectoryCleanupFailure& OutFailure);

	bool PrepareOwnedEffectDirectories(
		FOperationLedgerEntry& Entry,
		FString& OutReason,
		EEffectDirectoryCleanupFailure& OutCleanupFailure
#if PLATFORM_WINDOWS
		, TArray<FScopedDirectoryHandle>& OutDirectoryLeases
#endif
	)
	{
		Entry.EffectCreatedDirectoryPaths.Reset();
		Entry.EffectCreatedDirectoryIdentities.Reset();
		OutCleanupFailure = EEffectDirectoryCleanupFailure::None;
#if PLATFORM_WINDOWS
		OutDirectoryLeases.Reset();
#endif
		if (Entry.Operation == UAgentAssetTools::EOperation::CreateFolder)
		{
#if PLATFORM_WINDOWS
			return PrepareOwnedRunRoot(
				Entry,
				OutReason,
				OutCleanupFailure,
				OutDirectoryLeases);
#else
			OutReason = TEXT("run_root_physical_identity_unsupported");
			return false;
#endif
		}
		if (Entry.Operation != UAgentAssetTools::EOperation::Move) return true;

		const FString RunRoot = FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *Entry.RunId);
		const FString TargetDirectory = FPackageName::GetLongPackagePath(Entry.AfterPath);
		if (!TargetDirectory.StartsWith(RunRoot + TEXT("/")))
		{
			OutReason = TEXT("effect_directory_outside_run_root");
			return false;
		}

#if PLATFORM_WINDOWS
		if (!OpenOwnedRunRootForEffect(Entry, OutReason, OutDirectoryLeases)) return false;
#else
		OutReason = TEXT("effect_directory_physical_identity_unsupported");
		return false;
#endif

		TArray<FString> Segments;
		TargetDirectory.RightChop(RunRoot.Len() + 1).ParseIntoArray(Segments, TEXT("/"), true);
		FString CurrentPackagePath = RunRoot;
		bool bMissingAncestor = false;
		auto FailAfterCreatedDirectories = [&](const FString& Reason) -> bool
		{
			const EEffectDirectoryCleanupFailure FailureBeforeCleanup = OutCleanupFailure;
			OutReason = Reason;
			if (Entry.EffectCreatedDirectoryPaths.IsEmpty()) return false;
#if PLATFORM_WINDOWS
			// Release no-share-delete leases before attempting exact cleanup.
			OutDirectoryLeases.Reset();
#endif
			FString CleanupReason;
			if (CleanupOwnedEffectDirectories(Entry, CleanupReason, OutCleanupFailure))
			{
				OutReason = Reason;
				OutCleanupFailure = FailureBeforeCleanup;
			}
			else
			{
				OutReason = CleanupReason;
				if (FailureBeforeCleanup != EEffectDirectoryCleanupFailure::None)
				{
					OutCleanupFailure = FailureBeforeCleanup;
				}
			}
			return false;
		};
		for (const FString& Segment : Segments)
		{
			CurrentPackagePath += TEXT("/") + Segment;
			FString Directory;
			if (!FPackageName::TryConvertLongPackageNameToFilename(CurrentPackagePath, Directory, TEXT("")))
			{
				return FailAfterCreatedDirectories(TEXT("effect_directory_invalid"));
			}
			const bool bPresent = IFileManager::Get().DirectoryExists(*Directory);
			if (bPresent && bMissingAncestor)
			{
				return FailAfterCreatedDirectories(TEXT("effect_directory_topology_invalid"));
			}
			if (!bPresent)
			{
				bMissingAncestor = true;
				FPhysicalDirectoryIdentity Identity;
#if PLATFORM_WINDOWS
				FScopedDirectoryHandle DirectoryLease(INVALID_HANDLE_VALUE);
				if (!CreateOwnedPhysicalDirectoryAtomic(
					OutDirectoryLeases.Last().Get(),
					Segment,
					Directory,
					EOwnedDirectoryCreationKind::EffectDirectory,
					DirectoryLease,
					Identity,
					OutReason,
					OutCleanupFailure))
				{
					return FailAfterCreatedDirectories(OutReason);
				}
#else
				OutReason = TEXT("effect_directory_physical_identity_unsupported");
				return FailAfterCreatedDirectories(OutReason);
#endif
				Entry.EffectCreatedDirectoryPaths.Add(CurrentPackagePath);
				Entry.EffectCreatedDirectoryIdentities.Add(Identity);
#if PLATFORM_WINDOWS
				// Keep every created directory non-replaceable until the asset
				// write and the post-write identity observation have completed.
				OutDirectoryLeases.Add(MoveTemp(DirectoryLease));
#endif
			}
			else
			{
#if PLATFORM_WINDOWS
				FScopedDirectoryHandle DirectoryLease(INVALID_HANDLE_VALUE);
				FPhysicalDirectoryIdentity ExistingIdentity;
				if (!OpenPhysicalDirectoryRelative(
					OutDirectoryLeases.Last().Get(),
					Segment,
					FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
					FILE_SHARE_READ | FILE_SHARE_WRITE,
					DirectoryLease,
					ExistingIdentity,
					OutReason))
				{
					return FailAfterCreatedDirectories(TEXT("effect_directory_existing_handle_open_failed"));
				}
				// Hold existing ancestors too, so every later atomic create stays
				// rooted beneath the same verified physical directory chain.
				OutDirectoryLeases.Add(MoveTemp(DirectoryLease));
#endif
			}
		}
		return true;
	}

	bool VerifyOwnedEffectDirectoryIdentities(const FOperationLedgerEntry& Entry, FString& OutReason)
	{
		if (Entry.EffectCreatedDirectoryPaths.Num() != Entry.EffectCreatedDirectoryIdentities.Num())
		{
			OutReason = TEXT("effect_directory_identity_missing");
			return false;
		}
		for (int32 Index = 0; Index < Entry.EffectCreatedDirectoryPaths.Num(); ++Index)
		{
			FPhysicalDirectoryIdentity CurrentIdentity;
			if (!CaptureOwnedRunRootPhysicalIdentity(
				Entry.EffectCreatedDirectoryPaths[Index],
				CurrentIdentity,
				OutReason)
				|| !(CurrentIdentity == Entry.EffectCreatedDirectoryIdentities[Index]))
			{
				OutReason = TEXT("effect_directory_physical_identity_mismatch");
				return false;
			}
		}
		return true;
	}

	bool CleanupOwnedEffectDirectories(
		FOperationLedgerEntry& Entry,
		FString& OutReason,
		EEffectDirectoryCleanupFailure& OutFailure)
	{
		OutFailure = EEffectDirectoryCleanupFailure::None;
		if (Entry.EffectCreatedDirectoryPaths.Num() != Entry.EffectCreatedDirectoryIdentities.Num())
		{
			OutReason = TEXT("effect_directory_identity_missing");
			OutFailure = EEffectDirectoryCleanupFailure::Terminal;
			return false;
		}
		while (!Entry.EffectCreatedDirectoryPaths.IsEmpty())
		{
			const int32 Index = Entry.EffectCreatedDirectoryPaths.Num() - 1;
			FOperationLedgerEntry DirectoryEntry;
			DirectoryEntry.AfterPath = Entry.EffectCreatedDirectoryPaths[Index];
			DirectoryEntry.RunRootPhysicalIdentity = Entry.EffectCreatedDirectoryIdentities[Index];
			if (!CleanupOwnedEmptyRunRoot(DirectoryEntry, OutReason))
			{
				if (OutReason == TEXT("non_empty_run_root")
					|| OutReason == TEXT("run_root_directory_enumeration_failed"))
				{
					OutFailure = EEffectDirectoryCleanupFailure::Retryable;
				}
				else if (OutReason == TEXT("run_root_cleanup_failed")
					|| OutReason == TEXT("run_root_cleanup_not_observed"))
				{
					OutFailure = EEffectDirectoryCleanupFailure::Unknown;
				}
				else
				{
					OutFailure = EEffectDirectoryCleanupFailure::Terminal;
				}
				return false;
			}
			Entry.EffectCreatedDirectoryPaths.RemoveAt(Index);
			Entry.EffectCreatedDirectoryIdentities.RemoveAt(Index);
		}
		return true;
	}

	bool CaptureOwnedAssetEffect(FOperationLedgerEntry& Entry, const FString& ExpectedPath, FString& OutReason)
	{
		UObject* Asset = FindAsset(ExpectedPath);
		UPackage* Package = Asset ? Asset->GetOutermost() : nullptr;
		if (!Asset || !Package || Package->GetName() != ExpectedPath || !Package->GetPersistentGuid().IsValid())
		{
			OutReason = TEXT("forward_effect_not_observed");
			return false;
		}
		Entry.EffectPackageName = Package->GetName();
		Entry.EffectObjectName = Asset->GetFName().ToString();
		Entry.EffectClassPath = Asset->GetClass() ? Asset->GetClass()->GetPathName() : FString();
		Entry.EffectPackageGuid = Package->GetPersistentGuid().ToString();
		if (Entry.EffectObjectName.IsEmpty() || Entry.EffectClassPath.IsEmpty() || Entry.EffectPackageGuid.IsEmpty())
		{
			OutReason = TEXT("forward_effect_identity_unavailable");
			return false;
		}
		return true;
	}

	bool VerifyOwnedAssetEffect(const FOperationLedgerEntry& Entry, FString& OutReason)
	{
		if (Entry.EffectPackageName.IsEmpty() || Entry.EffectObjectName.IsEmpty() || Entry.EffectClassPath.IsEmpty() || Entry.EffectPackageGuid.IsEmpty())
		{
			OutReason = TEXT("owned_effect_evidence_missing");
			return false;
		}
		UObject* Asset = FindAsset(Entry.AfterPath);
		UPackage* Package = Asset ? Asset->GetOutermost() : nullptr;
		if (!Asset || !Package
			|| Package->GetName() != Entry.EffectPackageName
			|| Asset->GetFName().ToString() != Entry.EffectObjectName
			|| !Asset->GetClass() || Asset->GetClass()->GetPathName() != Entry.EffectClassPath
			|| !Package->GetPersistentGuid().IsValid()
			|| Package->GetPersistentGuid().ToString() != Entry.EffectPackageGuid)
		{
			OutReason = TEXT("owned_effect_observation_mismatch");
			return false;
		}
		return true;
	}

	bool ObserveForwardEffect(FOperationLedgerEntry& Entry, FString& OutReason)
	{
		if (Entry.Operation == UAgentAssetTools::EOperation::CreateFolder)
		{
			FString Directory;
			if (!Entry.RunRootPhysicalIdentity.bValid)
			{
				OutReason = TEXT("run_root_physical_identity_missing");
				return false;
			}
			if (!IsOwnedRunRootPhysicallyEmpty(Entry, Directory, OutReason))
			{
				return false;
			}
#if WITH_DEV_AUTOMATION_TESTS
			if (GAutomationFault == UAgentAssetTools::EAutomationFault::ForwardObservationFailure)
			{
				OutReason = TEXT("automation_forward_observation_failed");
				return false;
			}
#endif
			Entry.bSideEffectObserved = true;
			return true;
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::Duplicate
			|| Entry.Operation == UAgentAssetTools::EOperation::Rename
			|| Entry.Operation == UAgentAssetTools::EOperation::Move)
		{
			if (!CaptureOwnedAssetEffect(Entry, Entry.AfterPath, OutReason)) return false;
			if (!VerifyOwnedEffectDirectoryIdentities(Entry, OutReason)) return false;
			Entry.bSideEffectObserved = true;
			return true;
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::Save)
		{
			UObject* Asset = FindAsset(Entry.BeforePath);
			UPackage* Package = Asset ? Asset->GetOutermost() : nullptr;
			if (!Asset || !Package || Package->IsDirty())
			{
				OutReason = TEXT("save_effect_not_observed");
				return false;
			}
			Entry.bSideEffectObserved = true;
			return true;
		}
		OutReason = TEXT("forward_delete_forbidden");
		return false;
	}

	bool ObserveRollbackSettled(const FOperationLedgerEntry& Entry)
	{
		if (Entry.Operation == UAgentAssetTools::EOperation::CreateFolder)
		{
			FString Directory;
			return FPackageName::TryConvertLongPackageNameToFilename(Entry.AfterPath, Directory, TEXT(""))
				&& !IFileManager::Get().DirectoryExists(*Directory);
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::Duplicate) return FindAsset(Entry.AfterPath) == nullptr;
		if (Entry.Operation == UAgentAssetTools::EOperation::Rename || Entry.Operation == UAgentAssetTools::EOperation::Move)
		{
			UObject* Restored = FindAsset(Entry.BeforePath);
			UPackage* Package = Restored ? Restored->GetOutermost() : nullptr;
			const FString ExpectedObjectName = FPackageName::GetLongPackageAssetName(Entry.BeforePath);
			return FindAsset(Entry.AfterPath) == nullptr && Package && Package->GetName() == Entry.BeforePath
				&& Restored->GetFName().ToString() == ExpectedObjectName
				&& Restored->GetClass() && Restored->GetClass()->GetPathName() == Entry.EffectClassPath
				&& Package->GetPersistentGuid().IsValid();
		}
		return false;
	}

	bool RefreshPredecessorOwnedEffectAfterRollback(const FOperationLedgerEntry& Entry, FString& OutReason)
	{
		if (Entry.Operation != UAgentAssetTools::EOperation::Rename && Entry.Operation != UAgentAssetTools::EOperation::Move)
		{
			return true;
		}
		const TArray<FString>* OrderedKeys = GRunLedgerOrder.Find(Entry.Scope);
		const int32 EntryIndex = OrderedKeys ? OrderedKeys->Find(Entry.Key) : INDEX_NONE;
		if (EntryIndex <= 0)
		{
			OutReason = TEXT("rollback_predecessor_missing");
			return false;
		}
		FOperationLedgerEntry* Previous = GOperationLedger.Find((*OrderedKeys)[EntryIndex - 1]);
		if (!Previous
			|| (Previous->Operation != UAgentAssetTools::EOperation::Duplicate
				&& Previous->Operation != UAgentAssetTools::EOperation::Rename
				&& Previous->Operation != UAgentAssetTools::EOperation::Move)
			|| Previous->AfterPath != Entry.BeforePath)
		{
			OutReason = TEXT("rollback_predecessor_identity_invalid");
			return false;
		}
		// A package rename can legitimately issue a new persistent GUID.  The
		// current entry was verified against its exact owned effect before the
		// inverse write; after settlement, bind the predecessor to the restored
		// package identity so the next reverse operation verifies current facts.
		if (!CaptureOwnedAssetEffect(*Previous, Entry.BeforePath, OutReason))
		{
			OutReason = TEXT("rollback_predecessor_identity_refresh_failed");
			return false;
		}
		return true;
	}

	bool SplitAssetPath(const FString& AssetPath, FString& OutPackagePath, FString& OutAssetName)
	{
		return AssetPath.Split(TEXT("/"), &OutPackagePath, &OutAssetName, ESearchCase::IgnoreCase, ESearchDir::FromEnd)
			&& OutPackagePath.StartsWith(TEXT("/Game/UAgentSandbox/"))
			&& !OutAssetName.IsEmpty();
	}

	bool ApplyForwardAssetOperation(UAgentAssetTools::EOperation Operation, const TSharedPtr<FJsonObject>& Params, FString& OutReason)
	{
		if (!IsInGameThread()) { OutReason = TEXT("game_thread_required"); return false; }
		FAssetToolsModule& AssetToolsModule = FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools"));
		IAssetTools& AssetTools = AssetToolsModule.Get();
		const FString AssetPath = PathFromParams(Params, TEXT("assetPath"));
		const FString TargetPath = PathFromParams(Params, TEXT("targetAssetPath"));
		if (Operation == UAgentAssetTools::EOperation::CreateFolder)
		{
			const FString FolderPath = PathFromParams(Params, TEXT("folderPath"));
			FString Parent;
			FString Name;
			if (!FolderPath.Split(TEXT("/"), &Parent, &Name, ESearchCase::IgnoreCase, ESearchDir::FromEnd)) { OutReason = TEXT("folder_path_invalid"); return false; }
			// The directory and its physical ownership identity are acquired
			// atomically in PrepareOwnedEffectDirectories before this dispatcher.
			// This branch retains only the executor/fault semantics.
#if WITH_DEV_AUTOMATION_TESTS
			if (GAutomationFault == UAgentAssetTools::EAutomationFault::ForwardReportedFailureAfterEffect)
			{
				OutReason = TEXT("automation_forward_reported_failure");
				return false;
			}
#endif
			return true;
		}
		if (Operation == UAgentAssetTools::EOperation::Duplicate)
		{
			UObject* Source = FindAsset(PathFromParams(Params, TEXT("sourceAssetPath")));
			FString PackagePath;
			FString AssetName;
			if (!Source || !SplitAssetPath(TargetPath, PackagePath, AssetName)) { OutReason = TEXT("duplicate_precondition_failed"); return false; }
			return IsValid(AssetTools.DuplicateAsset(AssetName, PackagePath, Source)) ? true : (OutReason = TEXT("duplicate_failed"), false);
		}
		if (Operation == UAgentAssetTools::EOperation::Delete)
		{
		OutReason = TEXT("forward_delete_forbidden");
		return false;
		}
		if (Operation == UAgentAssetTools::EOperation::Save)
		{
			UObject* Asset = FindAsset(AssetPath);
			if (!Asset || !Asset->GetOutermost()) { OutReason = TEXT("save_precondition_failed"); return false; }
			TArray<UPackage*> Packages;
			Packages.Add(Asset->GetOutermost());
			return UEditorLoadingAndSavingUtils::SavePackages(Packages, false) ? true : (OutReason = TEXT("single_package_save_failed"), false);
		}
		UObject* Asset = FindAsset(AssetPath);
		FString PackagePath;
		FString AssetName;
		if (!Asset || !SplitAssetPath(TargetPath, PackagePath, AssetName)) { OutReason = TEXT("rename_or_move_precondition_failed"); return false; }
		TArray<FAssetRenameData> RenameData;
		RenameData.Emplace(Asset, PackagePath, AssetName);
		return AssetTools.RenameAssets(RenameData) ? true : (OutReason = TEXT("rename_or_move_failed"), false);
	}

	bool ApplyOwnedRollbackOperation(const FOperationLedgerEntry& Entry, FString& OutReason)
	{
		if (!IsInGameThread()) { OutReason = TEXT("game_thread_required"); return false; }
		if (Entry.Operation == UAgentAssetTools::EOperation::CreateFolder)
		{
			return CleanupOwnedEmptyRunRoot(Entry, OutReason);
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::Duplicate)
		{
			if (!VerifyOwnedAssetEffect(Entry, OutReason)) return false;
			return UEditorAssetLibrary::DeleteAsset(Entry.AfterPath) ? true : (OutReason = TEXT("duplicate_rollback_delete_failed"), false);
		}
		if (Entry.Operation == UAgentAssetTools::EOperation::Rename || Entry.Operation == UAgentAssetTools::EOperation::Move)
		{
			if (!VerifyOwnedAssetEffect(Entry, OutReason)) return false;
			if (!VerifyOwnedEffectDirectoryIdentities(Entry, OutReason)) return false;
			if (FindAsset(Entry.BeforePath) != nullptr) { OutReason = TEXT("rollback_restore_target_present"); return false; }
			FString PackagePath;
			FString AssetName;
			if (!SplitAssetPath(Entry.BeforePath, PackagePath, AssetName)) { OutReason = TEXT("rollback_restore_path_invalid"); return false; }
			UObject* Asset = FindAsset(Entry.AfterPath);
			if (!Asset) { OutReason = TEXT("owned_effect_observation_mismatch"); return false; }
			FAssetToolsModule& AssetToolsModule = FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools"));
			TArray<FAssetRenameData> RenameData;
			RenameData.Emplace(Asset, PackagePath, AssetName);
			return AssetToolsModule.Get().RenameAssets(RenameData) ? true : (OutReason = TEXT("rollback_rename_or_move_failed"), false);
		}
		OutReason = TEXT("rollback_not_available");
		return false;
	}
}

FUAgentAssetTool::FUAgentAssetTool(UAgentAssetTools::EOperation InOperation, TSharedPtr<FJsonObject> InIdentity)
	: Operation(InOperation), Identity(MoveTemp(InIdentity))
{
}

FString FUAgentAssetTool::GetName() const
{
	return UAgentAssetTools::GetToolName(Operation);
}

FString FUAgentAssetTool::GetDescription() const
{
	return FString::Printf(TEXT("UAgent companion exact asset operation %s; sandbox-only, explicit dry-run and native approval required."), *UAgentAssetTools::GetOperationName(Operation));
}

TSharedPtr<FJsonObject> FUAgentAssetTool::GetInputJsonSchema() const
{
	return UAgentAssetTools::BuildInputSchema(Operation);
}

TSharedPtr<FJsonObject> FUAgentAssetTool::GetOutputJsonSchema() const
{
	return UAgentAssetTools::BuildOutputSchema(Operation, Identity);
}

FModelContextProtocolToolResult FUAgentAssetTool::Run(const TSharedPtr<FJsonObject>& Params)
{
	// This lock deliberately covers validation, plan admission, execution and cleanup.
	// It prevents a second call from observing a half-updated ledger or replaying an
	// approval while a game-thread AssetTools call is in progress.
	FScopeLock Lock(&GOperationMutex);
	const bool bDryRun = BoolFromParams(Params, TEXT("dryRun"));
	const bool bRollback = BoolFromParams(Params, TEXT("rollback"));
	const FString ProvidedDryRunHash = PathFromParams(Params, TEXT("dryRunHash"));
	const UAgentAssetTools::FValidationResult Validation = UAgentAssetTools::ValidateArguments(Operation, Params);
	const FString OperationName = UAgentAssetTools::GetOperationName(Operation);
	const FString ToolName = UAgentAssetTools::GetToolName(Operation);
	const FString CalculatedDryRunHash = UAgentAssetTools::ComputeDryRunHash(Params);
	// Inverse calls carry the accepted forward hash.  Their canonical arguments are
	// intentionally different, so using CalculatedDryRunHash here would reject every
	// valid inverse before the ledger can compare its exact stored before/after pair.
	const FString ResultDryRunHash = bRollback ? ProvidedDryRunHash : CalculatedDryRunHash;
	const FString ProvisionalEvidenceId = FString::Printf(TEXT("uagent-asset-evidence-%s"), *ResultDryRunHash.Left(16));
	if (!Validation.bValid)
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), Validation.Reason, false, false, ProvisionalEvidenceId, ResultDryRunHash);
	}
	const FString CurrentIdentity = IdentityFingerprint(Identity);
	if (CurrentIdentity.IsEmpty())
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("identity_unavailable"), false, false, ProvisionalEvidenceId, ResultDryRunHash);
	}
	if (bDryRun && !ProvidedDryRunHash.IsEmpty())
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("dry_run_hash_forbidden"), false, false, ProvisionalEvidenceId, ResultDryRunHash);
	}
	const FString Scope = LedgerScope(Params);
	const FString Key = LedgerKey(Params);
	if (bDryRun)
	{
		if (const FOperationLedgerEntry* Existing = GOperationLedger.Find(Key))
		{
			if (Existing->IdentityFingerprint != CurrentIdentity || Existing->Operation != Operation || Existing->DryRunHash != CalculatedDryRunHash || Existing->State != ELedgerState::DryRunAccepted)
			{
				return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("dry_run_replay_or_stale"), false, false, ProvisionalEvidenceId, CalculatedDryRunHash);
			}
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("dry_run_completed"), TEXT("none"), false, Existing->bRollbackAvailable, Existing->EvidenceId, Existing->DryRunHash, Existing);
		}
		FString PreconditionsReason;
		if (!CheckDryRunPreconditions(Operation, Params, Validation, PreconditionsReason))
		{
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), PreconditionsReason, false, false, ProvisionalEvidenceId, CalculatedDryRunHash);
		}
		FString BeforePath;
		FString AfterPath;
		ResolveOperationPaths(Operation, Params, BeforePath, AfterPath);
		FOperationLedgerEntry Entry;
		Entry.Scope = Scope;
		Entry.Key = Key;
		Entry.ChangeSetId = PathFromParams(Params, TEXT("changeSetId"));
		Entry.RunId = PathFromParams(Params, TEXT("runId"));
		Entry.OperationId = PathFromParams(Params, TEXT("operationId"));
		Entry.DryRunHash = CalculatedDryRunHash;
		Entry.LedgerCreatedAt = FDateTime::UtcNow().ToIso8601();
		Entry.IdentityFingerprint = CurrentIdentity;
		Identity->TryGetStringField(TEXT("pluginId"), Entry.PluginId);
		Identity->TryGetStringField(TEXT("pluginVersion"), Entry.PluginVersion);
		Identity->TryGetStringField(TEXT("contractVersion"), Entry.ContractVersion);
		Identity->TryGetStringField(TEXT("sourceCommit"), Entry.SourceCommit);
		Identity->TryGetStringField(TEXT("sourceTreeSha256"), Entry.SourceTreeSha256);
		Identity->TryGetStringField(TEXT("buildManifestSha256"), Entry.BuildManifestSha256);
		Identity->TryGetStringField(TEXT("loadedModuleName"), Entry.LoadedModuleName);
		Identity->TryGetStringField(TEXT("loadedModuleSha256"), Entry.LoadedModuleSha256);
		Entry.ForwardToolName = ToolName;
		Entry.EvidenceId = ProvisionalEvidenceId;
		Entry.Operation = Operation;
		Entry.BeforePath = BeforePath;
		Entry.AfterPath = AfterPath;
		Entry.bRollbackAvailable = UAgentAssetTools::GetRollbackAction(Operation) != TEXT("none");
		GOperationLedger.Add(Key, MoveTemp(Entry));
		GRunLedgerOrder.FindOrAdd(Scope).Add(Key);
		const FOperationLedgerEntry* StoredEntry = GOperationLedger.Find(Key);
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("dry_run_completed"), TEXT("none"), false, StoredEntry && StoredEntry->bRollbackAvailable, StoredEntry ? StoredEntry->EvidenceId : ProvisionalEvidenceId, StoredEntry ? StoredEntry->DryRunHash : CalculatedDryRunHash, StoredEntry);
	}
	FOperationLedgerEntry* Entry = GOperationLedger.Find(Key);
	if (!Entry)
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("accepted_dry_run_missing"), false, false, ProvisionalEvidenceId, ResultDryRunHash);
	}
	if (Entry->IdentityFingerprint != CurrentIdentity || Entry->DryRunHash != ProvidedDryRunHash)
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("accepted_plan_identity_mismatch"), false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
	}
	if (bRollback)
	{
		FString InverseReason;
		if (!HasExactRollbackArguments(*Entry, Operation, Params, InverseReason)) return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), InverseReason, false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
		if (Entry->State == ELedgerState::RolledBack)
		{
			FString ReplayAuthorityReason;
			if (!VerifyStoredNativeAuthorityFacts(*Entry, Params, true, ReplayAuthorityReason))
			{
				return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), ReplayAuthorityReason, false, false, Entry->EvidenceId, Entry->DryRunHash, Entry, false);
			}
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("rolled_back"), TEXT("already_rolled_back"), false, false, Entry->EvidenceId, Entry->DryRunHash, Entry, false);
		}
		if (!Entry->bRollbackAvailable) return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("rollback_not_available"), false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
		if ((Entry->State != ELedgerState::Executed
				&& Entry->State != ELedgerState::PartialFailure
				&& Entry->State != ELedgerState::RollbackCleanupPending)
			|| !IsNextRollback(*Entry))
		{
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("rollback_order_or_ownership_invalid"), false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
		}
		FString AcceptedPlanBindingReason;
		if (!VerifyAndBindNativeAuthority(*Entry, Params, true, AcceptedPlanBindingReason)) return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), AcceptedPlanBindingReason, false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
		auto MakeDirectoryCleanupFailureResult = [&](const FString& CleanupReason, EEffectDirectoryCleanupFailure Failure)
		{
			if (Failure == EEffectDirectoryCleanupFailure::Retryable)
			{
				Entry->State = ELedgerState::RollbackCleanupPending;
				Entry->bRollbackAvailable = true;
				return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), CleanupReason, true, true, Entry->EvidenceId, Entry->DryRunHash, Entry);
			}
			Entry->State = ELedgerState::PartialFailure;
			Entry->bRollbackAvailable = false;
			if (Failure == EEffectDirectoryCleanupFailure::Unknown)
			{
				return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), CleanupReason, true, false, Entry->EvidenceId, Entry->DryRunHash, Entry, true, EEffectState::Unknown);
			}
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), CleanupReason, true, false, Entry->EvidenceId, Entry->DryRunHash, Entry, true, EEffectState::KnownPartial);
		};
		if (Entry->State == ELedgerState::RollbackCleanupPending)
		{
			FString DirectoryCleanupReason;
			EEffectDirectoryCleanupFailure CleanupFailure;
			if (!CleanupOwnedEffectDirectories(*Entry, DirectoryCleanupReason, CleanupFailure))
			{
				return MakeDirectoryCleanupFailureResult(DirectoryCleanupReason, CleanupFailure);
			}
			FString RefreshReason;
			if (!RefreshPredecessorOwnedEffectAfterRollback(*Entry, RefreshReason))
			{
				Entry->State = ELedgerState::PartialFailure;
				Entry->bRollbackAvailable = false;
				return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), RefreshReason, true, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
			}
			Entry->State = ELedgerState::RolledBack;
			Entry->bRollbackAvailable = false;
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("rolled_back"), TEXT("none"), true, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
		}
		FString RollbackReason;
		if (!ApplyOwnedRollbackOperation(*Entry, RollbackReason))
		{
			if (ObserveRollbackSettled(*Entry))
			{
				FString DirectoryCleanupReason;
				EEffectDirectoryCleanupFailure CleanupFailure;
				if (!CleanupOwnedEffectDirectories(*Entry, DirectoryCleanupReason, CleanupFailure))
				{
					return MakeDirectoryCleanupFailureResult(DirectoryCleanupReason, CleanupFailure);
				}
				FString RefreshReason;
				if (!RefreshPredecessorOwnedEffectAfterRollback(*Entry, RefreshReason))
				{
					Entry->State = ELedgerState::PartialFailure;
					Entry->bRollbackAvailable = false;
					return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), RefreshReason, true, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
				}
				Entry->State = ELedgerState::RolledBack;
				Entry->bRollbackAvailable = false;
				return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), RollbackReason.IsEmpty() ? TEXT("rollback_reported_failure_but_settled") : RollbackReason, true, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
			}
			// The rollback was attempted but neither its result nor the asset
			// observation is trustworthy.  Do not leave the prior authority in a
			// retryable state that could turn an unknown effect into a second write.
			Entry->State = ELedgerState::PartialFailure;
			Entry->bRollbackAvailable = false;
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), RollbackReason.IsEmpty() ? TEXT("rollback_operation_failed") : RollbackReason, false, Entry->bRollbackAvailable, Entry->EvidenceId, Entry->DryRunHash, Entry, true, EEffectState::Unknown);
		}
		if (!ObserveRollbackSettled(*Entry))
		{
			Entry->State = ELedgerState::PartialFailure;
			Entry->bRollbackAvailable = false;
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), TEXT("rollback_effect_not_observed"), false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
		}
		FString DirectoryCleanupReason;
		EEffectDirectoryCleanupFailure CleanupFailure;
		if (!CleanupOwnedEffectDirectories(*Entry, DirectoryCleanupReason, CleanupFailure))
		{
			return MakeDirectoryCleanupFailureResult(DirectoryCleanupReason, CleanupFailure);
		}
		FString RefreshReason;
		if (!RefreshPredecessorOwnedEffectAfterRollback(*Entry, RefreshReason))
		{
			Entry->State = ELedgerState::PartialFailure;
			Entry->bRollbackAvailable = false;
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), RefreshReason, true, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
		}
		Entry->State = ELedgerState::RolledBack;
		Entry->bRollbackAvailable = false;
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("rolled_back"), TEXT("none"), true, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
	}
	if (Entry->Operation != Operation || Entry->ForwardToolName != ToolName || !HasExactForwardArguments(*Entry, Params))
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("accepted_plan_arguments_mismatch"), false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
	}
	if (Entry->State != ELedgerState::DryRunAccepted || !IsNextExecution(*Entry))
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), TEXT("execute_order_or_replay_invalid"), false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
	}
	FString PreconditionsReason;
	if (!CheckForwardExecutePreconditions(*Entry, Validation, PreconditionsReason))
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), PreconditionsReason, false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
	}
	FString AcceptedPlanBindingReason;
	if (!VerifyAndBindNativeAuthority(*Entry, Params, false, AcceptedPlanBindingReason))
	{
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), AcceptedPlanBindingReason, false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
	}
	FString EffectDirectoryReason;
	EEffectDirectoryCleanupFailure PrepareCleanupFailure;
#if PLATFORM_WINDOWS
	TArray<FScopedDirectoryHandle> EffectDirectoryLeases;
#endif
	if (!PrepareOwnedEffectDirectories(
		*Entry,
		EffectDirectoryReason,
		PrepareCleanupFailure
#if PLATFORM_WINDOWS
		, EffectDirectoryLeases
#endif
	))
	{
		if (PrepareCleanupFailure == EEffectDirectoryCleanupFailure::Retryable)
		{
			Entry->State = ELedgerState::RollbackCleanupPending;
			Entry->bRollbackAvailable = true;
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), EffectDirectoryReason, true, true, Entry->EvidenceId, Entry->DryRunHash, Entry);
		}
		if (PrepareCleanupFailure != EEffectDirectoryCleanupFailure::None)
		{
			Entry->State = ELedgerState::PartialFailure;
			Entry->bRollbackAvailable = false;
			const bool bUnknown = PrepareCleanupFailure == EEffectDirectoryCleanupFailure::Unknown;
			return MakeStructuredResult(
				ToolName,
				OperationName,
				Params,
				Validation,
				bUnknown,
				bUnknown ? TEXT("blocked") : TEXT("partial_failure"),
				EffectDirectoryReason,
				true,
				false,
				Entry->EvidenceId,
				Entry->DryRunHash,
				Entry,
				true,
				bUnknown ? EEffectState::Unknown : EEffectState::KnownPartial);
		}
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), EffectDirectoryReason, false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
	}
	FString Reason;
	if (!ApplyForwardAssetOperation(Operation, Params, Reason))
	{
		FString ObservationReason;
		if (ObserveForwardEffect(*Entry, ObservationReason))
		{
			Entry->State = ELedgerState::PartialFailure;
			return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), Reason.IsEmpty() ? TEXT("forward_operation_reported_failure") : Reason, true, Entry->bRollbackAvailable, Entry->EvidenceId, Entry->DryRunHash, Entry);
		}
		// A failed executor result plus an inconclusive observation is an unknown
		// effect, not a safe no-op.  Retire this plan so neither replay nor ledger
		// rollback can make an ownership assumption about the target.
		Entry->State = ELedgerState::PartialFailure;
		Entry->bRollbackAvailable = false;
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, true, TEXT("blocked"), Reason.IsEmpty() ? (ObservationReason.IsEmpty() ? TEXT("operation_failed") : ObservationReason) : Reason, false, false, Entry->EvidenceId, Entry->DryRunHash, Entry, true, EEffectState::Unknown);
	}
	FString ObservationReason;
	if (!ObserveForwardEffect(*Entry, ObservationReason))
	{
		Entry->State = ELedgerState::PartialFailure;
		Entry->bRollbackAvailable = false;
		return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("partial_failure"), ObservationReason.IsEmpty() ? TEXT("forward_effect_not_observed") : ObservationReason, false, false, Entry->EvidenceId, Entry->DryRunHash, Entry);
	}
	Entry->State = ELedgerState::Executed;
	return MakeStructuredResult(ToolName, OperationName, Params, Validation, false, TEXT("executed"), TEXT("none"), true, Entry->bRollbackAvailable, Entry->EvidenceId, Entry->DryRunHash, Entry);
}

void UAgentAssetTools::InvalidateOperationLedger()
{
	FScopeLock Lock(&GOperationMutex);
	GOperationLedger.Reset();
	GRunLedgerOrder.Reset();
	GRunAuthorityLedger.Reset();
}

#if WITH_DEV_AUTOMATION_TESTS
bool UAgentAssetTools::IsUsablePhysicalFileIdForAutomation(const TArray<uint8>& FileId)
{
	return HasUsablePhysicalFileId(FileId.GetData(), FileId.Num());
}

void UAgentAssetTools::SetAutomationFault(EAutomationFault Fault)
{
	FScopeLock Lock(&GOperationMutex);
	GAutomationFault = Fault;
}

TSharedPtr<FJsonObject> UAgentAssetTools::GetOperationLedgerSnapshot(
	const FString& ChangeSetId,
	const FString& RunId,
	const FString& OperationId)
{
	FScopeLock Lock(&GOperationMutex);
	const FString Key = ChangeSetId + TEXT("|") + RunId + TEXT("|") + OperationId;
	const FOperationLedgerEntry* Entry = GOperationLedger.Find(Key);
	if (!Entry) return nullptr;

	TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetStringField(TEXT("createdAt"), Entry->LedgerCreatedAt);
	Result->SetStringField(TEXT("acceptedPlanBinding"), Entry->AcceptedPlanBinding);
	Result->SetStringField(TEXT("nativeRegistrationId"), Entry->NativeRegistrationId);
	Result->SetStringField(TEXT("nativePhase"), Entry->LastNativePhase);
	Result->SetNumberField(TEXT("nativeOperationIndex"), Entry->NativeOperationIndex);
	Result->SetNumberField(TEXT("nativeOperationCount"), Entry->NativeOperationCount);
	Result->SetNumberField(TEXT("nativeCreatedAt"), static_cast<double>(Entry->NativeCreatedAt));
	Result->SetNumberField(TEXT("connectionGeneration"), Entry->ConnectionGeneration);
	Result->SetNumberField(TEXT("sessionGeneration"), Entry->SessionGeneration);
	Result->SetStringField(TEXT("nativeSourceIdentity"), Entry->NativeSourceIdentity);
	Result->SetStringField(TEXT("nativeManifestIdentity"), Entry->NativeManifestIdentity);
	Result->SetStringField(TEXT("nativePluginIdentity"), Entry->NativePluginIdentity);
	Result->SetStringField(TEXT("nativePackageIdentity"), Entry->NativePackageIdentity);
	Result->SetStringField(TEXT("pluginId"), Entry->PluginId);
	Result->SetStringField(TEXT("pluginVersion"), Entry->PluginVersion);
	Result->SetStringField(TEXT("contractVersion"), Entry->ContractVersion);
	Result->SetStringField(TEXT("sourceCommit"), Entry->SourceCommit);
	Result->SetStringField(TEXT("sourceTreeSha256"), Entry->SourceTreeSha256);
	Result->SetStringField(TEXT("buildManifestSha256"), Entry->BuildManifestSha256);
	Result->SetStringField(TEXT("loadedModuleName"), Entry->LoadedModuleName);
	Result->SetStringField(TEXT("loadedModuleSha256"), Entry->LoadedModuleSha256);
	Result->SetStringField(TEXT("effectPackageName"), Entry->EffectPackageName);
	Result->SetStringField(TEXT("effectObjectName"), Entry->EffectObjectName);
	Result->SetStringField(TEXT("effectClassPath"), Entry->EffectClassPath);
	Result->SetStringField(TEXT("effectPackageGuid"), Entry->EffectPackageGuid);
	Result->SetBoolField(TEXT("sideEffectObserved"), Entry->bSideEffectObserved);
	Result->SetBoolField(TEXT("runRootPhysicalIdentityCaptured"), Entry->RunRootPhysicalIdentity.bValid);
	Result->SetNumberField(TEXT("effectCreatedDirectoryCount"), Entry->EffectCreatedDirectoryPaths.Num());
	Result->SetNumberField(TEXT("effectCreatedDirectoryIdentityCount"), Entry->EffectCreatedDirectoryIdentities.Num());
	if (Entry->RunRootPhysicalIdentity.bValid)
	{
		Result->SetStringField(
			TEXT("runRootVolumeSerial"),
			FString::Printf(TEXT("%016llx"), static_cast<unsigned long long>(Entry->RunRootPhysicalIdentity.VolumeSerialNumber)));
		Result->SetStringField(
			TEXT("runRootFileId128"),
			BytesToHex(Entry->RunRootPhysicalIdentity.FileId, UE_ARRAY_COUNT(Entry->RunRootPhysicalIdentity.FileId)).ToLower());
	}
	return Result;
}
#endif
