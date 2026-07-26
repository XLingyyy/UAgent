using System.IO;
using UnrealBuildTool;

public class UAgentAssetToolsTests : ModuleRules
{
	public UAgentAssetToolsTests(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		// The source-checkpoint Automation tests exercise dry-run, forward,
		// rollback, and adversarial cleanup through the production tool boundary.
		// Keep those dependencies local to this private test module.
		PrivateIncludePaths.Add(Path.Combine(ModuleDirectory, "..", "UAgentAssetTools", "Private"));
		PrivateDependencyModuleNames.AddRange(new[]
		{
			"Core",
			"CoreUObject",
			"AssetRegistry",
			"EditorScriptingUtilities",
			"Engine",
			"Json",
			"ModelContextProtocol",
			"ModelContextProtocolEngine",
			"Projects",
			"ToolsetRegistry",
			"UAgentAssetTools",
			"UnrealEd",
		});
	}
}
