export type UnrealMcpTransport = "streamable-http" | "http-sse";

export type McpTransport = "stdio" | UnrealMcpTransport;

export interface McpServerProfile<T extends McpTransport = UnrealMcpTransport> {
  id: string;
  name: string;
  version: string;
  transport: T;
  status: "disconnected" | "connecting" | "connected" | "error";
  capabilities: McpCapability[];
  lastSeen: number | null;
}

export interface McpCapability {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ConnectionSummary {
  serverId: string;
  connectedAt: number;
  disconnectedAt: number | null;
  toolsDiscovered: number;
  promptsDiscovered: number;
  resourcesDiscovered: number;
  errors: string[];
}

export type DiscoveryMode = "manual" | "auto" | "lazy";

export interface DiscoveryConfig {
  mode: DiscoveryMode;
  pollIntervalMs: number;
  autoConnect: boolean;
}
