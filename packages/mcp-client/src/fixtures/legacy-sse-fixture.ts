import type { McpFixtureScenario } from "./mcp-fixture-types.js";

export interface LegacySseFixtureFetchOptions {
  endpointPath?: string;
  badEndpointEvent?: boolean;
  postStatus?: number;
}

export function createLegacySseFixtureFetch(
  scenario: McpFixtureScenario,
  options: LegacySseFixtureFetchOptions = {},
): typeof fetch {
  const endpointPath = options.endpointPath ?? "/message";
  return async (input, init) => {
    const method = init?.method ?? "GET";
    const url = input.toString();
    if (method === "GET") {
      const body = options.badEndpointEvent ? "event: ready\ndata: no-endpoint\n\n" : `event: endpoint\ndata: ${endpointPath}\n\n`;
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (options.postStatus && options.postStatus >= 400) {
      return new Response("fixture post status", { status: options.postStatus });
    }
    const body = typeof init?.body === "string" ? init.body : "{}";
    const result = await scenario.handleJsonRpc(JSON.parse(body), {
      headers: headersToRecord(init?.headers),
      url,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function headersToRecord(headers: unknown): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.filter((entry): entry is [string, string] => Array.isArray(entry) && entry.length >= 2));
  }
  return headers as Record<string, string>;
}
