import {
  type BrowserPreviewCapabilityStatus,
  type BrowserPreviewRequest,
  type BrowserPreviewSession,
  type BrowserPreviewTargetSummary,
  type PreviewArtifact,
  type AuditEvent,
} from "@uagent/shared";
import {
  createFixtureBrowserPreviewAdapter,
  classifyBrowserUrl,
  summarizeBrowserTarget,
  type FixtureBrowserPreviewAdapter,
  type NativeBrowserAdapter,
} from "./mvp9-browser-screenshot.js";
import { createAuditProjection, type AuditProjectionEngine } from "./audit-projection.js";
import { createSessionHistory, type SessionHistoryEngine } from "./session-history.js";

export type BrowserStage = "idle" | "blocked" | "active" | "completed" | "failed";

export interface BrowserServiceState {
  request: BrowserPreviewRequest | null;
  session: BrowserPreviewSession | null;
  artifact: PreviewArtifact | null;
  stage: BrowserStage;
  blockedReason: string | null;
  capability: BrowserPreviewCapabilityStatus;
  lastError: string | null;
}

const DEFAULT_BROWSER_CAPABILITY: BrowserPreviewCapabilityStatus = {
  enabled: false,
  mode: "disabled",
  reason: "feature_disabled",
  localhostAllowed: true,
  loopbackAllowed: true,
  fileAllowed: true,
  externalBlocked: true,
};

const ALLOWED_LOCAL_PATTERNS = [
  "http://localhost",
  "https://localhost",
  "http://127.0.0.1",
  "https://127.0.0.1",
];
const NATIVE_BROWSER_OPEN_TIMEOUT_MS = 10_000;

let browserIdCounter = 0;

function nextId(prefix: string): string {
  browserIdCounter++;
  return `${prefix}-${browserIdCounter}`;
}

async function withNativeBrowserOpenTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutOperation = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Native preview launch timed out"));
    }, NATIVE_BROWSER_OPEN_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeoutOperation]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export interface BrowserService {
  getState(): BrowserServiceState;
  requestPreview(url: string, taskId: string | null, trustedRootRef?: string | null): Promise<void>;
  launchPreview(): Promise<void>;
  reset(): void;
  subscribe(listener: (state: BrowserServiceState) => void): () => void;
  replayTask(taskId: string): BrowserServiceState;
  refreshCapability(): Promise<BrowserPreviewCapabilityStatus>;
}

export function createBrowserService(
  auditEngine?: AuditProjectionEngine,
  sessionEngine?: SessionHistoryEngine,
  adapter?: FixtureBrowserPreviewAdapter,
  nativeAdapter?: NativeBrowserAdapter,
): BrowserService {
  const browserAdapter = adapter ?? createFixtureBrowserPreviewAdapter(ALLOWED_LOCAL_PATTERNS);
  const audit = auditEngine ?? createAuditProjection();
  const session = sessionEngine ?? createSessionHistory();
  const listeners = new Set<(state: BrowserServiceState) => void>();
  const rawTargets = new Map<string, { url: string; trustedRootRef: string | null }>();

  let state: BrowserServiceState = {
    request: null,
    session: null,
    artifact: null,
    stage: "idle",
    blockedReason: null,
    capability: DEFAULT_BROWSER_CAPABILITY,
    lastError: null,
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

  function sessionEvent(
    eventType: string,
    title: string,
    status: string,
    target?: BrowserPreviewTargetSummary,
  ) {
    session.recordCapabilityEvent(
      state.request?.taskId ?? "browser",
      eventType,
      title,
      "browser",
      status,
      target ? { targetId: target.targetId, displayTarget: target.displayTarget, policy: target.policy } : undefined,
    );
  }

  function targetFromNativeResult(url: string, result: {
    policy: string;
    blocked: boolean;
    reason: string;
    targetId?: string;
    target_id?: string;
    displayTarget?: string | null;
    display_target?: string | null;
    displayUrl?: string | null;
    display_url?: string | null;
    needsTrustedRoot?: boolean;
    needs_trusted_root?: boolean;
  }): BrowserPreviewTargetSummary {
    const policy = result.policy === "local_only" ? "local_only" : "blocked_external";
    const base = summarizeBrowserTarget(
      url,
      policy,
      result.reason,
      result.blocked,
      result.needsTrustedRoot ?? result.needs_trusted_root ?? false,
    );
    return {
      ...base,
      targetId: result.targetId ?? result.target_id ?? base.targetId,
      displayTarget:
        result.displayTarget ?? result.display_target ?? result.displayUrl ?? result.display_url ?? base.displayTarget,
    };
  }

  function buildRequest(
    taskId: string | null,
    target: BrowserPreviewTargetSummary,
    policyReason: string,
  ): BrowserPreviewRequest {
    return {
      id: nextId("browser-req"),
      taskId,
      url: target.displayTarget,
      targetId: target.targetId,
      displayTarget: target.displayTarget,
      target,
      policy: target.policy,
      policyReason,
      requestedAt: Date.now(),
    };
  }

  function buildSession(request: BrowserPreviewRequest, target: BrowserPreviewTargetSummary): BrowserPreviewSession {
    return {
      id: nextId("browser-session"),
      requestId: request.id,
      url: target.displayTarget,
      displayUrl: target.displayTarget,
      targetId: target.targetId,
      displayTarget: target.displayTarget,
      target,
      status: "active",
      policy: target.policy,
      blockedReason: null,
      artifactId: null,
      createdAt: Date.now(),
      completedAt: null,
    };
  }

  function updateCapability(cap: BrowserPreviewCapabilityStatus) {
    state = { ...state, capability: cap };
    notify();
  }

  return {
    getState() {
      return { ...state };
    },

    async refreshCapability(): Promise<BrowserPreviewCapabilityStatus> {
      if (nativeAdapter?.refreshCapability) {
        const cap = await nativeAdapter.refreshCapability();
        updateCapability(cap);
        return cap;
      }
      const cap = { ...DEFAULT_BROWSER_CAPABILITY, reason: "native_adapter_unavailable" };
      updateCapability(cap);
      return cap;
    },

    async requestPreview(url: string, taskId: string | null, trustedRootRef?: string | null) {
      let classification: { policy: string; reason: string };
      let target: BrowserPreviewTargetSummary;

      if (nativeAdapter) {
        try {
          const result = await nativeAdapter.classifyUrl(url, trustedRootRef ?? undefined);
          classification = { policy: result.policy, reason: result.reason };
          target = targetFromNativeResult(url, result);
          const req = buildRequest(taskId, target, classification.reason);
          if (result.blocked) {
            state = {
              ...state,
              request: req,
              session: null,
              artifact: null,
              stage: "blocked",
              blockedReason: result.reason,
              lastError: null,
            };
            sessionEvent("browser_preview_blocked", `Browser blocked: ${target.displayTarget}`, "blocked", target);
            recordAudit("browser_preview_blocked", "Browser blocked", classification.reason, { target });
            notify();
            return;
          }
          const sess = buildSession(req, target);
          rawTargets.set(sess.id, { url, trustedRootRef: trustedRootRef ?? null });
          state = {
            ...state,
            request: req,
            session: sess,
            artifact: null,
            stage: "active",
            blockedReason: null,
            lastError: null,
          };
          sessionEvent("browser_preview_created", `Browser preview: ${target.displayTarget}`, "active", target);
          recordAudit("browser_preview_created", "Browser preview created", target.displayTarget, { target });
          notify();
          return;
        } catch (err) {
          state = {
            ...state,
            request: null,
            session: null,
            artifact: null,
            stage: "failed",
            blockedReason: null,
            lastError: err instanceof Error ? err.message : "Native classification failed",
          };
          notify();
          return;
        }
      } else {
        const c = classifyBrowserUrl(url, ALLOWED_LOCAL_PATTERNS, {
          requireTrustedRootForFile: true,
        });
        classification = c;
        target = summarizeBrowserTarget(url, c.policy, c.reason);
        if (c.policy === "blocked_external") {
          const req = buildRequest(taskId, target, c.reason);
          state = {
            ...state,
            request: req,
            session: null,
            artifact: null,
            stage: "blocked",
            blockedReason: c.reason,
            lastError: null,
          };
          sessionEvent("browser_preview_blocked", `Browser blocked: ${target.displayTarget}`, "blocked", target);
          recordAudit("browser_preview_blocked", "Browser blocked", c.reason, { target });
          notify();
          return;
        }
        const req = buildRequest(taskId, target, c.reason);
        const sess = buildSession(req, target);
        state = {
          ...state,
          request: req,
          session: sess,
          artifact: null,
          stage: "active",
          blockedReason: null,
          lastError: null,
        };
        sessionEvent("browser_preview_created", `Browser preview: ${target.displayTarget}`, "active", target);
        recordAudit("browser_preview_created", "Browser preview created", target.displayTarget, { target });
        notify();
        return;
      }
    },

    async launchPreview() {
      if (!state.session) return;
      const activeSession = state.session;

      if (nativeAdapter && state.request) {
        try {
          const rawTarget = rawTargets.get(activeSession.id);
          if (!rawTarget) throw new Error("Native preview target missing");
          const windowId = await withNativeBrowserOpenTimeout(
            nativeAdapter.openPreview(
              rawTarget.url,
              activeSession.id,
              rawTarget.trustedRootRef ?? undefined,
            ),
          );
          const art: PreviewArtifact = {
            id: `native-artifact-${Date.now()}`,
            kind: "browser_snapshot",
            source: "native-adapter",
            displayLabel: `Browser Preview (${windowId})`,
            mimeType: "text/html",
            byteSize: 0,
            capturedAt: Date.now(),
            redacted: true,
            thumbnailRef: null,
          };
          state = { ...state, artifact: art, stage: "completed" };
          sessionEvent("browser_preview_completed", "Browser preview completed", "completed", activeSession.target);
          recordAudit("browser_preview_completed", "Browser preview completed", `Native window: ${windowId}`, {
            targetId: activeSession.targetId,
            displayTarget: activeSession.displayTarget,
          });
          notify();
          return;
        } catch (err) {
          state = {
            ...state,
            stage: "failed",
            lastError: err instanceof Error ? err.message : "Native preview launch failed",
          };
          sessionEvent("browser_preview_completed", "Browser preview failed", "failed", activeSession.target);
          recordAudit("browser_preview_completed", "Browser preview failed", state.lastError!, {
            targetId: activeSession.targetId,
            displayTarget: activeSession.displayTarget,
          });
          notify();
          return;
        }
      }

      const art = browserAdapter.createArtifact(activeSession.id);
      state = { ...state, artifact: art, stage: "completed" };
      sessionEvent("browser_preview_completed", "Browser preview completed", "completed", activeSession.target);
      recordAudit("browser_preview_completed", "Browser preview completed", `Artifact: ${art.id}`);
      notify();
    },

    reset() {
      state = {
        request: null,
        session: null,
        artifact: null,
        stage: "idle",
        blockedReason: null,
        capability: state.capability,
        lastError: null,
      };
      rawTargets.clear();
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
        return {
          request: null,
          session: null,
          artifact: null,
          stage: "idle",
          blockedReason: null,
          capability: state.capability,
          lastError: null,
        };
      }
      const lastEvent = replay.events[replay.events.length - 1];
      const stage: BrowserStage =
        lastEvent?.type === "browser_preview_completed" ? "completed"
        : lastEvent?.type === "browser_preview_blocked" ? "blocked"
        : lastEvent?.type === "browser_preview_created" ? "active"
        : "idle";
      return {
        request: null,
        session: null,
        artifact: null,
        stage,
        blockedReason: null,
        capability: state.capability,
        lastError: null,
      };
    },
  };
}
