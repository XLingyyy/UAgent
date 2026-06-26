import type {
  ProviderCapability,
  ProviderRuntimeError,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
} from "@uagent/shared";
import type { ProviderAdapter } from "./provider-adapter.js";

const MOCK_CREATED_AT = 1_000;

export class MockTextProvider implements ProviderAdapter {
  readonly id: string = "mock-text";

  async complete(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> {
    const text = `Mock provider response for: ${lastMessageText(request)}`;
    return {
      id: `${this.id}-response-${request.id}`,
      requestId: request.id,
      providerId: this.id,
      modelId: request.modelId,
      text,
      finishReason: "stop",
      usage: {
        inputTokens: countTokens(request.messages.map((message) => message.content).join(" ")),
        outputTokens: countTokens(text),
        totalTokens:
          countTokens(request.messages.map((message) => message.content).join(" ")) + countTokens(text),
      },
      createdAt: MOCK_CREATED_AT,
    };
  }

  getCapabilities(): ProviderCapability {
    return {
      providerId: this.id,
      modelIds: ["mock-model"],
      supportsStreaming: false,
      supportsTools: false,
      isMock: true,
    };
  }
}

export class MockStreamingProvider extends MockTextProvider {
  override readonly id = "mock-streaming";

  async *stream(request: ProviderRuntimeRequest): AsyncIterable<ProviderStreamChunk> {
    const deltas = ["Mock ", "stream ", "response"];
    for (let index = 0; index < deltas.length; index += 1) {
      yield {
        id: `${this.id}-chunk-${request.id}-${index + 1}`,
        requestId: request.id,
        providerId: this.id,
        modelId: request.modelId,
        index,
        delta: deltas[index] ?? "",
        done: index === deltas.length - 1,
      };
    }
  }

  override getCapabilities(): ProviderCapability {
    return {
      providerId: this.id,
      modelIds: ["mock-model"],
      supportsStreaming: true,
      supportsTools: false,
      isMock: true,
    };
  }
}

export class FailingProvider implements ProviderAdapter {
  readonly id = "mock-failing";

  async complete(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> {
    void request;
    throw createProviderRuntimeError(this.id, "Deterministic provider failure.");
  }

  getCapabilities(): ProviderCapability {
    return {
      providerId: this.id,
      modelIds: ["mock-model"],
      supportsStreaming: false,
      supportsTools: false,
      isMock: true,
    };
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`Provider adapter is not registered: ${providerId}`);
    }
    return adapter;
  }

  listCapabilities(): ProviderCapability[] {
    return [...this.adapters.values()].map((adapter) => adapter.getCapabilities());
  }
}

function lastMessageText(request: ProviderRuntimeRequest): string {
  return request.messages.at(-1)?.content ?? "";
}

function countTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function createProviderRuntimeError(providerId: string, message: string): ProviderRuntimeError {
  return {
    name: "ProviderRuntimeError",
    providerId,
    message,
    retryable: false,
  };
}
