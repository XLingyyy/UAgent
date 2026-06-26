import type { McpFixtureScenario } from "./mcp-fixture-types.js";

export interface StreamableHttpFixtureFetchOptions {
  responseMode?: "json" | "sse";
  sessionId?: string;
  status?: number;
}

export function createStreamableHttpFixtureFetch(
  scenario: McpFixtureScenario,
  options: StreamableHttpFixtureFetchOptions = {},
): typeof fetch {
  return async (input, init) => {
    if (options.status && options.status >= 400) {
      return new Response("fixture status", { status: options.status });
    }
    const body = typeof init?.body === "string" ? init.body : "{}";
    const message = JSON.parse(body);
    const headers = headersToRecord(init?.headers);
    const result = await scenario.handleJsonRpc(message, { headers, url: input.toString() });
    const responseHeaders: Record<string, string> = {};
    if (options.sessionId) {
      responseHeaders["Mcp-Session-Id"] = options.sessionId;
    }
    if (options.responseMode === "sse") {
      responseHeaders["Content-Type"] = "text/event-stream";
      return new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, {
        status: 200,
        headers: responseHeaders,
      });
    }
    responseHeaders["Content-Type"] = "application/json";
    return new Response(JSON.stringify(result), { status: 200, headers: responseHeaders });
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
