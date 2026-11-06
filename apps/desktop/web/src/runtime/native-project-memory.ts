import {
  compareProjectMemoryIds, createProjectMemoryContext, memoryId, memoryInteger, parseProjectMemory, parseProjectMemoryContent,
  type ProjectMemory, type ProjectMemoryContent, type ProjectMemoryContextPort, type ProjectMemoryMutation,
  type ProjectMemoryStorePort, type RunContextSources, normalizeRunPath,
} from "@uagent/runtime";
import type { RunSourceRef } from "@uagent/shared";
import type { NativeRunStoreInvoke } from "./native-run-store";
import type { NativeProjectAdapter } from "./project-native-adapter";
import { createProjectContextSources } from "./project-context-sources";

function invalid(): never { throw Error("project_memory_invalid"); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function check(signal?: AbortSignal): void { if (signal?.aborted) throw Error("project_memory_cancelled"); }
function globalInvoke(): NativeRunStoreInvoke | null {
  return (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeRunStoreInvoke } }).__TAURI_INTERNALS__?.invoke ?? null;
}
function sameContent(record: ProjectMemory, expected: ProjectMemoryContent): boolean {
  const content = parseProjectMemoryContent({kind:record.kind,body:record.body,sourceRefs:record.sourceRefs,sharePaths:record.sharePaths,priority:record.priority,visibility:record.visibility,origin:record.origin,readAt:record.readAt});
  return JSON.stringify(content) === JSON.stringify(expected);
}
function checkedRecord(raw: unknown, projectId: string, id?: string): ProjectMemory {
  const record = parseProjectMemory(raw);
  if (record.projectId !== projectId || (id !== undefined && record.id !== id)) return invalid();
  return record;
}
/** No browser-storage fallback: successful writes mean the native managed store replied. */
export function createNativeProjectMemory(invoke: NativeRunStoreInvoke | null = globalInvoke()): ProjectMemoryStorePort {
  const call = async (command: string, input: unknown, signal: AbortSignal | undefined, write = false) => {
    check(signal);
    if (!invoke) throw Error("project_memory_native_unavailable");
    let result: unknown;
    try { result = await invoke(command, { input }); }
    catch (error) { if (signal?.aborted && write) throw Error("project_memory_write_outcome_unknown"); throw error; }
    if (signal?.aborted && write) throw Error("project_memory_write_outcome_unknown");
    check(signal);
    return result;
  };
  return {
    async list(input, signal) {
      const projectId = memoryId(input.projectId), afterId = input.afterId == null ? null : memoryId(input.afterId), limit = memoryInteger(input.limit ?? 30);
      if (limit < 1 || limit > 50) return invalid();
      const page = object(await call("list_project_memories", { schemaVersion: 1, projectId, afterId, limit }, signal), ["schemaVersion","projectId","afterId","limit","nextAfterId","memories"]);
      if (page.schemaVersion !== 1 || page.projectId !== projectId || page.afterId !== afterId || page.limit !== limit || !Array.isArray(page.memories) || page.memories.length > limit) return invalid();
      const memories = page.memories.map(raw => checkedRecord(raw, projectId));
      if (memories.some((memory, index) => (afterId !== null && compareProjectMemoryIds(memory.id, afterId) <= 0) || (index > 0 && compareProjectMemoryIds(memories[index - 1]!.id, memory.id) >= 0))) return invalid();
      const nextAfterId = page.nextAfterId === null ? null : memoryId(page.nextAfterId);
      if (nextAfterId !== null && (memories.length !== limit || nextAfterId !== memories.at(-1)?.id || nextAfterId === afterId)) return invalid();
      return { schemaVersion: 1, projectId, afterId, limit, nextAfterId, memories };
    },
    async get(project, memory, signal) {
      const projectId = memoryId(project), id = memoryId(memory);
      return checkedRecord(await call("get_project_memory", { schemaVersion: 1, projectId, id }, signal), projectId, id);
    },
    async create(input, signal) {
      const projectId = memoryId(input.projectId), id = memoryId(input.id), content = parseProjectMemoryContent(input.content);
      if (content.sourceRefs.some(source => source.projectId !== projectId)) return invalid();
      const record = checkedRecord(await call("create_project_memory", { schemaVersion: 1, projectId, id, content }, signal, true), projectId, id);
      if (record.revision !== 1 || record.validity !== "pending" || record.confirmation !== null || !sameContent(record, content)) return invalid();
      return record;
    },
    async update(input, signal) {
      const projectId = memoryId(input.projectId), id = memoryId(input.id), expectedRevision = memoryInteger(input.expectedRevision);
      if (!expectedRevision || expectedRevision === Number.MAX_SAFE_INTEGER) return invalid();
      const raw = object(input.mutation, input.mutation.type === "replace" ? ["type","content"] : ["type"]);
      let mutation: ProjectMemoryMutation;
      if (raw.type === "replace") {
        const content = parseProjectMemoryContent(raw.content);
        if (content.sourceRefs.some(source => source.projectId !== projectId)) return invalid();
        mutation = { type: "replace", content };
      } else if (raw.type === "confirm" || raw.type === "retire" || raw.type === "markStale") mutation = { type: raw.type };
      else return invalid();
      const record = checkedRecord(await call("update_project_memory", { schemaVersion: 1, projectId, id, expectedRevision, mutation }, signal, true), projectId, id);
      if (record.revision !== expectedRevision + 1 || (mutation.type === "replace" && (record.validity !== "pending" || record.confirmation !== null || !sameContent(record, mutation.content))) || (mutation.type === "confirm" && (record.validity !== "valid" || !record.confirmation)) || (mutation.type === "retire" && record.validity !== "retired") || (mutation.type === "markStale" && record.validity !== "stale")) return invalid();
      return record;
    },
  };
}
export function createNativeProjectMemoryContext(adapter: NativeProjectAdapter, port: ProjectMemoryStorePort = createNativeProjectMemory()): ProjectMemoryContextPort {
  return createProjectMemoryContext(port, createProjectContextSources(adapter));
}
/** Metadata-only capture. It neither reads file bodies nor grants outbound sharing. */
export function createProjectMemorySourceCapture(adapter: NativeProjectAdapter) {
  return async (projectId: string, paths: string[], signal: AbortSignal): Promise<RunSourceRef[]> => {
    check(signal);
    if (!paths.length) return [];
    if (paths.length > 8 || !adapter.inspectSources) throw Error("project_memory_sources_unavailable");
    const canonical = [...new Set(paths.map(path => normalizeRunPath(path)))];
    const project = adapter.getProject(projectId), rootRef = project?.rootRef;
    if (adapter.source !== "native" || project?.trustState !== "trusted") throw Error("project_memory_sources_unavailable");
    const result = await adapter.inspectSources(projectId, canonical);
    check(signal);
    const current = adapter.getProject(projectId);
    if (current?.trustState !== "trusted" || current.rootRef !== rootRef || !result.rootCurrent || result.projectId !== projectId) throw Error("project_memory_context_changed");
    return canonical.map(path => {
      const source = result.sources.find(item => item.path === path);
      if (source?.status !== "ready" || !source.version) throw Error("project_memory_source_missing");
      return { projectId, path, version: source.version, freshness: source.version, kind: "file_preview" };
    });
  };
}
export async function recheckProjectMemory(memory: ProjectMemory, scope: Parameters<RunContextSources["validate"]>[1], sources: RunContextSources, signal: AbortSignal): Promise<boolean> {
  check(signal);
  if (memory.projectId !== scope.projectId || (memory.kind === "fact" && !memory.sourceRefs.length)) return false;
  const result = !memory.sourceRefs.length || await sources.validate(memory.sourceRefs, scope, signal);
  check(signal);
  return result;
}
export type { ProjectMemory, ProjectMemoryContent, ProjectMemoryStorePort };
