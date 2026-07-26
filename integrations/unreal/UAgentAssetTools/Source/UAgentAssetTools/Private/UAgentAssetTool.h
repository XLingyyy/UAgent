#pragma once

#include "IModelContextProtocolTool.h"
#include "UAgentAssetToolsContract.h"

// This remains a private implementation type.  The module export is solely so
// the companion's separate Automation-test module can exercise rejected and
// dry-run calls without making an editor asset mutation.
class UAGENTASSETTOOLS_API FUAgentAssetTool final : public IModelContextProtocolTool
{
public:
	FUAgentAssetTool(UAgentAssetTools::EOperation InOperation, TSharedPtr<FJsonObject> InIdentity);

	virtual FString GetName() const override;
	virtual FString GetDescription() const override;
	virtual TSharedPtr<FJsonObject> GetInputJsonSchema() const override;
	virtual TSharedPtr<FJsonObject> GetOutputJsonSchema() const override;
	virtual FModelContextProtocolToolResult Run(const TSharedPtr<FJsonObject>& Params) override;

private:
	UAgentAssetTools::EOperation Operation;
	TSharedPtr<FJsonObject> Identity;
};

#if WITH_DEV_AUTOMATION_TESTS
namespace UAgentAssetTools
{
	/** Test-only coverage for the fail-closed Windows FILE_ID_128 admission rule. */
	UAGENTASSETTOOLS_API bool IsUsablePhysicalFileIdForAutomation(const TArray<uint8>& FileId);
}
#endif
