import type { UEEditorOperationKind, UEEditorOperationRisk } from "@uagent/shared";

export type EditorOperationDecision = "allow_read_only" | "proposal_required" | "changeset_required" | "blocked";

export interface EditorOperationPolicyInput {
  operationKind: UEEditorOperationKind;
}

export interface EditorOperationPolicyDecision {
  operationKind: UEEditorOperationKind;
  risk: UEEditorOperationRisk;
  decision: EditorOperationDecision;
  reason: string;
}

const READ_ONLY_OPERATIONS = new Set(["status", "run_read_only_validation", "refresh_diagnostics"]);
const STATE_ONLY_OPERATIONS = new Set(["open_asset", "focus_content_browser", "select_asset", "open_local_preview"]);
const TEXT_BACKED_OPERATIONS = new Set(["patch_text_file"]);
const ASSET_WRITE_OPERATIONS = new Set(["save_asset", "delete_asset", "rename_asset", "move_asset", "compile_blueprint"]);

export function classifyEditorOperation(input: EditorOperationPolicyInput): EditorOperationPolicyDecision {
  if (READ_ONLY_OPERATIONS.has(input.operationKind)) {
    return { operationKind: input.operationKind, risk: "read_only", decision: "allow_read_only", reason: "editor_read_only_allowlisted" };
  }
  if (STATE_ONLY_OPERATIONS.has(input.operationKind)) {
    return { operationKind: input.operationKind, risk: "state_only", decision: "proposal_required", reason: "editor_state_only_allowlisted" };
  }
  if (TEXT_BACKED_OPERATIONS.has(input.operationKind)) {
    return { operationKind: input.operationKind, risk: "text_backed_change", decision: "changeset_required", reason: "editor_text_change_requires_changeset_v2" };
  }
  if (ASSET_WRITE_OPERATIONS.has(input.operationKind)) {
    return { operationKind: input.operationKind, risk: "blocked_asset_write", decision: "blocked", reason: "asset_mutation_blocked" };
  }
  return { operationKind: input.operationKind, risk: "blocked_unknown", decision: "blocked", reason: "unknown_editor_operation" };
}
