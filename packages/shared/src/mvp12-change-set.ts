import type { BuildDiagnostic, ContextPackRedactionSummary, DiagnosticKind, ProjectDiagnostic } from "./ue-diagnostics.js";
import type { AuditEventType } from "./audit.js";
import type { TaskEventType } from "./task.js";

export const CHANGE_OPERATION_KINDS = [
  "replace_range",
  "insert_after",
  "delete_key",
  "set_json_field",
  "disable_plugin",
  "append_dependency",
] as const;

export type ChangeOperationKind = (typeof CHANGE_OPERATION_KINDS)[number];

export const CHANGE_RISK_LEVELS = [
  "low_text",
  "medium_config",
  "high_code",
  "blocked_binary",
  "blocked_root_escape",
] as const;

export type ChangeRiskLevel = (typeof CHANGE_RISK_LEVELS)[number];

export type ChangeSetStateV2 =
  | "draft"
  | "previewed"
  | "approval_required"
  | "approved"
  | "rejected"
  | "applying"
  | "applied"
  | "verifying"
  | "verified"
  | "failed"
  | "rollback_available"
  | "rolled_back"
  | "discarded";

export type AllowedTextMutationExtension =
  | ".ini"
  | ".Build.cs"
  | ".Target.cs"
  | ".cs"
  | ".cpp"
  | ".h"
  | ".hpp"
  | ".uproject"
  | ".uplugin";

export type BlockedMutationReason =
  | "not_trusted_root"
  | "root_escape"
  | "network_root"
  | "blocked_binary"
  | "blocked_directory"
  | "extension_not_allowed"
  | "file_too_large"
  | "line_count_exceeded"
  | "stale_hash"
  | "content_redacted"
  | "approval_required"
  | "approval_change_set_mismatch"
  | "approval_operation_mismatch"
  | "approval_hash_mismatch"
  | "approval_expired"
  | "approval_actor_required"
  | "approval_replay"
  | "unknown_file";

export type RepairIntent =
  | "append_build_dependency"
  | "remove_build_dependency"
  | "remove_missing_target_module"
  | "replace_missing_target_module"
  | "disable_missing_plugin"
  | "redact_config_secret"
  | "manual_descriptor_repair"
  | "locate_build_error";

export interface TextMutationPolicy {
  allowedExtensions: AllowedTextMutationExtension[];
  blockedDirectories: string[];
  blockedBinaryExtensions: string[];
  maxFileBytes: number;
  maxLineCount: number;
  approvalRequired: boolean;
}

export interface ChangeOperationTargetV2 {
  rootId: string;
  rootRelativePath: string;
  displayPath: string;
  extension: string;
}

export interface ChangeOperationV2 {
  id: string;
  kind: ChangeOperationKind;
  target: ChangeOperationTargetV2;
  beforeHash: string;
  afterHash: string;
  risk: ChangeRiskLevel;
  intent: RepairIntent;
  sourceDiagnosticIds: string[];
  summary: string;
  unifiedDiff: string;
  displayDiff: string;
}

export interface RollbackSnapshotV2 {
  id: string;
  available: boolean;
  beforeHashes: Record<string, string>;
  appliedHashes: Record<string, string>;
  createdAt: number;
}

export interface WorkspaceChangeSetV2 {
  id: string;
  projectId: string;
  state: ChangeSetStateV2;
  title: string;
  operations: ChangeOperationV2[];
  proposalIds: string[];
  risk: ChangeRiskLevel;
  diffSummary: string;
  rollback: RollbackSnapshotV2 | null;
  evidenceIds: string[];
  createdAt: number;
  updatedAt: number;
  redaction: ContextPackRedactionSummary;
}

export interface ApplyChangeSetRequest {
  changeSetId: string;
  approval: BoundChangeSetApproval;
  expectedBeforeHashes: Record<string, string>;
  trustedRootId: string;
}

export interface BoundChangeSetApproval {
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

export interface ApplyChangeSetResult {
  changeSetId: string;
  status: "applied" | "blocked" | "conflict";
  reason: BlockedMutationReason | null;
  afterHashes: Record<string, string>;
  rollbackId: string | null;
  evidenceId: string | null;
}

export interface RollbackChangeSetRequest {
  changeSetId: string;
  expectedCurrentHashes: Record<string, string>;
}

export interface RollbackChangeSetResult {
  changeSetId: string;
  status: "rolled_back" | "blocked" | "conflict";
  reason: BlockedMutationReason | null;
  restoredHashes: Record<string, string>;
}

export interface VerificationRunResult {
  changeSetId: string;
  command: string;
  status: "verified" | "failed" | "blocked";
  exitCode: number | null;
  outputSummary: string;
  diagnostics: BuildDiagnostic[];
  createdAt: number;
}

export interface RepairRecipe {
  id:
    | "R-BUILD-DEPENDENCY"
    | "R-TARGET-MODULE"
    | "R-PLUGIN-DISABLE"
    | "R-CONFIG-REDACT"
    | "R-DESCRIPTOR-MALFORMED"
    | "R-BUILD-ERROR-LOCATE";
  label: string;
  automatic: boolean;
}

export interface RepairSourceDiagnosticLink {
  diagnosticId: string;
  kind: DiagnosticKind;
  displayPath: string | null;
}

export interface RepairProposal {
  id: string;
  diagnosticId: string;
  title: string;
  recipe: RepairRecipe;
  intent: RepairIntent;
  sourceDiagnostics: RepairSourceDiagnosticLink[];
  risk: ChangeRiskLevel;
  explanation: string;
  expectedEffect: string;
  rollbackNote: string;
  operations: ChangeOperationV2[];
  manualNote: string | null;
  createdAt: number;
}

export interface Mvp12EvidencePayload {
  changeSetId: string;
  diffSummary: string;
  beforeHashes: Record<string, string>;
  afterHashes: Record<string, string>;
  affectedFiles: string[];
  rollbackId: string | null;
  redacted: true;
}

export type Mvp12AuditEventType = Extract<
  AuditEventType,
  "change_set_created" | "change_set_previewed" | "approval_required" | "approval_approved" | "change_set_applied" | "change_set_rolled_back"
>;

export type Mvp12TaskEventType = Extract<
  TaskEventType,
  "change_set_created" | "change_set_previewed" | "change_set_applied" | "change_set_rolled_back"
>;

export function createDefaultTextMutationPolicy(): TextMutationPolicy {
  return {
    allowedExtensions: [".ini", ".Build.cs", ".Target.cs", ".cs", ".cpp", ".h", ".hpp", ".uproject", ".uplugin"],
    blockedDirectories: ["Binaries", "Intermediate", "Saved", "DerivedDataCache", ".vs", "dist", "build", "node_modules"],
    blockedBinaryExtensions: [".uasset", ".umap", ".ubulk", ".uexp", ".dll", ".exe"],
    maxFileBytes: 512 * 1024,
    maxLineCount: 12_000,
    approvalRequired: true,
  };
}

export function isRepairableDiagnostic(diagnostic: ProjectDiagnostic | BuildDiagnostic): boolean {
  return [
    "suspicious_build_dependency",
    "target_missing_module",
    "plugin_descriptor_missing",
    "config_secret_redacted",
    "malformed_descriptor",
    "compiler_error",
  ].includes(diagnostic.kind);
}
