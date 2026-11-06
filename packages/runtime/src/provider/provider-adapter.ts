import type {
  ProviderCapability,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
} from "@uagent/shared";
import type { OutboundSendIntent } from "./outbound-consent.js";

export interface ProviderCallOptions {
  /** In-turn client tools; coordinator retains scope, budget, provenance and persistence. */
  executeClientTool?: (call: import("@uagent/shared").ProviderToolCall) => Promise<string>;
  signal?: AbortSignal;
  /** Internal task identity; never serialized or restored as authority. */
  parallelInvestigation?: object;
  /** User-confirmed conservative CNY per million token rates, for explicit cost review only; not a billing cap. */
  costEstimateRates?: { input: number; output: number };
  /** One trusted UI send, bound to an exact ordinary request; never persisted. */
  outboundSendIntent?: OutboundSendIntent;
  /** Revalidate live context after exact-body approval, immediately before transport. Never changes the approved body. */
  beforeSend?: () => Promise<void>;
}

export interface ProviderAdapter {
  readonly id: string;
  complete(request: ProviderRuntimeRequest, options?: ProviderCallOptions): Promise<ProviderRuntimeResponse>;
  stream?(request: ProviderRuntimeRequest, options?: ProviderCallOptions): AsyncIterable<ProviderStreamChunk>;
  /** Data-only archive receipt after terminal ordinary-task delivery; never a send/tool grant. */
  confirmOrdinaryDelivery?(requestId: string, identity: Pick<ProviderRuntimeRequest,"providerId"|"modelId">): Promise<void>;
  getCapabilities(): ProviderCapability;
}
