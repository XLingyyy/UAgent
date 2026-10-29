import type { ProviderFinishReason, ProviderToolCall, ProviderToolCallDelta } from "@uagent/shared";
import { createProviderRuntimeError } from "./provider-error.js";

const invalid = () =>
  createProviderRuntimeError("provider", "malformed_response", "Invalid structured tool call.");
const size = (s: string) => new TextEncoder().encode(s).length;

/** Protocol bytes stay intact; logging redaction must never change executable arguments or IDs. */
export class ToolCallAccumulator {
  private calls = new Map<number, ProviderToolCall>();
  private argumentBytes = 0;
  push(delta: ProviderToolCallDelta): { started: boolean; call: ProviderToolCall } {
    if (
      !Number.isInteger(delta.index) ||
      delta.index < 0 ||
      delta.index >= 8 ||
      typeof delta.argumentsDelta !== "string"
    )
      throw invalid();
    const previous = this.calls.get(delta.index);
    if (!previous) {
      if (
        typeof delta.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(delta.id) ||
        typeof delta.name !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(delta.name) ||
        [...this.calls.values()].some((call) => call.id === delta.id)
      )
        throw invalid();
      this.calls.set(delta.index, { id: delta.id, name: delta.name, arguments: "" });
    } else if (
      (delta.id !== undefined && delta.id !== previous.id) ||
      (delta.name !== undefined && delta.name !== previous.name)
    )
      throw invalid();
    this.argumentBytes += size(delta.argumentsDelta);
    if (this.argumentBytes > 16_384) throw invalid();
    const call = this.calls.get(delta.index)!;
    call.arguments += delta.argumentsDelta;
    return { started: !previous, call: { ...call } };
  }
  finish(reason: ProviderFinishReason): ProviderToolCall[] {
    const calls = [...this.calls.entries()].sort(([a], [b]) => a - b);
    if (reason === "tool_calls" ? !calls.length : calls.length > 0) throw invalid();
    return calls.map(([index, call], position) => {
      if (index !== position) throw invalid();
      let args: unknown;
      try {
        args = JSON.parse(call.arguments);
      } catch {
        throw invalid();
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw invalid();
      return { ...call };
    });
  }
}
