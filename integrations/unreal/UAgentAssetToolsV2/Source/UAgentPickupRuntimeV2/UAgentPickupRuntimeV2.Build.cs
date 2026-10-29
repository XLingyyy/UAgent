using UnrealBuildTool;
public class UAgentPickupRuntimeV2 : ModuleRules {
 public UAgentPickupRuntimeV2(ReadOnlyTargetRules Target) : base(Target) {
  PCHUsage = PCHUsageMode.NoPCHs; bUseUnity = false;
  PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "InputCore" });
 }
}
