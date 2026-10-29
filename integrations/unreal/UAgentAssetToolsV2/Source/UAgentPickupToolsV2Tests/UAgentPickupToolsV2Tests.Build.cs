using UnrealBuildTool;
public class UAgentPickupToolsV2Tests : ModuleRules {
 public UAgentPickupToolsV2Tests(ReadOnlyTargetRules Target) : base(Target) {
  PCHUsage = PCHUsageMode.NoPCHs; bUseUnity = false;
  PrivateDependencyModuleNames.AddRange(new[] { "Core", "ApplicationCore", "CoreUObject", "Engine", "UnrealEd", "Json", "InputCore", "UAgentPickupRuntimeV2", "UAgentPickupToolsV2" });
 }
}
