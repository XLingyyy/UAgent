import type { NativeRunStoreInvoke } from "./native-run-store";

export interface NativeCatalogSession {
  projectId: string;
  id: string;
  title: string;
  createdAt: number;
  archived: boolean;
  parentId: string | null;
  origin: "native" | "historicalTextCopy";
  messageCount: number;
  lastOrdinal: number;
  latestRunId: string | null;
}
export interface NativeSessionPage {
  titleQuery?: string;
  schemaVersion: 1;
  projectId: string;
  requestId: string;
  includeArchived: boolean;
  offset: number;
  limit: number;
  hasMore: boolean;
  sessions: NativeCatalogSession[];
}
export interface NativeSessionMessage {
  projectId: string;
  sessionId: string;
  id: string;
  ordinal: number;
  role: "system" | "user" | "assistant" | "tool";
  body: string;
  createdAt: number;
  origin: NativeCatalogSession["origin"];
}
export interface NativeSessionMutation {
  schemaVersion: 1;
  projectId: string;
  requestId: string;
  session: NativeCatalogSession;
  requiresFreshAuthorization: true;
}
export interface NativeSessionRecord extends NativeSessionMutation {
  throughOrdinal: number;
  prefixMessageCount: number;
  messages: NativeSessionMessage[];
}
/** A request to prepare a NEW task. No old run, scope, approval or execution token is included. */
export interface NativeSessionContinuation {
  session: NativeCatalogSession;
  shareContext: boolean;
  messages: NativeSessionMessage[];
  requiresFreshAuthorization: true;
}
export type NativeSessionPatch = { kind: "rename"; title: string; expectedTitle: string } | { kind: "setArchived"; archived: boolean; expectedArchived: boolean };
export interface NativeSessionCatalogPort {
  list(input: { projectId: string; requestId?: string; includeArchived?: boolean; titleQuery?: string; offset?: number; limit?: number }): Promise<NativeSessionPage>;
  update(input: { projectId: string; requestId?: string; sessionId: string; patch: NativeSessionPatch }): Promise<NativeSessionMutation>;
  branch(input: { projectId: string; requestId?: string; sessionId: string; throughOrdinal: number; newSessionId: string; title: string }): Promise<NativeSessionMutation>;
  read(input: { projectId: string; requestId?: string; sessionId: string; throughOrdinal: number }): Promise<NativeSessionRecord>;
  cancel(input: { projectId: string; requestId: string }): Promise<{ schemaVersion: 1; projectId: string; requestId: string; cancellationRequested: boolean }>;
}
const byteLength = (value: string) => new TextEncoder().encode(value).length;
function invalid(): never { throw new Error("native_session_catalog_invalid_record"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string { return typeof value === "string" ? value : invalid(); }
function integer(value: unknown): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
function bool(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function id(value: unknown): string {
  const result = text(value);
  if (!result || byteLength(result) > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(result)) return invalid();
  return result;
}
function title(value: unknown): string {
  const result = text(value);
  if (!result.trim() || byteLength(result) > 1024 || /[\u0000-\u001f\u007f-\u009f]/u.test(result)) return invalid();
  return result;
}
function origin(value: unknown): NativeCatalogSession["origin"] {
  if (value !== "native" && value !== "historicalTextCopy") return invalid();
  return value;
}
function session(value: unknown): NativeCatalogSession {
  const source = object(value);
  const messageCount = integer(source.messageCount), lastOrdinal = integer(source.lastOrdinal);
  if ((messageCount === 0) !== (lastOrdinal === 0) || lastOrdinal < messageCount) return invalid();
  // Historic titles may be empty; only new edits must satisfy the nonempty title rule.
  const savedTitle = text(source.title);
  if (byteLength(savedTitle) > 1024) return invalid();
  return { projectId: id(source.projectId), id: id(source.id), title: savedTitle,
    createdAt: integer(source.createdAt), archived: bool(source.archived),
    parentId: source.parentId === null ? null : id(source.parentId), origin: origin(source.origin),
    messageCount, lastOrdinal, latestRunId: source.latestRunId === null ? null : id(source.latestRunId) };
}
function mutation(value: unknown, projectId: string, sessionId: string, requestId: string): NativeSessionMutation {
  const source = object(value), saved = session(source.session);
  if (source.schemaVersion !== 1 || source.projectId !== projectId || source.requestId !== requestId || saved.projectId !== projectId || saved.id !== sessionId || source.requiresFreshAuthorization !== true) return invalid();
  return { schemaVersion: 1, projectId, requestId, session: saved, requiresFreshAuthorization: true };
}
function globalInvoke(): NativeRunStoreInvoke | null {
  return (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeRunStoreInvoke } }).__TAURI_INTERNALS__?.invoke ?? null;
}
export function createNativeSessionCatalog(invoke: NativeRunStoreInvoke | null = globalInvoke()): NativeSessionCatalogPort {
  async function call(command: string, input: Record<string, unknown>) {
    if (!invoke) throw new Error("native_session_catalog_unavailable");
    return invoke(command, { input: { schemaVersion: 1, ...input } });
  }
  return {
    async list(input) {
      const projectId = id(input.projectId), includeArchived = bool(input.includeArchived ?? false);
      const requestId = id(input.requestId ?? "request-" + crypto.randomUUID());
      const offset = integer(input.offset ?? 0), limit = integer(input.limit ?? 30);
      const titleQuery=text(input.titleQuery ?? "");
      if(byteLength(titleQuery)>1024||/[\u0000-\u001f\u007f-\u009f]/.test(titleQuery))return invalid();
      if (offset > 1_000_000 || limit < 1 || limit > 50) return invalid();
      const source = object(await call("list_native_session_catalog", { projectId, requestId, includeArchived, offset, limit, ...(titleQuery ? {titleQuery} : {}) }));
      if ((source.titleQuery ?? "") !== titleQuery || source.schemaVersion !== 1 || source.projectId !== projectId || source.requestId !== requestId || source.includeArchived !== includeArchived || source.offset !== offset || source.limit !== limit || !Array.isArray(source.sessions)) return invalid();
      const sessions = source.sessions.map(session), hasMore = bool(source.hasMore);
      if (sessions.length > limit || (hasMore && sessions.length !== limit) || new Set(sessions.map(value => value.id)).size !== sessions.length
        || sessions.some(value => value.projectId !== projectId || (!includeArchived && value.archived))) return invalid();
      const asciiFold=(v:string)=>v.replace(/[A-Z]/g,c=>c.toLowerCase());
      if(titleQuery&&sessions.some(s=>!asciiFold(s.title).includes(asciiFold(titleQuery))))return invalid();
      return { schemaVersion: 1, projectId, requestId, includeArchived, offset, limit, hasMore, sessions, ...(titleQuery ? {titleQuery} : {}) };
    },
    async update(input) {
      const projectId = id(input.projectId), sessionId = id(input.sessionId), requestId = id(input.requestId ?? "request-" + crypto.randomUUID());
      const candidate = object(input.patch);
      let patch: NativeSessionPatch;
      if (candidate.kind === "rename") {
        const expectedTitle = text(candidate.expectedTitle);
        if (byteLength(expectedTitle) > 1024) return invalid();
        patch = { kind: "rename", title: title(candidate.title), expectedTitle };
      } else if (candidate.kind === "setArchived") patch = { kind: "setArchived", archived: bool(candidate.archived), expectedArchived: bool(candidate.expectedArchived) };
      else return invalid();
      const result = mutation(await call("update_native_session_catalog", { projectId, sessionId, requestId, patch }), projectId, sessionId, requestId);
      if (result.session.origin !== "native" || (patch.kind === "rename" ? result.session.title !== patch.title : result.session.archived !== patch.archived)) return invalid();
      return result;
    },
    async branch(input) {
      const projectId = id(input.projectId), sessionId = id(input.sessionId), newSessionId = id(input.newSessionId);
      const requestId = id(input.requestId ?? "request-" + crypto.randomUUID());
      const throughOrdinal = integer(input.throughOrdinal), editedTitle = title(input.title);
      if (sessionId === newSessionId) return invalid();
      const result = mutation(await call("branch_native_session_catalog", { projectId, sessionId, requestId, newSessionId, throughOrdinal, title: editedTitle }), projectId, newSessionId, requestId);
      if (result.session.origin !== "native" || result.session.parentId !== sessionId || result.session.archived || result.session.title !== editedTitle || result.session.lastOrdinal !== throughOrdinal || result.session.latestRunId !== null) return invalid();
      return result;
    },
    async read(input) {
      const projectId = id(input.projectId), sessionId = id(input.sessionId), throughOrdinal = integer(input.throughOrdinal);
      const requestId = id(input.requestId ?? "request-" + crypto.randomUUID());
      const source = object(await call("read_native_session_catalog", { projectId, sessionId, requestId, throughOrdinal }));
      const saved = mutation(source, projectId, sessionId, requestId), prefixMessageCount = integer(source.prefixMessageCount);
      if (source.throughOrdinal !== throughOrdinal || throughOrdinal > saved.session.lastOrdinal || !Array.isArray(source.messages) || prefixMessageCount > 512 || source.messages.length !== prefixMessageCount || prefixMessageCount > saved.session.messageCount || (throughOrdinal === saved.session.lastOrdinal && prefixMessageCount !== saved.session.messageCount)) return invalid();
      let previous = 0, bytes = 0;
      const messages = source.messages.map(value => {
        const record = object(value), ordinal = integer(record.ordinal), body = text(record.body), role = text(record.role), length = byteLength(body);
        bytes += length;
        if (record.projectId !== projectId || record.sessionId !== sessionId || ordinal <= previous || ordinal > throughOrdinal || length > 256 * 1024 || bytes > 1024 * 1024 || !["system", "user", "assistant", "tool"].includes(role)) return invalid();
        previous = ordinal;
        return { projectId, sessionId, id: id(record.id), ordinal, body, role: role as NativeSessionMessage["role"], createdAt: integer(record.createdAt), origin: origin(record.origin) };
      });
      if (previous !== throughOrdinal || new Set(messages.map(value => value.id)).size !== messages.length) return invalid();
      return { ...saved, throughOrdinal, prefixMessageCount, messages };
    },
    async cancel(input) {
      const projectId = id(input.projectId), requestId = id(input.requestId);
      const source = object(await call("cancel_native_session_catalog", { projectId, requestId }));
      if (source.schemaVersion !== 1 || source.projectId !== projectId || source.requestId !== requestId) return invalid();
      return { schemaVersion: 1, projectId, requestId, cancellationRequested: bool(source.cancellationRequested) };
    },
  };
}
