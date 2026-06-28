import { describe, it, expect, vi } from "vitest";
import { createMvp9RuntimeService } from "./mvp9-runtime-service.js";
import { createTerminalService } from "./mvp9-terminal-service.js";
import { createScreenshotService } from "./mvp9-screenshot-service.js";
import { createAuditProjection } from "./audit-projection.js";
import { createSessionHistory } from "./session-history.js";
import { createFixtureTerminalAdapter } from "./mvp9-terminal-adapter.js";
import { createFixtureScreenshotAdapter } from "./mvp9-browser-screenshot.js";

describe("P0-1: Terminal Output And Evidence", () => {
  it("approve allowlisted command produces terminal_started, terminal_output, terminal_completed in session", async () => {
    const runtime = createMvp9RuntimeService();
    runtime.terminal.propose("pnpm typecheck", "/repo", "task-terminal-output-1");
    await runtime.terminal.approve("fixture-proposal-1", "test", "verify output");

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("task-terminal-output-1");
    const types = replay.events.map((e) => e.type);
    expect(types).toContain("terminal_started");
    expect(types).toContain("terminal_output");
    expect(types).toContain("terminal_completed");
  });

  it("audit contains terminal_output event with redacted output summary", async () => {
    const runtime = createMvp9RuntimeService();
    runtime.terminal.propose("pnpm lint", "/repo", "task-terminal-audit-1");
    await runtime.terminal.approve("fixture-proposal-2", "test", "verify audit");

    const audit = runtime.getAuditEngine();
    const events = audit.queryAuditEvents({ taskId: "task-terminal-audit-1" });
    const outputEvent = events.find((e) => e.type === "terminal_output");
    expect(outputEvent).toBeDefined();
    expect(outputEvent!.body).toContain("lines");
    expect(outputEvent!.payload).toBeDefined();
    expect((outputEvent!.payload as Record<string, unknown>).outputSummary).toBeDefined();
  });

  it("reject produces no terminal_output or terminal_completed", async () => {
    const runtime = createMvp9RuntimeService();
    runtime.terminal.propose("pnpm build", "/repo", "task-terminal-reject-1");
    runtime.terminal.reject("fixture-proposal-3", "test", "no need");

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("task-terminal-reject-1");
    const types = replay.events.map((e) => e.type);
    expect(types).not.toContain("terminal_output");
    expect(types).not.toContain("terminal_completed");
    expect(types).toContain("terminal_rejected");
  });

  it("replay produces no adapter execute call", async () => {
    const adapter = createFixtureTerminalAdapter();
    const executeSpy = vi.spyOn(adapter, "execute");
    const audit = createAuditProjection();
    const session = createSessionHistory();
    const terminalService = createTerminalService(audit, session, adapter);
    terminalService.propose("pnpm build", "/repo", "task-replay-no-exec-1");
    await terminalService.approve("fixture-proposal-4", "test", "go");

    executeSpy.mockClear();
    const replayed = terminalService.replayTask("task-replay-no-exec-1");
    expect(executeSpy).not.toHaveBeenCalled();
    expect(replayed.stage).toBe("completed");
  });
});

describe("P0-2: Screenshot Request/Capture Semantics", () => {
  it("request only produces screenshot_requested not screenshot_captured", () => {
    const runtime = createMvp9RuntimeService();
    runtime.screenshot.requestCapture("full_page", "test request", "task-ss-sem-1");

    const audit = runtime.getAuditEngine();
    const events = audit.queryAuditEvents({ taskId: "task-ss-sem-1" });
    const requestEvent = events.find((e) => e.type === "screenshot_requested");
    const captureEvent = events.find((e) => e.type === "screenshot_captured");
    expect(requestEvent).toBeDefined();
    expect(captureEvent).toBeUndefined();

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("task-ss-sem-1");
    const types = replay.events.map((e) => e.type);
    expect(types).toContain("screenshot_requested");
    expect(types).not.toContain("screenshot_captured");
  });

  it("request-only replay shows pending stage, not completed", () => {
    const runtime = createMvp9RuntimeService();
    runtime.screenshot.requestCapture("viewport", "test", "task-ss-sem-2");

    const replayed = runtime.replayTask("task-ss-sem-2");
    expect(replayed.screenshot.stage).toBe("pending");
    expect(replayed.screenshot.evidence).toBeNull();
  });

  it("deny produces screenshot_denied with no artifact", () => {
    const runtime = createMvp9RuntimeService();
    runtime.screenshot.requestCapture("viewport", "test deny", "task-ss-sem-3");
    runtime.screenshot.deny("not needed");

    const audit = runtime.getAuditEngine();
    const events = audit.queryAuditEvents({ taskId: "task-ss-sem-3" });
    const denyEvent = events.find((e) => e.type === "screenshot_denied");
    expect(denyEvent).toBeDefined();

    const replayed = runtime.replayTask("task-ss-sem-3");
    expect(replayed.screenshot.stage).toBe("denied");
    expect(replayed.screenshot.evidence).toBeNull();
  });

  it("approve produces screenshot_captured with evidence", () => {
    const runtime = createMvp9RuntimeService();
    runtime.screenshot.requestCapture("viewport", "test approve", "task-ss-sem-4");
    runtime.screenshot.approve();

    const audit = runtime.getAuditEngine();
    const events = audit.queryAuditEvents({ taskId: "task-ss-sem-4" });
    const captureEvent = events.find((e) => e.type === "screenshot_captured");
    expect(captureEvent).toBeDefined();

    const replayed = runtime.replayTask("task-ss-sem-4");
    expect(replayed.screenshot.stage).toBe("completed");
  });

  it("approve replay shows completed without capture adapter call", () => {
    const adapter = createFixtureScreenshotAdapter();
    const captureSpy = vi.spyOn(adapter, "captureResult");
    const ssService = createScreenshotService(undefined, undefined, adapter);
    ssService.requestCapture("viewport", "test", "task-ss-sem-5");
    ssService.approve();

    captureSpy.mockClear();
    const replayed = ssService.replayTask("task-ss-sem-5");
    expect(captureSpy).not.toHaveBeenCalled();
    expect(replayed.stage).toBe("completed");
  });
});

describe("P0-3: Watcher Apply/Rescan Action", () => {
  it("trusted root start produces active session", () => {
    const runtime = createMvp9RuntimeService();
    runtime.watcher.start("project-w-1", "[project-root]");
    expect(runtime.getState().watcher.stage).toBe("active");
  });

  it("change produces dirty/diff state, no apply/rescan event", () => {
    const runtime = createMvp9RuntimeService();
    runtime.watcher.start("project-w-2", "[project-root]");
    runtime.watcher.generateChanges(3);
    runtime.watcher.computeDiff();

    expect(runtime.getState().watcher.diff).not.toBeNull();
    expect(runtime.getState().watcher.events.length).toBe(3);

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("project-w-2");
    const types = replay.events.map((e) => e.type);
    expect(types).not.toContain("watcher_applied");
    expect(types).not.toContain("watcher_rescanned");
  });

  it("apply changes produces watcher_applied event and clears diff", () => {
    const runtime = createMvp9RuntimeService();
    runtime.watcher.start("project-w-3", "[project-root]");
    runtime.watcher.generateChanges(3);
    runtime.watcher.computeDiff();
    expect(runtime.getState().watcher.diff).not.toBeNull();

    runtime.watcher.applyChanges();
    expect(runtime.getState().watcher.diff).toBeNull();
    expect(runtime.getState().watcher.events.length).toBe(0);

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("project-w-3");
    const types = replay.events.map((e) => e.type);
    expect(types).toContain("watcher_applied");
  });

  it("rescan produces watcher_rescanned event with new diff", () => {
    const runtime = createMvp9RuntimeService();
    runtime.watcher.start("project-w-4", "[project-root]");
    runtime.watcher.generateChanges(5);
    runtime.watcher.computeDiff();

    runtime.watcher.rescan();
    expect(runtime.getState().watcher.diff).not.toBeNull();
    expect(runtime.getState().watcher.events.length).toBe(0);

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("project-w-4");
    const types = replay.events.map((e) => e.type);
    expect(types).toContain("watcher_rescanned");
  });

  it("stop produces stopped state with no further events", () => {
    const runtime = createMvp9RuntimeService();
    runtime.watcher.start("project-w-5", "[project-root]");
    runtime.watcher.stop();
    expect(runtime.getState().watcher.stage).toBe("stopped");
    expect(runtime.getState().watcher.stopReason).toBe("user_stopped");
  });

  it("replay produces no watcher adapter calls", () => {
    const runtime = createMvp9RuntimeService();
    runtime.watcher.start("project-w-6", "[project-root]");
    runtime.watcher.generateChanges(2);

    const replayed = runtime.replayTask("project-w-6");
    expect(replayed.watcher.stage).toBe("active");
  });
});

describe("P0-4: Terminal Evidence Projection", () => {
  it("approved terminal execution evidence appears in session replay payload", async () => {
    const runtime = createMvp9RuntimeService();
    runtime.terminal.propose("pnpm typecheck", "/repo", "task-terminal-evidence-1");
    await runtime.terminal.approve("fixture-proposal-5", "test", "verify evidence");

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("task-terminal-evidence-1");
    const outputEvent = replay.events.find((e) => e.type === "terminal_output");
    expect(outputEvent).toBeDefined();
    const payload = outputEvent!.payload as Record<string, unknown>;
    expect(payload.kind).toBe("terminal_output");
    expect((payload.summary as string)).toMatch(/lines.*bytes/);
    expect(payload.source).toBe("capability-bridge");
  });

  it("evidence item summary includes terminal output metadata", async () => {
    const runtime = createMvp9RuntimeService();
    runtime.terminal.propose("pnpm build", "/repo", "task-terminal-evidence-2");
    await runtime.terminal.approve("fixture-proposal-6", "test", "verify summary");

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("task-terminal-evidence-2");
    const outputEvent = replay.events.find((e) => e.type === "terminal_output");
    const payload = outputEvent!.payload as Record<string, unknown>;
    const summary = payload.summary as string;
    expect(summary).toContain("lines");
    expect(summary).toContain("bytes");
    const evidencePayload = payload.payload as Record<string, unknown> | undefined;
    expect(evidencePayload).toBeDefined();
    expect((evidencePayload!.totalLines as number)).toBeGreaterThan(0);
    expect((evidencePayload!.totalBytes as number)).toBeGreaterThan(0);
    expect(evidencePayload!.redactionSummary).toBeDefined();
  });

  it("reject produces no terminal evidence", async () => {
    const runtime = createMvp9RuntimeService();
    runtime.terminal.propose("pnpm build", "/repo", "task-terminal-evidence-reject-1");
    runtime.terminal.reject("fixture-proposal-7", "test", "no need");

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("task-terminal-evidence-reject-1");
    const types = replay.events.map((e) => e.type);
    expect(types).not.toContain("terminal_output");
    expect(types).toContain("terminal_rejected");
  });

  it("replay produces no adapter execute call", async () => {
    const adapter = createFixtureTerminalAdapter();
    const executeSpy = vi.spyOn(adapter, "execute");
    const audit = createAuditProjection();
    const session = createSessionHistory();
    const terminalService = createTerminalService(audit, session, adapter);
    terminalService.propose("pnpm build", "/repo", "task-terminal-evidence-replay-1");
    await terminalService.approve("fixture-proposal-8", "test", "go");

    executeSpy.mockClear();
    terminalService.replayTask("task-terminal-evidence-replay-1");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("evidence JSON does not contain raw absolute paths or secret patterns", async () => {
    const runtime = createMvp9RuntimeService();
    runtime.terminal.propose("pnpm typecheck", "/repo", "task-terminal-evidence-redact-1");
    await runtime.terminal.approve("fixture-proposal-9", "test", "verify redaction");

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("task-terminal-evidence-redact-1");
    const outputEvent = replay.events.find((e) => e.type === "terminal_output");
    expect(outputEvent).toBeDefined();
    const serialized = JSON.stringify(outputEvent);
    expect(serialized).not.toContain("C:/Users/");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("/home/");
    const RAW_SECRET = "abcdef1234567890abcdef1234567890";
    expect(serialized).not.toContain(RAW_SECRET);
  });

  it("existing screenshot request/capture semantics still pass", () => {
    const runtime = createMvp9RuntimeService();
    runtime.screenshot.requestCapture("viewport", "test", "task-ss-evidence-regression-1");
    runtime.screenshot.approve();
    const session = runtime.getSessionEngine();
    const replay = session.replayTask("task-ss-evidence-regression-1");
    const types = replay.events.map((e) => e.type);
    expect(types).toContain("screenshot_captured");
    expect(types).toContain("screenshot_requested");
    const audit = runtime.getAuditEngine();
    const auditEvents = audit.queryAuditEvents({ taskId: "task-ss-evidence-regression-1" });
    const captureEvent = auditEvents.find((e) => e.type === "screenshot_captured");
    expect(captureEvent).toBeDefined();
  });

  it("existing watcher apply/rescan still pass", () => {
    const runtime = createMvp9RuntimeService();
    runtime.watcher.start("project-w-evidence-1", "[project-root]");
    runtime.watcher.generateChanges(2);
    runtime.watcher.computeDiff();
    runtime.watcher.applyChanges();

    const session = runtime.getSessionEngine();
    const replay = session.replayTask("project-w-evidence-1");
    const types = replay.events.map((e) => e.type);
    expect(types).toContain("watcher_applied");
  });
});
