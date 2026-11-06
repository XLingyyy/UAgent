import type { ProviderRuntimeMessage, RunContextPlan, RunSourceRef, TaskRun, TaskRunScope } from "@uagent/shared";
import type { RunContextSources } from "../context/run-context.js";
import { normalizeRunPath } from "../run/tool-registry.js";

export type ProjectMemoryKind = "fact" | "decision" | "todo";
export type ProjectMemoryValidity = "pending" | "valid" | "stale" | "retired";
/** Descriptive provenance never restores authority from a prior session. */
export interface ProjectMemoryOrigin { kind: "user" | "model" | "session"; sessionId: string | null; messageId: string | null }
export interface ProjectMemoryContent {
  kind: ProjectMemoryKind;
  body: string;
  sourceRefs: RunSourceRef[];
  /** All paths must fit BOTH current read and outbound scope. "" means the project root. */
  sharePaths: string[];
  priority: "constraint" | "normal";
  visibility: "private" | "project";
  origin: ProjectMemoryOrigin;
  readAt: number;
}
export interface ProjectMemory extends ProjectMemoryContent {
  id: string; projectId: string; validity: ProjectMemoryValidity; revision: number;
  confirmation: { kind: "user"; confirmedAt: number } | null;
}
export interface ProjectMemoryPage {
  schemaVersion: 1; projectId: string; afterId: string | null; limit: number;
  nextAfterId: string | null; memories: ProjectMemory[];
}
export type ProjectMemoryMutation =
  | { type: "replace"; content: ProjectMemoryContent }
  | { type: "confirm" } | { type: "markStale" } | { type: "retire" };
export interface ProjectMemoryStorePort {
  list(input: { projectId: string; afterId?: string | null; limit?: number }, signal?: AbortSignal): Promise<ProjectMemoryPage>;
  get(projectId: string, id: string, signal?: AbortSignal): Promise<ProjectMemory>;
  create(input: { projectId: string; id: string; content: ProjectMemoryContent }, signal?: AbortSignal): Promise<ProjectMemory>;
  update(input: { projectId: string; id: string; expectedRevision: number; mutation: ProjectMemoryMutation }, signal?: AbortSignal): Promise<ProjectMemory>;
}
export type ProjectMemoryOmission = "other_project" | "private" | "scope" | "pending" | "stale" | "retired" | "unconfirmed" | "missing_source" | "budget" | "duplicate" | "not_relevant";
export interface ProjectMemorySelectionPlan {
  schemaVersion: 1; projectId: string;
  used: Array<{ id: string; revision: number; kind: ProjectMemoryKind; sources: RunSourceRef[] }>;
  omitted: Array<{ id: string; revision: number; reason: ProjectMemoryOmission }>;
  catalogTruncated: boolean; maxBytes: number; usedBytes: number;
}
export interface PreparedProjectMemory {
  messages: ProviderRuntimeMessage[]; plan: ProjectMemorySelectionPlan;
  /** Final BASE context plan; central must adopt this and revalidate its sources. */
  contextPlan?: RunContextPlan;
  /** Re-read revisions and source stamps after approval, immediately before transport. */
  beforeSend(): Promise<void>;
}
export interface ProjectMemoryContextPort {
  prepare(input: { run: TaskRun; messages: readonly ProviderRuntimeMessage[]; baseContext?: { records: readonly ProviderRuntimeMessage[]; goalMessageIndex: number }; signal: AbortSignal; isCurrent(): boolean }): Promise<PreparedProjectMemory>;
}
export interface ProjectMemorySelectionInput {
  memories: readonly ProjectMemory[]; scope: TaskRunScope;
  /** Current task goal, never inferred from stored memory instructions. */
  query?: string;
  messages: readonly ProviderRuntimeMessage[]; sources: RunContextSources;
  signal: AbortSignal; isCurrent(): boolean; catalogTruncated?: boolean;
}
const utf8 = (value: string) => new TextEncoder().encode(value).length;
function invalid(): never { throw Error("project_memory_invalid"); }
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!))) return invalid();
  return value as Record<string, unknown>;
}
export function memoryId(value: unknown): string {
  if (typeof value !== "string" || !value || utf8(value) > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || Array.from(value).some(character => { const point = character.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; })) return invalid();
  return value;
}
export function memoryInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
/** Unicode scalar order matches SQLite UTF-8 BINARY ordering for Unicode scalar IDs. */
export function compareProjectMemoryIds(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0)!), right = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) return invalid();
  return value as T;
}
/** Strict data-only IPC parser: unknown fields, including authority objects, are rejected. */
export function parseProjectMemoryContent(value: unknown): ProjectMemoryContent {
  const v = object(value, ["kind", "body", "sourceRefs", "sharePaths", "priority", "visibility", "origin", "readAt"]);
  if (typeof v.body !== "string" || !v.body.trim() || utf8(v.body) > 8192 || v.body.includes("\0")) return invalid();
  if (!Array.isArray(v.sourceRefs) || v.sourceRefs.length > 8 || !Array.isArray(v.sharePaths) || !v.sharePaths.length || v.sharePaths.length > 8) return invalid();
  const sourceRefs = v.sourceRefs.map(raw => {
    const s = object(raw, ["projectId", "path", "version", "kind", "freshness"]);
    if (typeof s.path !== "string" || utf8(s.path) > 1024 || typeof s.version !== "string" || !s.version || utf8(s.version) > 512 || (s.freshness !== undefined && (typeof s.freshness !== "string" || !s.freshness || utf8(s.freshness) > 512))) return invalid();
    return { projectId: memoryId(s.projectId), path: s.path, version: s.version, kind: enumValue(s.kind, ["project_index", "index_query", "file_preview", "tool"] as const), ...(s.freshness === undefined ? {} : { freshness: s.freshness as string }) };
  });
  const sharePaths = v.sharePaths.map(path => typeof path === "string" && utf8(path) <= 1024 ? normalizeRunPath(path, true) : invalid());
  sourceRefs.forEach(source => normalizeRunPath(source.path, true));
  const o = object(v.origin, ["kind", "sessionId", "messageId"]);
  const origin: ProjectMemoryOrigin = { kind: enumValue(o.kind, ["user", "model", "session"] as const), sessionId: o.sessionId === null ? null : memoryId(o.sessionId), messageId: o.messageId === null ? null : memoryId(o.messageId) };
  if (origin.kind === "session" && (!origin.sessionId || !origin.messageId)) return invalid();
  return { kind: enumValue(v.kind, ["fact", "decision", "todo"] as const), body: v.body, sourceRefs, sharePaths, priority: enumValue(v.priority, ["constraint", "normal"] as const), visibility: enumValue(v.visibility, ["private", "project"] as const), origin, readAt: memoryInteger(v.readAt) };
}
export function parseProjectMemory(value: unknown): ProjectMemory {
  const v = object(value, ["id", "projectId", "kind", "body", "sourceRefs", "sharePaths", "priority", "visibility", "origin", "readAt", "validity", "revision", "confirmation"]);
  const content = parseProjectMemoryContent(Object.fromEntries(["kind", "body", "sourceRefs", "sharePaths", "priority", "visibility", "origin", "readAt"].map(key => [key, v[key]])));
  const revision = memoryInteger(v.revision);
  if (!revision) return invalid();
  let confirmation: ProjectMemory["confirmation"] = null;
  if (v.confirmation !== null) {
    const c = object(v.confirmation, ["kind", "confirmedAt"]);
    if (c.kind !== "user") return invalid();
    confirmation = { kind: "user", confirmedAt: memoryInteger(c.confirmedAt) };
  }
  const projectId = memoryId(v.projectId);
  if (content.sourceRefs.some(ref => ref.projectId !== projectId)) return invalid();
  return { ...content, id: memoryId(v.id), projectId, validity: enumValue(v.validity, ["pending", "valid", "stale", "retired"] as const), revision, confirmation };
}
