import {
  type BrowserPreviewRequest,
  type BrowserPreviewSession,
  type PreviewArtifact,
  type AuditEvent,
} from "@uagent/shared";
import {
  createFixtureBrowserPreviewAdapter,
  classifyBrowserUrl,
  type FixtureBrowserPreviewAdapter,
} from "./mvp9-browser-screenshot.js";
import { createAuditProjection, type AuditProjectionEngine } from "./audit-projection.js";
import { createSessionHistory, type SessionHistoryEngine } from "./session-history.js";

export type BrowserStage = "idle" | "blocked" | "active" | "completed";

export interface BrowserServiceState {
  request: BrowserPreviewRequest | null;
  session: BrowserPreviewSession | null;
  artifact: PreviewArtifact | null;
  stage: BrowserStage;
  blockedReason: string | null;
}

const ALLOWED_LOCAL_PATTERNS = ["http://localhost", "http://127.0.0.1", "file://"];

let browserIdCounter = 0;

function nextId(prefix: string): string {
  browserIdCounter++;
  return `${prefix}-${browserIdCounter}`;
}

export interface BrowserService {
  getState(): BrowserServiceState;
  requestPreview(url: string, taskId: string | null): void;
  launchPreview(): void;
  reset(): void;
  subscribe(listener: (state: BrowserServiceState) => void): () => void;
  replayTask(taskId: string): BrowserServiceState;
}

export function createBrowserService(
  auditEngine?: AuditProjectionEngine,
  sessionEngine?: SessionHistoryEngine,
  adapter?: FixtureBrowserPreviewAdapter,
): BrowserService {
  const browserAdapter = adapter ?? createFixtureBrowserPreviewAdapter(ALLOWED_LOCAL_PATTERNS);
  const audit = auditEngine ?? createAuditProjection();
  const session = sessionEngine ?? createSessionHistory();
  const listeners = new Set<(state: BrowserServiceState) => void>();

  let state: BrowserServiceState = {
    request: null,
    session: null,
    artifact: null,
    stage: "idle",
    blockedReason: null,
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
      actor: { type: "fixture", id: "browser-service", label: "Browser Service" },
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

    requestPreview(url: string, taskId: string | null) {
      const classification = classifyBrowserUrl(url, ALLOWED_LOCAL_PATTERNS);

      if (classification.policy === "blocked_external") {
        state = {
          request: null,
          session: null,
          artifact: null,
          stage: "blocked",
          blockedReason: classification.reason,
        };
        session.recordCapabilityEvent(
          taskId ?? "browser",
          "browser_preview_blocked",
          `Browser blocked: ${url}`,
          "browser",
          "blocked",
        );
        recordAudit("browser_preview_blocked", "Browser blocked", classification.reason, { url });
        notify();
        return;
      }

      const req = browserAdapter.requestPreview(url, taskId);
      const sess = browserAdapter.getSession(req.id);
      state = {
        request: req,
        session: sess ?? null,
        artifact: null,
        stage: "active",
        blockedReason: null,
      };
      session.recordCapabilityEvent(
        taskId ?? "browser",
        "browser_preview_created",
        `Browser preview: ${url}`,
        "browser",
        "active",
      );
      recordAudit("browser_preview_created", "Browser preview created", url, { url });
      notify();
    },

    launchPreview() {
      if (!state.session) return;
      const art = browserAdapter.createArtifact(state.session.id);
      state = { ...state, artifact: art, stage: "completed" };
      session.recordCapabilityEvent(
        state.request?.taskId ?? "browser",
        "browser_preview_completed",
        `Browser preview completed`,
        "browser",
        "completed",
      );
      recordAudit("browser_preview_completed", "Browser preview completed", `Artifact: ${art.id}`);
      notify();
    },

    reset() {
      state = { request: null, session: null, artifact: null, stage: "idle", blockedReason: null };
      notify();
    },

    subscribe(listener: (state: BrowserServiceState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    replayTask(taskId: string): BrowserServiceState {
      const replay = session.replayTask(taskId);
      if (replay.summary.eventCount === 0) {
        return { request: null, session: null, artifact: null, stage: "idle", blockedReason: null };
      }
      const lastEvent = replay.events[replay.events.length - 1];
      const stage: BrowserStage =
        lastEvent?.type === "browser_preview_completed" ? "completed"
        : lastEvent?.type === "browser_preview_blocked" ? "blocked"
        : lastEvent?.type === "browser_preview_created" ? "active"
        : "idle";
      return { request: null, session: null, artifact: null, stage, blockedReason: null };
    },
  };
}
