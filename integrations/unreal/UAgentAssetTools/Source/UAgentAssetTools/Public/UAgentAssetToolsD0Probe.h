#pragma once

#include "CoreMinimal.h"

/**
 * Read-only task-local D0 registration state.  It is deliberately unavailable
 * unless the command line opts into the MVP15D probe, so the production
 * exact-six companion never gains a generic fallback route.
 */
namespace UAgentAssetTools::D0
{
	UAGENTASSETTOOLS_API bool IsEnabled();
	UAGENTASSETTOOLS_API bool UsesToolsetRegistry();
	UAGENTASSETTOOLS_API bool IsToolSearchEnabled();
	UAGENTASSETTOOLS_API int32 GetRegistrationGeneration();
	UAGENTASSETTOOLS_API FString GetRouteName();
}
