import type { ProviderRuntimeError, ProviderRuntimeErrorCode } from "@uagent/shared";

const RETRYABLE_CODES = new Set<ProviderRuntimeErrorCode>([
  "rate_limited",
  "timeout",
  "network_error",
  "provider_unavailable",
]);

export function normalizeProviderError(error: unknown, providerId: string): ProviderRuntimeError {
  if (isProviderRuntimeError(error)) {
    return {
      ...error,
      retryable: error.retryable ?? RETRYABLE_CODES.has(error.code),
    };
  }

  const code = extractErrorCode(error);
  return {
    name: "ProviderRuntimeError",
    providerId,
    code,
    message: extractErrorMessage(error),
    retryable: RETRYABLE_CODES.has(code),
    cause: error instanceof Error ? error.message : undefined,
  };
}

export function createProviderRuntimeError(
  providerId: string,
  code: ProviderRuntimeErrorCode,
  message: string,
  cause?: string,
): ProviderRuntimeError {
  return {
    name: "ProviderRuntimeError",
    providerId,
    code,
    message,
    retryable: RETRYABLE_CODES.has(code),
    cause,
  };
}

function isProviderRuntimeError(error: unknown): error is ProviderRuntimeError {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "ProviderRuntimeError" &&
      typeof (error as { providerId?: unknown }).providerId === "string" &&
      typeof (error as { message?: unknown }).message === "string",
  );
}

function extractErrorCode(error: unknown): ProviderRuntimeErrorCode {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (
    code === "auth_missing" ||
    code === "rate_limited" ||
    code === "timeout" ||
    code === "network_error" ||
    code === "malformed_response" ||
    code === "cancelled" ||
    code === "provider_unavailable"
  ) {
    return code;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "cancelled";
  }
  return "provider_unavailable";
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Provider request failed.";
}
