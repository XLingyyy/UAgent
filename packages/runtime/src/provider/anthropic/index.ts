/** Standalone Messages protocol. Intentionally not registered/exported by the production provider index. */
export {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_ENDPOINT,
  createAnthropicSession,
  type AnthropicProjectContext,
  type AnthropicSessionOptions,
  type AnthropicStreamChunk,
} from "./session.js";
export type {
  AnthropicAssistantBlock,
  AnthropicResult,
  AnthropicStopReason,
  AnthropicThinking,
} from "./protocol.js";
