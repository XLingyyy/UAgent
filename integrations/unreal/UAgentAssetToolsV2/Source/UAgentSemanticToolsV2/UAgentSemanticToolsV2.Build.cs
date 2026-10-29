using UnrealBuildTool;
public class UAgentSemanticToolsV2 : ModuleRules
{
    public UAgentSemanticToolsV2(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.NoPCHs;
        bUseUnity = false;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "Json", "JsonUtilities", "ModelContextProtocol" });
        PrivateDependencyModuleNames.AddRange(new[] { "CoreUObject", "Engine", "UnrealEd", "BlueprintGraph", "AssetRegistry", "Projects" });
    }
}
