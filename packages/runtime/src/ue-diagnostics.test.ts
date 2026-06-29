import { describe, expect, it, vi } from "vitest";
import type { ProjectIndexSnapshot } from "@uagent/shared";
import {
  createContextPackV1,
  createMcpDiagnosticBridge,
  createUEProjectDiagnosticsEngine,
  parseBuildOutputToDiagnostics,
  parseUEProjectMetadata,
} from "./index.js";

const fixtureSnapshot: ProjectIndexSnapshot = {
  id: "index-project-lyra",
  projectId: "project-lyra",
  rootRef: "fixture://lyra-starter",
  status: "ready",
  directories: [
    {
      id: "dir:Source",
      displayName: "Source",
      nodeType: "directory",
      rootRelativePath: "Source",
      displayPath: "[project-root]/Source",
      childrenCount: 2,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "dir:Source/LyraStarterGame",
      displayName: "LyraStarterGame",
      nodeType: "directory",
      rootRelativePath: "Source/LyraStarterGame",
      displayPath: "[project-root]/Source/LyraStarterGame",
      childrenCount: 2,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "dir:Config",
      displayName: "Config",
      nodeType: "directory",
      rootRelativePath: "Config",
      displayPath: "[project-root]/Config",
      childrenCount: 1,
      isIgnored: false,
      limitReason: "none",
    },
  ],
  files: [
    {
      id: "file:LyraStarter.uproject",
      displayName: "LyraStarter.uproject",
      nodeType: "file",
      rootRelativePath: "LyraStarter.uproject",
      displayPath: "[project-root]/LyraStarter.uproject",
      extension: ".uproject",
      byteSize: 300,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Source/LyraStarterEditor.Target.cs",
      displayName: "LyraStarterEditor.Target.cs",
      nodeType: "file",
      rootRelativePath: "Source/LyraStarterEditor.Target.cs",
      displayPath: "[project-root]/Source/LyraStarterEditor.Target.cs",
      extension: ".cs",
      byteSize: 220,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Source/LyraStarterGame/LyraStarterGame.Build.cs",
      displayName: "LyraStarterGame.Build.cs",
      nodeType: "file",
      rootRelativePath: "Source/LyraStarterGame/LyraStarterGame.Build.cs",
      displayPath: "[project-root]/Source/LyraStarterGame/LyraStarterGame.Build.cs",
      extension: ".cs",
      byteSize: 240,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Config/DefaultGame.ini",
      displayName: "DefaultGame.ini",
      nodeType: "file",
      rootRelativePath: "Config/DefaultGame.ini",
      displayPath: "[project-root]/Config/DefaultGame.ini",
      extension: ".ini",
      byteSize: 120,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Content/Hero.uasset",
      displayName: "Hero.uasset",
      nodeType: "file",
      rootRelativePath: "Content/Hero.uasset",
      displayPath: "[project-root]/Content/Hero.uasset",
      extension: ".uasset",
      byteSize: 4096,
      isIgnored: false,
      limitReason: "binary",
    },
  ],
  assets: [],
  summary: {
    projectId: "project-lyra",
    scannedAt: 10_000,
    status: "ready",
    directoryCount: 3,
    fileCount: 5,
    assetCount: 0,
    ignoredCount: 0,
    limitReasons: ["binary"],
    warnings: ["permission_denied on Plugins/PrivatePlugin/PrivatePlugin.uplugin"],
    redactedRoot: "[project-root]",
  },
};

const previews = new Map<string, string>([
  [
    "LyraStarter.uproject",
    JSON.stringify({
      EngineAssociation: "5.8",
      Category: "Games",
      Description: "Lyra fixture",
      TargetPlatforms: ["Win64"],
      Modules: [{ Name: "LyraStarterGame", Type: "Runtime", LoadingPhase: "Default" }],
      Plugins: [{ Name: "GameplayAbilities", Enabled: true }],
    }),
  ],
  [
    "Source/LyraStarterEditor.Target.cs",
    'Type = TargetType.Editor;\nExtraModuleNames.AddRange(new string[] { "LyraStarterGame", "MissingModule" });',
  ],
  [
    "Source/LyraStarterGame/LyraStarterGame.Build.cs",
    'PublicDependencyModuleNames.AddRange(new string[] { "Core", "Engine" });\nPrivateDependencyModuleNames.AddRange(new string[] { "UnknownExperimental" });',
  ],
  [
    "Config/DefaultGame.ini",
    "[URL]\nPort=7777\nAuthorization=Bearer sk-secret\nHome=C:/Users/Alice/Lyra\n",
  ],
]);

function preview(path: string) {
  const content = previews.get(path);
  if (content === undefined) {
    return { status: "missing" as const, content: "" };
  }
  return { status: "ready" as const, content };
}

describe("MVP11 UE diagnostics runtime", () => {
  it("parses UE metadata from read-only previews and redacts config secrets", () => {
    const metadata = parseUEProjectMetadata({
      snapshot: fixtureSnapshot,
      previewFile: preview,
      createdAt: 11_000,
    });

    expect(metadata.engineAssociation).toBe("5.8");
    expect(metadata.modules.map((module) => module.name)).toContain("LyraStarterGame");
    expect(metadata.targets[0].extraModuleNames).toContain("MissingModule");
    expect(metadata.builds[0].privateDependencyModuleNames).toContain("UnknownExperimental");
    expect(metadata.configSummaries[0].redactedKeys).toContain("Authorization");
    expect(JSON.stringify(metadata)).not.toContain("sk-secret");
    expect(JSON.stringify(metadata)).not.toContain("C:/Users/Alice");
  });

  it("turns malformed previews and project inconsistencies into diagnostics", () => {
    const badMetadata = parseUEProjectMetadata({
      snapshot: fixtureSnapshot,
      previewFile(path) {
        if (path === "LyraStarter.uproject") return { status: "ready", content: "{invalid json" };
        return preview(path);
      },
      createdAt: 11_001,
    });
    const diagnostics = createUEProjectDiagnosticsEngine().analyze({
      snapshot: fixtureSnapshot,
      metadata: badMetadata,
      createdAt: 11_002,
    });

    expect(diagnostics.some((diagnostic) => diagnostic.kind === "malformed_descriptor")).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.kind === "target_missing_module")).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.kind === "suspicious_build_dependency")).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.kind === "binary_preview_blocked")).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.kind === "permission_denied")).toBe(true);
  });

  it("parses build output without raw stdout, home paths, or secrets", () => {
    const output = [
      "C:/Users/Alice/Lyra/Source/LyraStarterGame/LyraStarterGame.cpp(42,7): error C2065: undeclared identifier",
      "/Users/bob/Lyra/Source/Foo.cpp:10:3: warning: unused variable [-Wunused-variable]",
      "/home/carla/project/src/main.rs:8:5: error[E0425]: cannot find value `x` in this scope",
      "src/App.tsx(12,4): error TS2322: Type string is not assignable",
      "Authorization: Bearer sk-very-secret token=abc api_key=def",
    ].join("\n");

    const summary = parseBuildOutputToDiagnostics({
      output,
      projectRoot: "C:/Users/Alice/Lyra",
      createdAt: 11_003,
      outputLimit: 500,
    });

    expect(summary.diagnostics.length).toBeGreaterThanOrEqual(4);
    expect(summary.errorCount).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(summary)).not.toContain("C:/Users/Alice");
    expect(JSON.stringify(summary)).not.toContain("/Users/bob");
    expect(JSON.stringify(summary)).not.toContain("/home/carla");
    expect(JSON.stringify(summary)).not.toContain("sk-very-secret");
    expect(summary.rawOutputStored).toBe(false);
  });

  it("keeps MCP diagnostics read-only and reports mutating tools as policy diagnostics", async () => {
    const callTool = vi.fn();
    const bridge = createMcpDiagnosticBridge({
      discover: async () => ({
        resources: [{ uri: "ue://project/summary", name: "Project summary" }],
        tools: [{ name: "ue.asset.delete" }, { name: "ue.project.read" }],
      }),
      readResource: async (uri) => ({ uri, text: "UE project summary" }),
      callTool,
      createdAt: 11_004,
    });

    const result = await bridge.collectReadOnlyObservations();

    expect(callTool).not.toHaveBeenCalled();
    expect(result.observations.some((observation) => observation.kind === "mcp_resource")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.kind === "mcp_policy_block")).toBe(true);
  });

  it("creates Context Pack v1 from redacted inputs only", () => {
    const metadata = parseUEProjectMetadata({
      snapshot: fixtureSnapshot,
      previewFile: preview,
      createdAt: 11_005,
    });
    const projectDiagnostics = createUEProjectDiagnosticsEngine().analyze({
      snapshot: fixtureSnapshot,
      metadata,
      createdAt: 11_006,
    });
    const buildSummary = parseBuildOutputToDiagnostics({
      output: "C:/Users/Alice/Lyra/Source/Foo.cpp(1): error C1001: boom",
      projectRoot: "C:/Users/Alice/Lyra",
      createdAt: 11_007,
    });
    const pack = createContextPackV1({
      snapshot: fixtureSnapshot,
      metadata,
      projectDiagnostics,
      buildDiagnostics: buildSummary.diagnostics,
      mcpObservations: [{ id: "obs-1", kind: "mcp_resource", summary: "Project summary", source: "ue://project/summary" }],
      terminalEvidenceSummary: "Terminal failed with exit code 6 at C:/Users/Alice/Lyra",
      createdAt: 11_008,
    });

    expect(pack.sections.map((section) => section.kind)).toEqual([
      "project_overview",
      "diagnostics_summary",
      "build_failures",
      "important_files",
      "mcp_observations",
      "safety_boundaries",
    ]);
    expect(JSON.stringify(pack)).not.toContain("C:/Users/Alice");
    expect(pack.redaction.redacted).toBe(true);
  });
});
