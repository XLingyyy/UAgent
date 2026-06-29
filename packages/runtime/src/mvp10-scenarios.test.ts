import { afterEach, describe, it, expect, vi } from "vitest";
import { createMvp9RuntimeService } from "./mvp9-runtime-service.js";
import type { NativeBrowserAdapter } from "./mvp9-browser-screenshot.js";
import { MVP10_SCENARIOS, runMvp10ScenarioMatrix } from "./mvp10-scenarios.js";

describe("MVP10 scenario matrix", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(MVP10_SCENARIOS.map((s) => [s.name, s] as const))("%s", (_name, scenario) => {
    const assertions = scenario.run();
    const failures = assertions.filter((a) => !a.pass);
    if (failures.length > 0) {
      const messages = failures.map((f) => f.detail).join("; ");
      expect(failures, messages).toHaveLength(0);
    }
    expect(assertions.length).toBeGreaterThan(0);
  });

  it("reports matrix summary with correct total assertions", () => {
    const { results } = runMvp10ScenarioMatrix();
    const total = results.reduce((s, r) => s + r.passed + r.failed, 0);
    expect(total).toBeGreaterThanOrEqual(120);
    const failed = results.reduce((s, r) => s + r.failed, 0);
    expect(failed).toBe(0);
  });

  it("redacts browser file targets from state, audit, and replay serialization", async () => {
    const rawPath = "C:/Users/Alice/UAgent/output/report.html";
    const rawUrl = `file:///${rawPath}`;
    const nativeBrowserAdapter: NativeBrowserAdapter = {
      getCapability: () => ({
        enabled: true,
        mode: "native",
        reason: null,
        localhostAllowed: true,
        loopbackAllowed: true,
        fileAllowed: true,
        externalBlocked: true,
      }),
      refreshCapability: async () => ({
        enabled: true,
        mode: "native",
        reason: null,
        localhostAllowed: true,
        loopbackAllowed: true,
        fileAllowed: true,
        externalBlocked: true,
      }),
      classifyUrl: async () => ({
        sessionId: "session:file",
        session_id: "session:file",
        url: rawUrl,
        policy: "local_only",
        blocked: false,
        reason: "",
        displayUrl: "[local file] report.html",
        display_url: "[local file] report.html",
        needsTrustedRoot: false,
        needs_trusted_root: false,
      }),
      openPreview: async () => "window:file",
    };
    const service = createMvp9RuntimeService({ nativeBrowserAdapter });

    await service.browser.requestPreview(rawUrl, "task-browser-redaction");
    await service.browser.launchPreview();

    const serialized = JSON.stringify({
      state: service.getState().browser,
      audit: service.getAuditEngine().getProjection(),
      replay: service.replayTask("task-browser-redaction").browser,
      replayEvents: service.getSessionEngine().replayTask("task-browser-redaction").events,
    });

    expect(serialized).not.toContain(rawUrl);
    expect(serialized).not.toContain(rawPath);
    expect(serialized).not.toContain("C:/Users/Alice");
    expect(serialized).not.toContain("file:///");
    expect(serialized).toContain("[local file] report.html");
  });

  it("replays native browser completion without reopening native preview", async () => {
    let openPreviewCalls = 0;
    const nativeBrowserAdapter: NativeBrowserAdapter = {
      getCapability: () => ({
        enabled: true,
        mode: "native",
        reason: null,
        localhostAllowed: true,
        loopbackAllowed: true,
        fileAllowed: true,
        externalBlocked: true,
      }),
      refreshCapability: async () => ({
        enabled: true,
        mode: "native",
        reason: null,
        localhostAllowed: true,
        loopbackAllowed: true,
        fileAllowed: true,
        externalBlocked: true,
      }),
      classifyUrl: async () => ({
        sessionId: "session:localhost",
        session_id: "session:localhost",
        url: "http://localhost:5173",
        targetId: "browser-target:localhost",
        policy: "local_only",
        blocked: false,
        reason: "",
        displayTarget: "http://localhost:5173",
        displayUrl: "http://localhost:5173",
        display_url: "http://localhost:5173",
        needsTrustedRoot: false,
        needs_trusted_root: false,
      }),
      openPreview: async () => {
        openPreviewCalls++;
        return "window:localhost";
      },
    };
    const service = createMvp9RuntimeService({ nativeBrowserAdapter });

    await service.browser.requestPreview("http://localhost:5173", "task-browser-replay");
    await service.browser.launchPreview();
    const replay = service.replayTask("task-browser-replay").browser;

    expect(openPreviewCalls).toBe(1);
    expect(replay.stage).toBe("completed");
    expect(replay.session).toBeNull();
    expect(replay.artifact).toBeNull();
  });

  it("fails native browser launch when native open does not resolve", async () => {
    vi.useFakeTimers();
    const nativeBrowserAdapter: NativeBrowserAdapter = {
      getCapability: () => ({
        enabled: true,
        mode: "native",
        reason: null,
        localhostAllowed: true,
        loopbackAllowed: true,
        fileAllowed: true,
        externalBlocked: true,
      }),
      refreshCapability: async () => ({
        enabled: true,
        mode: "native",
        reason: null,
        localhostAllowed: true,
        loopbackAllowed: true,
        fileAllowed: true,
        externalBlocked: true,
      }),
      classifyUrl: async () => ({
        sessionId: "session:localhost",
        session_id: "session:localhost",
        url: "http://localhost:5173",
        targetId: "browser-target:localhost",
        policy: "local_only",
        blocked: false,
        reason: "",
        displayTarget: "http://localhost:5173",
        displayUrl: "http://localhost:5173",
        display_url: "http://localhost:5173",
        needsTrustedRoot: false,
        needs_trusted_root: false,
      }),
      openPreview: async () => new Promise<string>(() => {}),
    };
    const service = createMvp9RuntimeService({ nativeBrowserAdapter });

    await service.browser.requestPreview("http://localhost:5173", "task-browser-timeout");
    const launch = service.browser.launchPreview();
    await vi.advanceTimersByTimeAsync(10_000);
    await launch;

    expect(service.getState().browser).toMatchObject({
      stage: "failed",
      lastError: "Native preview launch timed out",
    });
  });
});
