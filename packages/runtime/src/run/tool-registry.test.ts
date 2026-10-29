import { describe, expect, it, vi } from "vitest";
import type { ProviderToolCall, RunToolResult, TaskRunScope } from "@uagent/shared";
import { isRunPathAllowed, normalizeRunPath, ToolRegistry } from "./tool-registry.js";
import type { RegisteredRunTool, RunToolContext } from "./tool-registry.js";

type ToolResult = Omit<RunToolResult, "callId" | "toolId">;

function scope(overrides: Partial<TaskRunScope> = {}): TaskRunScope {
  return {
    id: "scope-1",
    runId: "run-1",
    projectId: "project-1",
    conversationId: "conversation-1",
    rootRef: "root-1",
    providerId: "fixture",
    modelId: "fixture",
    endpoint: "fixture",
    mode: "read_only",
    readPrefixes: ["Content"],
    sharePrefixes: [],
    toolIds: ["project.preview"],
    limits: {
      maxToolCalls: 5,
      maxModelRequests: 5,
      maxDurationMs: 1000,
      maxAttemptsPerFailure: 1,
      maxToolResultBytes: 65536,
      maxContextBytes: 65536,
    },
    expiresAt: 2000,
    ...overrides,
  };
}

function context(grant = scope(), overrides: Partial<RunToolContext> = {}): RunToolContext {
  return {
    runId: grant.runId,
    projectId: grant.projectId,
    scope: grant,
    signal: new AbortController().signal,
    isCurrent: () => true,
    ...overrides,
  };
}

function call(
  id = "call-1",
  args = '{"path":"Content/Main.ts"}',
  name = "project_preview",
): ProviderToolCall {
  return { id, arguments: args, name };
}

function completed(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    status: "completed",
    effectState: "not_started",
    output: { text: "safe" },
    sources: [
      { projectId: "project-1", path: "Content/Main.ts", version: "v1", kind: "file_preview" },
    ],
    truncated: false,
    ...overrides,
  };
}

function tool(overrides: Partial<RegisteredRunTool> = {}): RegisteredRunTool {
  return {
    id: "project.preview",
    definition: {
      name: "project_preview",
      description: "Read a scoped file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    validate: (args) => {
      if (Object.keys(args).length !== 1 || typeof args.path !== "string")
        throw new Error("private schema details");
    },
    paths: (args) => [args.path as string],
    execute: vi.fn(async () => completed()),
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  it("captures immutable definitions and callbacks, with exact internal tool ID grants", async () => {
    const registration = tool();
    const execute = registration.execute;
    const registry = new ToolRegistry([registration], { now: () => 1000 });
    registration.definition.name = "changed";
    registration.definition.parameters.type = "array";
    registration.execute = vi.fn(async () => {
      throw new Error("replaced");
    });
    const [definition] = registry.definitions(scope());
    expect(definition.name).toBe("project_preview");
    expect(definition.parameters.type).toBe("object");
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.parameters.properties)).toBe(true);
    expect(registry.definitions(scope({ toolIds: ["project_preview"] }))).toEqual([]);
    expect((await registry.execute(call(), context())).status).toBe("completed");
    expect(execute).toHaveBeenCalledOnce();
    expect(registration.execute).not.toHaveBeenCalled();
    expect(
      (await registry.execute(call("call-2"), context(scope({ toolIds: ["project_preview"] }))))
        .diagnosticCode,
    ).toBe("tool_outside_scope");
  });

  it("rejects missing, duplicate or unsafe registrations and invalid provider names", () => {
    const registry = new ToolRegistry([tool()]);
    expect(() => registry.register(tool())).toThrow("duplicate_tool_id");
    expect(() => registry.register(tool({ id: "another.id" }))).toThrow("duplicate_tool_name");
    for (const id of ["", "../read", "bad id"]) {
      expect(() => new ToolRegistry([tool({ id })])).toThrow("invalid_tool_registration");
    }
    for (const name of ["", "project.preview", "x".repeat(65), undefined]) {
      const registration = tool();
      registration.definition.name = name as string;
      expect(() => new ToolRegistry([registration])).toThrow("invalid_tool_registration");
    }
    const unsafe = tool();
    unsafe.definition.parameters = JSON.parse('{"type":"object","__proto__":{}}');
    expect(() => new ToolRegistry([unsafe])).toThrow("invalid_tool_registration");
  });

  it("accepts canonical relative paths and checks prefixes at segment boundaries", () => {
    expect(normalizeRunPath("Content/UI/Main.ts")).toBe("Content/UI/Main.ts");
    expect(normalizeRunPath("", true)).toBe("");
    for (const path of [
      "",
      "/Content",
      "C:/Content",
      "C:Content",
      "\\\\server\\share",
      "Content\\Main.ts",
      "Content/../Private",
      "./Content",
      "Content/./Main.ts",
      "Content//Main.ts",
      "Content/",
      "Content/.. /file",
      "Content/%2e%2e/Private",
      "Content/%252e%252e/Private",
      "Content/a\u0000b",
      "Content/file:stream",
      "Content/file.",
    ]) {
      expect(() => normalizeRunPath(path), path).toThrow("invalid_run_path");
      expect(isRunPathAllowed(path, ["Content"]), path).toBe(false);
    }
    expect(isRunPathAllowed("Content", ["Content"])).toBe(true);
    expect(isRunPathAllowed("Content/UI/Main.ts", ["Content"])).toBe(true);
    expect(isRunPathAllowed("ContentPrivate/file", ["Content"])).toBe(false);
    expect(isRunPathAllowed("", ["Content"])).toBe(false);
    expect(isRunPathAllowed("", [""])).toBe(true);
    expect(isRunPathAllowed("Private/file", [""])).toBe(true);
    expect(isRunPathAllowed("Content/file", ["", "../Private"])).toBe(false);
  });

  it.each([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  ])("rejects DOS device segment %s regardless of case, extension or depth", (name) => {
    for (const path of [
      name,
      `${name}.txt`,
      `Content/${name.toLowerCase()}`,
      `Content/${name[0]}${name.slice(1).toLowerCase()}.json/child.ts`,
    ]) {
      expect(() => normalizeRunPath(path), path).toThrow("invalid_run_path");
      expect(isRunPathAllowed(path, [""]), path).toBe(false);
    }
  });

  it("never dispatches unknown names, missing IDs, incomplete JSON or nonobject arguments", async () => {
    const registration = tool();
    const registry = new ToolRegistry([registration], { now: () => 1000 });
    expect((await registry.execute(call(""), context())).diagnosticCode).toBe(
      "invalid_tool_call_id",
    );
    expect(
      (await registry.execute(call("unknown", "{}", "unknown"), context())).diagnosticCode,
    ).toBe("unknown_tool");
    const invalid = [
      "",
      '{"path":',
      '{"path":"Content/Main.ts"} trailing',
      "null",
      "[]",
      '"path"',
      "42",
      "true",
      '{"path":"Content/Main.ts","__proto__":{}}',
      '{"path":"Content/Main.ts","nested":{"constructor":{}}}',
      '{"path":"Content/Main.ts","nested":[{"prototype":{}}]}',
    ];
    for (const [index, args] of invalid.entries()) {
      expect(
        (await registry.execute(call(`invalid-${index}`, args), context())).diagnosticCode,
      ).toBe("invalid_tool_arguments");
    }
    expect(registration.execute).not.toHaveBeenCalled();
  });

  it("runs the trusted schema validator before path resolution and freezes arguments", async () => {
    const paths = vi.fn((args: Record<string, unknown>) => [args.path as string]);
    const registration = tool({ paths });
    const original = registration.validate;
    registration.validate = vi.fn((args) => {
      expect(Object.isFrozen(args)).toBe(true);
      original(args);
    });
    const registry = new ToolRegistry([registration], { now: () => 1000 });
    for (const [index, args] of [
      "{}",
      '{"path":12}',
      '{"path":"Content/Main.ts","write":true}',
    ].entries()) {
      const result = await registry.execute(call(`schema-${index}`, args), context());
      expect(result.diagnosticCode).toBe("invalid_tool_arguments");
      expect(JSON.stringify(result)).not.toContain("private schema details");
    }
    expect(paths).not.toHaveBeenCalled();
    expect(registration.execute).not.toHaveBeenCalled();
    expect((await registry.execute(call("valid"), context())).status).toBe("completed");
  });

  it("blocks invalid and out-of-scope input paths without granting read access from share prefixes", async () => {
    const registration = tool();
    const registry = new ToolRegistry([registration], { now: () => 1000 });
    for (const [index, path] of [
      "../Private/file",
      "Content\\file",
      "Content/%2fPrivate",
      "ContentOther/file",
      "Private/file",
      "",
    ].entries()) {
      const result = await registry.execute(
        call(`path-${index}`, JSON.stringify({ path })),
        context(scope({ sharePrefixes: ["Private", ""] })),
      );
      expect(result.status).toBe("blocked");
    }
    expect(registration.execute).not.toHaveBeenCalled();
  });

  it("checks scope identity, mode, lease, grants and cancellation before starting tools", async () => {
    const registration = tool();
    const registry = new ToolRegistry([registration], { now: () => 1000 });
    const aborted = new AbortController();
    aborted.abort();
    const cases: Array<[RunToolContext, string]> = [
      [context(scope(), { projectId: "other" }), "run_scope_mismatch"],
      [context(scope(), { runId: "other" }), "run_scope_mismatch"],
      [context(scope({ mode: "write" as "read_only" })), "invalid_run_scope"],
      [context(scope({ readPrefixes: ["../Private"] })), "invalid_run_scope"],
      [context(scope({ expiresAt: 1000 })), "run_scope_expired"],
      [context(scope({ toolIds: [] })), "tool_outside_scope"],
      [context(scope(), { signal: aborted.signal }), "run_cancelled"],
      [context(scope(), { isCurrent: () => false }), "run_not_current"],
    ];
    for (const [index, [ctx, code]] of cases.entries()) {
      expect((await registry.execute(call(`scope-${index}`), ctx)).diagnosticCode).toBe(code);
    }
    expect(registry.definitions(scope({ expiresAt: 1000 }))).toEqual([]);
    expect(registration.execute).not.toHaveBeenCalled();
  });

  it("reserves concurrent call IDs before dispatch and isolates duplicate detection by run", async () => {
    let finish!: (result: ToolResult) => void;
    const pending = new Promise<ToolResult>((resolve) => {
      finish = resolve;
    });
    const registration = tool({
      execute: vi.fn(async (_args, ctx) => (ctx.runId === "run-1" ? pending : completed())),
    });
    const registry = new ToolRegistry([registration], { now: () => 1000 });
    const first = registry.execute(call(), context());
    expect((await registry.execute(call(), context())).diagnosticCode).toBe(
      "duplicate_tool_call_id",
    );
    const other = await registry.execute(call(), context(scope({ id: "scope-2", runId: "run-2" })));
    expect(other.status).toBe("completed");
    expect(registration.execute).toHaveBeenCalledTimes(2);
    finish(completed());
    expect((await first).status).toBe("completed");
    expect((await registry.execute(call(), context())).diagnosticCode).toBe(
      "duplicate_tool_call_id",
    );
  });

  it("discards an in-flight read after abort and starts no later tool", async () => {
    let finish!: (result: ToolResult) => void;
    const pending = new Promise<ToolResult>((resolve) => {
      finish = resolve;
    });
    const registration = tool({ execute: vi.fn(() => pending) });
    const registry = new ToolRegistry([registration], { now: () => 1000 });
    const abort = new AbortController();
    const ctx = context(scope(), { signal: abort.signal });
    const first = registry.execute(call(), ctx);
    abort.abort();
    expect((await registry.execute(call("later"), ctx)).diagnosticCode).toBe("run_cancelled");
    finish(completed({ output: "must not publish" }));
    const discarded = await first;
    expect(discarded.status).toBe("cancelled");
    expect(discarded.output).toBeNull();
    expect(discarded.sources).toEqual([]);
    expect(registration.execute).toHaveBeenCalledOnce();
  });

  it("rechecks lease, run identity and narrowed read/tool grants after execution", async () => {
    for (const change of ["expiry", "current", "project", "scope", "paths", "tools"] as const) {
      let now = 1000;
      let current = true;
      const ctx = context(scope(), { isCurrent: () => current });
      const registration = tool({
        execute: vi.fn(async (_args, invocation) => {
          expect(Object.isFrozen(invocation.scope.readPrefixes)).toBe(true);
          if (change === "expiry") now = 2000;
          if (change === "current") current = false;
          if (change === "project") ctx.projectId = "other";
          if (change === "scope") ctx.scope.id = "new-scope";
          if (change === "paths") ctx.scope.readPrefixes = ["Private"];
          if (change === "tools") ctx.scope.toolIds = [];
          return completed({ output: "discard" });
        }),
      });
      const result = await new ToolRegistry([registration], { now: () => now }).execute(
        call(),
        ctx,
      );
      expect(result.status, change).not.toBe("completed");
      expect(result.output, change).toBeNull();
    }
  });

  it("rejects unsafe results, side effects and source references without leaking exceptions", async () => {
    let getterCalls = 0;
    const getter = Object.defineProperty({}, "private", {
      enumerable: true,
      get: () => {
        getterCalls++;
        return "secret";
      },
    });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const bad: Array<[unknown, string]> = [
      [completed({ output: undefined as never }), "invalid_tool_result"],
      [completed({ output: Number.NaN }), "invalid_tool_result"],
      [completed({ output: { private: undefined } as never }), "invalid_tool_result"],
      [completed({ output: getter as never }), "invalid_tool_result"],
      [completed({ output: cycle as never }), "invalid_tool_result"],
      [completed({ output: JSON.parse('{"__proto__":{}}') }), "invalid_tool_result"],
      [completed({ effectState: "applied" }), "invalid_tool_result"],
      [{ ...completed(), externalEffect: "unknown" }, "invalid_tool_result"],
      [
        completed({
          sources: [{ projectId: "other", path: "Content/a", version: "v1", kind: "tool" }],
        }),
        "invalid_tool_sources",
      ],
      [
        completed({
          sources: [{ projectId: "project-1", path: "Private/a", version: "v1", kind: "tool" }],
        }),
        "tool_source_outside_scope",
      ],
      [
        completed({
          sources: [
            { projectId: "project-1", path: "Content/../Private", version: "v1", kind: "tool" },
          ],
        }),
        "tool_source_outside_scope",
      ],
    ];
    for (const [raw, code] of bad) {
      const registry = new ToolRegistry([tool({ execute: async () => raw as ToolResult })], {
        now: () => 1000,
      });
      const result = await registry.execute(call(), context());
      expect(result.diagnosticCode).toBe(code);
      expect(result.output).toBeNull();
    }
    expect(getterCalls).toBe(0);
    const registry = new ToolRegistry(
      [
        tool({
          execute: async () => {
            throw new Error("private token ABC");
          },
        }),
      ],
      { now: () => 1000 },
    );
    const result = await registry.execute(call(), context());
    expect(result.diagnosticCode).toBe("tool_execution_failed");
    expect(JSON.stringify(result)).not.toContain("private token");
  });

  it("enforces the full result UTF-8 budget and returns stable errors for executor failures", async () => {
    const raw = completed({ output: "界" });
    const expected: RunToolResult = { callId: "call-1", toolId: "project.preview", ...raw };
    const bytes = new TextEncoder().encode(JSON.stringify(expected)).byteLength;
    expect(bytes).toBeGreaterThan(JSON.stringify(expected).length);
    for (const [limit, status] of [
      [bytes - 1, "failed"],
      [bytes, "completed"],
    ] as const) {
      const grant = scope();
      grant.limits.maxToolResultBytes = limit;
      const registry = new ToolRegistry([tool({ execute: async () => raw })], { now: () => 1000 });
      const result = await registry.execute(call(), context(grant));
      expect(result.status).toBe(status);
      if (status === "failed") expect(result.diagnosticCode).toBe("tool_result_too_large");
      else expect(result).toEqual(expected);
    }
    const registry = new ToolRegistry(
      [
        tool({
          execute: async () =>
            completed({
              status: "failed",
              output: "private details",
              diagnosticCode: "private token",
            }),
        }),
      ],
      { now: () => 1000 },
    );
    const failed = await registry.execute(call(), context());
    expect(failed.diagnosticCode).toBe("tool_failed");
    expect(failed.output).toBeNull();
    expect(failed.effectState).toBe("not_started");
  });
});
