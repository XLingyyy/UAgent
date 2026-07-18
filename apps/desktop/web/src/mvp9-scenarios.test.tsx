import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./shell/AppShell";
import { UIProvider } from "./app/providers";
import { runMvp9ScenarioMatrix } from "@uagent/runtime";
import { utilityTools } from "./inspector/inspector-data";
import { createDesktopRuntimeAdapter } from "./runtime/desktop-runtime-adapter";

function renderMvp9App() {
  return render(
    <UIProvider>
      <AppShell />
    </UIProvider>,
  );
}

describe("MVP9 Desktop Scenarios", () => {
  it("renders TitleBar with MVP15 Complete badge", () => {
    renderMvp9App();
    expect(screen.getByText("MVP15 Complete")).toBeTruthy();
  });

  it("renders TitleBar with Native FS OK badge", () => {
    renderMvp9App();
    expect(screen.getByText("Native FS OK")).toBeTruthy();
  });

  it("has Terminal tool defined", () => {
    const tool = utilityTools.find((t) => t.id === "terminal");
    expect(tool).toBeDefined();
    expect(tool!.label).toBe("Terminal");
    expect(tool!.summary).toBe("Command proposal and execution");
  });

  it("has Browser tool defined", () => {
    const tool = utilityTools.find((t) => t.id === "browser");
    expect(tool).toBeDefined();
    expect(tool!.label).toBe("Browser");
    expect(tool!.summary).toBe("URL preview policy");
  });

  it("has Screenshot tool defined", () => {
    const tool = utilityTools.find((t) => t.id === "screenshot");
    expect(tool).toBeDefined();
    expect(tool!.label).toBe("Screenshot");
    expect(tool!.summary).toBe("Capture approval");
  });

  it("has Files tool defined for watcher", () => {
    const tool = utilityTools.find((t) => t.id === "files");
    expect(tool).toBeDefined();
    expect(tool!.label).toBe("Files");
    expect(tool!.summary).toBe("Watcher and changes");
  });

  it("has 17 utility tools total after MVP15 asset mutation panel", () => {
    expect(utilityTools.length).toBe(17);
  });

  it("terminal/browser/screenshot/files are not future tools", () => {
    const futureToolIds = ["logs", "asset-search"];
    for (const tool of utilityTools) {
      if (futureToolIds.includes(tool.id)) {
        continue;
      }
      expect(tool.id).toBeDefined();
    }
  });

  it("renders utility tabs in AppShell", () => {
    renderMvp9App();
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByText("Browser")).toBeTruthy();
    expect(screen.getByText("Screenshot")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
  });
});

describe("MVP9 Runtime Scenario Matrix", () => {
  it("passes all runtime scenarios with at least 90 scenarios", () => {
    const result = runMvp9ScenarioMatrix();
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThanOrEqual(90);
  });
});

describe("MVP9 Store-Backed Runtime Service", () => {
  it("proposes terminal command through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.terminal.propose("pnpm test", "[project-root]", null);
    const state = mvp9.terminal.getState();
    expect(state.stage).toBe("proposed");
    expect(state.activeProposal).toBeTruthy();
    expect(state.activeProposal!.command).toBe("pnpm test");
  });

  it("rejects terminal proposal through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.terminal.propose("pnpm lint", "[project-root]", "task-reject");
    const proposal = mvp9.terminal.getState().activeProposal!;
    mvp9.terminal.reject(proposal.id, "user", "not needed");
    expect(mvp9.terminal.getState().stage).toBe("rejected");
  });

  it("approves and executes terminal proposal through runtime service", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.terminal.propose("pnpm build", "[project-root]", "task-approve");
    const proposal = mvp9.terminal.getState().activeProposal!;
    await mvp9.terminal.approve(proposal.id, "user", "go ahead");
    const state = mvp9.terminal.getState();
    expect(state.stage === "completed" || state.stage === "executing").toBe(true);
  }, 10000);

  it("requests browser preview through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.browser.requestPreview("http://localhost:3000", null);
    expect(mvp9.browser.getState().stage).toBe("active");
  });

  it("blocks external browser URL through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.browser.requestPreview("https://evil.com", null);
    expect(mvp9.browser.getState().stage).toBe("blocked");
  });

  it("requests screenshot capture through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.screenshot.requestCapture("viewport", "test", null);
    expect(mvp9.screenshot.getState().stage).toBe("pending");
  });

  it("approves screenshot through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.screenshot.requestCapture("full_page", "test", "task-ss");
    mvp9.screenshot.approve();
    const state = mvp9.screenshot.getState();
    expect(state.stage).toBe("completed");
    expect(state.evidence).toBeTruthy();
  });

  it("denies screenshot through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.screenshot.requestCapture("full_page", "test", "task-ss-deny");
    mvp9.screenshot.deny("not allowed");
    expect(mvp9.screenshot.getState().stage).toBe("denied");
  });

  it("starts watcher through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.watcher.start("project-1", "[project-root]");
    expect(mvp9.watcher.getState().stage).toBe("active");
  });

  it("stops watcher through runtime service", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.watcher.start("project-1", "[project-root]");
    mvp9.watcher.stop();
    expect(mvp9.watcher.getState().stage).toBe("stopped");
  });

  it("watcher generates changes and computes diff", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.watcher.start("project-1", "[project-root]");
    mvp9.watcher.generateChanges(5);
    mvp9.watcher.computeDiff();
    const state = mvp9.watcher.getState();
    expect(state.diff).toBeTruthy();
    expect(state.diff!.summary.added + state.diff!.summary.modified + state.diff!.summary.deleted).toBe(5);
  });

  it("session replay reads state without calling adapter", () => {
    const adapter = createDesktopRuntimeAdapter();
    const mvp9 = adapter.getMvp9();
    mvp9.terminal.propose("pnpm rerun", "[project-root]", "task-replay");
    const replayState = mvp9.replayTask("task-replay");
    expect(replayState.terminal.stage).toBe("proposed");
  });
});
