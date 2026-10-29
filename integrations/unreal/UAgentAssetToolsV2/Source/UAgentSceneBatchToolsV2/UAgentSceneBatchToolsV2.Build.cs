using UnrealBuildTool;
public class UAgentSceneBatchToolsV2 : ModuleRules {
 public UAgentSceneBatchToolsV2(ReadOnlyTargetRules Target) : base(Target) {
  PCHUsage = PCHUsageMode.NoPCHs; bUseUnity = false;
  PublicDependencyModuleNames.AddRange(new[] { "Core", "Json", "JsonUtilities", "ModelContextProtocol" });
  PrivateDependencyModuleNames.AddRange(new[] { "CoreUObject", "Engine", "UnrealEd", "AssetRegistry", "Projects", "UAgentSemanticToolsV2" });
 }
}
