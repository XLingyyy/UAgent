import type { ProviderRuntimeMessage, ProviderToolDefinition } from "@uagent/shared";
import { createProviderRuntimeError } from "./provider-error.js";
import { redactString } from "../secrets/redaction.js";

const invalid = () =>
  createProviderRuntimeError(
    "deepseek",
    "provider_unavailable",
    "Invalid or unapproved structured tool conversation.",
  );
export function chatToolDefinitions(tools: ProviderToolDefinition[]) {
  if (!tools.length || tools.length > 8) throw invalid();
  const names = new Set<string>();
  return tools.map((tool) => {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) ||
      names.has(tool.name) ||
      typeof tool.description !== "string" ||
      tool.description.length > 1024 ||
      !tool.parameters ||
      tool.parameters.type !== "object"
    )
      throw invalid();
    names.add(tool.name);
    return {
      type: "function" as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    };
  });
}
export function chatToolMessages(
  messages: ProviderRuntimeMessage[],
  toolsAllowed: boolean,
  credential: string,
) {
  const pending = new Set<string>(),
    seen = new Set<string>();
  return messages
    .map((message) => {
      if (
        !["system", "developer", "user", "assistant", "tool"].includes(message.role) ||
        typeof message.content !== "string"
      )
        throw invalid();
      const text = message.content.split(credential || "\u0000").join("[REDACTED]");
      if (message.role === "tool") {
        if (
          !toolsAllowed ||
          !message.toolCallId ||
          !pending.delete(message.toolCallId) ||
          message.toolCalls
        )
          throw invalid();
        return { role: "tool", content: text, tool_call_id: message.toolCallId };
      }
      if (pending.size || message.toolCallId) throw invalid();
      const calls = message.toolCalls;
      if (calls) {
        if (!toolsAllowed || message.role !== "assistant" || !calls.length || calls.length > 8)
          throw invalid();
        const tool_calls = calls.map((call) => {
          if (
            !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
            !/^[A-Za-z0-9_-]{1,64}$/.test(call.name) ||
            seen.has(call.id) ||
            typeof call.arguments !== "string" ||
            (credential && JSON.stringify(call).includes(credential))
          )
            throw invalid();
          let args: unknown;
          try {
            args = JSON.parse(call.arguments);
          } catch {
            throw invalid();
          }
          if (!args || typeof args !== "object" || Array.isArray(args)) throw invalid();
          pending.add(call.id);
          seen.add(call.id);
          return {
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
          };
        });
        return { role: "assistant", content: redactString(text), tool_calls };
      }
      return {
        role: message.role === "developer" ? "system" : message.role,
        content: redactString(text),
      };
    })
    .map((message, index, array) => {
      if (index === array.length - 1 && pending.size) throw invalid();
      return message;
    });
}
