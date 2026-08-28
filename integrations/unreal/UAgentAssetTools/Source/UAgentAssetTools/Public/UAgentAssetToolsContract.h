#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

namespace UAgentAssetTools
{
	static constexpr const TCHAR* IdentitySchemaVersion = TEXT("uagent.ue-companion-plugin.identity.v2");
	static constexpr const TCHAR* ManifestSchemaVersion = TEXT("uagent.ue-companion-plugin.build-manifest.v3");
	static constexpr const TCHAR* PluginId = TEXT("UAgentAssetTools");
	static constexpr const TCHAR* PluginVersion = TEXT("0.1.0");
	static constexpr const TCHAR* ContractVersion = TEXT("mvp15d.asset-tools.v1");
	static constexpr const TCHAR* EngineVersion = TEXT("5.8.1");
	static constexpr int32 EngineChangelist = 56057345;
	static constexpr int32 CompatibleChangelist = 55116800;
	static constexpr const TCHAR* ModuleBuildId = TEXT("55116800");
	static constexpr const TCHAR* DryRunSchemaVersion = TEXT("mvp15c.dry-run.v1");
	static constexpr const TCHAR* AutomationReportSchemaVersion = TEXT("uagent.mvp15d.ue-automation-report.v1");
	static constexpr const TCHAR* AutomationTaskIdArgument = TEXT("-UAgentTaskId=");
	static constexpr const TCHAR* AutomationTaskGenerationArgument = TEXT("-UAgentTaskGeneration=");
	static constexpr const TCHAR* AutomationSourceCommitArgument = TEXT("-UAgentSourceCommit=");
	static constexpr const TCHAR* AutomationTaskMarkerArgument = TEXT("-UAgentTaskMarker=");
	static constexpr const TCHAR* AutomationSessionArgument = TEXT("-UAgentSession=");
	static constexpr const TCHAR* AutomationGenerationArgument = TEXT("-UAgentGeneration=");

	enum class EOperation : uint8
	{
		CreateFolder,
		Duplicate,
		Rename,
		Move,
		Delete,
		Save,
	};

	struct FValidationResult
	{
		bool bValid = false;
		FString Reason;
		FString RunRoot;
	};

	UAGENTASSETTOOLS_API FString GetToolName(EOperation Operation);
	UAGENTASSETTOOLS_API FString GetOperationName(EOperation Operation);
	UAGENTASSETTOOLS_API FString GetRollbackAction(EOperation Operation);
	UAGENTASSETTOOLS_API bool IsExactToolName(const FString& ToolName);
	UAGENTASSETTOOLS_API bool IsCanonicalGamePath(const FString& Path);
	UAGENTASSETTOOLS_API bool IsStrictSandboxDescendant(const FString& Path, const FString& RunRoot);
	UAGENTASSETTOOLS_API FValidationResult ValidateArguments(EOperation Operation, const TSharedPtr<FJsonObject>& Params);
	UAGENTASSETTOOLS_API FString ComputeDryRunHash(const TSharedPtr<FJsonObject>& Params);
	/** Retracts task/run plan authority on module refresh, reconnect, or shutdown. */
	UAGENTASSETTOOLS_API void InvalidateOperationLedger();
	UAGENTASSETTOOLS_API TSharedPtr<FJsonObject> BuildInputSchema(EOperation Operation);
	UAGENTASSETTOOLS_API TSharedPtr<FJsonObject> BuildOutputSchema(EOperation Operation, const TSharedPtr<FJsonObject>& Identity);

#if WITH_DEV_AUTOMATION_TESTS
	enum class EAutomationFault : uint8
	{
		None,
		ForwardReportedFailureAfterEffect,
		ForwardObservationFailure,
		RunRootEnumerationFailure,
		RunRootCreateToIdentityReplacement,
		EffectDirectoryCreateToIdentityReplacement,
	};

	/** Task-only deterministic fault control; production builds contain no fault route. */
	UAGENTASSETTOOLS_API void SetAutomationFault(EAutomationFault Fault);
	/** Seeds the UE 5.8 stale destination mapping reproduced by the live rollback regression. */
	UAGENTASSETTOOLS_API bool SeedStaleAssetDataDestinationForAutomation(const FString& AssetPath);
	/** Read-only inspection of the actual operation ledger used by Automation assertions. */
	UAGENTASSETTOOLS_API TSharedPtr<FJsonObject> GetOperationLedgerSnapshot(
		const FString& ChangeSetId,
		const FString& RunId,
		const FString& OperationId);
#endif
}
