using UnrealBuildTool;

public class LyraFixture : ModuleRules
{
    public LyraFixture(ReadOnlyTargetRules Target) : base(Target)
    {
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "Engine" });
        PrivateDependencyModuleNames.AddRange(new string[] { "CoreUObject" });
    }
}
