using UnrealBuildTool;
using System.Collections.Generic;

public class LyraFixtureTarget : TargetRules
{
    public LyraFixtureTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        ExtraModuleNames.AddRange(new string[] { "LyraFixture" });
    }
}
