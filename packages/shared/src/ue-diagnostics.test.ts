import { describe, expect, it } from "vitest";
import type {
  BuildDiagnostic,
  ContextPack,
  DiagnosticEvidenceLink,
  ProjectDiagnostic,
  UEProjectMetadata,
} from "./index.js";

describe("MVP11 UE diagnostics shared contracts", () => {
  it("constructs redacted UE metadata without raw absolute path fields", () => {
    const metadata: UEProjectMetadata = {
      projectId: "project-lyra",
      displayRoot: "[project-root]",
      uprojectPath: "[project-root]/LyraStarter.uproject",
      engineAssociation: "5.8",
      category: "Games",
      description: "Fixture project",
      targetPlatforms: ["Win64"],
      modules: [
        {
          name: "LyraStarterGame",
          type: "Runtime",
          loadingPhase: "Default",
          source: "uproject",
          dependencies: {
            public: ["Core"],
            private: ["Engine"],
          },
        },
      ],
      plugins: [
        {
          name: "GameplayAbilities",
          friendlyName: "Gameplay Abilities",
          versionName: "1.0",
          enabled: true,
          enabledByDefault: true,
          descriptorPath: "[project-root]/Plugins/GameplayAbilities/GameplayAbilities.uplugin",
          supportedTargetPlatforms: ["Win64"],
          modules: [],
        },
      ],
      targets: [
        {
          name: "LyraStarterEditor",
          path: "[project-root]/Source/LyraStarterEditor.Target.cs",
          targetType: "Editor",
          extraModuleNames: ["LyraStarterGame"],
        },
      ],
      builds: [
        {
          moduleName: "LyraStarterGame",
          path: "[project-root]/Source/LyraStarterGame/LyraStarterGame.Build.cs",
          publicDependencyModuleNames: ["Core"],
          privateDependencyModuleNames: ["Engine"],
        },
      ],
      configSummaries: [
        {
          path: "[project-root]/Config/DefaultGame.ini",
          sections: [{ name: "URL", keys: ["Port"] }],
          redactedKeys: ["Authorization"],
        },
      ],
      diagnostics: [],
      redaction: {
        replacedPaths: 2,
        replacedSecrets: 1,
        redacted: true,
      },
      createdAt: 11_000,
    };

    const serialized = JSON.stringify(metadata);
    expect(metadata.modules[0].dependencies.public).toContain("Core");
    expect(serialized).not.toContain("C:/Users/");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("/home/");
    expect(serialized).not.toContain("Authorization:");
    expect(serialized).not.toContain("sk-");
  });

  it("constructs project/build diagnostics and evidence links", () => {
    const evidence: DiagnosticEvidenceLink = {
      evidenceId: "evidence-1",
      label: "Build output",
      displayPath: "[project-root]/Source/LyraStarterGame/LyraStarterGame.cpp",
      line: 42,
      column: 7,
    };
    const projectDiagnostic: ProjectDiagnostic = {
      id: "diag-project-1",
      kind: "missing_module_source",
      severity: "error",
      title: "Module source missing",
      message: "Target references LyraStarterGame but Source/LyraStarterGame is absent.",
      displayPath: "[project-root]/Source/LyraStarterGame",
      evidence: [evidence],
      createdAt: 11_001,
    };
    const buildDiagnostic: BuildDiagnostic = {
      id: "diag-build-1",
      kind: "compiler_error",
      severity: "error",
      tool: "MSVC",
      code: "C2065",
      message: "undeclared identifier",
      displayPath: "[project-root]/Source/LyraStarterGame/LyraStarterGame.cpp",
      line: 42,
      column: 7,
      evidence: [evidence],
      createdAt: 11_002,
    };

    expect(projectDiagnostic.kind).toBe("missing_module_source");
    expect(buildDiagnostic.evidence[0].displayPath).toContain("[project-root]");
  });

  it("constructs Context Pack v1 with bounded redaction summaries", () => {
    const contextPack: ContextPack = {
      id: "context-pack-1",
      version: "v1",
      projectId: "project-lyra",
      title: "MVP11 Context Pack",
      createdAt: 11_003,
      sections: [
        {
          id: "section-project",
          kind: "project_overview",
          title: "Project overview",
          summary: "UE 5.8 fixture project with one runtime module.",
          items: ["LyraStarterGame"],
          source: {
            kind: "ue_project_metadata",
            label: "UE metadata",
            evidenceIds: ["evidence-metadata"],
          },
          createdAt: 11_003,
          redaction: { replacedPaths: 1, replacedSecrets: 0, redacted: true },
        },
      ],
      sources: [
        {
          kind: "ue_project_metadata",
          label: "UE metadata",
          evidenceIds: ["evidence-metadata"],
        },
      ],
      redaction: {
        replacedPaths: 1,
        replacedSecrets: 0,
        redacted: true,
      },
    };

    expect(contextPack.version).toBe("v1");
    expect(contextPack.sections[0].source.kind).toBe("ue_project_metadata");
  });
});
