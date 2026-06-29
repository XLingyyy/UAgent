import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UIProvider } from "../app/providers";
import { BrowserPanel } from "./BrowserPanel";
import { ScreenshotPanel } from "./ScreenshotPanel";
import { WatcherPanel } from "./WatcherPanel";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import type { ProjectProfile } from "@uagent/shared";

function renderWithUI(component: React.ReactElement) {
  return render(<UIProvider>{component}</UIProvider>);
}

const activeTrustedProject: ProjectProfile = {
  id: "project-active-browser",
  name: "Active Browser Project",
  rootRef: "root:active-browser-project",
  displayRoot: "[project-root]",
  trustState: "trusted",
  indexStatus: "ready",
  engine: { label: "UE 5.8", association: "5.8", source: "fixture" },
  createdAt: 1,
  updatedAt: 1,
};

function renderWatcherWithState(watcher: unknown) {
  return render(
    <UIProvider
      initialState={{
        runtime: {
          mvp9: {
            terminal: { proposals: [], activeProposal: null, approvalState: null, executionResult: null, stage: "idle" },
            browser: { request: null, session: null, artifact: null, stage: "idle", blockedReason: null, capability: { enabled: false, mode: "disabled", reason: "fixture", localhostAllowed: true, loopbackAllowed: true, fileAllowed: true, externalBlocked: true }, lastError: null },
            screenshot: { request: null, result: null, stage: "idle", evidence: null },
            watcher,
            mvp10: {
              terminal: {
                proposals: [],
                activeProposal: null,
                approvalState: null,
                token: null,
                executionResult: null,
                stage: "idle",
                capability: {
                  enabled: false,
                  mode: "disabled",
                  reason: "native_terminal_unavailable",
                  allowlistSummary: "MVP10 verification commands only",
                  trustedRootRequired: true,
                  approvalRequired: true,
                  timeoutMs: 60_000,
                  outputLimitBytes: 1_048_576,
                  outputLimitLines: 5_000,
                },
              },
            },
          } as never,
        },
      }}
    >
      <WatcherPanel />
    </UIProvider>,
  );
}

describe("BrowserPanel", () => {
  it("renders URL input", () => {
    renderWithUI(<BrowserPanel />);
    expect(screen.getByLabelText("URL input")).toBeTruthy();
    expect(screen.getByLabelText("Preview URL")).toBeTruthy();
  });

  it("classifies local URL as allowed and shows active", async () => {
    renderWithUI(<BrowserPanel />);
    const input = screen.getByLabelText("URL input");
    fireEvent.change(input, {
      target: { value: "http://localhost:3000/test" },
    });
    fireEvent.click(screen.getByLabelText("Preview URL"));
    await waitFor(() => {
      expect(screen.getByText(/Disabled/)).toBeTruthy();
      expect(screen.getAllByText(/active/).length).toBeGreaterThan(0);
      expect(screen.getByText("local_only")).toBeTruthy();
    });
  });

  it("blocks external URL and shows reason", async () => {
    renderWithUI(<BrowserPanel />);
    const input = screen.getByLabelText("URL input");
    fireEvent.change(input, {
      target: { value: "https://external-site.com" },
    });
    fireEvent.click(screen.getByLabelText("Preview URL"));
    await waitFor(() => {
      expect(screen.getByLabelText("Clear blocked URL")).toBeTruthy();
    });
  });

  it("does not auto-navigate on mount", () => {
    renderWithUI(<BrowserPanel />);
    expect(screen.getByText(/Real browser preview is disabled/)).toBeTruthy();
    expect(screen.queryByLabelText("Launch Preview")).toBeNull();
  });

  it("passes the active project root when requesting a trusted file preview", async () => {
    const runtimeClient = createDesktopRuntimeAdapter();
    const requestPreview = vi
      .spyOn(runtimeClient.getMvp9().browser, "requestPreview")
      .mockResolvedValue(undefined);

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{
          project: {
            activeProjectId: activeTrustedProject.id,
            registeredProjects: [activeTrustedProject],
          },
        }}
      >
        <BrowserPanel />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("URL input"), {
      target: { value: "file:///[project-root]/Saved/Automation/report.html" },
    });
    fireEvent.click(screen.getByLabelText("Preview URL"));

    await waitFor(() => {
      expect(requestPreview).toHaveBeenCalledWith(
        "file:///[project-root]/Saved/Automation/report.html",
        null,
        activeTrustedProject.rootRef,
      );
    });
  });
});

describe("ScreenshotPanel", () => {
  it("requests capture and shows pending state", () => {
    renderWithUI(<ScreenshotPanel />);
    fireEvent.click(screen.getByLabelText("Request screenshot capture"));
    expect(screen.getByText(/Capture requires approval/)).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
  });

  it("creates artifact on approve", () => {
    renderWithUI(<ScreenshotPanel />);
    fireEvent.click(screen.getByLabelText("Request screenshot capture"));
    fireEvent.click(screen.getByLabelText("Approve screenshot capture"));
    expect(screen.getByText("Capture completed")).toBeTruthy();
    expect(screen.getByText(/1920x1080/)).toBeTruthy();
    expect(screen.getByText(/image\/png/)).toBeTruthy();
  });

  it("blocks artifact on deny", () => {
    renderWithUI(<ScreenshotPanel />);
    fireEvent.click(screen.getByLabelText("Request screenshot capture"));
    fireEvent.click(screen.getByLabelText("Deny screenshot capture"));
    expect(screen.getByText("Capture denied")).toBeTruthy();
    expect(screen.getByText(/User denied screenshot capture request/)).toBeTruthy();
  });

  it("does not auto-capture on mount", () => {
    renderWithUI(<ScreenshotPanel />);
    expect(screen.getByText(/No active capture/)).toBeTruthy();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Deny")).toBeNull();
  });
});

describe("WatcherPanel", () => {
  it("starts session and shows active state", () => {
    renderWithUI(<WatcherPanel />);
    fireEvent.click(screen.getByLabelText("Start watching project root"));
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByLabelText("Read diff")).toBeTruthy();
    expect(screen.getByLabelText("Stop watching project root")).toBeTruthy();
  });

  it("reads diff and shows diff summary", () => {
    renderWithUI(<WatcherPanel />);
    fireEvent.click(screen.getByLabelText("Start watching project root"));
    fireEvent.click(screen.getByLabelText("Read diff"));
    expect(screen.getByText("Diff Summary")).toBeTruthy();
  });

  it("stops session and shows stopped state", () => {
    renderWithUI(<WatcherPanel />);
    fireEvent.click(screen.getByLabelText("Start watching project root"));
    fireEvent.click(screen.getByLabelText("Stop watching project root"));
    expect(screen.getByText("Stopped")).toBeTruthy();
  });

  it("does not auto-scan on mount", () => {
    renderWithUI(<WatcherPanel />);
    expect(screen.getByText("Idle")).toBeTruthy();
    expect(screen.queryByLabelText("Read diff")).toBeNull();
  });

  it("shows disabled native watcher capability instead of implying availability", () => {
    renderWatcherWithState({
      session: null,
      events: [],
      diff: null,
      stage: "idle",
      stopReason: null,
      overflowed: false,
      dirty: false,
      queuedCount: 0,
      lastError: null,
      capability: {
        enabled: false,
        mode: "disabled",
        reason: "feature_disabled",
        trustedRootRequired: true,
        debounceMs: 500,
        maxQueueSize: 10000,
        overflowAction: "warn",
        readDiffOnly: true,
      },
    });

    expect(screen.getByText(/Real watcher disabled/)).toBeTruthy();
    expect(screen.getByText(/feature_disabled/)).toBeTruthy();
  });

  it("shows native dirty and queued count without requiring a diff", () => {
    renderWatcherWithState({
      session: {
        id: "native-watch-1",
        projectId: "project-native-watch",
        rootRef: "root:native-watch",
        displayRoot: "[project-root]",
        status: "active",
        policy: {
          allowedRoots: [],
          ignoredDirs: [],
          ignorePatterns: [],
          maxQueueSize: 10000,
          debounceMs: 500,
          overflowAction: "warn",
        },
        startedAt: Date.now(),
        stoppedAt: null,
        stopReason: null,
        totalChanges: 0,
        overflowed: true,
      },
      events: [],
      diff: null,
      stage: "active",
      stopReason: null,
      overflowed: true,
      dirty: true,
      queuedCount: 4,
      lastError: null,
      capability: {
        enabled: true,
        mode: "native",
        reason: null,
        trustedRootRequired: true,
        debounceMs: 500,
        maxQueueSize: 10000,
        overflowAction: "warn",
        readDiffOnly: true,
      },
    });

    expect(screen.getByText("Dirty")).toBeTruthy();
    expect(screen.getByText(/Queued changes: 4/)).toBeTruthy();
    expect(screen.queryByText("Diff Summary")).toBeNull();
  });
});
