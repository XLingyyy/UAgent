export type McpTransportKind = "streamable-http" | "http-sse" | "stdio";

export type McpConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "discovering"
  | "error";

export interface McpConnectionProfile {
  id: string;
  name: string;
  endpoint: string;
  transport: McpTransportKind;
  allowRemoteEndpoint?: boolean;
}

export interface McpServerInfo {
  name: string;
  version?: string;
}

export interface McpCapabilitySummary {
  tools: number;
  resources: number;
  prompts: number;
  readOnlyTools: number;
  blockedTools: number;
  resourceTemplates?: number;
}

export interface McpConnectionState {
  status: McpConnectionStatus;
  profile: McpConnectionProfile | null;
  protocolVersion: string | null;
  serverInfo: McpServerInfo | null;
  capabilities: McpCapabilitySummary | null;
  lastError: string | null;
  legacyMode: boolean;
}

export interface McpToolDescriptor {
  name: string;
  schemaVersion?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  dryRunSchema?: Record<string, unknown>;
  rollbackContract?: Record<string, unknown>;
  affectedAssetsSchema?: Record<string, unknown>;
  evidenceQuery?: Record<string, unknown>;
  "x-uagent-contract"?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpDiscoverySnapshot {
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  prompts: McpPromptDescriptor[];
  capabilitySummary: McpCapabilitySummary;
  discoveredAt: number;
}
