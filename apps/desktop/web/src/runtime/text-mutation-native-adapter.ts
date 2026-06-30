import type { NativeInvoke } from "./project-native-adapter";

export interface NativeTextMutationCapability {
  enabled: boolean;
  mode: "disabled" | "approval_required" | "fixture_only" | "native";
  reason: string;
  approvalRequired: boolean;
  allowedExtensions: string[];
  blockedDirectories: string[];
}

export interface NativeTextMutationOperation {
  operationId: string;
  rootRelativePath: string;
  beforeHash: string;
  afterContent: string;
}

export interface NativePreviewedTextMutationOperation {
  operationId: string;
  rootRelativePath: string;
  displayPath: string;
  beforeHash: string;
  afterHash: string;
  unifiedDiff: string;
}

export interface NativeApplyTextMutationOperation extends NativePreviewedTextMutationOperation {
  afterContent: string;
}

export interface NativeBoundChangeSetApproval {
  token: string;
  changeSetId: string;
  operationIds: string[];
  beforeHashes: Record<string, string>;
  afterHashes: Record<string, string>;
  actor: string;
  reason: string;
  approvedAt: number;
  expiresAt: number;
}

export interface NativePreviewTextMutationResult {
  changeSetId: string;
  status: "previewed" | "blocked";
  reason: string;
  operations: NativePreviewedTextMutationOperation[];
  diffSummary: string;
}

export interface NativeApplyTextMutationResult {
  changeSetId: string;
  status: "applied" | "blocked" | "conflict";
  reason: string;
  backupId: string | null;
  afterHashes: Record<string, string>;
}

export interface NativeRollbackTextMutationResult {
  changeSetId: string;
  status: "rolled_back" | "blocked";
  reason: string;
  restoredHashes: Record<string, string>;
}

export interface NativeTextMutationAdapter {
  capabilityStatus(): Promise<NativeTextMutationCapability>;
  preview(input: {
    changeSetId: string;
    rootRef: string;
    operations: NativeTextMutationOperation[];
  }): Promise<NativePreviewTextMutationResult>;
  apply(input: {
    changeSetId: string;
    approval: NativeBoundChangeSetApproval;
    rootRef: string;
    operations: NativeApplyTextMutationOperation[];
  }): Promise<NativeApplyTextMutationResult>;
  rollback(input: {
    changeSetId: string;
    rootRef: string;
    backupId: string;
    expectedCurrentHashes: Record<string, string>;
  }): Promise<NativeRollbackTextMutationResult>;
  getStatus(changeSetId: string): Promise<{ changeSetId: string; status: string; reason: string }>;
}

type NativeCapabilityResult = {
  enabled?: boolean;
  mode?: NativeTextMutationCapability["mode"];
  reason?: string;
  approvalRequired?: boolean;
  approval_required?: boolean;
  allowedExtensions?: string[];
  allowed_extensions?: string[];
  blockedDirectories?: string[];
  blocked_directories?: string[];
};

function snakeOperation(operation: NativeTextMutationOperation) {
  return {
    operationId: operation.operationId,
    rootRelativePath: operation.rootRelativePath,
    beforeHash: operation.beforeHash,
    afterContent: operation.afterContent,
  };
}

function snakeApplyOperation(operation: NativeApplyTextMutationOperation) {
  return {
    operationId: operation.operationId,
    rootRelativePath: operation.rootRelativePath,
    beforeHash: operation.beforeHash,
    afterHash: operation.afterHash,
    afterContent: operation.afterContent,
  };
}

function normalizeCapability(result: NativeCapabilityResult): NativeTextMutationCapability {
  return {
    enabled: result.enabled ?? false,
    mode: result.mode ?? "approval_required",
    reason: result.reason ?? "controlled_text_mutation_requires_explicit_approval",
    approvalRequired: result.approvalRequired ?? result.approval_required ?? true,
    allowedExtensions: result.allowedExtensions ?? result.allowed_extensions ?? [],
    blockedDirectories: result.blockedDirectories ?? result.blocked_directories ?? [],
  };
}

export function createDesktopTextMutationAdapterFromEnvironment(
  invoke?: NativeInvoke | null,
): NativeTextMutationAdapter | null {
  if (!invoke) return null;
  return {
    async capabilityStatus() {
      return normalizeCapability(await invoke("mutation_capability_status"));
    },
    preview(input) {
      return invoke("preview_workspace_change", {
        input: {
          changeSetId: input.changeSetId,
          rootRef: input.rootRef,
          operations: input.operations.map(snakeOperation),
        },
      });
    },
    apply(input) {
      return invoke("apply_workspace_change", {
        input: {
          changeSetId: input.changeSetId,
          approval: input.approval,
          rootRef: input.rootRef,
          operations: input.operations.map(snakeApplyOperation),
        },
      });
    },
    rollback(input) {
      return invoke("rollback_workspace_change", {
        input: {
          changeSetId: input.changeSetId,
          rootRef: input.rootRef,
          backupId: input.backupId,
          expectedCurrentHashes: input.expectedCurrentHashes,
        },
      });
    },
    getStatus(changeSetId) {
      return invoke("get_change_set_status", { input: { changeSetId } });
    },
  };
}
