import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type { ProviderRuntimeRequest, ProviderRuntimeResponse, RunStoreCommit, TaskDraft, TaskRunScope } from "@uagent/shared";
import { ToolRegistry } from "../../../packages/runtime/src/run/tool-registry.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = fileURLToPath(new URL("../dist/runtime-host.cjs", import.meta.url));
const children: ChildProcessWithoutNullStreams[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(root, ".local-dev/temp/host-process-") )) throw Error("unsafe_cleanup");
    await rm(directory, { recursive: true });
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function harness(options: { holdModel?: boolean; failStore?: boolean } = {}) {
  await access(entry);
  const temporary = join(root, ".local-dev/temp");
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(join(temporary, "host-process-"));
  directories.push(directory);
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ next: "source.json" }));
  await writeFile(join(directory, "source.json"), JSON.stringify({ next: "value.json" }));
  await writeFile(join(directory, "value.json"), JSON.stringify({ value: 7 }));
  const scope: TaskRunScope = {
    id: "scope", runId: "run", projectId: "project", conversationId: "chat", rootRef: "root",
    providerId: "synthetic", modelId: "test", endpoint: "https://invalid.example", mode: "read_only",
    readPrefixes: [""], sharePrefixes: [""], toolIds: ["read"], expiresAt: Date.now() + 60000,
    limits: { maxToolCalls: 3, maxModelRequests: 4, maxDurationMs: 60000,
      maxAttemptsPerFailure: 2, maxToolResultBytes: 8192, maxContextBytes: 24576 },
  };
  const draft: TaskDraft = { input: "Follow manifest references and report the value", taskMode: "investigation",
    projectId: scope.projectId, conversationId: scope.conversationId, providerId: scope.providerId,
    modelId: scope.modelId, investigationScopeId: scope.id, permissionMode: "request_approval",
    reasoningEffort: "low", runMode: "local", branch: null, contextPercent: null };
  const reads: string[] = [], commits: RunStoreCommit[] = [];
  let current = true;
  const registry = new ToolRegistry([{
    id: "read", definition: { name: "read", description: "Read a fixture reference", parameters: {
      type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false,
    } },
    validate: args => { if (Object.keys(args).join() !== "path" || typeof args.path !== "string") throw Error("arguments"); },
    paths: args => [args.path as string],
    execute: async args => {
      reads.push(args.path as string);
      return { status: "completed", effectState: "not_started",
        output: { text: await readFile(join(directory, args.path as string), "utf8") }, sources: [], truncated: false };
    },
  }]);
  const child = spawn(process.execPath, [entry], { stdio: "pipe", windowsHide: true });
  children.push(child);
  const exit = once(child, "exit");
  const settled = deferred<any>(), entered = deferred<void>(), release = deferred<void>();
  const replies = new Map<number, (value: any) => void>();
  let sequence = 0, buffer = "", stderr = "";
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
  const command = (method: string, input: unknown = {}) => new Promise<any>(done => {
    const id = ++sequence; replies.set(id, done); send({ kind: "command", id, method, input });
  });
  async function handle(message: any) {
    if (message.kind === "reply") { replies.get(message.id)?.(message); replies.delete(message.id); return; }
    if (message.kind === "settled" || message.kind === "run_error") { settled.resolve(message); return; }
    if (message.kind !== "broker_request") return;
    let value: unknown;
    try {
      switch (message.method) {
        case "store.commit":
          if (options.failStore) throw Error("storage_failed");
          commits.push(message.input);
          await appendFile(join(directory, "commits.jsonl"), JSON.stringify(message.input) + "\n");
          break;
        case "context.validate": value = current; break;
        case "provider.complete": {
          entered.resolve();
          if (options.holdModel) await release.promise;
          if (!current) throw Error("revoked");
          const request = message.input as ProviderRuntimeRequest;
          const tools = request.messages.filter(item => item.role === "tool");
          const last = tools.at(-1);
          const content = last ? JSON.parse(JSON.parse(last.content).output.text) : { next: "manifest.json" };
          value = { id: request.id + ":reply", requestId: request.id, providerId: scope.providerId,
            modelId: scope.modelId, text: content.next ? "" : "Value is " + content.value,
            finishReason: content.next ? "tool_calls" : "stop", createdAt: Date.now(),
            ...(content.next ? { toolCalls: [{ id: "call-" + tools.length, name: "read", arguments: JSON.stringify({ path: content.next }) }] } : {}),
          } satisfies ProviderRuntimeResponse;
          break;
        }
        case "tool.execute":
          value = await registry.execute(message.input, { runId: scope.runId, projectId: scope.projectId,
            scope, signal: new AbortController().signal, isCurrent: () => current });
          break;
        default: throw Error("unexpected_broker_request");
      }
      send({ kind: "broker_reply", id: message.id, ok: true, value });
    } catch { send({ kind: "broker_reply", id: message.id, ok: false }); }
  }
  child.stdout.on("data", chunk => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const end = buffer.indexOf("\n"); if (end < 0) break;
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      void handle(JSON.parse(frame));
    }
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  return { child, exit, command, settled, entered, release, reads, commits, directory,
    stderr: () => stderr, revoke: () => { current = false; },
    start: () => command("start", { taskId: "task", draft, scope, tools: registry.definitions(scope) }) };
}

describe("standalone TypeScript host with synthetic parent broker and real file reads", () => {
  it("runs three causally dependent reads without a view and returns the final snapshot on reconnect", async () => {
    const f = await harness();
    expect((await f.command("hello")).value.protocolVersion).toBe(1);
    expect((await f.start()).ok).toBe(true);
    expect((await f.settled.promise).snapshot.run.status).toBe("completed");
    expect(f.reads).toEqual(["manifest.json", "source.json", "value.json"]);
    const latest = await f.command("snapshot", { runId: "run" });
    expect(latest.value.text).toBe("Value is 7");
    expect(latest.value.run.toolCalls).toBe(3);
    expect(f.commits.at(-1)?.run.status).toBe("completed");
    expect((await f.command("shutdown")).value.checkpointed).toBe(true);
    expect((await f.exit)[0]).toBe(0);
    expect(f.stderr()).toBe("");
  });

  it("waits for the in-flight response then checkpoints before clean process exit", async () => {
    const f = await harness({ holdModel: true });
    await f.start(); await f.entered.promise;
    const shuttingDown = f.command("shutdown");
    // The pause request is observed before releasing the synthetic native response.
    await f.command("hello");
    f.release.resolve();
    expect((await shuttingDown).value.checkpointed).toBe(true);
    expect(f.reads).toEqual([]);
    expect(f.commits.at(-1)?.checkpoint?.reason).toBe("user_paused");
    expect((await f.exit)[0]).toBe(0);
  });

  it("does not report a checkpoint when persistence failed", async () => {
    const f = await harness({ failStore: true });
    await f.start();
    expect((await f.settled.promise).snapshot.run.stopReason).toBe("persistence_failed");
    expect((await f.command("shutdown")).value.checkpointed).toBe(false);
    expect((await f.exit)[0]).toBe(0);
    expect(f.reads).toEqual([]);
  });

  it("exits when the parent pipe closes with a request outstanding", async () => {
    const f = await harness({ holdModel: true });
    await f.start(); await f.entered.promise;
    f.child.stdin.end();
    expect((await f.exit)[0]).toBe(0);
    expect(f.reads).toEqual([]);
  });
});
