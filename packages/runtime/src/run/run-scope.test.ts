import { describe, expect, it } from "vitest";
import type { TaskRunScope } from "@uagent/shared";
import { RunScopeAuthority } from "./run-scope.js";
function scope(): TaskRunScope {
  return {
    id: "s",
    runId: "r",
    projectId: "p",
    conversationId: "c",
    rootRef: "root",
    providerId: "synthetic",
    modelId: "m",
    endpoint: "https://invalid.example/v1",
    mode: "read_only",
    readPrefixes: ["Source"],
    sharePrefixes: [],
    toolIds: ["read"],
    expiresAt: 2000,
    limits: {
      maxToolCalls: 3,
      maxModelRequests: 4,
      maxDurationMs: 60000,
      maxAttemptsPerFailure: 2,
      maxToolResultBytes: 8192,
      maxContextBytes: 24576,
    },
  };
}
describe("ephemeral scope ownership", () => {
  it("clones and freezes scope and permits only one claim", () => {
    const a = new RunScopeAuthority(() => 1000),
      s = scope(),
      lease = a.approve(s, () => true);
    s.readPrefixes[0] = "";
    expect(lease.scope.readPrefixes).toEqual(["Source"]);
    expect(Object.isFrozen(lease.scope.limits)).toBe(true);
    expect(a.claim("s")).toBe(lease);
    expect(a.claim("s")).toBeNull();
  });
  it("checks live owner on every use, including A to B to A revocation", () => {
    let owner = true;
    const a = new RunScopeAuthority(() => 1000),
      lease = a.approve(scope(), () => owner);
    expect(lease.isCurrent()).toBe(true);
    owner = false;
    expect(lease.isCurrent()).toBe(false);
    a.invalidate();
    owner = true;
    expect(lease.isCurrent()).toBe(false);
    expect(a.claim("s")).toBeNull();
  });
  it("expires without restoring authority from a serialized scope", () => {
    let now = 1000;
    const a = new RunScopeAuthority(() => now),
      lease = a.approve(scope(), () => true);
    now = 2000;
    expect(lease.isCurrent()).toBe(false);
    expect(a.claim("s")).toBeNull();
    expect(
      new RunScopeAuthority(() => 1000).claim(JSON.parse(JSON.stringify(lease.scope)).id),
    ).toBeNull();
  });
  it.each([
    "http://invalid.example",
    "https://user:pass@invalid.example",
    "https://invalid.example/?key=x",
    "https://invalid.example/#fragment",
  ])("rejects unsafe endpoint %s", (endpoint) => {
    const a = new RunScopeAuthority(() => 1000);
    expect(() => a.approve({ ...scope(), endpoint }, () => true)).toThrow();
  });
  it("does not accept parent traversal or an excessive call limit", () => {
    const a = new RunScopeAuthority(() => 1000),
      s = scope();
    expect(() => a.approve({ ...s, readPrefixes: ["../private"] }, () => true)).toThrow();
    s.limits.maxToolCalls = 31;
    expect(() => a.approve(s, () => true)).toThrow();
  });
});
