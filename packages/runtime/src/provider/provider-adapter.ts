import type {
  ProviderCapability,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
} from "@uagent/shared";

export interface ProviderCallOptions {
  signal?: AbortSignal;
  /** Revalidate live context after exact-body approval, immediately before transport. Never changes the approved body. */
  beforeSend?: () => Promise<void>;
}

export interface ProviderAdapter {
  readonly id: string;
  complete(request: ProviderRuntimeRequest, options?: ProviderCallOptions): Promise<ProviderRuntimeResponse>;
  stream?(request: ProviderRuntimeRequest, options?: ProviderCallOptions): AsyncIterable<ProviderStreamChunk>;
  getCapabilities(): ProviderCapability;
}
