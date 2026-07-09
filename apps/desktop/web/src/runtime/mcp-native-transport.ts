import type { NativeInvoke } from "./project-native-adapter";

interface NativeMcpHttpRequestResult {
  status?: number;
  body?: string;
  contentType?: string | null;
  content_type?: string | null;
  sessionId?: string | null;
  session_id?: string | null;
}

type NativeHttpPost = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createNativeMcpHttpPoster(invoke: NativeInvoke, timeoutMs = 5_000): NativeHttpPost {
  return async (input, init) => {
    if (init?.signal?.aborted) {
      throw new DOMException("MCP native request aborted.", "AbortError");
    }

    const endpoint = endpointFromRequestInput(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "POST") {
      throw new TypeError("Native MCP bridge only supports POST requests.");
    }

    const headers = headersFromRequestInput(input, init);
    const result = await invoke<NativeMcpHttpRequestResult>("mcp_streamable_http_request", {
      input: {
        endpoint,
        body: await bodyToText(init?.body ?? (input instanceof Request ? input.clone().body : null)),
        protocolVersion: headers.get("MCP-Protocol-Version") ?? "2025-06-18",
        sessionId: headers.get("Mcp-Session-Id"),
        timeoutMs,
      },
    });

    const responseHeaders = new Headers();
    const contentType = result.contentType ?? result.content_type;
    const sessionId = result.sessionId ?? result.session_id;
    if (contentType) responseHeaders.set("Content-Type", contentType);
    if (sessionId) responseHeaders.set("Mcp-Session-Id", sessionId);

    return new Response(result.body ?? "", {
      status: normalizeStatus(result.status),
      headers: responseHeaders,
    });
  };
}

function endpointFromRequestInput(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function headersFromRequestInput(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

async function bodyToText(body: BodyInit | ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  throw new TypeError("Native MCP bridge requires a string JSON body.");
}

function normalizeStatus(status: number | undefined): number {
  return status && status >= 100 && status <= 599 ? status : 599;
}
