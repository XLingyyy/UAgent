import type { ProviderNetworkMode } from "@uagent/shared";
import { createProviderRuntimeError } from "./provider-error.js";

export interface ProviderHttpTransportOptions {
  networkMode?: ProviderNetworkMode;
  baseUrl?: string;
  apiKeyRef?: string;
  timeoutMs?: number;
}

export interface ProviderHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface ProviderHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ProviderHttpTransport {
  readonly networkMode: ProviderNetworkMode;
  sendJson(request: ProviderHttpRequest): Promise<ProviderHttpResponse>;
  streamSse(request: ProviderHttpRequest): AsyncIterable<string>;
  getBaseUrl(): string;
  enableLive(): void;
}

export function createProviderHttpTransport(
  options: ProviderHttpTransportOptions = {},
): ProviderHttpTransport {
  let currentMode: ProviderNetworkMode = options.networkMode ?? "disabled";
  let liveEnabled = false;

  function checkNetworkMode(): void {
    if (currentMode === "disabled") {
      throw createProviderRuntimeError(
        "transport",
        "provider_unavailable",
        "Provider HTTP transport is disabled. Enable live mode or switch to fixture mode.",
      );
    }
    if (currentMode === "live" && !liveEnabled) {
      throw createProviderRuntimeError(
        "transport",
        "auth_missing",
        "Live provider mode requires explicit opt-in via enableLive().",
      );
    }
    if (currentMode === "live" && !options.apiKeyRef) {
      throw createProviderRuntimeError(
        "transport",
        "auth_missing",
        "Live provider mode requires a secretRef before sending requests.",
      );
    }
  }

  function buildHeaders(apiKeyRef: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKeyRef) {
      headers["Authorization"] = "Bearer [VIA-SECRET-STORE]";
    }
    return headers;
  }

  function getBaseUrl(): string {
    return options.baseUrl ?? "";
  }

  return {
    networkMode: currentMode,

    async sendJson(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
      checkNetworkMode();

      if (currentMode === "fixture") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "fixture-response",
            object: "text.completion",
            created: Date.now(),
            model: "fixture-model",
            choices: [{ text: "Fixture provider response.", index: 0 }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        };
      }

      try {
        const headers = buildHeaders(options.apiKeyRef);
        const mergedHeaders = { ...headers, ...request.headers };
        const response = await fetch(request.url, {
          method: request.method,
          headers: mergedHeaders,
          body: request.body ? JSON.stringify(request.body) : undefined,
          signal: createTimeoutSignal(options.timeoutMs),
        });

        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        };
      } catch (error) {
        throw normalizeFetchError(error);
      }
    },

    async *streamSse(request: ProviderHttpRequest): AsyncIterable<string> {
      checkNetworkMode();

      if (currentMode === "fixture") {
        const fixtureChunks = [
          "data: {\"id\":\"chunk-1\",\"object\":\"completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"Fixture \"},\"index\":0}]}",
          "",
          "data: {\"id\":\"chunk-2\",\"object\":\"completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"stream \"},\"index\":0}]}",
          "",
          "data: {\"id\":\"chunk-3\",\"object\":\"completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"response.\"},\"index\":0}]}",
          "",
          "data: [DONE]",
          "",
        ];
        for (const chunk of fixtureChunks) {
          yield chunk;
        }
        return;
      }

      try {
        const headers = buildHeaders(options.apiKeyRef);
        const mergedHeaders = { ...headers, ...request.headers };
        const response = await fetch(request.url, {
          method: request.method,
          headers: mergedHeaders,
          body: request.body ? JSON.stringify(request.body) : undefined,
          signal: createTimeoutSignal(options.timeoutMs),
        });

        if (!response.ok) {
          throw createProviderRuntimeError(
            "transport",
            "network_error",
            `Provider HTTP transport returned status ${response.status}.`,
          );
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw createProviderRuntimeError(
            "transport",
            "malformed_response",
            "Provider HTTP transport response body is not readable.",
          );
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              yield line;
            }
          }
        }
      } catch (error) {
        throw normalizeFetchError(error);
      }
    },

    getBaseUrl,
    enableLive() {
      liveEnabled = true;
      currentMode = "live";
    },
  };
}

function createTimeoutSignal(timeoutMs: number | undefined): AbortSignal | undefined {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return undefined;
  }
  return AbortSignal.timeout(timeoutMs);
}

function normalizeFetchError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") {
    return createProviderRuntimeError("transport", "timeout", "Provider HTTP request timed out.");
  }
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return createProviderRuntimeError("transport", "network_error", `Provider HTTP network error: ${error.message}`);
  }
  if (error && typeof error === "object" && "code" in error) {
    return error as unknown as Error;
  }
  return createProviderRuntimeError("transport", "network_error", error instanceof Error ? error.message : "Provider HTTP request failed.");
}
