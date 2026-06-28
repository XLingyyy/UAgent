import {
  type ScreenshotCaptureRequest,
  type ScreenshotCaptureResult,
  type EvidenceRecord,
  type AuditEvent,
} from "@uagent/shared";
import {
  createFixtureScreenshotAdapter,
  type FixtureScreenshotAdapter,
} from "./mvp9-browser-screenshot.js";
import { createAuditProjection, type AuditProjectionEngine } from "./audit-projection.js";
import { createSessionHistory, type SessionHistoryEngine } from "./session-history.js";

export type ScreenshotStage = "idle" | "pending" | "completed" | "denied";

export interface ScreenshotServiceState {
  request: ScreenshotCaptureRequest | null;
  result: ScreenshotCaptureResult | null;
  stage: ScreenshotStage;
  evidence: EvidenceRecord | null;
}

let screenshotIdCounter = 0;

function nextId(prefix: string): string {
  screenshotIdCounter++;
  return `${prefix}-${screenshotIdCounter}`;
}

export interface ScreenshotService {
  getState(): ScreenshotServiceState;
  requestCapture(scope: string, reason: string, taskId: string | null): void;
  approve(): void;
  deny(reason: string): void;
  reset(): void;
  subscribe(listener: (state: ScreenshotServiceState) => void): () => void;
  replayTask(taskId: string): ScreenshotServiceState;
}

export function createScreenshotService(
  auditEngine?: AuditProjectionEngine,
  sessionEngine?: SessionHistoryEngine,
  adapter?: FixtureScreenshotAdapter,
): ScreenshotService {
  const screenshotAdapter = adapter ?? createFixtureScreenshotAdapter();
  const audit = auditEngine ?? createAuditProjection();
  const session = sessionEngine ?? createSessionHistory();
  const listeners = new Set<(state: ScreenshotServiceState) => void>();

  let state: ScreenshotServiceState = {
    request: null,
    result: null,
    stage: "idle",
    evidence: null,
  };

  function notify() {
    for (const listener of listeners) {
      listener({ ...state });
    }
  }

  function recordAudit(type: string, title: string, body: string, payload?: Record<string, unknown>) {
    audit.recordAuditEvent({
      id: nextId("audit"),
      type: type as AuditEvent["type"],
      taskId: state.request?.taskId ?? null,
      sessionId: "session-default",
      actor: { type: "fixture", id: "screenshot-service", label: "Screenshot Service" },
      title,
      body,
      summary: title,
      redacted: true,
      createdAt: Date.now(),
      payload,
    });
  }

  return {
    getState() {
      return { ...state };
    },

    requestCapture(scope: string, reason: string, taskId: string | null) {
      const req = screenshotAdapter.requestCapture(scope, reason, taskId);
      state = { request: req, result: null, stage: "pending", evidence: null };
      session.recordCapabilityEvent(
        taskId ?? "screenshot",
        "screenshot_requested",
        `Screenshot requested: ${scope}`,
        "screenshot",
        "pending",
      );
      recordAudit("screenshot_requested", "Screenshot requested", reason, { scope });
      notify();
    },

    approve() {
      const req = state.request;
      if (!req) return;
      const result = screenshotAdapter.captureResult(req.id, true);
      const evidence: EvidenceRecord = {
        id: nextId("evidence"),
        taskId: req.taskId ?? "screenshot",
        kind: "artifact_placeholder",
        title: "Screenshot capture",
        summary: `Screenshot captured: ${result.metadata.width}x${result.metadata.height}`,
        source: "capability-bridge",
        createdAt: Date.now(),
        payload: {
          artifactId: result.artifactId,
          mimeType: result.metadata.mimeType,
          dimensions: `${result.metadata.width}x${result.metadata.height}`,
          redacted: result.metadata.redacted,
        },
      };
      state = { ...state, result, stage: "completed", evidence };
      session.recordCapabilityEvent(
        req.taskId ?? "screenshot",
        "screenshot_captured",
        `Screenshot captured`,
        "screenshot",
        "completed",
      );
      recordAudit("screenshot_captured", "Screenshot captured",
        `Artifact: ${result.artifactId}, dimensions: ${result.metadata.width}x${result.metadata.height}`);
      notify();
    },

    deny(reason: string) {
      const req = state.request;
      if (!req) return;
      const result = screenshotAdapter.captureResult(req.id, false);
      state = { ...state, result, stage: "denied", evidence: null };
      session.recordCapabilityEvent(
        req.taskId ?? "screenshot",
        "screenshot_denied",
        `Screenshot denied: ${reason}`,
        "screenshot",
        "denied",
      );
      recordAudit("screenshot_denied", "Screenshot denied", reason);
      notify();
    },

    reset() {
      state = { request: null, result: null, stage: "idle", evidence: null };
      notify();
    },

    subscribe(listener: (state: ScreenshotServiceState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    replayTask(taskId: string): ScreenshotServiceState {
      const replay = session.replayTask(taskId);
      if (replay.summary.eventCount === 0) {
        return { request: null, result: null, stage: "idle", evidence: null };
      }
      const hasApproved = replay.events.some((e) => e.type === "screenshot_captured");
      const hasDenied = replay.events.some((e) => e.type === "screenshot_denied");
      const stage: ScreenshotStage =
        hasApproved ? "completed"
        : hasDenied ? "denied"
        : "pending";
      return { request: null, result: null, stage, evidence: null };
    },
  };
}
