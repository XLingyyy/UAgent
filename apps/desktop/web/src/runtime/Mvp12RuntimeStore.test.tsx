import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProjectIndexSnapshot, ProjectProfile } from "@uagent/shared";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";
import type { NativeInvoke } from "./project-native-adapter";
import {
  createEmptyMvp12State,
  createMvp12FileMarkers,
  refreshMvp12DerivedState,
} from "./runtime-store";
import type { Mvp12RuntimeState } from "./runtime-store";
import { UIProvider, useRuntimeActions, useRuntimeStore } from "../stores/ui-store";

const tauriGlobal = globalThis as typeof globalThis & {
  __TAURI_INTERNALS__?: { invoke?: (command: string, payload?: unknown) => Promise<unknown> };
};
const previousTauriInternals = tauriGlobal.__TAURI_INTERNALS__;

afterEach(() => {
  tauriGlobal.__TAURI_INTERNALS__ = previousTauriInternals;
  vi.restoreAllMocks();
});

const project: ProjectProfile = {
  id: "project-mvp12-ui",
  name: "MVP12 UI Fixture",
  rootRef: "G:/UAgent/packages/runtime/src/fixtures/mvp12-repair-fixture",
  displayRoot: "[project-root]",
  trustState: "trusted",
  indexStatus: "ready",
  engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
  createdAt: 12_000,
  updatedAt: 12_000,
};

const snapshot: ProjectIndexSnapshot = {
  id: "index-mvp12-ui",
  projectId: project.id,
  rootRef: project.rootRef,
  status: "ready",
  directories: [],
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
  ],
  assets: [],
  summary: {
    projectId: project.id,
    scannedAt: 12_000,
    status: "ready",
    directoryCount: 0,
    fileCount: 1,
    assetCount: 0,
    ignoredCount: 0,
    limitReasons: [],
    warnings: [],
    redactedRoot: "[project-root]",
  },
};

function Mvp12ActionProbe() {
  const state = useRuntimeStore((runtime) => runtime.mvp12);
  const actions = useRuntimeActions();
  const proposalId = state.proposals[0]?.id ?? "proposal:missing";
  const changeSetId = state.activeChangeSet?.id ?? "changeset:missing";

  return (
    <div>
      <button type="button" onClick={() => actions.proposeRepairForDiagnostic("diag-plugin")}>
        propose repair
      </button>
      <button type="button" onClick={() => void actions.previewChangeSet(proposalId)}>
        preview change
      </button>
      <button type="button" onClick={() => actions.approveChangeSet(changeSetId)}>
        approve change
      </button>
      <button type="button" onClick={() => void actions.applyChangeSet(changeSetId)}>
        apply change
      </button>
      <button type="button" onClick={() => actions.runVerification(changeSetId)}>
        verify change
      </button>
      <button type="button" onClick={() => void actions.rollbackChangeSet(changeSetId)}>
        rollback change
      </button>
      <pre data-testid="mvp12-json">{JSON.stringify(state)}</pre>
    </div>
  );
}

describe("MVP12 desktop runtime store helpers", () => {
  it("tracks proposal, active change set, statuses, evidence, and file markers", () => {
    const base = createEmptyMvp12State();
    const state: Mvp12RuntimeState = {
      ...base,
      capability: {
        enabled: false,
        mode: "approval_required",
        reason: "disabled_until_approved",
        approvalRequired: true,
        allowedExtensions: [".ini", ".uproject"],
        blockedDirectories: ["Binaries", "Intermediate"],
      },
      proposals: [
        {
          id: "proposal:1",
          diagnosticId: "diag-1",
          title: "Disable MissingPlugin",
          recipe: { id: "R-PLUGIN-DISABLE", label: "Disable missing plugin", automatic: true },
          intent: "disable_missing_plugin",
          sourceDiagnostics: [{ diagnosticId: "diag-1", kind: "plugin_descriptor_missing", displayPath: "[project-root]/Game.uproject" }],
          risk: "medium_config",
          explanation: "Set Enabled to false.",
          expectedEffect: "Descriptor warning clears.",
          rollbackNote: "Restore before snapshot.",
          operations: [],
          manualNote: null,
          createdAt: 1,
        },
      ],
      activeChangeSet: {
        id: "changeset:1",
        projectId: "project:test",
        state: "rollback_available",
        title: "Disable MissingPlugin",
        operations: [],
        proposalIds: ["proposal:1"],
        risk: "medium_config",
        diffSummary: "1 file changed",
        rollback: { id: "rollback:1", available: true, beforeHashes: {}, appliedHashes: {}, createdAt: 2 },
        evidenceIds: ["evidence:1"],
        createdAt: 1,
        updatedAt: 2,
        redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
      },
      changedFiles: {
        "[project-root]/Game.uproject": {
          path: "[project-root]/Game.uproject",
          diagnosticCount: 1,
          proposed: true,
          modified: true,
          verified: true,
          rollbackAvailable: true,
        },
      },
    };

    expect(refreshMvp12DerivedState(state).fileMarkers["[project-root]/Game.uproject"]).toEqual(
      expect.arrayContaining(["diagnostic", "proposed", "modified", "verified", "rollback_available"]),
    );
    expect(createMvp12FileMarkers(state)["[project-root]/Game.uproject"]).toContain("verified");
  });

  it("routes proposal, preview, apply, and rollback actions through native text mutation invoke", async () => {
    const previewContent = '{ "Plugins": [{ "Name": "MissingPlugin", "Enabled": true }] }\n';
    const invokeMock = vi.fn(async (command: string, payload?: unknown) => {
      if (command === "preview_native_project_file") {
        return {
          status: "ready",
          reason: "allowed_text_preview",
          content: previewContent,
          truncated: false,
          originalBytes: previewContent.length,
          originalLines: 1,
          replacedSecrets: 0,
          replacedPaths: 0,
        };
      }
      if (command === "mutation_capability_status") {
        return {
          enabled: true,
          mode: "native",
          reason: "native_text_mutation_available",
          approvalRequired: true,
          allowedExtensions: [".uproject"],
          blockedDirectories: ["Binaries"],
        };
      }
      if (command === "preview_workspace_change") {
        const input = (payload as { input: { changeSetId: string; operations: Array<{ operationId: string; rootRelativePath: string; beforeHash: string; afterContent: string }> } }).input;
        return {
          changeSetId: input.changeSetId,
          status: "previewed",
          reason: "ok",
          diffSummary: "1 text operation(s)",
          operations: input.operations.map((operation) => ({
            operationId: operation.operationId,
            rootRelativePath: operation.rootRelativePath,
            displayPath: `[project-root]/${operation.rootRelativePath}`,
            beforeHash: operation.beforeHash,
            afterHash: "native-after-hash",
            unifiedDiff: "--- a/[project-root]/Game.uproject\n+++ b/[project-root]/Game.uproject\n-true\n+false",
          })),
        };
      }
      if (command === "apply_workspace_change") {
        const input = (payload as { input: { changeSetId: string; approval: { afterHashes: Record<string, string> }; operations: Array<{ operationId: string }> } }).input;
        expect(input.approval.afterHashes).toEqual(Object.fromEntries(input.operations.map((operation) => [operation.operationId, "native-after-hash"])));
        return {
          changeSetId: input.changeSetId,
          status: "applied",
          reason: "ok",
          backupId: "backup:native",
          afterHashes: Object.fromEntries(input.operations.map((operation) => [operation.operationId, "native-after-hash"])),
        };
      }
      if (command === "rollback_workspace_change") {
        const input = (payload as { input: { changeSetId: string; expectedCurrentHashes: Record<string, string> } }).input;
        return {
          changeSetId: input.changeSetId,
          status: "rolled_back",
          reason: "ok",
          restoredHashes: Object.fromEntries(Object.keys(input.expectedCurrentHashes).map((operationId) => [operationId, "native-before-hash"])),
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const invoke = invokeMock as unknown as NativeInvoke;
    tauriGlobal.__TAURI_INTERNALS__ = { invoke };
    const runtimeClient = createDesktopRuntimeAdapter({ nativeInvoke: invoke });

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{
          project: {
            activeProjectId: project.id,
            registeredProjects: [project],
            activeProjectIndex: snapshot,
            scanStatus: "ready",
          },
          runtime: {
            mvp11: {
              metadataStatus: "completed",
              buildAnalysisStatus: "idle",
              contextPackStatus: "idle",
              metadata: null,
              projectDiagnostics: [
                {
                  id: "diag-plugin",
                  kind: "plugin_descriptor_missing",
                  severity: "warning",
                  title: "Plugin descriptor missing",
                  message: "MissingPlugin is enabled but no descriptor was indexed.",
                  displayPath: "[project-root]/Plugins/MissingPlugin/MissingPlugin.uplugin",
                  evidence: [],
                  createdAt: 1,
                },
              ],
              buildAnalysis: null,
              mcpObservations: [],
              mcpDiagnostics: [],
              contextPack: null,
              redactionSummary: { replacedPaths: 0, replacedSecrets: 0, redacted: false },
              affectedFiles: {},
              diagnosticCounts: { total: 1, blocker: 0, error: 0, warning: 1, info: 0, byKind: { plugin_descriptor_missing: 1 } },
              terminalEvidenceSummary: null,
              analysisRequested: true,
              lastError: null,
            },
          },
        }}
      >
        <Mvp12ActionProbe />
      </UIProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "propose repair" }));
    await waitFor(() => expect(screen.getByTestId("mvp12-json").textContent).toContain('"operations":[{'));

    fireEvent.click(screen.getByRole("button", { name: "preview change" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("preview_workspace_change", expect.anything()));

    fireEvent.click(screen.getByRole("button", { name: "approve change" }));
    fireEvent.click(screen.getByRole("button", { name: "apply change" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("apply_workspace_change", expect.anything()));

    fireEvent.click(screen.getByRole("button", { name: "verify change" }));
    fireEvent.click(screen.getByRole("button", { name: "rollback change" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rollback_workspace_change", expect.anything()));

    const serialized = screen.getByTestId("mvp12-json").textContent ?? "";
    expect(serialized).toContain('"rollbackStatus":"completed"');
    expect(serialized).not.toContain("approval-token:");
    expect(serialized).not.toContain(project.rootRef);
  });

  it("blocks preview and apply state when native text mutation is unavailable", async () => {
    render(
      <UIProvider
        runtimeClient={createDesktopRuntimeAdapter()}
        initialState={{
          project: {
            activeProjectId: project.id,
            registeredProjects: [project],
            activeProjectIndex: snapshot,
            scanStatus: "ready",
          },
          runtime: {
            mvp11: {
              metadataStatus: "completed",
              buildAnalysisStatus: "idle",
              contextPackStatus: "idle",
              metadata: null,
              projectDiagnostics: [
                {
                  id: "diag-plugin",
                  kind: "plugin_descriptor_missing",
                  severity: "warning",
                  title: "Plugin descriptor missing",
                  message: "MissingPlugin is enabled but no descriptor was indexed.",
                  displayPath: "[project-root]/Plugins/MissingPlugin/MissingPlugin.uplugin",
                  evidence: [],
                  createdAt: 1,
                },
              ],
              buildAnalysis: null,
              mcpObservations: [],
              mcpDiagnostics: [],
              contextPack: null,
              redactionSummary: { replacedPaths: 0, replacedSecrets: 0, redacted: false },
              affectedFiles: {},
              diagnosticCounts: { total: 1, blocker: 0, error: 0, warning: 1, info: 0, byKind: { plugin_descriptor_missing: 1 } },
              terminalEvidenceSummary: null,
              analysisRequested: true,
              lastError: null,
            },
            mvp12: {
              ...createEmptyMvp12State(),
              proposals: [
                {
                  id: "proposal:diag-plugin",
                  diagnosticId: "diag-plugin",
                  title: "Disable missing plugin",
                  recipe: { id: "R-PLUGIN-DISABLE", label: "Disable missing plugin", automatic: true },
                  intent: "disable_missing_plugin",
                  sourceDiagnostics: [{ diagnosticId: "diag-plugin", kind: "plugin_descriptor_missing", displayPath: "[project-root]/Game.uproject" }],
                  risk: "medium_config",
                  explanation: "Disable plugin",
                  expectedEffect: "Diagnostic clears",
                  rollbackNote: "Rollback restores before snapshot",
                  operations: [
                    {
                      id: "operation:diag-plugin:0",
                      kind: "disable_plugin",
                      target: { rootId: "root:test", rootRelativePath: "Game.uproject", displayPath: "[project-root]/Game.uproject", extension: ".uproject" },
                      beforeHash: "before",
                      afterHash: "after",
                      risk: "medium_config",
                      intent: "disable_missing_plugin",
                      sourceDiagnosticIds: ["diag-plugin"],
                      summary: "Set MissingPlugin Enabled to false.",
                      unifiedDiff: "-true\n+false",
                      displayDiff: "-true\n+false",
                    },
                  ],
                  manualNote: null,
                  createdAt: 1,
                },
              ],
            },
          },
        }}
      >
        <Mvp12ActionProbe />
      </UIProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "preview change" }));

    await waitFor(() => {
      const serialized = screen.getByTestId("mvp12-json").textContent ?? "";
      expect(serialized).toContain('"applyStatus":"blocked"');
      expect(serialized).toContain("native_text_mutation_unavailable");
      expect(serialized).not.toContain('"state":"approval_required"');
      expect(serialized).not.toContain('"state":"applied"');
    });
  });
});
