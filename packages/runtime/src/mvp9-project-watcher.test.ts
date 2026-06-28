import { describe, it, expect } from "vitest";
import {
  createDefaultWatcherPolicy,
  isRootAllowedForWatch,
  computeProjectIndexDiff,
  createFixtureWatcherAdapter,
} from "./mvp9-project-watcher.js";
import type { ProjectChangeEvent } from "@uagent/shared";

describe("createDefaultWatcherPolicy", () => {
  it("creates policy with default ignored dirs", () => {
    const policy = createDefaultWatcherPolicy("G:/repo");
    expect(policy.allowedRoots).toContain("G:/repo");
    expect(policy.ignoredDirs).toContain(".git");
    expect(policy.maxQueueSize).toBe(10000);
    expect(policy.debounceMs).toBe(500);
  });
});

describe("isRootAllowedForWatch", () => {
  it("allows matching root", () => {
    const policy = createDefaultWatcherPolicy("G:/repo");
    const result = isRootAllowedForWatch("G:/repo", policy);
    expect(result.allowed).toBe(true);
  });

  it("allows subdirectory of allowed root", () => {
    const policy = createDefaultWatcherPolicy("G:/repo");
    const result = isRootAllowedForWatch("G:/repo/subdir", policy);
    expect(result.allowed).toBe(true);
  });

  it("rejects unknown root", () => {
    const policy = createDefaultWatcherPolicy("G:/repo");
    const result = isRootAllowedForWatch("/tmp/unknown", policy);
    expect(result.allowed).toBe(false);
  });
});

describe("computeProjectIndexDiff", () => {
  it("produces correct summary from change events", () => {
    const events: ProjectChangeEvent[] = [
      {
        id: "ev-1", watchSessionId: "ws-1", kind: "added", source: "file",
        rootRelativePath: "src/main.ts", displayPath: "[project-root]/src/main.ts", timestamp: 100,
      },
      {
        id: "ev-2", watchSessionId: "ws-1", kind: "modified", source: "file",
        rootRelativePath: "src/util.ts", displayPath: "[project-root]/src/util.ts", timestamp: 200,
      },
      {
        id: "ev-3", watchSessionId: "ws-1", kind: "deleted", source: "file",
        rootRelativePath: "old.ts", displayPath: "[project-root]/old.ts", timestamp: 300,
      },
    ];
    const diff = computeProjectIndexDiff(events);
    expect(diff.summary.added).toBe(1);
    expect(diff.summary.modified).toBe(1);
    expect(diff.summary.deleted).toBe(1);
    expect(diff.entries.length).toBe(3);
  });
});

describe("createFixtureWatcherAdapter", () => {
  it("starts and stops a watcher session", () => {
    const policy = createDefaultWatcherPolicy("G:/repo");
    const adapter = createFixtureWatcherAdapter(policy);
    const session = adapter.startSession("proj-1", "G:/repo");
    expect(session.status).toBe("active");

    const stopped = adapter.stopSession(session.id, "user_stopped");
    expect(stopped.status).toBe("stopped");
    expect(stopped.stopReason).toBe("user_stopped");
  });

  it("generates change events and computes diff", () => {
    const policy = createDefaultWatcherPolicy("G:/repo");
    const adapter = createFixtureWatcherAdapter(policy);
    const session = adapter.startSession("proj-2", "G:/repo");
    const events = adapter.generateChangeEvents(session.id, 3);
    expect(events.length).toBe(3);
    expect(events.some((e) => e.kind === "added")).toBe(true);

    const diff = adapter.computeDiff(session.id);
    expect(diff.entries.length).toBe(3);
  });

  it("throws when stopping unknown session", () => {
    const policy = createDefaultWatcherPolicy("G:/repo");
    const adapter = createFixtureWatcherAdapter(policy);
    expect(() => adapter.stopSession("unknown", "error")).toThrow("Session unknown not found");
  });

  it("returns null for unknown session", () => {
    const policy = createDefaultWatcherPolicy("G:/repo");
    const adapter = createFixtureWatcherAdapter(policy);
    expect(adapter.getSession("unknown")).toBeNull();
  });
});
