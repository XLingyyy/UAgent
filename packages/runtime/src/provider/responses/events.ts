import type { ProviderRuntimeRequest, ProviderToolCallDelta } from "@uagent/shared";
import { createProviderRuntimeError } from "../provider-error.js";
import {
  identifier,
  parseResponsesResult,
  record,
  responsesError,
  type ResponsesResult,
} from "./protocol.js";

export interface ResponsesEmission {
  delta: string;
  toolCallDelta?: ProviderToolCallDelta;
}
interface FunctionState {
  itemId: string;
  callId: string;
  name: string;
  index: number;
  arguments: string;
  argumentsDone: boolean;
  itemDone: boolean;
}
interface TextState {
  value: string;
  done: boolean;
  kind: string;
}

/** Deltas are progress only. Executable calls appear solely after a valid terminal response. */
export class ResponsesEvents {
  private readonly items = new Map<number, { id: string; type: string; done: boolean }>();
  private readonly functions = new Map<number, FunctionState>();
  private readonly textParts = new Map<string, TextState>();
  private responseId?: string;
  private sequence = -1;
  private text = "";
  private argumentBytes = 0;
  private ended = false;
  constructor(private readonly request: ProviderRuntimeRequest) {}
  private fail(message: string): never {
    throw responsesError(this.request.providerId, message);
  }
  private outputIndex(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= 256)
      this.fail("Invalid Responses output index.");
    return value;
  }
  private addItem(value: unknown, index: number, emissions: ResponsesEmission[]) {
    const p = this.request.providerId,
      item = record(value, p);
    const id = identifier(item.id, p);
    if (this.items.has(index) || [...this.items.values()].some((item) => item.id === id))
      this.fail("Duplicate Responses output item.");
    if (item.type !== "function_call" && item.type !== "message" && item.type !== "reasoning")
      this.fail("Unapproved native Responses tool output.");
    this.items.set(index, { id, type: item.type, done: false });
    if (item.type === "function_call") {
      const callId = identifier(item.call_id, p),
        name = identifier(item.name, p, 64);
      if (
        this.request.toolChoice === "none" ||
        !this.request.tools?.some((tool) => tool.name === name) ||
        this.functions.size >= 8 ||
        [...this.functions.values()].some((call) => call.callId === callId)
      )
        this.fail("Unadvertised or duplicate Responses function call.");
      const state: FunctionState = {
        itemId: id,
        callId,
        name,
        index: this.functions.size,
        arguments: "",
        argumentsDone: false,
        itemDone: false,
      };
      this.functions.set(index, state);
      if (typeof item.arguments !== "string") this.fail("Invalid Responses function arguments.");
      this.appendArguments(state, item.arguments, emissions, true);
    }
  }
  private appendArguments(
    state: FunctionState,
    delta: string,
    emissions: ResponsesEmission[],
    started = false,
  ) {
    if (state.argumentsDone || state.itemDone || typeof delta !== "string")
      this.fail("Function arguments changed after completion.");
    state.arguments += delta;
    this.argumentBytes += new TextEncoder().encode(delta).length;
    if (this.argumentBytes > 16_384)
      this.fail("Responses function arguments exceed the byte limit.");
    emissions.push({
      delta: "",
      toolCallDelta: {
        index: state.index,
        ...(started ? { id: state.callId, name: state.name } : {}),
        argumentsDelta: delta,
      },
    });
  }
  private finishArguments(state: FunctionState, value: unknown, emissions: ResponsesEmission[]) {
    if (typeof value !== "string" || !value.startsWith(state.arguments))
      this.fail("Final Responses function arguments disagree with streamed bytes.");
    const suffix = value.slice(state.arguments.length);
    if (suffix) this.appendArguments(state, suffix, emissions);
    state.argumentsDone = true;
  }
  private identity(value: unknown) {
    const body = record(value, this.request.providerId);
    const id = identifier(body.id, this.request.providerId);
    if (this.responseId !== undefined && this.responseId !== id)
      this.fail("Responses identity changed midstream.");
    if (body.model !== this.request.modelId)
      this.fail("Responses model differs from the explicitly selected model.");
    this.responseId = id;
    return body;
  }
  accept(
    value: unknown,
    eventName?: string,
  ): { emissions: ResponsesEmission[]; result?: ResponsesResult } {
    const p = this.request.providerId,
      event = record(value, p),
      emissions: ResponsesEmission[] = [];
    if (this.ended) this.fail("Unexpected Responses event after completion.");
    if (
      typeof event.type !== "string" ||
      (eventName && eventName !== "message" && eventName !== event.type)
    )
      this.fail("Responses SSE event type mismatch.");
    if (event.sequence_number !== undefined) {
      if (
        typeof event.sequence_number !== "number" ||
        !Number.isSafeInteger(event.sequence_number) ||
        event.sequence_number <= this.sequence
      )
        this.fail("Responses sequence is not increasing.");
      this.sequence = event.sequence_number;
    }
    const type = event.type;
    if (type === "error") {
      const code =
        event.code === "rate_limit_exceeded"
          ? "rate_limited"
          : event.code === "invalid_api_key"
            ? "auth_missing"
            : "provider_unavailable";
      throw createProviderRuntimeError(
        p,
        code,
        "Responses stream reported an error. No automatic retry was sent.",
      );
    }
    if (type === "response.created" || type === "response.in_progress") {
      this.identity(event.response);
    } else if (
      type === "response.failed" ||
      type === "response.incomplete" ||
      type === "response.completed" ||
      type === "response.cancelled"
    ) {
      const body = this.identity(event.response);
      const expected = type.slice("response.".length);
      if (body.status !== expected) this.fail("Responses terminal event and status disagree.");
      const result = parseResponsesResult(body, this.request);
      for (const [index, item] of this.items) {
        const final = result.output[index];
        if (!final || final.id !== item.id || final.type !== item.type)
          this.fail("Final Responses output items disagree with the stream.");
      }
      result.output.forEach((item, index) => {
        if (item.type !== "function_call") return;
        if (!this.items.has(index)) this.addItem(item, index, emissions);
        const state = this.functions.get(index)!;
        if (item.call_id !== state.callId || item.name !== state.name)
          this.fail("Final Responses function identity changed.");
        this.finishArguments(state, item.arguments, emissions);
      });
      const streamedOrder = [...this.functions.values()].sort((a, b) => a.index - b.index);
      if (result.toolCalls.some((call, index) => streamedOrder[index]?.callId !== call.id))
        this.fail("Final Responses function order disagrees with the stream.");
      if (result.toolCalls.length !== this.functions.size)
        this.fail("Final Responses function set disagrees with the stream.");
      if (!result.text.startsWith(this.text))
        this.fail("Final Responses text disagrees with streamed bytes.");
      const delta = result.text.slice(this.text.length);
      if (delta) emissions.push({ delta });
      this.ended = true;
      return { emissions, result };
    } else if (type === "response.output_item.added") {
      this.addItem(event.item, this.outputIndex(event.output_index), emissions);
    } else if (type === "response.output_item.done") {
      const index = this.outputIndex(event.output_index),
        item = record(event.item, p),
        previous = this.items.get(index);
      if (!previous || previous.done || item.id !== previous.id || item.type !== previous.type)
        this.fail("Responses output item completion changed identity.");
      const state = this.functions.get(index);
      if (state) {
        if (item.call_id !== state.callId || item.name !== state.name)
          this.fail("Responses function completion changed identity.");
        this.finishArguments(state, item.arguments, emissions);
        state.itemDone = true;
      }
      previous.done = true;
    } else if (
      type === "response.function_call_arguments.delta" ||
      type === "response.function_call_arguments.done"
    ) {
      const index = this.outputIndex(event.output_index),
        state = this.functions.get(index);
      if (!state || event.item_id !== state.itemId)
        this.fail("Orphan Responses function arguments.");
      if (type.endsWith(".delta")) this.appendArguments(state, event.delta as string, emissions);
      else {
        if (state.argumentsDone || state.itemDone)
          this.fail("Duplicate function arguments completion.");
        this.finishArguments(state, event.arguments, emissions);
      }
    } else if (
      type === "response.output_text.delta" ||
      type === "response.output_text.done" ||
      type === "response.refusal.delta" ||
      type === "response.refusal.done"
    ) {
      const index = this.outputIndex(event.output_index),
        item = this.items.get(index);
      const contentIndex = this.outputIndex(event.content_index);
      if (!item || item.type !== "message" || item.id !== event.item_id || item.done)
        this.fail("Orphan Responses text content.");
      const key = index + ":" + contentIndex,
        kind = type.includes(".refusal.") ? "refusal" : "output_text";
      const part = this.textParts.get(key) ?? { value: "", done: false, kind };
      if (part.done || part.kind !== kind) this.fail("Responses text changed after completion.");
      let delta: string;
      if (type.endsWith(".delta")) {
        if (typeof event.delta !== "string") this.fail("Invalid Responses text delta.");
        delta = event.delta;
      } else {
        const final = kind === "refusal" ? event.refusal : event.text;
        if (typeof final !== "string" || !final.startsWith(part.value))
          this.fail("Final Responses text part disagrees with streamed bytes.");
        delta = final.slice(part.value.length);
        part.done = true;
      }
      part.value += delta;
      this.text += delta;
      this.textParts.set(key, part);
      if (delta) emissions.push({ delta });
    } else if (
      type === "response.content_part.added" ||
      type === "response.content_part.done" ||
      type === "response.output_text.annotation.added" ||
      type.startsWith("response.reasoning_summary_") ||
      type.startsWith("response.reasoning_text.")
    ) {
      // Presentation/progress only. Complete native items are retained at the terminal event.
    } else this.fail("Unsupported Responses event.");
    return { emissions };
  }
}
