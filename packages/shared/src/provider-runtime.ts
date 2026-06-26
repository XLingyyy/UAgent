export type ProviderMessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface ProviderRuntimeMessage {
  role: ProviderMessageRole;
  content: string;
  name?: string;
}

export interface ProviderRuntimeRequest {
  id: string;
  providerId: string;
  modelId: string;
  messages: ProviderRuntimeMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: {
    taskId?: string;
    planId?: string;
    traceId?: string;
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
  finishReason: "stop" | "length" | "error";
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
