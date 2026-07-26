#pragma once

#include "CoreMinimal.h"
#include "ToolsetRegistry/ToolsetDefinition.h"

#include "UAgentAssetToolsD0Toolset.generated.h"

/**
 * A task-only, mutation-incapable Toolset Registry spike.  It is registered
 * only when -UAgentMvp15D0Probe -UAgentMvp15D0Route=toolset_registry is set.
 */
UCLASS(Blueprintable, Hidden)
class UAGENTASSETTOOLS_API UUAgentAssetToolsD0Toolset final : public UToolsetDefinition
{
	GENERATED_BODY()

public:
	/** Returns a parseable route/generation no-op acknowledgement and never opens or edits an asset. */
	UFUNCTION(meta = (AICallable), Category = "UAgentMvp15D0")
	static FString Probe();

	virtual FString GetToolsetVersion() const override;
};
