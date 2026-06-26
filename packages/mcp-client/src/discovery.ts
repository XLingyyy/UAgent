import type {
  McpCapabilitySummary,
  McpDiscoverySnapshot,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpToolDescriptor,
} from "@uagent/shared";
import type { JsonRpcIdFactory } from "./json-rpc.js";
import { createJsonRpcRequest, isJsonRpcErrorResponse } from "./json-rpc.js";
import { McpProtocolError } from "./errors.js";
import type { McpTransport } from "./transport.js";

interface PageResult<TItem> {
  items: TItem[];
  nextCursor?: string;
}

export interface DiscoveryOptions {
  transport: McpTransport;
  idFactory?: JsonRpcIdFactory;
  clock?: () => number;
}

export class McpDiscoveryService {
  private readonly transport: McpTransport;
  private readonly idFactory?: JsonRpcIdFactory;
  private readonly clock: () => number;

  constructor(options: DiscoveryOptions) {
    this.transport = options.transport;
    this.idFactory = options.idFactory;
    this.clock = options.clock ?? Date.now;
  }

  async discover(capabilities?: Record<string, unknown>): Promise<McpDiscoverySnapshot> {
    const hasTools = capabilities ? isCapabilityPresent(capabilities, "tools") : true;
    const hasResources = capabilities ? isCapabilityPresent(capabilities, "resources") : true;
    const hasPrompts = capabilities ? isCapabilityPresent(capabilities, "prompts") : true;

    const [tools, resources, prompts] = await Promise.all([
      hasTools ? this.listTools() : Promise.resolve([]),
      hasResources ? this.listResources() : Promise.resolve([]),
      hasPrompts ? this.listPrompts() : Promise.resolve([]),
    ]);
    const capabilitySummary: McpCapabilitySummary = {
      tools: tools.length,
      resources: resources.length,
      prompts: prompts.length,
      readOnlyTools: tools.filter((tool) => /(^|\.|\/)(get|list|read|inspect|query|describe|summary|summarize)/i.test(tool.name)).length,
      blockedTools: tools.filter((tool) => /(create|update|delete|remove|save|persist|apply|set|rename|import|export|compile|run|launch|spawn|edit|mutate|write)/i.test(tool.name)).length,
    };
    return {
      tools,
      resources,
      prompts,
      capabilitySummary,
      discoveredAt: this.clock(),
    };
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    return this.listPaginated<McpToolDescriptor>("tools/list", "tools");
  }

  async listResources(): Promise<McpResourceDescriptor[]> {
    return this.listPaginated<McpResourceDescriptor>("resources/list", "resources");
  }

  async listPrompts(): Promise<McpPromptDescriptor[]> {
    return this.listPaginated<McpPromptDescriptor>("prompts/list", "prompts");
  }

  private async listPaginated<TItem>(method: string, field: string): Promise<TItem[]> {
    const items: TItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.requestPage<TItem>(method, field, cursor);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  private async requestPage<TItem>(
    method: string,
    field: string,
    cursor?: string,
  ): Promise<PageResult<TItem>> {
    const response = await this.transport.sendRequest(
      createJsonRpcRequest(method, cursor ? { cursor } : {}, this.idFactory),
    );
    if (isJsonRpcErrorResponse(response)) {
      throw new McpProtocolError(`MCP discovery request ${method} failed: ${response.error.message}`);
    }
    const result = response.result as Record<string, unknown>;
    const rawItems = result[field];
    if (!Array.isArray(rawItems)) {
      throw new McpProtocolError(`MCP discovery response ${method} missing ${field} array.`);
    }
    return {
      items: rawItems as TItem[],
      nextCursor: typeof result.nextCursor === "string" ? result.nextCursor : undefined,
    };
  }
}

function isCapabilityPresent(capabilities: Record<string, unknown>, name: string): boolean {
  return capabilities[name] !== undefined;
}
