import type {
  ProviderCapability,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
} from "@uagent/shared";

export interface ProviderAdapter {
  readonly id: string;
  complete(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse>;
  stream?(request: ProviderRuntimeRequest): AsyncIterable<ProviderStreamChunk>;
  getCapabilities(): ProviderCapability;
}
