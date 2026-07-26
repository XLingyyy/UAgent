#pragma once

#include "Dom/JsonObject.h"
#include "IModelContextProtocolTool.h"
#include "Modules/ModuleManager.h"

class IModelContextProtocolModule;

class UAGENTASSETTOOLS_API FUAgentAssetToolsModule final : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

#if WITH_DEV_AUTOMATION_TESTS
	/**
	 * Runs an explicit package candidate through the same manifest/module
	 * attestation boundary used by production registration.
	 */
	static TSharedPtr<FJsonObject> LoadBuildIdentityCandidate(
		const FString& PluginRoot,
		const FString& ManifestPath,
		const FString& LoadedModulePath);
	static TArray<TSharedRef<IModelContextProtocolTool>> BuildCandidateToolsForAutomation(
		const FString& PluginRoot,
		const FString& ManifestPath,
		const FString& LoadedModulePath);
#endif

private:
	void ConfigureD0ProbeFromCommandLine();
	void RestoreD0ProbeSettings();
	void RegisterTools();
	void UnregisterTools(IModelContextProtocolModule& ModelContextProtocol);
	void OnPostEngineInit();
	void OnRefreshTools();
	TSharedPtr<FJsonObject> LoadBuildIdentity() const;
	static TSharedPtr<FJsonObject> LoadBuildIdentityCandidateInternal(
		const FString& PluginRoot,
		const FString& ManifestPath,
		const FString& LoadedModulePath);

	TArray<TSharedRef<IModelContextProtocolTool>> RegisteredTools;
	FDelegateHandle PostEngineInitHandle;
	FDelegateHandle RefreshToolsHandle;
};
