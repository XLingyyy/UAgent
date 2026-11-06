using UnrealBuildTool;
public class UAgentPickupToolsV2 : ModuleRules {
 public UAgentPickupToolsV2(ReadOnlyTargetRules Target) : base(Target) {
  PCHUsage = PCHUsageMode.NoPCHs; bUseUnity = false;
  PublicDependencyModuleNames.AddRange(new[] { "Core", "Json", "JsonUtilities", "ModelContextProtocol" });
  PrivateDependencyModuleNames.AddRange(new[] { "CoreUObject", "Engine", "InputCore", "UnrealEd", "BlueprintGraph", "KismetCompiler", "AssetRegistry", "UAgentSemanticToolsV2", "UAgentPickupRuntimeV2" });
 }
}
