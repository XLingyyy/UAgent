import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { createEmptyMvp11State } from "../runtime/runtime-store";
import { UIProvider } from "../stores/ui-store";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ReviewPanel } from "./ReviewPanel";
import { UtilityEvidencePanel } from "./UtilityPlaceholderPanel";
import { ConfigSettings } from "../settings/pages/ConfigSettings";

const populatedMvp11 = {
  ...createEmptyMvp11State(),
  metadataStatus: "completed" as const,
  contextPackStatus: "completed" as const,
  buildAnalysisStatus: "completed" as const,
  redactionSummary: { replacedPaths: 2, replacedSecrets: 1, redacted: true },
  metadata: {
    projectId: "project-mvp11-ui",
    displayRoot: "[project-root]",
    uprojectPath: "[project-root]/Game.uproject",
    engineAssociation: "5.8",
    category: null,
    description: null,
    targetPlatforms: ["Win64"],
    modules: [{ name: "Game", type: "Runtime", loadingPhase: null, source: "uproject" as const, dependencies: { public: [], private: [] } }],
    plugins: [],
    targets: [{ name: "Game", path: "[project-root]/Source/Game.Target.cs", targetType: "Game", extraModuleNames: ["Missing"] }],
    builds: [],
    configSummaries: [],
    diagnostics: [],
    redaction: { replacedPaths: 0, replacedSecrets: 0, redacted: false },
    createdAt: 12_000,
  },
  projectDiagnostics: [
    {
      id: "diag-project-1",
      kind: "target_missing_module" as const,
      severity: "error" as const,
      title: "Target references missing module",
      message: "Game references Missing.",
      displayPath: "[project-root]/Source/Game.Target.cs",
      evidence: [],
      createdAt: 12_000,
    },
    {
      id: "diag-project-2",
      kind: "config_secret_redacted" as const,
      severity: "warning" as const,
      title: "Config value redacted",
      message: "Authorization was redacted.",
      displayPath: "[project-root]/Config/DefaultGame.ini",
      evidence: [],
      createdAt: 12_000,
    },
  ],
  buildAnalysis: {
    diagnostics: [
      {
        id: "diag-build-1",
        kind: "compiler_error" as const,
        severity: "error" as const,
        tool: "MSVC",
        code: "C2065",
        message: "missing symbol",
        displayPath: "[project-root]/Source/Game.cpp",
        line: 9,
        column: 2,
        evidence: [],
        createdAt: 12_100,
      },
    ],
    errorCount: 1,
    warningCount: 0,
    topIssues: ["MSVC: missing symbol"],
    nextChecks: ["Open the first affected source file."],
    outputSummary: "missing symbol",
    outputTruncated: false,
    rawOutputStored: false as const,
    redaction: { replacedPaths: 1, replacedSecrets: 0, redacted: true },
  },
  contextPack: {
    id: "context-pack-project-mvp11-ui-v1",
    version: "v1" as const,
    projectId: "project-mvp11-ui",
    title: "MVP11 Context Pack v1",
    createdAt: 12_200,
    sections: [
      {
        id: "context-diagnostics_summary",
        kind: "diagnostics_summary" as const,
        title: "Diagnostics summary",
        summary: "1 project errors, 2 total project diagnostics.",
        items: ["error: Target references missing module"],
        source: { kind: "ue_project_diagnostic" as const, label: "Diagnostics summary", evidenceIds: [] },
        createdAt: 12_200,
        redaction: { replacedPaths: 0, replacedSecrets: 0, redacted: false },
      },
    ],
    sources: [{ kind: "ue_project_diagnostic" as const, label: "Diagnostics summary", evidenceIds: [] }],
    redaction: { replacedPaths: 2, replacedSecrets: 1, redacted: true },
  },
  affectedFiles: {
    "[project-root]/Source/Game.Target.cs": {
      path: "[project-root]/Source/Game.Target.cs",
      projectCount: 1,
      buildCount: 0,
      total: 1,
      severities: ["error" as const],
      kinds: ["target_missing_module" as const],
    },
    "[project-root]/Source/Game.cpp": {
      path: "[project-root]/Source/Game.cpp",
      projectCount: 0,
      buildCount: 1,
      total: 1,
      severities: ["error" as const],
      kinds: ["compiler_error" as const],
    },
  },
  diagnosticCounts: {
    total: 3,
    blocker: 0,
    error: 2,
    warning: 1,
    info: 0,
    byKind: { target_missing_module: 1, config_secret_redacted: 1, compiler_error: 1 },
  },
};

function renderWithMvp11(ui: ReactElement) {
  return render(<UIProvider initialState={{ runtime: { mvp11: populatedMvp11 } }}>{ui}</UIProvider>);
}

describe("MVP11 desktop diagnostics UI", () => {
  it("renders populated UE diagnostics, counts, affected paths, and redaction summary", () => {
    renderWithMvp11(<DiagnosticsPanel />);

    expect(screen.getAllByText("Project diagnostics").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("2 errors / 1 warning").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("target_missing_module").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("[project-root]/Source/Game.Target.cs")).toBeTruthy();
    expect(screen.getByText("Redaction: 2 paths / 1 secrets")).toBeTruthy();
    expect(screen.getAllByText("Context Pack").length).toBeGreaterThanOrEqual(1);
  });

  it("computes ReviewPanel diagnostic summary from populated MVP11 state", () => {
    renderWithMvp11(<ReviewPanel />);

    expect(screen.getByText("Diagnostic summary")).toBeTruthy();
    expect(screen.getAllByText("2 errors / 1 warning").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Open the first affected source file.")).toBeTruthy();
  });

  it("lists MVP11 evidence summaries from runtime state", () => {
    renderWithMvp11(<UtilityEvidencePanel />);

    expect(screen.getByText("UE metadata: 1 modules, 1 targets, UE 5.8")).toBeTruthy();
    expect(screen.getByText("Build diagnostics: 1 errors, 0 warnings")).toBeTruthy();
    expect(screen.getByText("Context Pack: MVP11 Context Pack v1")).toBeTruthy();
  });

  it("reflects MVP11 failure/read-only status in Config settings", () => {
    renderWithMvp11(<ConfigSettings />);

    expect(screen.getByText("Diagnostic Engine")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
    expect(screen.getByText("2 errors / 1 warning")).toBeTruthy();
    expect(screen.getByText("Provider live off")).toBeTruthy();
  });
});
