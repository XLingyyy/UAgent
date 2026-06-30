import type { UEEditorSession, UEEditorSessionMode } from "@uagent/shared";

export interface EditorSessionRegistryOptions {
  featureEnabled: boolean;
  trustedRootIds?: string[];
  ttlMs?: number;
  now?: () => number;
}

export interface EditorSessionAttachInput {
  projectId: string;
  rootId: string;
  uprojectDisplayPath: string;
  mode: UEEditorSessionMode;
}

export interface EditorSessionAttachResult {
  status: "attached" | "blocked";
  reason: string | null;
  session: UEEditorSession | null;
}

export interface EditorSessionRegistry {
  attach(input: EditorSessionAttachInput): EditorSessionAttachResult;
  launch(input: EditorSessionAttachInput): EditorSessionAttachResult;
  stop(sessionId: string): EditorSessionAttachResult;
  get(sessionId: string): UEEditorSession | null;
  isActive(sessionId: string): boolean;
  createReplaySummary(sessionId: string): UEEditorSession | null;
}

export function createEditorSessionRegistry(options: EditorSessionRegistryOptions): EditorSessionRegistry {
  const sessions = new Map<string, UEEditorSession>();
  const trustedRootIds = new Set(options.trustedRootIds ?? []);
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 120_000;
  let sequence = 0;

  function create(input: EditorSessionAttachInput, mode: UEEditorSessionMode): EditorSessionAttachResult {
    if (!options.featureEnabled) return { status: "blocked", reason: "feature_disabled", session: null };
    if (!trustedRootIds.has(input.rootId)) return { status: "blocked", reason: "untrusted_root", session: null };
    if (!input.uprojectDisplayPath.startsWith("[project-root]/") || !input.uprojectDisplayPath.endsWith(".uproject")) {
      return { status: "blocked", reason: "missing_uproject", session: null };
    }
    const createdAt = now();
    const session: UEEditorSession = {
      sessionId: `editor-session:${++sequence}`,
      projectId: input.projectId,
      rootId: input.rootId,
      uprojectDisplayPath: input.uprojectDisplayPath,
      mode,
      status: mode === "launched" ? "launched" : "attached",
      createdAt,
      expiresAt: createdAt + ttlMs,
      replayOnly: false,
    };
    sessions.set(session.sessionId, session);
    return { status: "attached", reason: null, session };
  }

  return {
    attach: (input) => create(input, input.mode === "fixture" ? "fixture" : "attached"),
    launch: (input) => create(input, "launched"),
    stop(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return { status: "blocked", reason: "session_not_found", session: null };
      const stopped: UEEditorSession = { ...session, status: "stopped" };
      sessions.set(sessionId, stopped);
      return { status: "attached", reason: null, session: stopped };
    },
    get(sessionId) {
      const session = sessions.get(sessionId) ?? null;
      if (!session) return null;
      if (now() > session.expiresAt && session.status !== "stopped") {
        const expired: UEEditorSession = { ...session, status: "expired" };
        sessions.set(sessionId, expired);
        return expired;
      }
      return session;
    },
    isActive(sessionId) {
      const session = this.get(sessionId);
      return !!session && (session.status === "attached" || session.status === "launched") && now() <= session.expiresAt;
    },
    createReplaySummary(sessionId) {
      const session = sessions.get(sessionId);
      return session ? { ...session, replayOnly: true } : null;
    },
  };
}
