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

export interface AnthropicCompatibleAdapterOptions {
  modelId: string;
  baseUrl?: string;
  apiKeyRef?: string;
  apiVersion?: string;
  isFixture?: boolean;
  transport?: ProviderHttpTransport;
}

export class AnthropicCompatibleAdapter implements ProviderAdapter {
  readonly id: string;
  private readonly modelId: string;
  private readonly baseUrl: string;
  private readonly apiKeyRef: string | undefined;
  private readonly apiVersion: string;
  private readonly isFixture: boolean;
  private readonly transport: ProviderHttpTransport;

  constructor(options: AnthropicCompatibleAdapterOptions) {
    this.id = `anthropic-compatible-${options.modelId}`;
    this.modelId = options.modelId;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1";
    this.apiKeyRef = options.apiKeyRef;
    this.apiVersion = options.apiVersion ?? "2023-06-01";
    this.isFixture = options.isFixture ?? true;
    this.transport = options.transport ?? createProviderHttpTransport({
      networkMode: this.isFixture ? "fixture" : "disabled",
      baseUrl: this.baseUrl,
      apiKeyRef: this.apiKeyRef,
    });
  }

  async complete(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> {
    const anthropicRequest = this.buildMessagesRequest(request);

    let response: { status: number; body: string };
    try {
      response = await this.transport.sendJson({
        url: `${this.transport.getBaseUrl() || this.baseUrl}/messages`,
        method: "POST",
        headers: this.buildHeaders(),
        body: anthropicRequest,
      });
    } catch (error) {
      throw normalizeProviderError(error, this.id);
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.handleErrorResponse(response.status, response.body);
    }

    const body = JSON.parse(response.body) as Record<string, unknown>;
    return this.parseMessagesResponse(body, request);
  }

  async *stream(request: ProviderRuntimeRequest): AsyncIterable<ProviderStreamChunk> {
    const anthropicRequest = this.buildMessagesRequest(request);
    anthropicRequest.stream = true;

    let lines: AsyncIterable<string>;
    try {
      lines = this.transport.streamSse({
        url: `${this.transport.getBaseUrl() || this.baseUrl}/messages`,
        method: "POST",
        headers: this.buildHeaders(),
        body: anthropicRequest,
      });
    } catch (error) {
      throw normalizeProviderError(error, this.id);
    }
    let index = 0;

    try {
      for await (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

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
          if (parsed.type === "content_block_delta") {
            const delta = parsed.delta?.text ?? "";
            yield {
              id: `${this.id}-chunk-${request.id}-${index}`,
              requestId: request.id,
              providerId: this.id,
              modelId: request.modelId,
              index: index++,
              delta,
              done: false,
            };
          } else if (parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text) {
            const choice = parsed.choices[0];
            const delta = choice.delta?.content ?? choice.text ?? "";
            yield {
              id: `${this.id}-chunk-${request.id}-${index}`,
              requestId: request.id,
              providerId: this.id,
              modelId: request.modelId,
              index: index++,
              delta,
              done: false,
            };
          } else if (parsed.type === "message_stop") {
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
        } catch {
          throw createProviderRuntimeError(this.id, "malformed_response", "Anthropic-compatible stream contained malformed JSON.");
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
      "anthropic-version": this.apiVersion,
    };
    if (this.apiKeyRef) {
      headers["x-api-key"] = "[VIA-SECRET-STORE]";
    }
    return headers;
  }

  private buildMessagesRequest(request: ProviderRuntimeRequest): Record<string, unknown> {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

    return {
      model: request.modelId,
      messages: nonSystemMessages.map((msg) => ({
        role: msg.role === "developer" ? "user" : msg.role,
        content: msg.content,
      })),
      system: systemMessages.length > 0 ? systemMessages.map((m) => m.content).join("\n") : undefined,
      max_tokens: request.maxOutputTokens ?? 1024,
      temperature: request.temperature ?? 0,
    };
  }

  private parseMessagesResponse(body: Record<string, unknown>, request: ProviderRuntimeRequest): ProviderRuntimeResponse {
    const content = body.content as Array<Record<string, unknown>> | undefined;
    const text = content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text as string)
      .join("") ?? this.parseOpenAiFixtureText(body);

    const usage = body.usage as Record<string, number> | undefined;

    return {
      id: (body.id as string) ?? `${this.id}-response-${request.id}`,
      requestId: request.id,
      providerId: this.id,
      modelId: request.modelId,
      text,
      finishReason: (body.stop_reason as string) === "end_turn" ? "stop" : "stop",
      usage: this.parseUsage(usage, text, request),
      createdAt: Date.now(),
    };
  }

  private parseUsage(usage: Record<string, number> | undefined, text: string, request: ProviderRuntimeRequest): ProviderUsage {
    if (usage) {
      return {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      };
    }
    const inputTokens = this.countTokens(request.messages.map((m) => m.content).join(" "));
    const outputTokens = this.countTokens(text);
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  private parseOpenAiFixtureText(body: Record<string, unknown>): string {
    const choice = (body.choices as Array<Record<string, unknown>> | undefined)?.[0];
    return ((choice?.message as Record<string, unknown> | undefined)?.content as string | undefined) ?? (choice?.text as string | undefined) ?? "";
  }

  private handleErrorResponse(status: number, bodyText: string): ProviderRuntimeError {
    if (status === 401) {
      return createProviderRuntimeError(this.id, "auth_missing", "Anthropic-compatible provider returned 401. Check API key.");
    }
    if (status === 429) {
      return createProviderRuntimeError(this.id, "rate_limited", "Anthropic-compatible provider rate limited.");
    }
    if (status >= 500) {
      return createProviderRuntimeError(this.id, "provider_unavailable", `Anthropic-compatible provider returned ${status}.`);
    }
    return createProviderRuntimeError(this.id, "malformed_response", `Anthropic-compatible provider returned ${status}: ${bodyText.slice(0, 200)}`);
  }

  private countTokens(text: string): number {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }
}
