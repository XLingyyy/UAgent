import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProjectIndexSnapshot, ProjectProfile } from "@uagent/shared";
import { createDesktopMockRuntimeClient, createRuntimeStoreState } from "../runtime/runtime-store";
import { UIProvider, useRuntimeActions, useRuntimeStore } from "./ui-store";

const tauriGlobal = globalThis as typeof globalThis & {
  __TAURI_INTERNALS__?: { invoke?: (command: string, payload?: unknown) => Promise<unknown> };
};
const previousTauriInternals = tauriGlobal.__TAURI_INTERNALS__;

afterEach(() => {
  tauriGlobal.__TAURI_INTERNALS__ = previousTauriInternals;
  vi.restoreAllMocks();
});

const snapshot: ProjectIndexSnapshot = {
  id: "index-mvp11-ui",
  projectId: "project-mvp11-ui",
  rootRef: "root:mvp11-ui",
  status: "ready",
  directories: [
    {
      id: "dir:Source",
      displayName: "Source",
      nodeType: "directory",
      rootRelativePath: "Source",
      displayPath: "[project-root]/Source",
      childrenCount: 1,
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
      id: "file:Game.uproject",
      displayName: "Game.uproject",
      nodeType: "file",
      rootRelativePath: "Game.uproject",
      displayPath: "[project-root]/Game.uproject",
      extension: ".uproject",
      byteSize: 100,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Source/Game.Target.cs",
      displayName: "Game.Target.cs",
      nodeType: "file",
      rootRelativePath: "Source/Game.Target.cs",
      displayPath: "[project-root]/Source/Game.Target.cs",
      extension: ".cs",
      byteSize: 100,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Source/Game/Game.Build.cs",
      displayName: "Game.Build.cs",
      nodeType: "file",
      rootRelativePath: "Source/Game/Game.Build.cs",
      displayPath: "[project-root]/Source/Game/Game.Build.cs",
      extension: ".cs",
      byteSize: 100,
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
      byteSize: 100,
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
      byteSize: 9000,
      isIgnored: false,
      limitReason: "binary",
    },
  ],
  assets: [
    {
      id: "asset:Hero",
      displayName: "Hero.uasset",
      assetType: "blueprint",
      rootRelativePath: "Content/Hero.uasset",
      displayPath: "[project-root]/Content/Hero.uasset",
      extension: ".uasset",
      source: "project_index",
      indexedAt: 12_000,
      tags: [],
      previewStatus: "blocked",
    },
  ],
  summary: {
    projectId: "project-mvp11-ui",
    scannedAt: 12_000,
    status: "ready",
    directoryCount: 2,
    fileCount: 5,
    assetCount: 1,
    ignoredCount: 0,
    limitReasons: ["binary"],
    warnings: ["permission_denied on C:/Users/Alice/Game/Plugins/Private"],
    redactedRoot: "[project-root]",
  },
};

const project: ProjectProfile = {
  id: "project-mvp11-ui",
  name: "MVP11 UI Fixture",
  rootRef: "root:mvp11-ui",
  displayRoot: "[project-root]",
  trustState: "trusted",
  indexStatus: "ready",
  engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
  createdAt: 12_000,
  updatedAt: 12_000,
};

function Mvp11ActionProbe() {
  const state = useRuntimeStore((runtime) => runtime.mvp11);
  const actions = useRuntimeActions();

  return (
    <div>
      <button type="button" onClick={() => void actions.analyzeActiveProjectDiagnostics()}>
        analyze project
      </button>
      <button type="button" onClick={() => actions.analyzeBuildOutputEvidence()}>
        analyze terminal
      </button>
      <button type="button" onClick={() => actions.createMvp11ContextPack()}>
        create context pack
      </button>
      <pre data-testid="mvp11-json">{JSON.stringify(state)}</pre>
    </div>
  );
}

describe("MVP11 runtime store actions", () => {
  it("analyzes the active indexed project through read-only previews", async () => {
    const previews = new Map<string, string>([
      [
        "Game.uproject",
        '{"EngineAssociation":"5.8","Modules":[{"Name":"Game","Type":"Runtime"}],"Plugins":[{"Name":"MissingPlugin","Enabled":true}],"TargetPlatforms":["Win64"]}',
      ],
      [
        "Source/Game.Target.cs",
        'Type = TargetType.Game;\nExtraModuleNames.AddRange(new string[] { "Game", "Missing" });',
      ],
      [
        "Source/Game/Game.Build.cs",
        'PublicDependencyModuleNames.AddRange(new string[] { "Core" });\nPrivateDependencyModuleNames.AddRange(new string[] { "UnknownExperimental" });',
      ],
      ["Config/DefaultGame.ini", "Authorization=Bearer sk-secret\n"],
    ]);
    const invoke = vi.fn(async (command: string, payload?: unknown) => {
      if (command !== "preview_native_project_file") {
        throw new Error(`Unexpected command: ${command}`);
      }
      const input = (payload as { input: { rootRelativePath: string } }).input;
      return {
        projectId: project.id,
        rootRelativePath: input.rootRelativePath,
        displayPath: `[project-root]/${input.rootRelativePath}`,
        status: previews.has(input.rootRelativePath) ? "ready" : "missing",
        reason: "test_preview",
        content: previews.get(input.rootRelativePath) ?? "",
        redaction: { replacedSecrets: 0, replacedPaths: 0, redacted: false },
      };
    });
    tauriGlobal.__TAURI_INTERNALS__ = { invoke };

    render(
      <UIProvider
        initialState={{
          project: {
            activeProjectId: project.id,
            registeredProjects: [project],
            activeProjectIndex: snapshot,
            scanStatus: "ready",
          },
        }}
      >
        <Mvp11ActionProbe />
      </UIProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "analyze project" }));

    await waitFor(() => {
      const text = screen.getByTestId("mvp11-json").textContent ?? "";
      expect(text).toContain('"metadataStatus":"completed"');
      expect(text).toContain('"engineAssociation":"5.8"');
      expect(text).toContain("target_missing_module");
      expect(text).toContain("Content/Hero.uasset");
      expect(text).not.toContain("C:/Users/Alice");
      expect(text).not.toContain("sk-secret");
    });
    expect(invoke).toHaveBeenCalledWith(
      "preview_native_project_file",
      expect.objectContaining({
        input: expect.objectContaining({ projectId: project.id, rootRelativePath: "Game.uproject" }),
      }),
    );
  });

  it("turns recorded terminal output into build diagnostics and Context Pack v1", async () => {
    const baseRuntime = createRuntimeStoreState(createDesktopMockRuntimeClient().getSnapshot());
    const output =
      "C:/Users/Alice/Game/Source/Game.cpp(9,2): error C2065: missing symbol\n" +
      "Config/DefaultGame.ini(1): warning C4996: deprecated setting\n";

    render(
      <UIProvider
        initialState={{
          project: {
            activeProjectId: project.id,
            registeredProjects: [project],
            activeProjectIndex: snapshot,
            scanStatus: "ready",
          },
          runtime: {
            mvp9: {
              ...baseRuntime.mvp9,
              mvp10: {
                terminal: {
                  ...baseRuntime.mvp9.mvp10.terminal,
                  executionResult: {
                    id: "exec-build",
                    requestId: "request-build",
                    status: "failed",
                    chunks: [],
                    exitState: { code: 6, signal: null, durationMs: 1200 },
                    outputSummary: output,
                    outputTruncated: false,
                    totalBytes: output.length,
                    totalLines: 2,
                    redactionSummary: { replacedSecrets: 0, replacedPaths: 0 },
                    createdAt: 12_100,
                    completedAt: 12_200,
                  },
                  stage: "completed",
                },
              },
            },
            mvp11: {
              ...baseRuntime.mvp11,
              metadataStatus: "completed",
              metadata: {
                projectId: project.id,
                displayRoot: "[project-root]",
                uprojectPath: "[project-root]/Game.uproject",
                engineAssociation: "5.8",
                category: null,
                description: null,
                targetPlatforms: ["Win64"],
                modules: [{ name: "Game", type: "Runtime", loadingPhase: null, source: "uproject", dependencies: { public: [], private: [] } }],
                plugins: [],
                targets: [],
                builds: [],
                configSummaries: [],
                diagnostics: [],
                redaction: { replacedPaths: 0, replacedSecrets: 0, redacted: false },
                createdAt: 12_000,
              },
              projectDiagnostics: [
                {
                  id: "diag-project-1",
                  kind: "target_missing_module",
                  severity: "error",
                  title: "Target references missing module",
                  message: "Missing module",
                  displayPath: "[project-root]/Source/Game.Target.cs",
                  evidence: [],
                  createdAt: 12_000,
                },
              ],
            },
          },
        }}
      >
        <Mvp11ActionProbe />
      </UIProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "analyze terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "create context pack" }));

    await waitFor(() => {
      const text = screen.getByTestId("mvp11-json").textContent ?? "";
      expect(text).toContain('"buildAnalysisStatus":"completed"');
      expect(text).toContain('"contextPackStatus":"completed"');
      expect(text).toContain("MVP11 Context Pack v1");
      expect(text).toContain("[user-home]");
      expect(text).not.toContain("C:/Users/Alice");
    });
  });
});
