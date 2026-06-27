import type {
  ProviderCapability,
  ProviderRuntimeError,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
  ProviderUsage,
} from "@uagent/shared";
import type { ProviderAdapter } from "./provider-adapter.js";
import { createProviderRuntimeError, normalizeProviderError } from "./provider-error.js";
import { createProviderHttpTransport, type ProviderHttpTransport } from "./provider-http-transport.js";

export interface OpenAICompatibleAdapterOptions {
  modelId: string;
  baseUrl?: string;
  apiKeyRef?: string;
  isFixture?: boolean;
  transport?: ProviderHttpTransport;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: string;
  private readonly modelId: string;
  private readonly baseUrl: string;
  private readonly apiKeyRef: string | undefined;
  private readonly isFixture: boolean;
  private readonly transport: ProviderHttpTransport;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.id = `openai-compatible-${options.modelId}`;
    this.modelId = options.modelId;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.apiKeyRef = options.apiKeyRef;
    this.isFixture = options.isFixture ?? true;
    this.transport = options.transport ?? createProviderHttpTransport({
      networkMode: this.isFixture ? "fixture" : "disabled",
      baseUrl: this.baseUrl,
      apiKeyRef: this.apiKeyRef,
    });
  }

  async complete(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> {
    const openAiRequest = this.buildChatRequest(request);

    let response: { status: number; body: string };
    try {
      response = await this.transport.sendJson({
        url: `${this.transport.getBaseUrl() || this.baseUrl}/chat/completions`,
        method: "POST",
        headers: this.buildHeaders(),
        body: openAiRequest,
      });
    } catch (error) {
      throw normalizeProviderError(error, this.id);
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.handleErrorResponse(response.status, response.body);
    }

    const body = JSON.parse(response.body) as Record<string, unknown>;
    return this.parseChatResponse(body, request);
  }

  async *stream(request: ProviderRuntimeRequest): AsyncIterable<ProviderStreamChunk> {
    const openAiRequest = this.buildChatRequest(request);
    openAiRequest.stream = true;

    let lines: AsyncIterable<string>;
    try {
      lines = this.transport.streamSse({
        url: `${this.transport.getBaseUrl() || this.baseUrl}/chat/completions`,
        method: "POST",
        headers: this.buildHeaders(),
        body: openAiRequest,
      });
    } catch (error) {
      throw normalizeProviderError(error, this.id);
    }
    let index = 0;

    try {
      for await (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6).trim();
        if (data === "[DONE]") {
          yield {
            id: `${this.id}-chunk-${request.id}-done`,
            requestId: request.id,
            providerId: this.id,
            modelId: request.modelId,
            index: index++,
            delta: "",
            done: true,
          };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta?.content ?? choice?.text ?? "";

          yield {
            id: `${this.id}-chunk-${request.id}-${index}`,
            requestId: request.id,
            providerId: this.id,
            modelId: request.modelId,
            index: index++,
            delta,
            done: false,
          };
        } catch {
          throw createProviderRuntimeError(this.id, "malformed_response", "OpenAI-compatible stream contained malformed JSON.");
        }
      }
    } catch (error) {
      throw normalizeProviderError(error, this.id);
    }
  }

  getCapabilities(): ProviderCapability {
    return {
      providerId: this.id,
      modelIds: [this.modelId],
      supportsStreaming: true,
      supportsTools: false,
      isMock: this.isFixture,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKeyRef) {
      headers["Authorization"] = "Bearer [VIA-SECRET-STORE]";
    }
    return headers;
  }

  private buildChatRequest(request: ProviderRuntimeRequest): Record<string, unknown> {
    return {
      model: request.modelId,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.name ? { name: msg.name } : {}),
      })),
      temperature: request.temperature ?? 0,
      max_tokens: request.maxOutputTokens ?? 1024,
    };
  }

  private parseChatResponse(body: Record<string, unknown>, request: ProviderRuntimeRequest): ProviderRuntimeResponse {
    const choice = (body.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const text = ((choice?.message as Record<string, unknown> | undefined)?.content as string | undefined) ?? (choice?.text as string | undefined) ?? "";
    const usage = body.usage as Record<string, number> | undefined;

    return {
      id: (body.id as string) ?? `${this.id}-response-${request.id}`,
      requestId: request.id,
      providerId: this.id,
      modelId: request.modelId,
      text,
      finishReason: this.parseFinishReason(choice?.finish_reason),
      usage: this.parseUsage(usage, text, request),
      createdAt: Date.now(),
    };
  }

  private parseFinishReason(finishReason: unknown): ProviderRuntimeResponse["finishReason"] {
    if (finishReason === "stop") return "stop";
    if (finishReason === "length") return "length";
    return "stop";
  }

  private parseUsage(usage: Record<string, number> | undefined, text: string, request: ProviderRuntimeRequest): ProviderUsage {
    if (usage) {
      return {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      };
    }
    const inputTokens = this.countTokens(request.messages.map((m) => m.content).join(" "));
    const outputTokens = this.countTokens(text);
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  private handleErrorResponse(status: number, bodyText: string): ProviderRuntimeError {
    if (status === 401) {
      return createProviderRuntimeError(this.id, "auth_missing", "OpenAI-compatible provider returned 401. Check API key.");
    }
    if (status === 429) {
      return createProviderRuntimeError(this.id, "rate_limited", "OpenAI-compatible provider rate limited.");
    }
    if (status >= 500) {
      return createProviderRuntimeError(this.id, "provider_unavailable", `OpenAI-compatible provider returned ${status}.`);
    }
    return createProviderRuntimeError(this.id, "malformed_response", `OpenAI-compatible provider returned ${status}: ${bodyText.slice(0, 200)}`);
  }

  private countTokens(text: string): number {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }
}
