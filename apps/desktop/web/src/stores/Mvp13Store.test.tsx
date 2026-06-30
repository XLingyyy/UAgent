import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AssetMutationPlan, McpMutationDryRunResult, UEEditorOperationProposal, UEEditorOperationResult, UEEditorSession } from "@uagent/shared";
import { createDesktopMockRuntimeClient, createRuntimeStoreState, refreshMvp13DerivedState } from "../runtime/runtime-store";
import { EditorPanel } from "../inspector/EditorPanel";
import { McpMutationPanel } from "../inspector/McpMutationPanel";
import { ProjectTree } from "../sidebar/ProjectTree";
import { UIProvider } from "./ui-store";

function renderWithRuntime(children: ReactNode) {
  const runtime = createRuntimeStoreState(createDesktopMockRuntimeClient().getSnapshot());
  const session: UEEditorSession = {
    sessionId: "editor-session:1",
    projectId: "project:1",
    rootId: "root:1",
    uprojectDisplayPath: "[project-root]/Game.uproject",
    mode: "fixture",
    status: "attached",
    createdAt: 1,
    expiresAt: 60,
    replayOnly: false,
  };
  const proposal: UEEditorOperationProposal = {
    proposalId: "editor-operation:1",
    sessionId: session.sessionId,
    projectId: "project:1",
    rootId: "root:1",
    operationKind: "select_asset",
    argsHash: "hash:args",
    risk: "state_only",
    status: "approval_required",
    summary: "Select [project-root]/Content/Hero.Hero",
    redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
    createdAt: 2,
    expiresAt: 60,
  };
  const result: UEEditorOperationResult = {
    proposalId: proposal.proposalId,
    status: "executed",
    outputSummary: "Executed select_asset.",
    durationMs: 1,
    redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
    evidenceId: "evidence:editor",
    executedAt: 3,
    replayOnly: false,
  };
  const dryRun: McpMutationDryRunResult = {
    id: "mcp-dry-run:1",
    toolName: "ue.asset.save",
    wouldChange: true,
    operationKind: "save_asset",
    affectedFiles: ["[project-root]/Content/Hero.uasset"],
    assetRisk: true,
    textBacked: false,
    stateOnly: false,
    blockedReason: null,
    summary: "Would save an asset.",
    redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
    createdAt: 4,
  };
  const assetPlan: AssetMutationPlan = {
    id: "asset-plan:1",
    toolName: dryRun.toolName,
    operationKind: dryRun.operationKind,
    affectedAssets: dryRun.affectedFiles,
    status: "blocked",
    reason: "asset_mutation_blocked",
    summary: "Asset writes remain blocked.",
    redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
  };
  const mvp13 = refreshMvp13DerivedState({
    ...runtime.mvp13,
    editorCapability: {
      enabled: true,
      mode: "fixture",
      reason: "fixture_enabled",
      trustedRootRequired: true,
      mutationExecution: "state_only",
    },
    editorSession: session,
    editorProposals: [proposal],
    editorResults: [result],
    mcpDryRuns: [dryRun],
    assetPlans: [assetPlan],
    replayOnly: true,
  });

  return render(
    <UIProvider initialState={{ runtime: { mvp13 } }}>
      {children}
    </UIProvider>,
  );
}

describe("MVP13 desktop store and panels", () => {
  it("drives editor proposal approval execution and MCP dry-run through runtime actions", () => {
    const { container } = render(
      <UIProvider>
        <EditorPanel />
        <McpMutationPanel />
      </UIProvider>,
    );

    expect(screen.getByText(/Session: none/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Refresh editor capability" }));
    expect(screen.getByText(/Capability: fixture \/ state_only/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Attach fixture editor session" }));
    expect(screen.getByText(/Session: attached \(fixture\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Propose state-only editor operation" }));
    expect(screen.getByText(/Proposal: select_asset \/ approval_required \/ state_only/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve editor operation" }));
    expect(screen.getByText(/Proposal: select_asset \/ approved \/ state_only/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Execute editor operation" }));
    expect(screen.getByText(/Result: blocked \/ recorded/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run MCP mutation dry-run" }));
    expect(screen.getByText(/Dry-runs: 1 \/ proposals 0 \/ blocked asset plans 1/)).toBeTruthy();
    expect(screen.getByText(/Asset plan: asset_mutation_blocked/)).toBeTruthy();

    expect(container.textContent).not.toContain("editor-approval-token");
    expect(container.textContent).not.toContain("fixture://");
    expect(container.textContent).not.toContain("sk-secret");
    expect(container.textContent).not.toContain("/Game/Hero");
  });

  it("renders editor approval state without exposing approval tokens", () => {
    renderWithRuntime(<EditorPanel />);

    expect(screen.getByText("UE Editor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve editor operation" })).not.toHaveProperty("disabled", true);
    expect(screen.queryByText(/approval-token/)).toBeNull();
  });

  it("renders MCP mutation dry-run and blocked asset plan summaries", () => {
    renderWithRuntime(<McpMutationPanel />);

    expect(screen.getByText("MCP Mutation")).toBeTruthy();
    expect(screen.getByText(/blocked asset plans 1/)).toBeTruthy();
    expect(screen.getByText(/Asset plan: asset_mutation_blocked/)).toBeTruthy();
    expect(screen.getByText(/Replay: recorded summaries only/)).toBeTruthy();
  });

  it("shows mutation markers in the project tree", () => {
    render(
      <ProjectTree
        nodes={[{ id: "hero", name: "Hero.uasset", type: "Asset", rootRelativePath: "Content/Hero.uasset" }]}
        mutationMarkers={{ "[project-root]/Content/Hero.uasset": ["mutation_blocked"] }}
      />,
    );

    expect(screen.getByLabelText("mutation_blocked marker for Hero.uasset")).toBeTruthy();
  });
});
