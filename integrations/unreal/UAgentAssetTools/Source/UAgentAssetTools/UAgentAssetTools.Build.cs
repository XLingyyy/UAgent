using UnrealBuildTool;

public class UAgentAssetTools : ModuleRules
{
	public UAgentAssetTools(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new[]
		{
			"Core",
			"Json",
			"JsonUtilities",
			"ModelContextProtocol",
		});
		PrivateDependencyModuleNames.AddRange(new[]
		{
			"CoreUObject",
			"AssetRegistry",
			"AssetTools",
			"EditorScriptingUtilities",
			"UnrealEd",
			"Projects",
			"ModelContextProtocolEngine",
			"ToolsetRegistry",
			"TypedElementFramework",
		});
		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			PublicSystemLibraries.AddRange(new[]
			{
				"bcrypt.lib",
				"ntdll.lib",
			});
		}
	}
}
