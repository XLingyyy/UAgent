import {
  createMvp15McpAssetToolInventory,
  MVP15_ASSET_TOOL_ALLOWLIST,
  type Mvp15McpAssetToolDescriptor,
  type Mvp15McpAssetToolInventory,
  type Mvp15McpAssetToolName,
} from "./mvp15-mcp-asset-adapter.js";

export interface Mvp15ExactToolFacadeMethod {
  exactToolName: string;
  methodId: string;
  schemaVersion: string;
  inputSchema?: unknown;
  dryRunSchema?: unknown;
  rollbackContract?: unknown;
  affectedAssetsSchema?: unknown;
  evidenceQuery?: unknown;
}

export interface Mvp15ExactToolFacadeToolset {
  toolsetId: string;
  methods: readonly Mvp15ExactToolFacadeMethod[];
}

export interface Mvp15ExactToolFacadeMetadata {
  wrapperToolName: "call_tool";
  toolsetId: string;
  methodId: string;
  schemaVersion: string;
}

export interface Mvp15ExactToolFacadeResult {
  status: "ready" | "blocked_by_mcp_schema";
  tools: Mvp15McpAssetToolDescriptor[];
  candidates: Mvp15McpAssetToolDescriptor[];
  inventory: Mvp15McpAssetToolInventory;
  skippedMethods: string[];
}

export interface Mvp15FacadeWrapperCall {
  wrapperToolName: "call_tool";
  args: {
    toolsetId: string;
    methodId: string;
    schemaVersion: string;
    changeSetId: string;
    dryRunHash: string;
    arguments: Record<string, unknown>;
  };
}

export function createMvp15ExactToolFacade(
  toolsets: readonly Mvp15ExactToolFacadeToolset[],
): Mvp15ExactToolFacadeResult {
  const candidates: Mvp15McpAssetToolDescriptor[] = [];
  const validCandidates: Mvp15McpAssetToolDescriptor[] = [];
  const skippedMethods: string[] = [];

  for (const toolset of toolsets) {
    if (!toolset.toolsetId.trim()) {
      skippedMethods.push("missing_toolset_id");
      continue;
    }
    for (const method of toolset.methods) {
      if (!method.exactToolName.startsWith("ue.asset.")) {
        skippedMethods.push(method.exactToolName || "missing_exact_tool_name");
        continue;
      }
      const candidate: Mvp15McpAssetToolDescriptor = {
        name: method.exactToolName,
        schemaVersion: method.schemaVersion,
        inputSchema: method.inputSchema,
        dryRunSchema: method.dryRunSchema,
        rollbackContract: method.rollbackContract,
        affectedAssetsSchema: method.affectedAssetsSchema,
        evidenceQuery: method.evidenceQuery,
        annotations: {
          mvp15Facade: {
            wrapperToolName: "call_tool",
            toolsetId: toolset.toolsetId,
            methodId: method.methodId,
            schemaVersion: method.schemaVersion,
          },
        },
      };
      candidates.push(candidate);
      if (
        !isExactAssetToolName(method.exactToolName) ||
        !method.methodId.trim() ||
        !method.schemaVersion.trim()
      ) {
        skippedMethods.push(method.exactToolName);
        continue;
      }
      validCandidates.push(candidate);
    }
  }

  const inventory = createMvp15McpAssetToolInventory(validCandidates);
  const available = new Set(inventory.availableTools);
  return {
    status: inventory.status,
    tools: validCandidates.filter((tool) => available.has(tool.name as Mvp15McpAssetToolName)),
    candidates,
    inventory,
    skippedMethods,
  };
}

export function createMvp15FacadeWrapperCall(
  descriptor: Mvp15McpAssetToolDescriptor,
  args: Record<string, unknown>,
): Mvp15FacadeWrapperCall | null {
  const metadata = getMvp15FacadeMetadata(descriptor);
  if (!metadata) return null;
  const changeSetId = typeof args.changeSetId === "string" ? args.changeSetId : null;
  const dryRunHash = typeof args.dryRunHash === "string" ? args.dryRunHash : null;
  if (!changeSetId || !dryRunHash) return null;
  const operationArgs = { ...args };
  delete operationArgs.changeSetId;
  delete operationArgs.dryRunHash;
  return {
    wrapperToolName: "call_tool",
    args: {
      toolsetId: metadata.toolsetId,
      methodId: metadata.methodId,
      schemaVersion: metadata.schemaVersion,
      changeSetId,
      dryRunHash,
      arguments: operationArgs,
    },
  };
}

export function getMvp15FacadeMetadata(
  descriptor: Mvp15McpAssetToolDescriptor,
): Mvp15ExactToolFacadeMetadata | null {
  const raw = descriptor.annotations?.mvp15Facade;
  if (!raw || typeof raw !== "object") return null;
  const metadata = raw as Partial<Mvp15ExactToolFacadeMetadata>;
  if (
    metadata.wrapperToolName !== "call_tool" ||
    typeof metadata.toolsetId !== "string" ||
    typeof metadata.methodId !== "string" ||
    typeof metadata.schemaVersion !== "string" ||
    !metadata.toolsetId.trim() ||
    !metadata.methodId.trim() ||
    !metadata.schemaVersion.trim()
  ) {
    return null;
  }
  return {
    wrapperToolName: "call_tool",
    toolsetId: metadata.toolsetId,
    methodId: metadata.methodId,
    schemaVersion: metadata.schemaVersion,
  };
}

function isExactAssetToolName(value: string): value is Mvp15McpAssetToolName {
  return (MVP15_ASSET_TOOL_ALLOWLIST as readonly string[]).includes(value);
}
