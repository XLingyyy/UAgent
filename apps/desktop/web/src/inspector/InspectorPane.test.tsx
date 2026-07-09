import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import { InspectorPane } from "./InspectorPane";
import { reviewFindings, diagnosticSummary } from "./inspector-data";
import { UIProvider } from "../app/providers";
import { ComposerDock } from "../composer/ComposerDock";
import type { DesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import type { RuntimeSnapshot, TaskEvent, TaskRecord } from "@uagent/shared";
function renderInspector(open = true, onClose?: () => void) {
  return render(<InspectorPane open={open} onClose={onClose} />);
}

async function renderRuntimeInspector(input = "Review Lyra asset loading risks") {
  renderRuntimeInspectorShell(input);
  await screen.findByText("Mock runtime / no provider call");
}

function renderRuntimeInspectorShell(input = "Review Lyra asset loading risks") {
  render(
    <UIProvider>
      <ComposerDock />
      <InspectorPane open />
    </UIProvider>,
  );
  fireEvent.change(screen.getByLabelText("Composer input"), { target: { value: input } });
  fireEvent.click(screen.getByRole("button", { name: "Send mock task" }));
}

function createPendingApprovalRuntimeState() {
  const taskId = "task-approval-0001";
  const stepId = "step-review-risk";
  const task: TaskRecord = {
    id: taskId,
    title: "Delete selected Lyra asset",
    state: "awaiting_approval",
    draft: {
      input: "Delete selected Lyra asset",
      projectId: "lyra",
      permissionMode: "request_approval",
      modelId: "not-configured",
      reasoningEffort: "medium",
      runMode: "local",
      branch: "main",
      contextPercent: 12,
    },
    createdAt: 1_000,
    updatedAt: 1_010,
    completedAt: null,
    error: null,
  };
  const approvalEvent: TaskEvent = {
    id: "task-approval-0001-event-0001",
    taskId,
    type: "approval_required",
    title: "Approval required",
    body: "Delete selected Lyra asset requires approval.",
    level: "warning",
    createdAt: 1_010,
    payload: {
      stepId,
      riskLevel: "destructive",
    },
  };

  return {
    taskId,
    stepId,
    runtime: {
      status: "waiting_for_approval" as const,
      activeTaskId: taskId,
      tasksById: { [taskId]: task },
      eventsByTaskId: { [taskId]: [approvalEvent] },
      lastError: null,
    },
  };
}

function createSpyRuntimeAdapter(snapshot: RuntimeSnapshot): DesktopRuntimeAdapter {
  return {
    getSnapshot: () => snapshot,
    getMcpState: () => ({
      status: "disconnected",
      profile: {
        id: "local-unreal-mcp",
        name: "Local Unreal MCP",
        endpoint: "http://127.0.0.1:8765/mcp",
        transport: "streamable-http",
      },
      protocolVersion: null,
      serverInfo: null,
      capabilities: null,
      lastError: null,
      legacyMode: false,
    }),
    getMcpDiscovery: () => null,
    subscribe: () => () => {},
    subscribeMcp: () => () => {},
    submitTask: vi.fn(),
    cancelTask: vi.fn(),
    submitApprovalDecision: vi.fn(async () => {}),
    setMcpEndpoint: vi.fn(),
    connectMcp: vi.fn(async () => {}),
    discoverMcp: vi.fn(async () => {}),
    disconnectMcp: vi.fn(),
    getMvp9: () => ({ getState: () => ({ terminal: { proposals: [], activeProposal: null, approvalState: null, executionResult: null, stage: "idle" }, browser: { request: null, session: null, artifact: null, stage: "idle", blockedReason: null, capability: { enabled: false, mode: "disabled", reason: "fixture", localhostAllowed: true, loopbackAllowed: true, fileAllowed: true, externalBlocked: true }, lastError: null }, screenshot: { request: null, result: null, stage: "idle", evidence: null }, watcher: { session: null, events: [], diff: null, stage: "idle", stopReason: null, overflowed: false, dirty: false, queuedCount: 0, lastError: null, capability: { enabled: false, mode: "fixture", reason: "native_watcher_unavailable", trustedRootRequired: true, debounceMs: 500, maxQueueSize: 10000, overflowAction: "warn", readDiffOnly: true } }, mvp10: { terminal: { proposals: [], activeProposal: null, approvalState: null, token: null, executionResult: null, stage: "idle", capability: { enabled: false, mode: "disabled", reason: "native_terminal_unavailable", allowlistSummary: "MVP10 verification commands only", trustedRootRequired: true, approvalRequired: true, timeoutMs: 60_000, outputLimitBytes: 1_048_576, outputLimitLines: 5_000 } } } }), terminal: { getState: () => ({ proposals: [], activeProposal: null, approvalState: null, executionResult: null, stage: "idle" }), propose: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn(), reset: vi.fn(), subscribe: () => () => {}, replayTask: vi.fn() }, browser: { getState: () => ({ request: null, session: null, artifact: null, stage: "idle", blockedReason: null, capability: { enabled: false, mode: "disabled", reason: "fixture", localhostAllowed: true, loopbackAllowed: true, fileAllowed: true, externalBlocked: true }, lastError: null }), requestPreview: vi.fn(async () => {}), launchPreview: vi.fn(async () => {}), reset: vi.fn(), subscribe: () => () => {}, replayTask: vi.fn(), refreshCapability: vi.fn(async () => ({ enabled: false, mode: "disabled" as const, reason: "fixture", localhostAllowed: true, loopbackAllowed: true, fileAllowed: true, externalBlocked: true })) }, screenshot: { getState: () => ({ request: null, result: null, stage: "idle", evidence: null }), requestCapture: vi.fn(), approve: vi.fn(), deny: vi.fn(), reset: vi.fn(), subscribe: () => () => {}, replayTask: vi.fn() }, watcher: { getState: () => ({ session: null, events: [], diff: null, stage: "idle", stopReason: null, overflowed: false }), start: vi.fn(), generateChanges: vi.fn(), computeDiff: vi.fn(), applyChanges: vi.fn(), rescan: vi.fn(), stop: vi.fn(), reset: vi.fn(), subscribe: () => () => {}, replayTask: vi.fn() }, mvp10: { terminal: { refreshCapability: vi.fn(async () => ({ enabled: false, mode: "disabled" as const, reason: "native_terminal_unavailable", allowlistSummary: "MVP10 verification commands only", trustedRootRequired: true, approvalRequired: true, timeoutMs: 60_000, outputLimitBytes: 1_048_576, outputLimitLines: 5_000 })), propose: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn(), reset: vi.fn(), getState: () => ({ proposals: [], activeProposal: null, approvalState: null, token: null, executionResult: null, stage: "idle" }), subscribe: () => () => {} }, getState: () => ({ terminal: { proposals: [], activeProposal: null, approvalState: null, token: null, executionResult: null, stage: "idle" } }), subscribe: vi.fn(), getAuditEngine: vi.fn(), getSessionEngine: vi.fn(), replayTask: vi.fn() }, subscribe: () => () => {}, getAuditEngine: vi.fn(), getSessionEngine: vi.fn(), replayTask: vi.fn() }),
    getTextMutationAdapter: () => null,
    getEditorObservationAdapter: () => null,
    subscribeMvp9: () => () => {},
  };
}

function renderSafetyPanelWithPendingApproval(
  runtimeClient: DesktopRuntimeAdapter,
  runtime: RuntimeSnapshot,
) {
  render(
    <UIProvider initialState={{ runtime }} runtimeClient={runtimeClient}>
      <InspectorPane open />
    </UIProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Safety" }));
}

async function flushRuntimeSubmitMicrotasks() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("InspectorPane", () => {
  it("renders with open class when open=true", () => {
    const { container } = renderInspector(true);
    const aside = container.querySelector(".ua-inspector");
    expect(aside?.classList.contains("ua-inspector--open")).toBe(true);
    expect(aside?.getAttribute("aria-label")).toBe("Utility drawer");
    expect(aside?.getAttribute("aria-hidden")).toBe("false");
    expect(aside?.getAttribute("data-state")).toBe("open");
    expect(screen.getByText("Tools")).toBeTruthy();
  });

  it("renders with closed class when open=false", () => {
    const { container } = renderInspector(false);
    const aside = container.querySelector(".ua-inspector");
    expect(aside?.classList.contains("ua-inspector--closed")).toBe(true);
    expect(aside?.getAttribute("aria-hidden")).toBe("true");
    expect(aside?.getAttribute("data-state")).toBe("closed");
  });

  it("shows a close button when onClose is provided", () => {
    renderInspector(true, () => {});
    expect(screen.getByLabelText("Close tools")).toBeTruthy();
  });

  it("does not show a close button when onClose is omitted", () => {
    renderInspector(true);
    expect(screen.queryByLabelText("Close tools")).toBeNull();
  });

  describe("utility tools", () => {
    it("renders utility tool tabs with tablist semantics", () => {
      renderInspector();
      const tablist = screen.getByRole("tablist", { name: "Utility tools" });
      expect(tablist).toBeTruthy();

      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent)).toEqual([
        "Review",
        "Diagnostics",
        "Runtime",
        "Agent Trace",
        "Safety",
        "Audit",
        "Changes",
        "Terminal",
        "Browser",
        "Screenshot",
        "Files",
        "Evidence",
        "UE",
        "Assets",
        "MCP",
        "Logs",
        "Asset Search",
      ]);
    });

    it("marks Review as the default active utility tool", () => {
      renderInspector();
      const reviewTab = screen.getByRole("tab", { name: "Review" });
      expect(reviewTab.getAttribute("aria-selected")).toBe("true");
      expect(reviewTab.classList.contains("ua-inspector__tab--active")).toBe(true);
      expect(screen.getByText("Review queue")).toBeTruthy();
      expect(screen.getByLabelText("Review panel")).toBeTruthy();
    });

    it("marks Diagnostics as not selected by default", () => {
      renderInspector();
      const diagTab = screen.getByRole("tab", { name: "Diagnostics" });
      expect(diagTab.getAttribute("aria-selected")).toBe("false");
    });

    it("switches to Diagnostics tab on click", () => {
      renderInspector();
      const diagTab = screen.getByRole("tab", { name: "Diagnostics" });
      fireEvent.click(diagTab);
      expect(diagTab.getAttribute("aria-selected")).toBe("true");
      expect(diagTab.classList.contains("ua-inspector__tab--active")).toBe(true);
      expect(screen.getByRole("tab", { name: "Review" }).getAttribute("aria-selected")).toBe(
        "false",
      );
    });

    it("switches back to Review tab from Diagnostics", () => {
      renderInspector();
      const diagTab = screen.getByRole("tab", { name: "Diagnostics" });
      fireEvent.click(diagTab);
      const reviewTab = screen.getByRole("tab", { name: "Review" });
      fireEvent.click(reviewTab);
      expect(reviewTab.getAttribute("aria-selected")).toBe("true");
      expect(diagTab.getAttribute("aria-selected")).toBe("false");
    });

    it.each([
      ["Logs"],
      ["Asset Search"],
    ])("keeps %s as a disabled future tool placeholder", (toolName) => {
      renderInspector();
      const tab = screen.getByRole("tab", { name: toolName });
      fireEvent.click(tab);

      expect(tab.getAttribute("aria-selected")).toBe("false");
      expect(tab.getAttribute("aria-disabled")).toBe("true");
      expect(tab.getAttribute("aria-describedby")).toMatch(/^ua-coming-soon-tooltip-/);
      expect(screen.getByRole("tab", { name: "Review" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getByRole("tooltip", { name: new RegExp(toolName) })).toBeTruthy();
    });

    it("switches to the active UE editor panel", () => {
      renderInspector();
      const tab = screen.getByRole("tab", { name: "UE" });
      fireEvent.click(tab);

      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(tab.getAttribute("aria-disabled")).toBeNull();
      expect(screen.getByLabelText("Editor panel")).toBeTruthy();
    });

    it("shows runtime-derived safety, audit, and changes panels without active task", () => {
      renderInspector();

      fireEvent.click(screen.getByRole("tab", { name: "Safety" }));
      expect(screen.getByText("No active task. Submit a task to see safety state.")).toBeTruthy();

      fireEvent.click(screen.getByRole("tab", { name: "Audit" }));
      expect(screen.getByText("No active task. Submit a task to see audit events.")).toBeTruthy();

      fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
      expect(screen.getByText("No active task. Submit a task to see change events.")).toBeTruthy();
    });

    it.each([
      ["Approve", "approved", "Approved via Safety panel"],
      ["Deny", "denied", "Denied via Safety panel"],
      ["Cancel task", "cancelled", "Cancelled via Safety panel"],
    ] as const)(
      "submits an approval decision when %s is clicked",
      (buttonName, decision, reason) => {
        const { runtime, taskId, stepId } = createPendingApprovalRuntimeState();
        const runtimeClient = createSpyRuntimeAdapter(runtime);

        renderSafetyPanelWithPendingApproval(runtimeClient, runtime);

        fireEvent.click(screen.getByRole("button", { name: buttonName }));

        expect(runtimeClient.submitApprovalDecision).toHaveBeenCalledWith(
          taskId,
          stepId,
          decision,
          "user",
          reason,
        );
      },
    );

    it("switches Evidence to review evidence without collecting live evidence", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));

      expect(screen.getByRole("tabpanel", { name: "Evidence" })).toBeTruthy();
      expect(screen.getByText("Review evidence")).toBeTruthy();
      expect(screen.getByText("Mock only")).toBeTruthy();
      expect(screen.getByText("No live evidence collection")).toBeTruthy();
      expect(screen.getByText("Workspace skeleton render")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Future evidence capture" }).hasAttribute("disabled"),
      ).toBe(true);
    });

    it("shows Agent observation and evidence summaries for the active runtime task", async () => {
      await renderRuntimeInspector();

      fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));

      expect(
        (await screen.findAllByText('Mock observation for "Review Lyra asset loading risks".'))
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        (await screen.findAllByText("mock-runtime")).length,
      ).toBeGreaterThanOrEqual(1);
      expect(await screen.findByText("evidence-0001")).toBeTruthy();
    });
  });

  describe("ReviewPanel", () => {
    it("renders review summary cards", () => {
      renderInspector();
      const panel = screen.getByLabelText("Review panel");
      expect(panel).toBeTruthy();
      expect(screen.getByText("Review: Mock ready")).toBeTruthy();
      expect(screen.getByText("No blocking issues")).toBeTruthy();
    });

    it("renders current runtime review context when a task is active", async () => {
      await renderRuntimeInspector();

      expect(await screen.findByText("Review Lyra asset loading risks")).toBeTruthy();
      expect(
        (await screen.findAllByText("read-only completed: Agent loop finished without write actions."))
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        (await screen.findAllByText('Mock observation for "Review Lyra asset loading risks".'))
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(await screen.findByText("evidence-0001")).toBeTruthy();
    });

    it("renders the Findings section with at least 2 findings", () => {
      renderInspector();
      expect(screen.getByText("Findings")).toBeTruthy();
      const articles = screen.getAllByRole("article");
      expect(articles.length).toBeGreaterThanOrEqual(2);
    });

    it("renders finding severities from mock data", () => {
      renderInspector();
      for (const finding of reviewFindings) {
        expect(screen.getByText(finding.title)).toBeTruthy();
      }
      expect(screen.getByText("Passed")).toBeTruthy();
      expect(screen.getAllByText("Info").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Warning")).toBeTruthy();
    });

    it("renders the evidence checklist section", () => {
      renderInspector();
      expect(screen.getByText("Evidence checklist")).toBeTruthy();
      expect(screen.getByText("Mock evidence", { exact: false })).toBeTruthy();
      expect(screen.getByText("Workspace skeleton render")).toBeTruthy();
      expect(screen.getByText("Sidebar nav & project tree")).toBeTruthy();
      expect(screen.getByText("No real UE/MCP/LLM calls")).toBeTruthy();
      expect(screen.getByText("Theme tokens applied")).toBeTruthy();
    });
  });

  describe("DiagnosticsPanel", () => {
    it("renders Diagnostics panel after tab switch", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      const panel = screen.getByLabelText("Diagnostics panel");
      expect(panel).toBeTruthy();
    });

    it("shows diagnostic summary status", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(screen.getByText(diagnosticSummary.status)).toBeTruthy();
    });

    it("shows failed runtime diagnostics for the current task", async () => {
      await renderRuntimeInspector("Review lighting #fail");

      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(await screen.findByText("Task failed")).toBeTruthy();
      expect((await screen.findAllByText("Mock failure injected by #fail.")).length).toBeGreaterThanOrEqual(
        1,
      );
    });

    it("shows blocked policy diagnostics for mutating runtime intent", async () => {
      await renderRuntimeInspector("Delete selected Lyra asset");

      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(await screen.findByText("MCP tool blocked")).toBeTruthy();
      expect(await screen.findByText("Mutating intent is outside MVP3 read-only boundaries.")).toBeTruthy();
    });

    it("renders the Runtime health section with diagnostic items", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(screen.getByText("Runtime health")).toBeTruthy();
      const panel = screen.getByLabelText("Diagnostics panel");
      for (const item of diagnosticSummary.items) {
        expect(panel.textContent).toContain(item.label);
        expect(screen.getByText(item.state)).toBeTruthy();
        expect(screen.getByText(item.description)).toBeTruthy();
      }
    });

    it("shows UE Not connected and Verifier Offline states", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(screen.getByText("Not connected")).toBeTruthy();
      expect(screen.getByText("Offline")).toBeTruthy();
      expect(screen.getByText("None")).toBeTruthy();
      expect(screen.getByText("Not accessed")).toBeTruthy();
    });

    it("switches back to Review panel and hides Diagnostics content", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(screen.getByLabelText("Diagnostics panel")).toBeTruthy();

      fireEvent.click(screen.getByRole("tab", { name: "Review" }));
      expect(screen.queryByLabelText("Diagnostics panel")).toBeNull();
      expect(screen.getByLabelText("Review panel")).toBeTruthy();
    });
  });

  describe("Runtime tab", () => {
    it("shows active task runtime state and event count", async () => {
      renderRuntimeInspectorShell();
      await flushRuntimeSubmitMicrotasks();

      fireEvent.click(screen.getByRole("tab", { name: "Runtime" }));
      expect(screen.getByText("Runtime context")).toBeTruthy();
      expect(screen.getByText("completed")).toBeTruthy();
      expect(screen.getByText("18 events")).toBeTruthy();
      expect(screen.getByText("Plan: Review Lyra asset loading risks")).toBeTruthy();
      expect(screen.getByText("Current step: Record evidence")).toBeTruthy();
      expect(screen.getByText("Completed steps: 4")).toBeTruthy();
      expect(screen.getByText("Evidence: 2")).toBeTruthy();
      expect(screen.getAllByText("Mock runtime / no provider call").length).toBeGreaterThanOrEqual(
        1,
      );
    });

    it("disables cancellation after the active mock task reaches a terminal state", async () => {
      renderRuntimeInspectorShell();
      await flushRuntimeSubmitMicrotasks();

      fireEvent.click(screen.getByRole("tab", { name: "Runtime" }));

      expect(
        (screen.getByRole("button", { name: "Cancel mock task" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("does not cancel a terminal AgentLoop task", async () => {
      render(
        <UIProvider>
          <ComposerDock />
          <InspectorPane open />
        </UIProvider>,
      );
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Composer input"), {
          target: { value: "Review Lyra asset loading risks" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Send mock task" }));
      });
      await flushRuntimeSubmitMicrotasks();

      fireEvent.click(screen.getByRole("tab", { name: "Runtime" }));
      expect(screen.getByLabelText("Runtime panel").textContent).toContain("State: completed");
      expect(screen.getByText("18 events")).toBeTruthy();

      expect(
        (screen.getByRole("button", { name: "Cancel mock task" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(screen.queryByText("Task cancelled")).toBeNull();
    });
  });

  describe("Agent Trace tab", () => {
    it("shows the active task trace plan, steps, evidence, report, and blocked action", async () => {
      renderRuntimeInspectorShell("Delete selected Lyra asset");
      await flushRuntimeSubmitMicrotasks();

      fireEvent.click(screen.getByRole("tab", { name: "Agent Trace" }));

      expect(await screen.findByLabelText("Agent trace panel")).toBeTruthy();
      expect(await screen.findByText("Agent run trace")).toBeTruthy();
      expect((await screen.findAllByText("Delete selected Lyra asset")).length).toBeGreaterThanOrEqual(1);
      expect(await screen.findByText("Block mutating intent")).toBeTruthy();
      expect(await screen.findByText("Evidence refs: evidence-0001")).toBeTruthy();
      expect(
        (await screen.findAllByText("blocked mutating action: no write action was executed.")).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        (await screen.findAllByText("Mutating intent is outside MVP3 read-only boundaries.")).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("shows an empty trace state without an active task", () => {
      renderInspector();

      fireEvent.click(screen.getByRole("tab", { name: "Agent Trace" }));

      expect(screen.getByText("No active Agent trace")).toBeTruthy();
    });
  });

  describe("close button behavior", () => {
    it("calls onClose when close button is clicked", () => {
      let closed = false;
      renderInspector(true, () => {
        closed = true;
      });
      fireEvent.click(screen.getByLabelText("Close tools"));
      expect(closed).toBe(true);
    });
  });

  describe("forbidden content", () => {
    it("does not render audio capture controls", () => {
      const { container } = renderInspector();
      const blockedAudioNames = ["mic", "vo" + "ice", "rec" + "ord"];
      const audioControls = container.querySelectorAll(
        blockedAudioNames.map((name) => `[aria-label*="${name}" i]`).join(", "),
      );
      expect(audioControls.length).toBe(0);
    });

    it("does not render real verifier execute, network, or file system controls", () => {
      const { container } = renderInspector();
      const execButtons = container.querySelectorAll(
        '[aria-label*="execute" i], [aria-label*="run verifier" i], [aria-label*="fetch" i], [aria-label*="upload" i]',
      );
      expect(execButtons.length).toBe(0);
      expect(container.querySelectorAll("form").length).toBe(0);
    });
  });
});
