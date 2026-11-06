import type { ProviderRuntimeRequest } from "@uagent/shared";
import { chatToolDefinitions, chatToolMessages } from "../../../packages/runtime/src/provider/chat-tool-messages.js";

/** Credentials remain in the native parent; use the existing conversation serializer. */
export function prepareHostedChatRequest(request: ProviderRuntimeRequest) {
  if (!request.messages.length || request.messages.length > 32) throw Error("host_model_message_limit");
  const tools = request.tools?.length ? chatToolDefinitions(request.tools) : undefined;
  const maxTokens = request.maxOutputTokens ?? 1024;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) throw Error("host_model_output_limit");
  const body = JSON.stringify({ model: request.modelId,
    messages: chatToolMessages(request.messages, Boolean(tools), ""),
    max_tokens: maxTokens, stream: false, thinking: { type: "disabled" }, temperature: 0,
    ...(tools ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
  });
  if (new TextEncoder().encode(body).length > 32768) throw Error("host_model_request_limit");
  return { request, body };
}
