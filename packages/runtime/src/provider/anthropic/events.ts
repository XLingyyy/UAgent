import type { ProviderRuntimeRequest, ProviderToolCallDelta } from "@uagent/shared";
import { checkBlock, parseMessage, readUsage, type AnthropicResult } from "./protocol.js";
import { argumentsObject, clone, invalid, MessagesError, object, token } from "./utils.js";

export interface MessagesEmission {
  text?: string;
  toolCallDelta?: ProviderToolCallDelta;
}
export class MessagesEvents {
  private message: Record<string, unknown> | undefined;
  private content: Array<Record<string, unknown>> = [];
  private active: number | undefined;
  private phase: "blocks" | "delta" | "stopped" = "blocks";
  private rawArguments = new Map<number, string>();
  private argumentsText = "";
  private toolIndex = 0;
  private usage: Record<string, unknown> = {};
  private finalOutput = false;
  constructor(private request: ProviderRuntimeRequest) {}
  accept(
    data: unknown,
    event?: string,
  ): { emissions: MessagesEmission[]; result?: AnthropicResult } {
    if (
      !object(data) ||
      typeof data.type !== "string" ||
      event !== data.type ||
      this.phase === "stopped"
    )
      return invalid();
    if (data.type === "error") {
      const type = object(data.error) ? data.error.type : undefined;
      throw new MessagesError(
        type === "authentication_error" || type === "permission_error"
          ? "auth_missing"
          : type === "rate_limit_error"
            ? "rate_limited"
            : type === "overloaded_error" || type === "api_error"
              ? "provider_unavailable"
              : "malformed_response",
      );
    }
    if (data.type === "ping") return { emissions: [] };
    if (data.type === "message_start") {
      if (this.message || !object(data.message)) return invalid();
      const m = data.message;
      if (
        m.type !== "message" ||
        m.role !== "assistant" ||
        !token(m.id) ||
        m.model !== this.request.modelId ||
        !Array.isArray(m.content) ||
        m.content.length ||
        m.stop_reason != null ||
        m.stop_sequence != null
      )
        return invalid();
      this.message = clone(m);
      this.mergeUsage(m.usage);
      return { emissions: [] };
    }
    if (!this.message) {
      if (
        ![
          "content_block_start",
          "content_block_delta",
          "content_block_stop",
          "message_delta",
          "message_stop",
        ].includes(data.type)
      )
        return { emissions: [] };
      return invalid();
    }
    if (data.type === "content_block_start") {
      if (
        this.phase !== "blocks" ||
        this.active !== undefined ||
        data.index !== this.content.length ||
        !object(data.content_block)
      )
        return invalid();
      const block = clone(data.content_block);
      if (!["text", "thinking", "redacted_thinking", "tool_use"].includes(block.type as string))
        return invalid();
      if (block.type === "thinking") {
        if (typeof block.thinking !== "string" || typeof block.signature !== "string")
          return invalid();
      } else checkBlock(block);
      if (block.type === "tool_use" && Object.keys(block.input as object).length) return invalid();
      this.active = this.content.length;
      this.content.push(block);
      this.argumentsText = "";
      return {
        emissions: block.type === "text" && block.text ? [{ text: block.text as string }] : [],
      };
    }
    if (data.type === "content_block_delta") {
      if (
        this.phase !== "blocks" ||
        this.active === undefined ||
        data.index !== this.active ||
        !object(data.delta)
      )
        return invalid();
      const block = this.content[this.active]!,
        delta = data.delta;
      switch (delta.type) {
        case "text_delta":
          if (block.type !== "text" || typeof delta.text !== "string") return invalid();
          block.text = (block.text as string) + delta.text;
          return { emissions: [{ text: delta.text }] };
        case "thinking_delta":
          if (block.type !== "thinking" || typeof delta.thinking !== "string" || block.signature)
            return invalid();
          block.thinking = (block.thinking as string) + delta.thinking;
          break;
        case "signature_delta":
          if (block.type !== "thinking" || typeof delta.signature !== "string") return invalid();
          // Signature is an opaque replacement value, matching the official SDK accumulator.
          block.signature = delta.signature;
          break;
        case "input_json_delta":
          if (block.type !== "tool_use" || typeof delta.partial_json !== "string") return invalid();
          this.argumentsText += delta.partial_json;
          break;
        default:
          return invalid();
      }
      return { emissions: [] };
    }
    if (data.type === "content_block_stop") {
      if (this.phase !== "blocks" || this.active === undefined || data.index !== this.active)
        return invalid();
      const block = this.content[this.active]!,
        emissions: MessagesEmission[] = [];
      if (block.type === "tool_use") {
        const args = this.argumentsText || "{}";
        block.input = argumentsObject(args);
        this.rawArguments.set(this.active, args);
        emissions.push({
          toolCallDelta: {
            index: this.toolIndex++,
            id: block.id as string,
            name: block.name as string,
            argumentsDelta: args,
          },
        });
      }
      checkBlock(block);
      this.active = undefined;
      return { emissions };
    }
    if (data.type === "message_delta") {
      if (this.active !== undefined || !object(data.delta)) return invalid();
      this.phase = "delta";
      if (data.delta.stop_reason != null) {
        if (this.message.stop_reason != null && this.message.stop_reason !== data.delta.stop_reason)
          return invalid();
        this.message.stop_reason = data.delta.stop_reason;
        this.message.stop_sequence = data.delta.stop_sequence ?? null;
      }
      this.mergeUsage(data.usage);
      if (object(data.usage) && data.usage.output_tokens !== undefined) this.finalOutput = true;
      return { emissions: [] };
    }
    if (data.type === "message_stop") {
      if (this.phase !== "delta" || this.active !== undefined || !this.message.stop_reason)
        return invalid();
      this.phase = "stopped";
      const usage = clone(this.usage);
      if (!this.finalOutput) delete usage.output_tokens;
      return {
        emissions: [],
        result: parseMessage(
          { ...this.message, content: this.content, usage },
          this.request,
          this.rawArguments,
        ),
      };
    }
    // Future top-level SSE events are ignored, never interpreted as text/tools or success.
    return { emissions: [] };
  }
  private mergeUsage(raw: unknown) {
    if (raw == null) return;
    if (!object(raw)) return invalid();
    readUsage(raw);
    for (const name of [
      "input_tokens",
      "output_tokens",
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
    ])
      if (
        raw[name] !== undefined &&
        this.usage[name] !== undefined &&
        (raw[name] as number) < (this.usage[name] as number)
      )
        return invalid();
    this.usage = { ...this.usage, ...clone(raw) };
  }
}
