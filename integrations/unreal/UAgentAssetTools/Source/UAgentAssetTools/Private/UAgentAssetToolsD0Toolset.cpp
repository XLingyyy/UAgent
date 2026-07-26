#include "UAgentAssetToolsD0Toolset.h"
#include "UAgentAssetToolsD0Probe.h"

FString UUAgentAssetToolsD0Toolset::Probe()
{
	// The parseable acknowledgement exposes only route/lifecycle facts.  It has
	// no input and no path, object, package, editor, or file-system capability.
	return FString::Printf(
		TEXT("{\"status\":\"noop\",\"route\":\"toolset_registry\",\"toolSearchEnabled\":%s,\"registrationGeneration\":%d,\"mutationCount\":0}"),
		UAgentAssetTools::D0::IsToolSearchEnabled() ? TEXT("true") : TEXT("false"),
		UAgentAssetTools::D0::GetRegistrationGeneration());
}

FString UUAgentAssetToolsD0Toolset::GetToolsetVersion() const
{
	return TEXT("mvp15d-d0-probe-v1");
}
