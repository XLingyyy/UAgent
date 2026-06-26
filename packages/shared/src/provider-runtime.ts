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
  message: string;
  retryable: boolean;
  cause?: string;
}

export interface ProviderCapability {
  providerId: string;
  modelIds: string[];
  supportsStreaming: boolean;
  supportsTools: boolean;
  isMock: boolean;
}
