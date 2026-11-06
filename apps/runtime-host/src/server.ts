import type { ProviderRuntimeResponse, ProviderToolDefinition, RunToolResult, TaskDraft, TaskRunScope } from "@uagent/shared";
import { RunHost } from "../../../packages/runtime/src/run/run-host.js";
import { createNativeRunStore } from "../../../packages/runtime/src/run/native-run-store.js";
import { BrokerPeer } from "./broker-peer.js";
import { prepareHostedChatRequest } from "./chat-request.js";
import { redactProjectFile } from "../../../packages/runtime/src/secrets/project-file-redaction.js";

interface StartInput {
  taskId: string;
  draft: TaskDraft;
  scope: TaskRunScope;
  tools: ProviderToolDefinition[];
}

/** This endpoint is for the native parent, never a renderer-accessible execution API. */
export class RuntimeHostServer {
  private readonly host = new RunHost();
  private readonly broker: BrokerPeer;
  private readonly owners = new Map<string, { current: boolean }>();
  private closing = false;

  constructor(private readonly send: (message: unknown) => void, private readonly stopped: () => void) {
    this.broker = new BrokerPeer(send);
  }

  async receive(message: unknown): Promise<void> {
    if (!message || typeof message !== "object" || Array.isArray(message)) throw Error("invalid_host_message");
    const item = message as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || Number(item.id) < 1) throw Error("invalid_host_message");
    if (item.kind === "broker_reply") {
      if (typeof item.ok !== "boolean") throw Error("invalid_host_message");
      this.broker.reply(Number(item.id), item.ok, item.value);
      return;
    }
    if (item.kind !== "command" || typeof item.method !== "string") throw Error("invalid_host_message");
    try {
      const value = await this.command(item.method, item.input);
      this.send({ kind: "reply", id: item.id, ok: true, value });
      if (item.method === "shutdown") this.stopped();
    } catch {
      this.send({ kind: "reply", id: item.id, ok: false, error: "host_command_rejected" });
    }
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    for (const owner of this.owners.values()) owner.current = false;
    this.broker.close();
    await this.host.close();
  }

  private async command(method: string, input: unknown): Promise<unknown> {
    if (method === "hello") return { protocolVersion: 1, engine: "RunCoordinator", taskModes: ["investigation"] };
    if (method === "shutdown") {
      this.closing = true;
      return await this.host.close();
    }
    if (this.closing) throw Error("host_closing");
    if (method === "start") return this.start(input as StartInput);
    if (!input || typeof input !== "object" || typeof (input as { runId?: unknown }).runId !== "string")
      throw Error("invalid_run_id");
    const runId = (input as { runId: string }).runId;
    if (!this.owners.has(runId)) throw Error("run_not_found");
    switch (method) {
      case "snapshot": return this.host.getSnapshot(runId);
      case "pause": this.host.pause(runId); break;
      case "cancel": await this.host.cancel(runId); break;
      case "revoke": this.owners.get(runId)!.current = false; await this.host.cancel(runId); break;
      case "resume": this.observe(runId, this.host.resume(runId)); break;
      case "amend": {
        const change = input as { instructions: string; expectedPlanVersion: number };
        await this.host.amend(runId, change.instructions, change.expectedPlanVersion);
        break;
      }
      default: throw Error("unknown_host_command");
    }
    return { accepted: true };
  }

  private start(input: StartInput): unknown {
    if (!input?.scope || input.draft?.taskMode !== "investigation" || input.scope.collaboration
      || !Array.isArray(input.tools) || !input.tools.length || input.tools.length > 8
      || typeof input.taskId !== "string" || !input.taskId) throw Error("invalid_host_start");
    const { scope } = input;
    if (!scope.runId || this.owners.has(scope.runId)) throw Error("duplicate_host_run");
    const owner = { current: true };
    // This local flag can only revoke. The broker must check its original live lease,
    // trusted root and provider generation again for each real model/tool operation.
    const current = () => owner.current && Date.now() < scope.expiresAt;
    const pending = this.host.start(input.taskId, input.draft, {
      lease: { scope: structuredClone(scope), isCurrent: current },
      adapter: {
        id: scope.providerId,
        getCapabilities: () => ({ providerId: scope.providerId, modelIds: [scope.modelId],
          supportsTools: true, supportsStreaming: false, supportsPreSendValidation: true, isMock: false }),
        complete: async (request, options) => {
          await options?.beforeSend?.();
          return this.broker.request<ProviderRuntimeResponse>(scope.runId, "provider.complete", prepareHostedChatRequest(request), options?.signal);
        },
      },
      registry: {
        definitions: () => structuredClone(input.tools),
        execute: async (call, context) => {
          const result = await this.broker.request<RunToolResult>(scope.runId, "tool.execute", call, context.signal);
          if (result.toolId === "project.read_file" && result.status === "completed") {
            const output = result.output as Record<string, unknown>;
            if (typeof output.text !== "string") throw Error("host_file_result_invalid");
            const safe = redactProjectFile(output.text);
            result.output = { ...result.output as Record<string, import("@uagent/shared").RunJsonValue>,
              text: safe.text, redacted: output.redacted === true || safe.redacted };
          }
          if (new TextEncoder().encode(JSON.stringify(result)).length > scope.limits.maxToolResultBytes)
            throw Error("host_tool_result_limit");
          return result;
        },
      },
      contextSources: {
        validate: (sources, _scope, signal) => this.broker.request<boolean>(scope.runId, "context.validate", sources, signal),
      },
      store: createNativeRunStore((command, args) => {
        if (command === "commit_native_run_store") return this.broker.request(scope.runId, "store.commit", args.input);
        if (command === "snapshot_native_run_store") return this.broker.request(scope.runId, "store.snapshot", args.input);
        throw Error("unsupported_store_operation");
      }),
    });
    this.owners.set(scope.runId, owner);
    this.observe(scope.runId, pending);
    return { accepted: true, runId: scope.runId };
  }

  private observe(runId: string, pending: Promise<unknown>): void {
    void pending.then(
      () => this.send({ kind: "settled", runId, snapshot: this.host.getSnapshot(runId) }),
      () => this.send({ kind: "run_error", runId, error: "host_run_rejected" }),
    );
  }
}
