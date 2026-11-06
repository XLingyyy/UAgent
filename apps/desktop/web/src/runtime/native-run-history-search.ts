import {
  createNativeRunHistory,
  type NativeArchivedMessage,
  type NativeRunArchive,
  type NativeRunHistoryPort,
} from "./native-run-history";
import type { NativeRunStoreInvoke } from "./native-run-store";

export interface NativeHistorySearchHit {
  projectId: string;
  sessionId: string;
  messageId: string;
  ordinal: number;
  role: NativeArchivedMessage["role"];
  createdAt: number;
  origin: "native" | "historicalTextCopy";
  preview: string;
  previewTruncated: boolean;
  bodySha256: string;
  /** A saved run identity to verify, never a claim that this message belongs to it. */
  archiveCandidate: { runId: string; revision: number } | null;
}
export interface NativeHistorySearchPage {
  schemaVersion: 1;
  projectId: string;
  query: string;
  offset: number;
  limit: number;
  hasMore: boolean;
  messages: NativeHistorySearchHit[];
}
export interface NativeHistorySearchSelection {
  archive: NativeRunArchive;
  messageId: string;
  identity: { projectId: string; sessionId: string; runId: string; revision: number };
}
export interface NativeRunHistorySearchPort {
  search(input: { projectId: string; query: string; offset?: number; limit?: number }): Promise<NativeHistorySearchPage>;
  /** Returns only after the real archive and message body match the search result. */
  open(hit: NativeHistorySearchHit): Promise<NativeHistorySearchSelection>;
}
function invalid(): never {
  throw new Error("native_run_history_search_invalid_record");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}
function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function bool(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalid();
}
function id(value: unknown): string {
  const result = text(value);
  if (!result || new TextEncoder().encode(result).length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(result)) return invalid();
  return result;
}
function queryText(value: unknown): string {
  const result = text(value);
  if (!result.trim() || result.includes("\0") || Array.from(result).length > 512 || new TextEncoder().encode(result).length > 2048) return invalid();
  return result;
}
function parseHit(value: unknown): NativeHistorySearchHit {
  const source = object(value), role = text(source.role), origin = text(source.origin);
  const preview = text(source.preview), bodySha256 = text(source.bodySha256);
  if (!["system", "user", "assistant", "tool"].includes(role) || !["native", "historicalTextCopy"].includes(origin) || Array.from(preview).length > 480 || !/^[a-f0-9]{64}$/.test(bodySha256)) return invalid();
  let archiveCandidate: NativeHistorySearchHit["archiveCandidate"] = null;
  if (source.archiveCandidate !== null) {
    const candidate = object(source.archiveCandidate), revision = integer(candidate.revision);
    if (revision === 0 || origin !== "native") return invalid();
    archiveCandidate = { runId: id(candidate.runId), revision };
  }
  const ordinal = integer(source.ordinal);
  if (ordinal === 0) return invalid();
  return {
    projectId: id(source.projectId), sessionId: id(source.sessionId), messageId: id(source.messageId), ordinal,
    role: role as NativeHistorySearchHit["role"], createdAt: integer(source.createdAt),
    origin: origin as NativeHistorySearchHit["origin"], preview, previewTruncated: bool(source.previewTruncated), bodySha256, archiveCandidate,
  };
}
async function digest(body: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("native_run_history_search_verification_unavailable");
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function globalInvoke(): NativeRunStoreInvoke | null {
  return (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeRunStoreInvoke } }).__TAURI_INTERNALS__?.invoke ?? null;
}
/** Local archive only. No root trust, continuation, credential or approval is restored. */
export function createNativeRunHistorySearch(
  invoke: NativeRunStoreInvoke | null = globalInvoke(),
  history: Pick<NativeRunHistoryPort, "snapshot"> = createNativeRunHistory(invoke),
): NativeRunHistorySearchPort {
  return {
    async search(input) {
      const projectId = id(input.projectId), query = queryText(input.query);
      const offset = integer(input.offset ?? 0), limit = integer(input.limit ?? 30);
      if (offset > 1_000_000 || limit < 1 || limit > 50) return invalid();
      if (!invoke) throw new Error("native_run_history_search_unavailable");
      const page = object(await invoke("search_native_run_history", { input: { schemaVersion: 1, projectId, query, offset, limit } }));
      if (page.schemaVersion !== 1 || page.projectId !== projectId || page.query !== query || page.offset !== offset || page.limit !== limit || !Array.isArray(page.messages)) return invalid();
      const messages = page.messages.map(parseHit);
      if (messages.length > limit || messages.some((message) => message.projectId !== projectId) || new Set(messages.map((message) => message.messageId)).size !== messages.length) return invalid();
      const hasMore = bool(page.hasMore);
      if (hasMore && messages.length !== limit) return invalid();
      return { schemaVersion: 1, projectId, query, offset, limit, hasMore, messages };
    },
    async open(hit) {
      // Copy before awaiting so a caller cannot mutate the requested identity in flight.
      const target = parseHit(hit), candidate = target.archiveCandidate;
      if (!candidate) throw new Error("native_run_history_search_archive_unavailable");
      const archive = await history.snapshot(target.projectId, candidate.runId);
      const saved = archive.descriptor, run = archive.snapshot.run;
      if (archive.schemaVersion !== 1 || saved.projectId !== target.projectId || saved.sessionId !== target.sessionId || saved.runId !== candidate.runId || run.projectId !== target.projectId || run.sessionId !== target.sessionId || run.id !== candidate.runId || run.revision !== candidate.revision || archive.snapshot.requiresFreshAuthorization !== true) return invalid();
      const matches = archive.messages.filter((message) => message.id === target.messageId);
      if (matches.length !== 1 || matches[0].role !== target.role || matches[0].createdAt !== target.createdAt || await digest(matches[0].body) !== target.bodySha256) return invalid();
      return {
        archive, messageId: target.messageId,
        identity: { projectId: target.projectId, sessionId: target.sessionId, runId: candidate.runId, revision: candidate.revision },
      };
    },
  };
}
