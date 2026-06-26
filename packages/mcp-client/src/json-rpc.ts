import { McpProtocolError } from "./errors.js";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcError;
}

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse;

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

let nextRequestId = 1;

export type JsonRpcIdFactory = () => JsonRpcId;

export function createJsonRpcRequest<TParams = unknown>(
  method: string,
  params?: TParams,
  idFactory: JsonRpcIdFactory = () => nextRequestId++,
): JsonRpcRequest<TParams> {
  return params === undefined
    ? { jsonrpc: "2.0", id: idFactory(), method }
    : { jsonrpc: "2.0", id: idFactory(), method, params };
}

export function createJsonRpcNotification<TParams = unknown>(
  method: string,
  params?: TParams,
): JsonRpcNotification<TParams> {
  return params === undefined
    ? { jsonrpc: "2.0", method }
    : { jsonrpc: "2.0", method, params };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasJsonRpcVersion(value: unknown): value is { jsonrpc: "2.0" } {
  return isObject(value) && value.jsonrpc === "2.0";
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    hasJsonRpcVersion(value) &&
    "id" in value &&
    ("result" in value || isJsonRpcErrorResponse(value))
  );
}

export function isJsonRpcErrorResponse(value: unknown): value is JsonRpcErrorResponse {
  const message = value as Record<string, unknown>;
  const error = message.error as Record<string, unknown> | undefined;
  return (
    hasJsonRpcVersion(value) &&
    "id" in message &&
    isObject(error) &&
    typeof error.code === "number" &&
    typeof error.message === "string"
  );
}

export function assertJsonRpcMessage(value: unknown): asserts value is JsonRpcMessage {
  if (!hasJsonRpcVersion(value)) {
    throw new McpProtocolError("Invalid JSON-RPC message: missing jsonrpc 2.0 version.");
  }
  if ("method" in value && typeof value.method === "string") {
    return;
  }
  if (isJsonRpcResponse(value)) {
    return;
  }
  throw new McpProtocolError("Invalid JSON-RPC message: malformed request or response.");
}
