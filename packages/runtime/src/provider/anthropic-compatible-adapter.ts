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

    let body: Record<string, unknown>;
    try { body = JSON.parse(response.body) as Record<string, unknown>; }
    catch { throw createProviderRuntimeError(this.id, "malformed_response", "Invalid Anthropic response JSON."); }
    if (!body || typeof body !== "object") throw createProviderRuntimeError(this.id, "malformed_response", "Invalid Anthropic response.");
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
    let usageFields: Record<string, number> = {};
    let finishReason: "stop" | "length" = "stop";
    const chunk = (delta: string, done: boolean): ProviderStreamChunk => ({
      id: `${this.id}-chunk-${request.id}-${index}`, requestId: request.id,
      providerId: this.id, modelId: request.modelId, index: index++, delta, done,
      ...(done ? { finishReason, usage: this.parseUsage(usageFields) } : {}),
    });
    try {
      for await (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]" && this.isFixture) { yield chunk("", true); return; }
        let parsed: any;
        try { parsed = JSON.parse(data); }
        catch { throw createProviderRuntimeError(this.id, "malformed_response", "Invalid Anthropic stream JSON."); }
        if (!parsed || typeof parsed !== "object") throw createProviderRuntimeError(this.id, "malformed_response", "Invalid Anthropic event.");
        if (parsed.type === "error") throw createProviderRuntimeError(this.id,
          parsed.error?.type === "rate_limit_error" ? "rate_limited" : "provider_unavailable",
          "Anthropic stream failed. No automatic retry was sent.");
        if (parsed.type === "message_start") {
          usageFields = { ...(parsed.message?.usage ?? {}) };
        } else if (parsed.type === "message_delta") {
          usageFields = { ...usageFields, ...(parsed.usage ?? {}) };
          if (parsed.delta?.stop_reason === "max_tokens") finishReason = "length";
          else if (parsed.delta?.stop_reason && !["end_turn", "stop_sequence"].includes(parsed.delta.stop_reason))
            throw createProviderRuntimeError(this.id, "malformed_response", "Unsupported Anthropic completion reason.");
        } else if (parsed.type === "content_block_start") {
          if (parsed.content_block?.type !== "text") throw createProviderRuntimeError(this.id, "malformed_response", "Only text blocks are supported.");
          if (typeof parsed.content_block.text !== "string") throw createProviderRuntimeError(this.id, "malformed_response", "Invalid text block.");
          if (parsed.content_block.text) yield chunk(parsed.content_block.text, false);
        } else if (parsed.type === "content_block_delta") {
          if (parsed.delta?.type !== "text_delta" || typeof parsed.delta.text !== "string")
            throw createProviderRuntimeError(this.id, "malformed_response", "Unsupported Anthropic delta.");
          yield chunk(parsed.delta.text, false);
        } else if (parsed.type === "message_stop") {
          yield chunk("", true); return;
        } else if (this.isFixture && (parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text)) {
          yield chunk(parsed.choices[0].delta?.content ?? parsed.choices[0].text, false);
        }
      }
      throw createProviderRuntimeError(this.id, "malformed_response", "Anthropic stream ended before message_stop.");
    } catch (error) { throw normalizeProviderError(error, this.id); }
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
    const systemMessages = request.messages.filter((m) => m.role === "system" || m.role === "developer");
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system" && m.role !== "developer");

    if (request.modelId !== this.modelId || !Number.isSafeInteger(request.maxOutputTokens ?? 1024) ||
        (request.maxOutputTokens ?? 1024) < 1 || nonSystemMessages.some(m => !["user", "assistant"].includes(m.role)))
      throw createProviderRuntimeError(this.id, "malformed_response", "Unsupported Anthropic request identity or messages.");
    return {
      model: request.modelId,
      messages: nonSystemMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      system: systemMessages.length > 0 ? systemMessages.map((m) => m.content).join("\n") : undefined,
      max_tokens: request.maxOutputTokens ?? 1024,
      temperature: request.temperature ?? 0,
    };
  }

  private parseMessagesResponse(body: Record<string, unknown>, request: ProviderRuntimeRequest): ProviderRuntimeResponse {
    const content = body.content as Array<Record<string, unknown>> | undefined;
    if ((!Array.isArray(content) && !this.isFixture) || (Array.isArray(content) &&
        content.some(block => !block || block.type !== "text" || typeof block.text !== "string")))
      throw createProviderRuntimeError(this.id, "malformed_response", "Only Anthropic text responses are supported.");
    if (!this.isFixture && !["end_turn", "stop_sequence", "max_tokens"].includes(String(body.stop_reason)))
      throw createProviderRuntimeError(this.id, "malformed_response", "Unsupported Anthropic completion reason.");
    const text = content?.map(block => block.text as string).join("") ?? this.parseOpenAiFixtureText(body);

    const usage = this.parseUsage(body.usage as Record<string, number> | undefined);

    return {
      id: (body.id as string) ?? `${this.id}-response-${request.id}`,
      requestId: request.id,
      providerId: this.id,
      modelId: request.modelId,
      text,
      finishReason: body.stop_reason === "max_tokens" ? "length" : "stop",
      usage,
      usageStatus: usage ? "reported" : "unknown",
      createdAt: Date.now(),
    };
  }

  private parseUsage(usage: Record<string, number> | undefined): ProviderUsage | undefined {
    if (!usage) return undefined;
    const inputTokens = usage.input_tokens,
      outputTokens = usage.output_tokens;
    if (![inputTokens, outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0))
      return undefined;
    const totalTokens = inputTokens + outputTokens;
    if (!Number.isSafeInteger(totalTokens) || totalTokens !== inputTokens + outputTokens)
      return undefined;
    return { inputTokens, outputTokens, totalTokens };
  }

  private parseOpenAiFixtureText(body: Record<string, unknown>): string {
    const choice = (body.choices as Array<Record<string, unknown>> | undefined)?.[0];
    return ((choice?.message as Record<string, unknown> | undefined)?.content as string | undefined) ?? (choice?.text as string | undefined) ?? "";
  }

  private handleErrorResponse(status: number, _bodyText: string): ProviderRuntimeError {
    if (status === 401) {
      return createProviderRuntimeError(this.id, "auth_missing", "Anthropic-compatible provider returned 401. Check API key.");
    }
    if (status === 429) {
      return createProviderRuntimeError(this.id, "rate_limited", "Anthropic-compatible provider rate limited.");
    }
    if (status >= 500) {
      return createProviderRuntimeError(this.id, "provider_unavailable", `Anthropic-compatible provider returned ${status}.`);
    }
    return createProviderRuntimeError(this.id, "malformed_response", `Anthropic-compatible provider returned ${status}.`);
  }

}
