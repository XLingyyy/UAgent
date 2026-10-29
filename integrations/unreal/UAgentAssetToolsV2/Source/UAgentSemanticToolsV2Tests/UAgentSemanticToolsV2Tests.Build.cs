using UnrealBuildTool;
public class UAgentSemanticToolsV2Tests : ModuleRules
{
    public UAgentSemanticToolsV2Tests(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.NoPCHs;
        bUseUnity = false;
        PrivateDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "UnrealEd", "Json", "BlueprintGraph", "KismetCompiler", "AssetRegistry", "UAgentSemanticToolsV2" });
    }
}
