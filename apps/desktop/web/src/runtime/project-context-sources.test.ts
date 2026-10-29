import { describe, expect, it, vi } from "vitest";
import type { TaskRunScope, RunSourceRef } from "@uagent/shared";
import { createProjectContextSources } from "./project-context-sources";
import type { NativeProjectAdapter } from "./project-native-adapter";
function fixture() {
  let project = { id: "A", rootRef: "root-A", trustState: "trusted" },
    revision = "index:1",
    stamp = "stamp1";
  const inspect = vi.fn(async (projectId: string, paths: string[]) => ({
    rootCurrent:true,
    projectId,
    sources: paths.map((path) => ({ path, status: "ready" as const, version: stamp })),
  }));
  const adapter = {
    source: "native",
    getProject: () => project,
    getIndexRevision: () => revision,
    getStableSnapshot: () => ({ status: "ready", id: "index", summary: { scannedAt: 1 } }),
    inspectSources: inspect,
  } as unknown as NativeProjectAdapter;
  const scope: TaskRunScope = {
    id: "scope",
    runId: "run",
    projectId: "A",
    conversationId: "chat",
    rootRef: "root-A",
    providerId: "synthetic",
    modelId: "model",
    endpoint: "https://invalid.example",
    mode: "read_only",
    readPrefixes: ["Source"],
    sharePrefixes: ["Source"],
    toolIds: ["read"],
    limits: {
      maxToolCalls: 3,
      maxModelRequests: 4,
      maxDurationMs: 1000,
      maxAttemptsPerFailure: 2,
      maxToolResultBytes: 8192,
      maxContextBytes: 24576,
    },
    expiresAt: Date.now() + 1000,
  };
  const source: RunSourceRef = {
    projectId: "A",
    path: "Source/Main.cpp",
    version: "hash1",
    kind: "file_preview",
    freshness: "stamp1",
  };
  return {
    scope,
    source,
    adapter,
    inspect,
    port: createProjectContextSources(adapter),
    changeStamp: () => {
      stamp = "stamp2";
    },
    rescan: () => {
      revision = "index:2";
    },
    revoke: () => {
      project = { ...project, trustState: "untrusted" };
    },
  };
}
describe("live native context source validation", () => {
  it("accepts current metadata and invalidates a changed file without reading contents", async () => {
    const f = fixture(),
      signal = new AbortController().signal;
    expect(await f.port.validate([f.source], f.scope, signal)).toBe(true);
    f.changeStamp();
    expect(await f.port.validate([f.source], f.scope, signal)).toBe(false);
    expect(f.inspect).toHaveBeenCalledWith("A", ["Source/Main.cpp"]);
  });
  it("invalidates rescanned index facts even when native timestamps/IDs repeat", async () => {
    const f = fixture(),
      source = { ...f.source, kind: "project_index" as const, version: "index:1" };
    expect(await f.port.validate([source], f.scope, new AbortController().signal)).toBe(true);
    f.rescan();
    expect(await f.port.validate([source], f.scope, new AbortController().signal)).toBe(false);
  });
  it("never probes project B or unshared paths, and does not trust version strings as permission", async () => {
    const f = fixture(),
      signal = new AbortController().signal;
    expect(await f.port.validate([{ ...f.source, projectId: "B" }], f.scope, signal)).toBe(false);
    expect(
      await f.port.validate([{ ...f.source, path: "Private/Hidden.cpp" }], f.scope, signal),
    ).toBe(false);
    expect(await f.port.validate([{ ...f.source, freshness: undefined }], f.scope, signal)).toBe(
      false,
    );
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it("rechecks trust after an asynchronous probe", async () => {
    const f = fixture();
    f.inspect.mockImplementation(async (projectId, paths) => {
      f.revoke();
      return {
        rootCurrent:true,
        projectId,
        sources: paths.map((path) => ({ path, status: "ready" as const, version: "stamp1" })),
      };
    });
    expect(await f.port.validate([f.source], f.scope, new AbortController().signal)).toBe(false);
  });
  it("deduplicates checks and fails on cancelled validation or excessive source sets", async () => {
    const f = fixture();
    expect(await f.port.validate([f.source, f.source], f.scope, new AbortController().signal)).toBe(
      true,
    );
    expect(f.inspect.mock.calls[0]![1]).toEqual(["Source/Main.cpp"]);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(f.port.validate([f.source], f.scope, cancelled.signal)).rejects.toThrow(
      "context_cancelled",
    );
    expect(
      await f.port.validate(
        Array.from({ length: 65 }, (_, i) => ({ ...f.source, path: "Source/F" + i + ".cpp" })),
        f.scope,
        new AbortController().signal,
      ),
    ).toBe(false);
  });
});
