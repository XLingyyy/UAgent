export type ProviderMessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ProviderToolCall {
  id: string;
  name: string;
  /** Exact, complete JSON text. Validate before dispatch; never execute partial deltas. */
  arguments: string;
}
export interface ProviderToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsDelta: string;
}
export type ProviderFinishReason = "stop" | "length" | "tool_calls" | "error";

export interface ProviderRuntimeMessage {
  role: ProviderMessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
}

export interface ProviderRuntimeRequest {
  id: string;
  providerId: string;
  modelId: string;
  messages: ProviderRuntimeMessage[];
  tools?: ProviderToolDefinition[];
  toolChoice?: "auto" | "none";
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: {
    taskId?: string;
    planId?: string;
    traceId?: string;
    networkMode?: string;
    projectId?: string | null;
    projectEpoch?: number;
    /** Internal scoped result analysis; never implicitly append selected attachments. */
    purpose?: "tool_feedback" | "investigation";
    runId?: string;
    scopeRef?: string;
  };
}

export type ProviderRuntimeErrorCode =
  | "auth_missing"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "malformed_response"
  | "cancelled"
  | "provider_unavailable";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ProviderRuntimeResponse {
  id: string;
  requestId: string;
  providerId: string;
  modelId: string;
  text: string;
  finishReason: ProviderFinishReason;
  toolCalls?: ProviderToolCall[];
  usage: ProviderUsage;
  createdAt: number;
}

export interface ProviderStreamChunk {
  id: string;
  requestId: string;
  providerId: string;
  modelId: string;
  index: number;
  delta: string;
  done: boolean;
  usage?: ProviderUsage;
  finishReason?: Exclude<ProviderFinishReason, "error">;
  toolCallDelta?: ProviderToolCallDelta;
  toolCalls?: ProviderToolCall[];
}

export interface ProviderRuntimeError {
  name: "ProviderRuntimeError";
  providerId: string;
  code: ProviderRuntimeErrorCode;
  message: string;
  retryable: boolean;
  cause?: string;
}

export type ProviderRuntimeEvent =
  | {
      type: "provider_tool_call_started";
      requestId: string; providerId: string; index: number; callId: string; name: string;
    }
  | {
      type: "provider_tool_call_arguments_delta";
      requestId: string; providerId: string; index: number; callId: string; delta: string;
    }
  | {
      type: "provider_tool_call_completed";
      requestId: string; providerId: string; call: ProviderToolCall;
    }
  | {
      type: "provider_request_started";
      requestId: string;
      providerId: string;
      modelId: string;
    }
  | {
      type: "provider_stream_started";
      requestId: string;
      providerId: string;
    }
  | {
      type: "provider_stream_delta";
      requestId: string;
      providerId: string;
      chunk: ProviderStreamChunk;
    }
  | {
      type: "provider_stream_completed";
      requestId: string;
      providerId: string;
      text: string;
    }
  | {
      type: "provider_request_completed";
      requestId: string;
      providerId: string;
      response: ProviderRuntimeResponse;
    }
  | {
      type: "provider_request_failed";
      requestId: string;
      providerId: string;
      error: ProviderRuntimeError;
    }
  | {
      type: "provider_request_cancelled";
      requestId: string;
      providerId: string;
      reason: string;
    }
  | {
      type: "provider_usage_recorded";
      requestId: string;
      providerId: string;
      usage: ProviderUsage;
    };

export interface ProviderCapability {
  providerId: string;
  modelIds: string[];
  supportsStreaming: boolean;
  supportsTools: boolean;
  isMock: boolean;
}

export type ProviderNetworkMode = "disabled" | "fixture" | "live";

export type ProviderWireApi = "openai-compatible" | "anthropic-compatible" | "local-openai-compatible" | "mock";

export interface ProviderConfig {
  providerId: string;
  displayName: string;
  baseUrl: string;
  wireApi: ProviderWireApi;
  networkMode: ProviderNetworkMode;
  secretRef: string | null;
  models: string[];
  defaultModel: string | null;
  isFixture: boolean;
}

export interface ProviderRedactedStatus {
  providerId: string;
  displayName: string;
  wireApi: ProviderWireApi;
  networkMode: ProviderNetworkMode;
  hasSecret: boolean;
  isFixture: boolean;
}

export function redactProviderConfig(config: ProviderConfig): ProviderRedactedStatus {
  return {
    providerId: config.providerId,
    displayName: config.displayName,
    wireApi: config.wireApi,
    networkMode: config.networkMode,
    hasSecret: config.secretRef !== null,
    isFixture: config.isFixture,
  };
}

export function createDefaultProviderConfig(providerId: string): ProviderConfig {
  return {
    providerId,
    displayName: providerId,
    baseUrl: "",
    wireApi: "mock",
    networkMode: "disabled",
    secretRef: null,
    models: [],
    defaultModel: null,
    isFixture: true,
  };
}
