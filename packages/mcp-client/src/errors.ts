export type McpErrorKind = "protocol" | "transport" | "timeout" | "endpoint";

export class McpClientError extends Error {
  readonly kind: McpErrorKind;
  readonly causeValue?: unknown;

  constructor(kind: McpErrorKind, message: string, causeValue?: unknown) {
    super(message);
    this.name = "McpClientError";
    this.kind = kind;
    this.causeValue = causeValue;
  }
}

export class McpProtocolError extends McpClientError {
  constructor(message: string, causeValue?: unknown) {
    super("protocol", message, causeValue);
    this.name = "McpProtocolError";
  }
}

export class McpTransportError extends McpClientError {
  readonly status?: number;

  constructor(message: string, status?: number, causeValue?: unknown) {
    super("transport", message, causeValue);
    this.name = "McpTransportError";
    this.status = status;
  }
}
