import type {
  ProviderToolCall,
  ProviderToolDefinition,
  RunJsonValue,
  RunToolResult,
  TaskRunScope,
} from "@uagent/shared";

export interface RunToolContext {
  runId: string;
  projectId: string;
  scope: TaskRunScope;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

/** Only trusted, read-only implementations may be registered. No ambient I/O is used here. */
export interface RegisteredRunTool {
  id: string;
  definition: ProviderToolDefinition;
  validate: (args: Record<string, unknown>) => void;
  paths: (args: Record<string, unknown>) => string[];
  execute: (
    args: Record<string, unknown>,
    context: RunToolContext,
  ) => Promise<Omit<RunToolResult, "callId" | "toolId">>;
}

const providerNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
const internalIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);
const windowsDeviceNamePattern = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
const resultKeys = new Set([
  "status",
  "effectState",
  "output",
  "sources",
  "truncated",
  "diagnosticCode",
]);

/** Reject aliases rather than repairing paths whose meaning might depend on an I/O backend. */
export function normalizeRunPath(value: string, allowRoot = false): string {
  if (typeof value !== "string" || (value === "" && !allowRoot)) {
    throw new Error("invalid_run_path");
  }
  if (value === "") return value;
  if (/^[\/]/.test(value) || /[\\%:\u0000-\u001f\u007f<>"|?*]/.test(value)) {
    throw new Error("invalid_run_path");
  }
  if (
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          windowsDeviceNamePattern.test(part),
      )
  ) {
    throw new Error("invalid_run_path");
  }
  return value;
}

/** Both operands are canonical; an empty prefix explicitly grants the project root. */
export function isRunPathAllowed(path: string, prefixes: readonly string[]): boolean {
  try {
    const canonical = normalizeRunPath(path, true);
    if (!Array.isArray(prefixes)) return false;
    const allowed = prefixes.map((prefix) => normalizeRunPath(prefix, true));
    return allowed.some(
      (prefix) => prefix === "" || canonical === prefix || canonical.startsWith(`${prefix}/`),
    );
  } catch {
    return false;
  }
}

/** Clone only JSON data. Reject accessors, custom prototypes, cycles, and lossy JSON values. */
function cloneJson(value: unknown, ancestors = new Set<object>(), depth = 0): RunJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || depth > 64 || ancestors.has(value))
    throw new Error("invalid_json_data");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) {
    throw new Error("invalid_json_data");
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || keys.length !== value.length + 1)
        throw new Error("invalid_json_data");
      const result: RunJsonValue[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          throw new Error("invalid_json_data");
        result.push(cloneJson(descriptor.value, ancestors, depth + 1));
      }
      return result;
    }
    if (prototype === Array.prototype) throw new Error("invalid_json_data");
    const result: { [key: string]: RunJsonValue } = {};
    for (const key of keys) {
      if (typeof key !== "string" || dangerousKeys.has(key)) throw new Error("invalid_json_data");
      const descriptor = descriptors[key];
      if (!("value" in descriptor) || !descriptor.enumerable) throw new Error("invalid_json_data");
      result[key] = cloneJson(descriptor.value, ancestors, depth + 1);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type Issue = { status: "blocked" | "failed" | "cancelled"; code: string };

export class ToolRegistry {
  private readonly toolsByName = new Map<string, RegisteredRunTool>();
  private readonly toolIds = new Set<string>();
  private readonly callsByRun = new Map<string, Set<string>>();
  private readonly now: () => number;

  constructor(tools: RegisteredRunTool[] = [], options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    for (const tool of tools) this.register(tool);
  }

  register(tool: RegisteredRunTool): void {
    if (
      !tool ||
      typeof tool.id !== "string" ||
      !internalIdPattern.test(tool.id) ||
      !tool.definition ||
      typeof tool.definition.name !== "string" ||
      !providerNamePattern.test(tool.definition.name) ||
      typeof tool.definition.description !== "string" ||
      typeof tool.validate !== "function" ||
      typeof tool.paths !== "function" ||
      typeof tool.execute !== "function"
    ) {
      throw new Error("invalid_tool_registration");
    }
    if (this.toolIds.has(tool.id)) throw new Error("duplicate_tool_id");
    if (this.toolsByName.has(tool.definition.name)) throw new Error("duplicate_tool_name");
    let definition: ProviderToolDefinition;
    try {
      const parameters = cloneJson(tool.definition.parameters);
      if (!isRecord(parameters) || parameters.type !== "object")
        throw new Error("invalid_tool_schema");
      definition = freezeJson({
        name: tool.definition.name,
        description: tool.definition.description,
        parameters,
      });
    } catch {
      throw new Error("invalid_tool_registration");
    }
    // Capture callbacks as well as data: changing the caller's registration cannot replace dispatch.
    const registered = Object.freeze({
      id: tool.id,
      definition,
      validate: tool.validate,
      paths: tool.paths,
      execute: tool.execute,
    });
    this.toolIds.add(registered.id);
    this.toolsByName.set(definition.name, registered);
  }

  definitions(scope: TaskRunScope): ProviderToolDefinition[] {
    if (this.scopeIssue(scope)) return [];
    return [...this.toolsByName.values()]
      .filter((tool) => scope.toolIds.includes(tool.id))
      .map((tool) => tool.definition);
  }

  async execute(call: ProviderToolCall, context: RunToolContext): Promise<RunToolResult> {
    const callId =
      typeof call?.id === "string" && /^[^\s\u0000-\u001f\u007f]{1,256}$/.test(call.id)
        ? call.id
        : "";
    const name =
      typeof call?.name === "string" && providerNamePattern.test(call.name) ? call.name : "";
    const tool = this.toolsByName.get(name);
    const toolId = tool?.id ?? name;
    const reject = (issue: Issue): RunToolResult => ({
      callId,
      toolId,
      status: issue.status,
      effectState: "not_started",
      output: null,
      sources: [],
      truncated: false,
      diagnosticCode: issue.code,
    });
    const blocked = (code: string) => reject({ status: "blocked", code });
    const failed = (code: string) => reject({ status: "failed", code });

    if (!callId) return blocked("invalid_tool_call_id");
    const initialIssue = this.contextIssue(context);
    if (initialIssue) return reject(initialIssue);
    const previous = this.callsByRun.get(context.runId) ?? new Set<string>();
    if (previous.has(callId)) return blocked("duplicate_tool_call_id");
    previous.add(callId);
    this.callsByRun.set(context.runId, previous);
    if (!tool) return blocked("unknown_tool");

    let invocation: RunToolContext;
    try {
      invocation = Object.freeze({
        runId: context.runId,
        projectId: context.projectId,
        signal: context.signal,
        isCurrent: context.isCurrent,
        scope: freezeJson(cloneJson(context.scope)) as unknown as TaskRunScope,
      });
    } catch {
      return blocked("invalid_run_scope");
    }
    const check = (): Issue | undefined => {
      const issue = this.contextIssue(context) ?? this.contextIssue(invocation);
      if (issue) return issue;
      if (
        context.runId !== invocation.runId ||
        context.projectId !== invocation.projectId ||
        context.scope.id !== invocation.scope.id
      ) {
        return { status: "blocked", code: "run_scope_changed" };
      }
      if (!context.scope.toolIds.includes(tool.id) || !invocation.scope.toolIds.includes(tool.id)) {
        return { status: "blocked", code: "tool_outside_scope" };
      }
      return undefined;
    };
    let issue = check();
    if (issue) return reject(issue);
    let args: Record<string, unknown>;
    try {
      if (typeof call.arguments !== "string") throw new Error("invalid_tool_arguments");
      const parsed: unknown = cloneJson(JSON.parse(call.arguments));
      if (!isRecord(parsed)) throw new Error("invalid_tool_arguments");
      args = freezeJson(parsed);
      if (tool.validate(args) !== undefined) throw new Error("invalid_tool_validator");
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_tool_limit") {
        return {
          ...failed("invalid_tool_limit"),
          output: {
            reason: "invalid_tool_limit",
            message: "No files were read. Correct limit using the tool schema, or omit the optional limit to use its default.",
            parameters: cloneJson(tool.definition.parameters),
          },
        };
      }
      return blocked("invalid_tool_arguments");
    }
    let paths: string[];
    try {
      paths = tool.paths(args);
      if (!Array.isArray(paths)) throw new Error("invalid_tool_paths");
      paths = paths.map((path) => normalizeRunPath(path, true));
    } catch {
      return blocked("invalid_tool_paths");
    }
    const pathsAllowed = () =>
      paths.every(
        (path) =>
          isRunPathAllowed(path, context.scope.readPrefixes) &&
          isRunPathAllowed(path, invocation.scope.readPrefixes),
      );
    issue = check();
    if (issue) return reject(issue);
    if (!pathsAllowed()) return blocked("tool_path_outside_scope");

    let raw: Omit<RunToolResult, "callId" | "toolId">;
    try {
      raw = await tool.execute(args, invocation);
    } catch {
      issue = check();
      return issue ? reject(issue) : failed("tool_execution_failed");
    }
    issue = check();
    if (issue) return reject(issue);
    if (!pathsAllowed()) return blocked("tool_path_outside_scope");

    let result: RunToolResult;
    try {
      const data = cloneJson(raw);
      if (
        !isRecord(data) ||
        Object.keys(data).some((key) => !resultKeys.has(key)) ||
        data.effectState !== "not_started" ||
        typeof data.truncated !== "boolean" ||
        !Object.hasOwn(data, "output") ||
        !Array.isArray(data.sources)
      )
        return failed("invalid_tool_result");
      if (data.status !== "completed") {
        if (data.status === "blocked" || data.status === "failed" || data.status === "cancelled") {
          return reject({ status: data.status, code: `tool_${data.status}` });
        }
        return failed("invalid_tool_result");
      }
      for (const source of data.sources) {
        if (
          !isRecord(source) ||
          Object.keys(source).some(
            (key) => !["projectId", "path", "version", "kind", "freshness"].includes(key),
          ) ||
          source.projectId !== invocation.projectId ||
          typeof source.path !== "string" ||
          typeof source.version !== "string" || !source.version ||
          (source.freshness!==undefined&&(typeof source.freshness!=="string"||!source.freshness||source.freshness.length>256)) ||
          !["project_index", "index_query", "file_preview", "tool"].includes(String(source.kind))
        ) {
          return failed("invalid_tool_sources");
        }
        if (
          !isRunPathAllowed(source.path, invocation.scope.readPrefixes) ||
          !isRunPathAllowed(source.path, context.scope.readPrefixes)
        ) {
          return blocked("tool_source_outside_scope");
        }
      }
      result = {
        callId,
        toolId,
        status: "completed",
        effectState: "not_started",
        output: data.output as RunJsonValue,
        sources: data.sources as unknown as RunToolResult["sources"],
        truncated: data.truncated,
      };
      const limit = Math.min(
        context.scope.limits.maxToolResultBytes,
        invocation.scope.limits.maxToolResultBytes,
      );
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > limit)
        return failed("tool_result_too_large");
    } catch {
      return failed("invalid_tool_result");
    }
    // Result getters/serialization cannot turn a revoked read into a publishable success.
    issue = check();
    return issue ? reject(issue) : result;
  }

  private scopeIssue(scope: TaskRunScope): Issue | undefined {
    try {
      const now = this.now();
      if (
        !scope ||
        typeof scope.id !== "string" ||
        !scope.id ||
        typeof scope.runId !== "string" ||
        !scope.runId ||
        typeof scope.projectId !== "string" ||
        !scope.projectId ||
        scope.mode !== "read_only" ||
        !Number.isFinite(now) ||
        !Number.isFinite(scope.expiresAt) ||
        !Array.isArray(scope.toolIds) ||
        scope.toolIds.some((id) => typeof id !== "string" || !internalIdPattern.test(id)) ||
        new Set(scope.toolIds).size !== scope.toolIds.length ||
        !Array.isArray(scope.readPrefixes) ||
        scope.readPrefixes.some((path) => normalizeRunPath(path, true) !== path) ||
        !scope.limits ||
        !Number.isSafeInteger(scope.limits.maxToolResultBytes) ||
        scope.limits.maxToolResultBytes <= 0
      ) {
        return { status: "blocked", code: "invalid_run_scope" };
      }
      if (scope.expiresAt <= now) return { status: "cancelled", code: "run_scope_expired" };
      return undefined;
    } catch {
      return { status: "blocked", code: "invalid_run_scope" };
    }
  }

  private contextIssue(context: RunToolContext): Issue | undefined {
    try {
      if (typeof context.signal?.aborted !== "boolean")
        return { status: "blocked", code: "invalid_run_scope" };
      if (context.signal.aborted) return { status: "cancelled", code: "run_cancelled" };
      if (context.isCurrent() !== true) return { status: "cancelled", code: "run_not_current" };
      if (
        typeof context.runId !== "string" ||
        typeof context.projectId !== "string" ||
        context.runId !== context.scope.runId ||
        context.projectId !== context.scope.projectId
      ) {
        return { status: "blocked", code: "run_scope_mismatch" };
      }
      return this.scopeIssue(context.scope);
    } catch {
      return { status: "blocked", code: "invalid_run_scope" };
    }
  }
}
