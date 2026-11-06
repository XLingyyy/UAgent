import {readAssetReferences} from "./native-asset-references";
import {blueprintPath,readBlueprint,selectedBlueprintReadSession} from "./native-blueprint-read";
import type { RunJsonValue, RunSourceRef, RunToolResult, TaskRunScope } from "@uagent/shared";
import {
  ToolRegistry,
  isRunPathAllowed,
  normalizeRunPath,
  type RegisteredRunTool,
  type RunToolContext,
} from "@uagent/runtime";
import { redactPathsInString } from "@uagent/runtime";
import type { NativeProjectAdapter } from "./project-native-adapter";
import { checkedFreshness, projectIndexVersion } from "./project-context-sources";

export const PROJECT_READ_TOOL_IDS = [
  "project.list_files",
  "project.find_files",
  "project.read_file",
  "ue.blueprint_structure",
  "ue.asset_references",
] as const;
function safeFile(path: string): boolean {
  try {
    normalizeRunPath(path);
  } catch {
    return false;
  }
  const parts = path.toLowerCase().split("/"),
    name = parts[parts.length - 1]!;
  return (
    !parts.some((part) =>
      [
        ".git",
        ".aws",
        ".ssh",
        ".codex",
        "node_modules",
        "target",
        "saved",
        "intermediate",
        "binaries",
      ].includes(part),
    ) &&
    !/^\.env(?:\.|$)/.test(name) &&
    !/(?:\.pem|\.key|\.p12|\.pfx|\.secret)$/.test(name) &&
    !["credentials.json", "secrets.json"].includes(name)
  );
}
function redactFile(text: string): { text: string; redacted: boolean } {
  const original = text;
  text = text.replace(
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)/g,
    "[REDACTED PRIVATE KEY]",
  );
  text = text
    .split("\n")
    .map((line) =>
      /["']?(?:api[_-]?key|authorization|password|secret|approval[_-]?token|execution[_-]?token)["']?\s*[:=]/i.test(
        line,
      )
        ? "[REDACTED SENSITIVE LINE]"
        : line,
    )
    .join("\n");
  text = text.replace(
    /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
    "[REDACTED]",
  );
  text = text.replace(/https?:\/\/[^\s/]+:[^\s/@]+@[^\s]+/g, "[REDACTED CREDENTIAL URL]");
  text = redactPathsInString(text).replace(
    /[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s]*)*/g,
    "[user-home]",
  );
  return { text, redacted: text !== original };
}
function validateArgs(args: Record<string, unknown>, keys: string[], required: string[]): void {
  if (
    Object.keys(args).some((key) => !keys.includes(key)) ||
    required.some((key) => typeof args[key] !== "string")
  )
    throw Error("invalid_tool_arguments");
  if (
    "limit" in args &&
    (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 25)
  )
    throw Error("invalid_tool_limit");
  if (
    "query" in args &&
    (typeof args.query !== "string" || !args.query.trim() || args.query.length > 100)
  )
    throw Error("invalid_query");
}
function source(
  projectId: string,
  path: string,
  version: string,
  kind: RunSourceRef["kind"],
  freshness?: string,
): RunSourceRef {
  return { projectId, path, version, kind, ...(freshness ? { freshness } : {}) };
}
export function createProjectReadToolRegistry(
  adapter: NativeProjectAdapter,
  options: { allowFixture?: boolean } = {},
): ToolRegistry {
  function project(context: RunToolContext) {
    if (adapter.source !== "native" && !options.allowFixture)
      throw Error("native_project_unavailable");
    const p = adapter.getProject(context.projectId);
    if (!p || p.trustState !== "trusted" || p.rootRef !== context.scope.rootRef)
      throw Error("trusted_project_required");
    return p;
  }
  function index(context: RunToolContext) {
    const p = project(context),
      snapshot = adapter.getStableSnapshot(p.id);
    if (
      !snapshot ||
      snapshot.status !== "ready" ||
      snapshot.projectId !== p.id ||
      snapshot.rootRef !== p.rootRef
    )
      throw Error("current_index_required");
    return snapshot;
  }
  const list = (search: boolean): RegisteredRunTool => ({
    id: search ? "project.find_files" : "project.list_files",
    definition: {
      name: search ? "project_find_files" : "project_list_files",
      description: search
        ? "Find paths in the current approved project index. Does not search file contents or scan the disk. Optional limit must be an integer from 1 to 25 (default 20)."
        : "List paths from the current approved project index. Use an approved project-relative prefix. Optional limit must be an integer from 1 to 25 (default 20).",
      parameters: {
        type: "object",
        properties: {
          prefix: { type: "string" },
          ...(search ? { query: { type: "string" } } : {}),
          limit: { type: "integer", minimum: 1, maximum: 25 },
        },
        required: search ? ["prefix", "query"] : ["prefix"],
        additionalProperties: false,
      },
    },
    validate: (args) =>
      validateArgs(
        args,
        search ? ["prefix", "query", "limit"] : ["prefix", "limit"],
        search ? ["prefix", "query"] : ["prefix"],
      ),
    paths: (args) => [args.prefix as string],
    execute: async (args, context) => {
      const snapshot = index(context),
        prefix = normalizeRunPath(args.prefix as string, true),
        query = search ? (args.query as string).toLowerCase() : "";
      const matches = snapshot.files.filter(
        (file) =>
          !file.isIgnored &&
          safeFile(file.rootRelativePath) &&
          isRunPathAllowed(file.rootRelativePath, [prefix]) &&
          isRunPathAllowed(file.rootRelativePath, context.scope.readPrefixes) &&
          file.rootRelativePath.toLowerCase().includes(query),
      );
      const files = matches.slice(0, Number(args.limit ?? 20)).map((file) => ({
        path: file.rootRelativePath,
        bytes: file.byteSize,
        extension: file.extension,
      }));
      const indexVersion = projectIndexVersion(adapter, context.projectId);
      const inspected = adapter.inspectSources
        ? await adapter.inspectSources(
            context.projectId,
            files.map((file) => file.path),
          )
        : null;
      if (
        adapter.source === "native" &&
        (!inspected ||
          !indexVersion ||
          indexVersion !== projectIndexVersion(adapter, context.projectId))
      )
        throw Error("source_unavailable");
      return {
        status: "completed",
        effectState: "not_started",
        output: {
          files,
          indexVersion: snapshot.id,
          indexedAt: snapshot.summary.scannedAt,
        } as RunJsonValue,
        sources: [source(context.projectId,prefix,indexVersion??snapshot.id+":"+snapshot.summary.scannedAt,"index_query"),...files.map((file) =>
          source(
            context.projectId,
            file.path,
            indexVersion ?? snapshot.id + ":" + snapshot.summary.scannedAt,
            "project_index",
            inspected ? checkedFreshness(inspected, file.path) : undefined,
          ),
        )],
        truncated: matches.length > files.length,
      };
    },
  });
  const read: RegisteredRunTool = {
    id: "project.read_file",
    definition: {
      name: "project_read_file",
      description:
        "Read bounded text from one approved project-relative file through the native trusted-root preview. Binary/secret files are blocked; truncation and redaction are explicit.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    validate: (args) => {
      validateArgs(args, ["path"], ["path"]);
      if (!safeFile(args.path as string)) throw Error("file_not_shareable");
    },
    paths: (args) => [args.path as string],
    execute: async (args, context): Promise<Omit<RunToolResult, "callId" | "toolId">> => {
      const p = project(context),
        path = normalizeRunPath(args.path as string);
      const before = adapter.inspectSources ? await adapter.inspectSources(p.id, [path]) : null;
      if (adapter.source === "native" && !before) throw Error("source_unavailable");
      const beforeVersion = before ? checkedFreshness(before, path) : null;
      const overhead =
        new TextEncoder().encode(
          JSON.stringify({
            path,
            readAt: Number.MAX_SAFE_INTEGER,
            redacted: true,
            originalBytes: Number.MAX_SAFE_INTEGER,
            originalLines: null,
            observedLines: 80,
            lineCountComplete: false,
            sources: [
              source(
                p.id,
                path,
                "preview-sha256:" + "0".repeat(64),
                "file_preview",
                beforeVersion ?? "0".repeat(256),
              ),
            ],
          }),
        ).length + 512;
      const contentLimit = Math.min(
        2048,
        Math.floor((context.scope.limits.maxToolResultBytes - overhead) / 6),
      );
      if (contentLimit < 32) throw Error("tool_result_budget");
      const preview = await adapter.previewFile(p.id, p.rootRef, path, contentLimit, 80);
      if (
        preview.projectId !== p.id ||
        preview.rootRelativePath !== path ||
        !["ready", "truncated"].includes(preview.status)
      )
        return {
          status: "blocked",
          effectState: "not_started",
          output: { reason: preview.status === "missing" ? "file_missing" : "preview_blocked" },
          sources: [],
          truncated: false,
          diagnosticCode: preview.status === "missing" ? "file_missing" : "preview_blocked",
        };
      const after = adapter.inspectSources ? await adapter.inspectSources(p.id, [path]) : null;
      const freshness = after ? checkedFreshness(after, path) : undefined;
      if (adapter.source === "native" && (!freshness || freshness !== beforeVersion))
        throw Error("source_changed_during_read");
      const safe = redactFile(preview.content),
        digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(safe.text));
      const version =
        "preview-sha256:" +
        Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      return {
        status: "completed",
        effectState: "not_started",
        output: {
          path,
          text: safe.text,
          readAt: preview.createdAt,
          redacted: safe.redacted || preview.redaction.redacted,
          originalBytes: preview.truncation.originalBytes,
          originalLines:
            preview.truncation.lineCountComplete === false
              ? null
              : preview.truncation.originalLines,
          ...(preview.truncation.lineCountComplete === undefined
            ? {}
            : { lineCountComplete: preview.truncation.lineCountComplete }),
          ...(preview.truncation.observedLines === undefined
            ? {}
            : { observedLines: preview.truncation.observedLines }),
        },
        sources: [source(p.id, path, version, "file_preview", freshness)],
        truncated: preview.status === "truncated" || preview.truncation.truncated,
      };
    },
  };
  const blueprint:RegisteredRunTool={
    id:"ue.blueprint_structure",
    definition:{name:"ue_blueprint_structure",description:"Read declared structure of an already-loaded Blueprint in the selected managed editor, with a separate native approval. Point-in-time observation only; not a reusable or disk-coherent source. Never loads, compiles or saves assets.",parameters:{type:"object",properties:{packageName:{type:"string"}},required:["packageName"],additionalProperties:false}},
    validate:args=>{validateArgs(args,["packageName"],["packageName"]);blueprintPath(args.packageName as string);},
    paths:args=>[blueprintPath(args.packageName as string)],
    execute:async(args,context)=>{
      project(context);if(!isRunPathAllowed(blueprintPath(args.packageName as string),context.scope.sharePrefixes))throw Error("semantic_sharing_scope_required");const session=selectedBlueprintReadSession(context.projectId);if(!session)throw Error("semantic_managed_editor_required");
      const observation=await readBlueprint(session,args.packageName as string,context.signal);
      project(context);if(selectedBlueprintReadSession(context.projectId)!==session)throw Error("semantic_editor_changed");
      // Preserve native provenance in the tool result, never invent a disk freshness token.
      return {status:"completed",effectState:"not_started",output:{observation,usage:"Historical editor observation at observedAtUtc; re-query for current state. Not disk-coherent or reusable as a file source."} as unknown as RunJsonValue,sources:[],truncated:(observation.result.data as Record<string,unknown>).truncated===true};
    },
  };
  const references:RegisteredRunTool={
    id:"ue.asset_references",
    definition:{name:"ue_asset_references",description:"Read direct Asset Registry package dependencies and referencers in the selected managed editor. Separate native approval required. No loading/scanning/writes or recursive traversal. Names outside approved read/sharing scope are omitted. Registry may be incomplete or stale; empty is not proof of no references.",parameters:{type:"object",properties:{packageName:{type:"string"}},required:["packageName"],additionalProperties:false}},
    validate:args=>{validateArgs(args,["packageName"],["packageName"]);blueprintPath(args.packageName as string);},
    paths:args=>[blueprintPath(args.packageName as string)],
    execute:async(args,context)=>{
      project(context);const packageName=args.packageName as string;
      if(!isRunPathAllowed(blueprintPath(packageName),context.scope.sharePrefixes))throw Error("semantic_sharing_scope_required");
      const session=selectedBlueprintReadSession(context.projectId);if(!session)throw Error("semantic_managed_editor_required");
      const observation=await readAssetReferences(session,packageName,context.signal);
      project(context);if(selectedBlueprintReadSession(context.projectId)!==session)throw Error("semantic_editor_changed");
      const visible=(name:string)=>{try{const path=blueprintPath(name);return isRunPathAllowed(path,context.scope.readPrefixes)&&isRunPathAllowed(path,context.scope.sharePrefixes);}catch{return false;}};
      const original=observation.result.data,dependencies=original.dependencies.filter(visible),referencers=original.referencers.filter(visible);
      const omitted={dependencies:original.dependencies.length-dependencies.length,referencers:original.referencers.length-referencers.length};
      const filtered={...observation,result:{...observation.result,data:{...original,dependencies,referencers}}};
      return {status:"completed",effectState:"not_started",output:{observation:filtered,omittedOutsideScope:omitted,usage:"Direct package edges only; no hard/soft distinction or runtime object references. Historical registry observation, not a complete/current disk graph. No recursive lookup or asset loading."} as unknown as RunJsonValue,sources:[],truncated:original.truncated||original.assetRegistryLoading||omitted.dependencies>0||omitted.referencers>0};
    },
  };
  return new ToolRegistry([list(false), list(true), read, blueprint,references]);
}
export function defaultInvestigationLimits(): TaskRunScope["limits"] {
  return {
    maxToolCalls: 3,
    maxModelRequests: 4,
    maxDurationMs: 600000,
    maxAttemptsPerFailure: 2,
    maxToolResultBytes: 8192,
    maxContextBytes: 24576,
  };
}
