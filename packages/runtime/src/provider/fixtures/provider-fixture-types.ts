export type ProviderFixtureWireApi = "openai-compatible" | "anthropic-compatible";

export interface ProviderFixtureStreamChunk {
  id: string;
  object: string;
  choices?: Array<{
    delta?: { content?: string; role?: string };
    index: number;
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  type?: string;
  content_block?: { type: string; text: string };
}

export interface ProviderFixtureScenarioOptions {
  wireApi: ProviderFixtureWireApi;
  name: string;
  description: string;
}

export type ProviderFixtureRouteHandler = (
  request: { path: string; method: string; headers: Record<string, string>; body?: unknown },
) => {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  streamChunks?: ProviderFixtureStreamChunk[];
};
