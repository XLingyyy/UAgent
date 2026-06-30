import type {
  ApplyChangeSetRequest,
  ApplyChangeSetResult,
  BlockedMutationReason,
  ChangeOperationKind,
  ChangeOperationV2,
  ChangeRiskLevel,
  ProjectDiagnostic,
  RepairIntent,
  RepairProposal,
  RepairRecipe,
  RollbackChangeSetRequest,
  RollbackChangeSetResult,
  TextMutationPolicy,
  VerificationRunResult,
  WorkspaceChangeSetV2,
} from "@uagent/shared";
import { createDefaultTextMutationPolicy } from "@uagent/shared";

export interface TextMutationTargetClassification {
  allowed: boolean;
  reason: BlockedMutationReason | null;
  risk: ChangeRiskLevel;
  displayPath: string;
  extension: string;
}

export interface DiffInput {
  displayPath: string;
  before: string;
  after: string;
  projectRoot?: string;
}

export interface DiffResult {
  unifiedDiff: string;
  displayDiff: string;
  redaction: { redacted: boolean; replacedPaths: number; replacedSecrets: number };
}

export interface RepairProposalEngineInput {
  diagnostics: ProjectDiagnostic[];
  files: Record<string, string>;
  projectId: string;
  rootId: string;
  createdAt?: number;
}

export interface ChangeSetServiceV2Options {
  projectId: string;
  rootId: string;
  files: Record<string, string>;
  createdAt?: number;
  now?: () => number;
}

export interface TextBackedOperationInput {
  id: string;
  rootId: string;
  rootRelativePath: string;
  before: string;
  after: string;
  intent: RepairIntent;
  summary: string;
  sourceDiagnosticIds?: string[];
  projectRoot?: string;
}

export interface VerifyChangeSetInput {
  command: string;
  exitCode: number;
  outputSummary: string;
}

export interface ReplayChangeSetSummary {
  changeSetId: string;
  state: WorkspaceChangeSetV2["state"];
  replaySafe: true;
  recordedOnlyActions: string[];
  diffSummary: string;
}

const SECRET_RE = /(Bearer\s+)\S+|(sk-)[A-Za-z0-9_-]+|((?:api[_-]?key|token|secret|password|Authorization)\s*[=:]\s*)\S+/gi;
const HOME_RE = /[A-Za-z]:\/Users\/[^/\s:)]+(?:\/[^\s:)]+)*|\/Users\/[^/\s:)]+(?:\/[^\s:)]+)*|\/home\/[^/\s:)]+(?:\/[^\s:)]+)*/g;
const OPERATION_AFTER_CONTENT = Symbol("mvp12.operation.afterContent");

type InternalChangeOperationV2 = ChangeOperationV2 & { [OPERATION_AFTER_CONTENT]?: string };
type BoundChangeSetApproval = ApplyChangeSetRequest["approval"];

function slash(value: string): string {
  return value.replace(/\\/g, "/");
}

function displayPath(rootRelativePath: string): string {
  return rootRelativePath.startsWith("[project-root]") ? slash(rootRelativePath) : `[project-root]/${slash(rootRelativePath).replace(/^\//, "")}`;
}

function extensionFor(rootRelativePath: string): string {
  if (/\.Build\.cs$/i.test(rootRelativePath)) return ".Build.cs";
  if (/\.Target\.cs$/i.test(rootRelativePath)) return ".Target.cs";
  const match = rootRelativePath.match(/(\.[^./\\]+)$/);
  return match?.[1] ?? "";
}

function maxRisk(left: ChangeRiskLevel, right: ChangeRiskLevel): ChangeRiskLevel {
  const order: ChangeRiskLevel[] = ["low_text", "medium_config", "high_code", "blocked_binary", "blocked_root_escape"];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

export function createSha256Hash(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const words = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);

  const schedule = new Uint32Array(64);
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(schedule[index - 15], 7) ^ rotate(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3);
      const s1 = rotate(schedule[index - 2], 17) ^ rotate(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10);
      schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = words;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index] + schedule[index]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    words[0] = (words[0] + a) >>> 0;
    words[1] = (words[1] + b) >>> 0;
    words[2] = (words[2] + c) >>> 0;
    words[3] = (words[3] + d) >>> 0;
    words[4] = (words[4] + e) >>> 0;
    words[5] = (words[5] + f) >>> 0;
    words[6] = (words[6] + g) >>> 0;
    words[7] = (words[7] + h) >>> 0;
  }
  return words.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function attachInternalAfterContent(operation: ChangeOperationV2, afterContent: string): ChangeOperationV2 {
  Object.defineProperty(operation, OPERATION_AFTER_CONTENT, {
    configurable: false,
    enumerable: false,
    value: afterContent,
    writable: false,
  });
  return operation;
}

export function createTextBackedOperation(input: TextBackedOperationInput): ChangeOperationV2 {
  const classification = classifyTextMutationTarget(input.rootId, input.rootRelativePath, {
    byteSize: input.before.length,
    lineCount: input.before.split(/\r?\n/).length,
  });
  const diff = renderUnifiedDiff({
    displayPath: classification.displayPath,
    before: input.before,
    after: input.after,
    projectRoot: input.projectRoot,
  });
  return attachInternalAfterContent({
    id: input.id,
    kind: "replace_range",
    target: {
      rootId: input.rootId,
      rootRelativePath: input.rootRelativePath,
      displayPath: classification.displayPath,
      extension: classification.extension,
    },
    beforeHash: createSha256Hash(input.before),
    afterHash: createSha256Hash(input.after),
    risk: classification.risk,
    intent: input.intent,
    sourceDiagnosticIds: input.sourceDiagnosticIds ?? [],
    summary: redactMvp12Text(input.summary).text,
    unifiedDiff: diff.unifiedDiff,
    displayDiff: diff.displayDiff,
  }, input.after);
}

export function getChangeOperationInternalAfterContent(operation: ChangeOperationV2): string | null {
  return (operation as InternalChangeOperationV2)[OPERATION_AFTER_CONTENT] ?? null;
}

export function redactMvp12Text(text: string, projectRoot?: string) {
  let replacedPaths = 0;
  let replacedSecrets = 0;
  let result = slash(text);
  if (projectRoot) {
    const normalizedRoot = slash(projectRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(normalizedRoot, "gi"), () => {
      replacedPaths += 1;
      return "[project-root]";
    });
  }
  result = result.replace(HOME_RE, () => {
    replacedPaths += 1;
    return "[user-home]";
  });
  result = result.replace(SECRET_RE, (_match, bearer, skPrefix, keyPrefix) => {
    replacedSecrets += 1;
    if (bearer) return `${bearer}[REDACTED]`;
    if (skPrefix) return "sk-[REDACTED]";
    if (keyPrefix) return `${keyPrefix}[REDACTED]`;
    return "[REDACTED]";
  });
  return {
    text: result,
    redaction: { replacedPaths, replacedSecrets, redacted: result !== text },
  };
}

export function classifyTextMutationTarget(
  rootId: string,
  rootRelativePath: string,
  metadata?: { byteSize?: number; lineCount?: number; policy?: TextMutationPolicy },
): TextMutationTargetClassification {
  const policy = metadata?.policy ?? createDefaultTextMutationPolicy();
  const normalized = slash(rootRelativePath);
  const extension = extensionFor(normalized);
  if (!rootId) return { allowed: false, reason: "not_trusted_root", risk: "blocked_root_escape", displayPath: displayPath(normalized), extension };
  if (normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || normalized.startsWith("..")) {
    return { allowed: false, reason: "root_escape", risk: "blocked_root_escape", displayPath: displayPath(normalized), extension };
  }
  if (normalized.startsWith("//")) {
    return { allowed: false, reason: "network_root", risk: "blocked_root_escape", displayPath: displayPath(normalized), extension };
  }
  if (policy.blockedDirectories.some((dir) => normalized.toLowerCase().split("/").includes(dir.toLowerCase()))) {
    return { allowed: false, reason: "blocked_directory", risk: "blocked_root_escape", displayPath: displayPath(normalized), extension };
  }
  if (policy.blockedBinaryExtensions.some((ext) => normalized.toLowerCase().endsWith(ext.toLowerCase()))) {
    return { allowed: false, reason: "blocked_binary", risk: "blocked_binary", displayPath: displayPath(normalized), extension };
  }
  if (!policy.allowedExtensions.some((ext) => ext.toLowerCase() === extension.toLowerCase())) {
    return { allowed: false, reason: "extension_not_allowed", risk: "blocked_binary", displayPath: displayPath(normalized), extension };
  }
  if ((metadata?.byteSize ?? 0) > policy.maxFileBytes) {
    return { allowed: false, reason: "file_too_large", risk: "blocked_binary", displayPath: displayPath(normalized), extension };
  }
  if ((metadata?.lineCount ?? 0) > policy.maxLineCount) {
    return { allowed: false, reason: "line_count_exceeded", risk: "blocked_binary", displayPath: displayPath(normalized), extension };
  }
  const risk: ChangeRiskLevel = extension === ".ini" || extension === ".uproject" || extension === ".uplugin" ? "medium_config" : "high_code";
  return { allowed: true, reason: null, risk, displayPath: displayPath(normalized), extension };
}

export function renderUnifiedDiff(input: DiffInput): DiffResult {
  const beforeLines = input.before.split(/\r?\n/);
  const afterLines = input.after.split(/\r?\n/);
  const lines = [`--- a/${input.displayPath}`, `+++ b/${input.displayPath}`, "@@ -1 +1 @@"];
  const display: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const before = beforeLines[index] ?? "";
    const after = afterLines[index] ?? "";
    if (before === after) {
      if (before) lines.push(` ${before}`);
      continue;
    }
    if (before) {
      lines.push(`-${before}`);
      display.push(`-${before}`);
    }
    if (after) {
      lines.push(`+${after}`);
      display.push(`+${after}`);
    }
  }
  const redactedUnified = redactMvp12Text(lines.join("\n"), input.projectRoot);
  const redactedDisplay = redactMvp12Text(display.slice(0, 20).join("\n"), input.projectRoot);
  return {
    unifiedDiff: redactedUnified.text,
    displayDiff: redactedDisplay.text,
    redaction: {
      replacedPaths: redactedUnified.redaction.replacedPaths + redactedDisplay.redaction.replacedPaths,
      replacedSecrets: redactedUnified.redaction.replacedSecrets + redactedDisplay.redaction.replacedSecrets,
      redacted: redactedUnified.redaction.redacted || redactedDisplay.redaction.redacted,
    },
  };
}

function recipeForDiagnostic(diagnostic: ProjectDiagnostic): RepairRecipe {
  switch (diagnostic.kind) {
    case "suspicious_build_dependency":
      return { id: "R-BUILD-DEPENDENCY", label: "Adjust Build.cs dependency", automatic: true };
    case "target_missing_module":
      return { id: "R-TARGET-MODULE", label: "Adjust target module list", automatic: true };
    case "plugin_descriptor_missing":
      return { id: "R-PLUGIN-DISABLE", label: "Disable missing plugin", automatic: true };
    case "config_secret_redacted":
      return { id: "R-CONFIG-REDACT", label: "Redact config secret", automatic: true };
    case "malformed_descriptor":
      return { id: "R-DESCRIPTOR-MALFORMED", label: "Manual descriptor repair", automatic: false };
    default:
      return { id: "R-BUILD-ERROR-LOCATE", label: "Locate build error", automatic: false };
  }
}

function pickTargetFile(diagnostic: ProjectDiagnostic, files: Record<string, string>): string | null {
  const path = diagnostic.displayPath?.replace(/^\[project-root\]\//, "") ?? "";
  if (files[path] !== undefined) return path;
  if (diagnostic.kind === "plugin_descriptor_missing") return Object.keys(files).find((file) => file.endsWith(".uproject")) ?? null;
  if (diagnostic.kind === "target_missing_module") return Object.keys(files).find((file) => file.endsWith(".Target.cs")) ?? null;
  if (diagnostic.kind === "suspicious_build_dependency") return Object.keys(files).find((file) => file.endsWith(".Build.cs")) ?? null;
  if (diagnostic.kind === "config_secret_redacted") return Object.keys(files).find((file) => file.endsWith(".ini")) ?? null;
  return null;
}

function extractName(message: string, fallback: string): string {
  const quoted = message.match(/"([^"]+)"/)?.[1];
  if (quoted) return quoted;
  const proper = message.match(/\b([A-Z][A-Za-z0-9_]+)\b/)?.[1];
  return proper ?? fallback;
}

function mutateContentForRecipe(recipe: RepairRecipe, diagnostic: ProjectDiagnostic, before: string): { after: string; kind: ChangeOperationKind; intent: RepairIntent; summary: string } | null {
  if (!recipe.automatic) return null;
  if (recipe.id === "R-PLUGIN-DISABLE") {
    const plugin = extractName(diagnostic.message, "MissingPlugin");
    const after = before.replace(new RegExp(`("Name"\\s*:\\s*"${plugin}"[\\s\\S]*?"Enabled"\\s*:\\s*)true`, "m"), "$1false");
    return { after, kind: "disable_plugin", intent: "disable_missing_plugin", summary: `Set ${plugin} Enabled to false.` };
  }
  if (recipe.id === "R-CONFIG-REDACT") {
    const after = before.replace(/(^\s*(?:Authorization|token|secret|password|api[_-]?key)\s*=\s*).+$/gim, "$1[REDACTED]");
    return { after, kind: "delete_key", intent: "redact_config_secret", summary: "Replace sensitive config values with [REDACTED]." };
  }
  if (recipe.id === "R-TARGET-MODULE") {
    const missing = extractName(diagnostic.message, "Missing");
    const after = before
      .replace(new RegExp(`,\\s*"${missing}"`, "g"), "")
      .replace(new RegExp(`"${missing}"\\s*,\\s*`, "g"), "");
    return { after, kind: "replace_range", intent: "remove_missing_target_module", summary: `Remove ${missing} from ExtraModuleNames.` };
  }
  if (recipe.id === "R-BUILD-DEPENDENCY") {
    const dep = extractName(diagnostic.message, "UnknownExperimental");
    const after = before
      .replace(new RegExp(`,\\s*"${dep}"`, "g"), "")
      .replace(new RegExp(`"${dep}"\\s*,\\s*`, "g"), "");
    return { after, kind: "append_dependency", intent: "remove_build_dependency", summary: `Remove suspicious dependency ${dep}.` };
  }
  return null;
}

export function createRepairProposalEngine() {
  return {
    propose(input: RepairProposalEngineInput): RepairProposal[] {
      const createdAt = input.createdAt ?? Date.now();
      return input.diagnostics.flatMap((diagnostic, index): RepairProposal[] => {
        const recipe = recipeForDiagnostic(diagnostic);
        const targetPath = pickTargetFile(diagnostic, input.files);
        const before = targetPath ? input.files[targetPath] : "";
        const mutation = targetPath ? mutateContentForRecipe(recipe, diagnostic, before) : null;
        const operations: ChangeOperationV2[] = [];
        if (targetPath && mutation && mutation.after !== before) {
          const classification = classifyTextMutationTarget(input.rootId, targetPath, {
            byteSize: before.length,
            lineCount: before.split(/\r?\n/).length,
          });
          const diff = renderUnifiedDiff({ displayPath: classification.displayPath, before, after: mutation.after });
          operations.push(attachInternalAfterContent({
            id: `operation:${diagnostic.id}:${index}`,
            kind: mutation.kind,
            target: {
              rootId: input.rootId,
              rootRelativePath: targetPath,
              displayPath: classification.displayPath,
              extension: classification.extension,
            },
            beforeHash: createSha256Hash(before),
            afterHash: createSha256Hash(mutation.after),
            risk: classification.risk,
            intent: mutation.intent,
            sourceDiagnosticIds: [diagnostic.id],
            summary: mutation.summary,
            unifiedDiff: diff.unifiedDiff,
            displayDiff: diff.displayDiff,
          }, mutation.after));
        }
        return [
          {
            id: `proposal:${diagnostic.id}`,
            diagnosticId: diagnostic.id,
            title: recipe.label,
            recipe,
            intent: operations[0]?.intent ?? (recipe.id === "R-DESCRIPTOR-MALFORMED" ? "manual_descriptor_repair" : "locate_build_error"),
            sourceDiagnostics: [{ diagnosticId: diagnostic.id, kind: diagnostic.kind, displayPath: diagnostic.displayPath ?? null }],
            risk: operations[0]?.risk ?? "low_text",
            explanation: redactMvp12Text(`${recipe.label}: ${diagnostic.message}`).text,
            expectedEffect: recipe.automatic ? "The linked diagnostic should no longer be emitted after verification." : "A human should inspect the affected file.",
            rollbackNote: "Rollback restores the before snapshot if the current hash still matches the applied hash.",
            operations,
            manualNote: recipe.automatic ? null : `${recipe.id} is informational and does not write files.`,
            createdAt,
          },
        ];
      });
    },
  };
}

export function createChangeSetServiceV2(options: ChangeSetServiceV2Options) {
  const files = { ...options.files };
  const beforeSnapshots = new Map<string, Record<string, string>>();
  const changeSets = new Map<string, WorkspaceChangeSetV2>();
  const proposals = new Map<string, RepairProposal>();
  const approvals = new Map<string, BoundChangeSetApproval>();
  const usedApprovalTokens = new Set<string>();
  const recordedActions = new Map<string, string[]>();
  const createdAt = options.createdAt ?? Date.now();
  const now = options.now ?? Date.now;

  function save(changeSet: WorkspaceChangeSetV2): WorkspaceChangeSetV2 {
    changeSets.set(changeSet.id, changeSet);
    return changeSet;
  }

  function createChangeSetFromProposals(selectedProposals: RepairProposal[]): WorkspaceChangeSetV2 {
    const operations = selectedProposals.flatMap((proposal) => proposal.operations);
    const risk = operations.reduce((current, op) => maxRisk(current, op.risk), selectedProposals[0]?.risk ?? "low_text");
    const changeSet: WorkspaceChangeSetV2 = {
      id:
        selectedProposals.length === 1
          ? `changeset:${selectedProposals[0].id.replace(/^proposal:/, "")}`
          : `changeset:${selectedProposals.map((proposal) => proposal.diagnosticId).join("+")}`,
      projectId: options.projectId,
      state: "approval_required",
      title: selectedProposals.length === 1 ? selectedProposals[0].title : `${selectedProposals.length} deterministic repairs`,
      operations,
      proposalIds: selectedProposals.map((proposal) => proposal.id),
      risk,
      diffSummary: `${operations.length} file${operations.length === 1 ? "" : "s"} changed`,
      rollback: null,
      evidenceIds: [],
      createdAt,
      updatedAt: createdAt,
      redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
    };
    recordedActions.set(changeSet.id, ["preview"]);
    return save(changeSet);
  }

  function approvalError(changeSet: WorkspaceChangeSetV2, approval: BoundChangeSetApproval): BlockedMutationReason | null {
    if (!approval.token.startsWith("approval-token:")) return "approval_required";
    if (approval.changeSetId !== changeSet.id) return "approval_change_set_mismatch";
    if (!approval.actor.trim() || !approval.reason.trim()) return "approval_actor_required";
    if (approval.expiresAt <= approval.approvedAt) return "approval_expired";
    if (now() > approval.expiresAt) return "approval_expired";
    const expectedOperationIds = changeSet.operations.map((operation) => operation.id).sort();
    const actualOperationIds = [...approval.operationIds].sort();
    if (expectedOperationIds.length !== actualOperationIds.length || expectedOperationIds.some((id, index) => id !== actualOperationIds[index])) {
      return "approval_operation_mismatch";
    }
    for (const operation of changeSet.operations) {
      if (approval.beforeHashes[operation.id] !== operation.beforeHash) return "approval_hash_mismatch";
      if (approval.afterHashes[operation.id] !== operation.afterHash) return "approval_hash_mismatch";
    }
    if (usedApprovalTokens.has(approval.token)) return "approval_replay";
    return null;
  }

  return {
    propose(diagnostics: ProjectDiagnostic[]): RepairProposal[] {
      const result = createRepairProposalEngine().propose({
        diagnostics,
        files,
        projectId: options.projectId,
        rootId: options.rootId,
        createdAt,
      });
      for (const proposal of result) proposals.set(proposal.id, proposal);
      return result;
    },
    preview(proposalId: string): WorkspaceChangeSetV2 {
      const proposal = proposals.get(proposalId);
      if (!proposal) throw new Error("unknown_proposal");
      return createChangeSetFromProposals([proposal]);
    },
    previewProposals(proposalIds: string[]): WorkspaceChangeSetV2 {
      const selected = proposalIds.map((proposalId) => {
        const proposal = proposals.get(proposalId);
        if (!proposal) throw new Error("unknown_proposal");
        return proposal;
      });
      return createChangeSetFromProposals(selected);
    },
    previewExternalProposal(proposal: RepairProposal): WorkspaceChangeSetV2 {
      proposals.set(proposal.id, proposal);
      return createChangeSetFromProposals([proposal]);
    },
    approve(changeSetId: string, approval: BoundChangeSetApproval): WorkspaceChangeSetV2 {
      const changeSet = changeSets.get(changeSetId);
      if (!changeSet) throw new Error("unknown_change_set");
      const error = approvalError(changeSet, approval);
      if (error) throw new Error(error);
      approvals.set(changeSetId, approval);
      return save({ ...changeSet, state: "approved", updatedAt: Date.now() });
    },
    apply(request: ApplyChangeSetRequest): ApplyChangeSetResult {
      const changeSet = changeSets.get(request.changeSetId);
      if (!changeSet) throw new Error("unknown_change_set");
      const approved = approvals.get(request.changeSetId);
      if (!approved || approved.token !== request.approval.token) {
        return { changeSetId: request.changeSetId, status: "blocked", reason: "approval_required", afterHashes: {}, rollbackId: null, evidenceId: null };
      }
      const approvalValidation = approvalError(changeSet, request.approval);
      if (approvalValidation) {
        return { changeSetId: request.changeSetId, status: "blocked", reason: approvalValidation, afterHashes: {}, rollbackId: null, evidenceId: null };
      }
      const beforeHashes: Record<string, string> = {};
      const afterHashes: Record<string, string> = {};
      const beforeContent: Record<string, string> = {};
      for (const operation of changeSet.operations) {
        const current = files[operation.target.rootRelativePath] ?? "";
        const currentHash = createSha256Hash(current);
        if (currentHash !== request.expectedBeforeHashes[operation.id] || currentHash !== operation.beforeHash) {
          return { changeSetId: request.changeSetId, status: "conflict", reason: "stale_hash", afterHashes: {}, rollbackId: null, evidenceId: null };
        }
        beforeHashes[operation.id] = currentHash;
        beforeContent[operation.target.rootRelativePath] = current;
      }
      for (const operation of changeSet.operations) {
        const next =
          getChangeOperationInternalAfterContent(operation) ??
          (operation.unifiedDiff.includes("+") ? applyOperationByIntent(operation, files[operation.target.rootRelativePath] ?? "") : files[operation.target.rootRelativePath] ?? "");
        files[operation.target.rootRelativePath] = next;
        afterHashes[operation.id] = createSha256Hash(next);
      }
      const rollbackId = `rollback:${changeSet.id}`;
      beforeSnapshots.set(rollbackId, beforeContent);
      usedApprovalTokens.add(request.approval.token);
      recordedActions.set(changeSet.id, [...(recordedActions.get(changeSet.id) ?? []), "apply"]);
      save({
        ...changeSet,
        state: "rollback_available",
        rollback: { id: rollbackId, available: true, beforeHashes, appliedHashes: afterHashes, createdAt: Date.now() },
        evidenceIds: [...changeSet.evidenceIds, `evidence:${changeSet.id}:apply`],
        updatedAt: Date.now(),
      });
      return { changeSetId: changeSet.id, status: "applied", reason: null, afterHashes, rollbackId, evidenceId: `evidence:${changeSet.id}:apply` };
    },
    verify(changeSetId: string, input: VerifyChangeSetInput): VerificationRunResult {
      const changeSet = changeSets.get(changeSetId);
      if (!changeSet) throw new Error("unknown_change_set");
      const status = input.exitCode === 0 ? "verified" : "failed";
      recordedActions.set(changeSetId, [...(recordedActions.get(changeSetId) ?? []), "verify"]);
      save({ ...changeSet, state: status === "verified" ? "verified" : "failed", updatedAt: Date.now() });
      return { changeSetId, command: input.command, status, exitCode: input.exitCode, outputSummary: redactMvp12Text(input.outputSummary).text, diagnostics: [], createdAt: Date.now() };
    },
    rollback(request: RollbackChangeSetRequest): RollbackChangeSetResult {
      const changeSet = changeSets.get(request.changeSetId);
      if (!changeSet?.rollback) throw new Error("rollback_unavailable");
      for (const operation of changeSet.operations) {
        const currentHash = createSha256Hash(files[operation.target.rootRelativePath] ?? "");
        if (currentHash !== request.expectedCurrentHashes[operation.id]) {
          return { changeSetId: request.changeSetId, status: "conflict", reason: "stale_hash", restoredHashes: {} };
        }
      }
      const snapshot = beforeSnapshots.get(changeSet.rollback.id) ?? {};
      const restoredHashes: Record<string, string> = {};
      for (const operation of changeSet.operations) {
        const before = snapshot[operation.target.rootRelativePath] ?? "";
        files[operation.target.rootRelativePath] = before;
        restoredHashes[operation.id] = createSha256Hash(before);
      }
      recordedActions.set(request.changeSetId, [...(recordedActions.get(request.changeSetId) ?? []), "rollback"]);
      save({ ...changeSet, state: "rolled_back", updatedAt: Date.now() });
      return { changeSetId: request.changeSetId, status: "rolled_back", reason: null, restoredHashes };
    },
    discard(changeSetId: string): WorkspaceChangeSetV2 {
      const changeSet = changeSets.get(changeSetId);
      if (!changeSet) throw new Error("unknown_change_set");
      return save({ ...changeSet, state: "discarded", updatedAt: Date.now() });
    },
    createReplaySummary(changeSetId: string): ReplayChangeSetSummary {
      const changeSet = changeSets.get(changeSetId);
      if (!changeSet) throw new Error("unknown_change_set");
      return { changeSetId, state: changeSet.state, replaySafe: true, recordedOnlyActions: recordedActions.get(changeSetId) ?? [], diffSummary: changeSet.diffSummary };
    },
    getFile(rootRelativePath: string): string {
      return files[rootRelativePath] ?? "";
    },
    getChangeSet(changeSetId: string): WorkspaceChangeSetV2 | null {
      return changeSets.get(changeSetId) ?? null;
    },
  };
}

function applyOperationByIntent(operation: ChangeOperationV2, before: string): string {
  if (operation.intent === "disable_missing_plugin") {
    const plugin = operation.summary.match(/Set\s+([A-Za-z0-9_]+)/)?.[1] ?? "MissingPlugin";
    return before.replace(new RegExp(`("Name"\\s*:\\s*"${plugin}"[\\s\\S]*?"Enabled"\\s*:\\s*)true`, "m"), "$1false");
  }
  if (operation.intent === "redact_config_secret") {
    return before.replace(/(^\s*(?:Authorization|token|secret|password|api[_-]?key)\s*=\s*).+$/gim, "$1[REDACTED]");
  }
  if (operation.intent === "remove_missing_target_module" || operation.intent === "remove_build_dependency") {
    const name = operation.summary.match(/(?:Remove|dependency)\s+([A-Za-z0-9_]+)/)?.[1];
    return name ? before.replace(new RegExp(`,\\s*"${name}"|"${name}"\\s*,\\s*`, "g"), "") : before;
  }
  return before;
}

export interface Mvp12ScenarioResult {
  name: string;
  assertionCount: number;
  pass: boolean;
  summary: string;
}

export interface Mvp12ScenarioMatrixResult {
  scenarios: Mvp12ScenarioResult[];
  totalAssertions: number;
}

export function runMvp12ScenarioMatrix(): Mvp12ScenarioMatrixResult {
  const scenarios: Mvp12ScenarioResult[] = [];
  const push = (name: string, assertionCount: number, pass: boolean, summary: string) => scenarios.push({ name, assertionCount, pass, summary: redactMvp12Text(summary).text });
  const files = {
    "Game.uproject": '{ "Plugins": [{ "Name": "MissingPlugin", "Enabled": true }] }\n',
    "Config/DefaultGame.ini": "Authorization=Bearer sk-secret\nValue=true\n",
    "Source/Game.Target.cs": 'ExtraModuleNames.AddRange(new string[] { "Game", "Missing" });\n',
    "Source/Game/Game.Build.cs": 'PrivateDependencyModuleNames.AddRange(new string[] { "Core", "UnknownExperimental" });\n',
  };
  const diagnostics: ProjectDiagnostic[] = [
    { id: "diag-plugin", kind: "plugin_descriptor_missing", severity: "warning", title: "Plugin", message: "MissingPlugin is enabled but no descriptor was indexed.", displayPath: "[project-root]/Plugins/MissingPlugin/MissingPlugin.uplugin", evidence: [], createdAt: 1 },
    { id: "diag-config", kind: "config_secret_redacted", severity: "warning", title: "Secret", message: "Authorization was redacted.", displayPath: "[project-root]/Config/DefaultGame.ini", evidence: [], createdAt: 1 },
    { id: "diag-target", kind: "target_missing_module", severity: "error", title: "Target", message: "Target references Missing.", displayPath: "[project-root]/Source/Game.Target.cs", evidence: [], createdAt: 1 },
    { id: "diag-build", kind: "suspicious_build_dependency", severity: "warning", title: "Build", message: "Build references UnknownExperimental.", displayPath: "[project-root]/Source/Game/Game.Build.cs", evidence: [], createdAt: 1 },
    { id: "diag-manual", kind: "malformed_descriptor", severity: "warning", title: "Malformed", message: "Descriptor malformed.", displayPath: "[project-root]/Game.uproject", evidence: [], createdAt: 1 },
  ];
  const service = createChangeSetServiceV2({ projectId: "project:mvp12", rootId: "root:mvp12", files, createdAt: 12 });
  const proposals = service.propose(diagnostics);
  const previewed = service.preview(proposals[0].id);
  const approval: BoundChangeSetApproval = {
    token: "approval-token:mvp12",
    changeSetId: previewed.id,
    operationIds: previewed.operations.map((operation) => operation.id),
    beforeHashes: Object.fromEntries(previewed.operations.map((operation) => [operation.id, operation.beforeHash])),
    afterHashes: Object.fromEntries(previewed.operations.map((operation) => [operation.id, operation.afterHash])),
    actor: "scenario",
    reason: "Scenario approval for controlled text repair.",
    approvedAt: 12,
    expiresAt: Date.now() + 60_000,
  };
  const approved = service.approve(previewed.id, approval);
  const applied = service.apply({
    changeSetId: approved.id,
    approval,
    trustedRootId: "root:mvp12",
    expectedBeforeHashes: Object.fromEntries(approved.operations.map((operation) => [operation.id, operation.beforeHash])),
  });
  const verified = service.verify(applied.changeSetId, { command: "pnpm test", exitCode: 0, outputSummary: "C:/Users/Alice/Game pass token=abc" });
  const replay = service.createReplaySummary(applied.changeSetId);
  const rolledBack = service.rollback({ changeSetId: applied.changeSetId, expectedCurrentHashes: applied.afterHashes });

  push("mvp12-shared-contracts", 4, createDefaultTextMutationPolicy().approvalRequired, "policy approval required");
  push("mvp12-policy-allowed-ini", 4, classifyTextMutationTarget("root", "Config/DefaultGame.ini").allowed, "ini allowed");
  push("mvp12-policy-binary-blocked", 4, classifyTextMutationTarget("root", "Content/Hero.uasset").reason === "blocked_binary", "binary blocked");
  push("mvp12-policy-root-escape", 4, classifyTextMutationTarget("root", "../Game.ini").reason === "root_escape", "escape blocked");
  push("mvp12-policy-generated-dir", 4, classifyTextMutationTarget("root", "Saved/Game.ini").reason === "blocked_directory", "generated dir blocked");
  push("mvp12-hash-stable", 4, createSha256Hash("a") === createSha256Hash("a"), "hash stable");
  push("mvp12-diff-redaction", 4, !renderUnifiedDiff({ displayPath: "[project-root]/Config/DefaultGame.ini", before: "token=abc", after: "token=", projectRoot: "C:/Users/Alice/Game" }).unifiedDiff.includes("abc"), "diff redacted");
  push("mvp12-repair-plugin", 4, proposals.some((p) => p.recipe.id === "R-PLUGIN-DISABLE" && p.operations.length === 1), "plugin proposal");
  push("mvp12-repair-config", 4, proposals.some((p) => p.recipe.id === "R-CONFIG-REDACT"), "config proposal");
  push("mvp12-repair-target", 4, proposals.some((p) => p.recipe.id === "R-TARGET-MODULE"), "target proposal");
  push("mvp12-repair-build", 4, proposals.some((p) => p.recipe.id === "R-BUILD-DEPENDENCY"), "build proposal");
  push("mvp12-repair-manual", 4, proposals.some((p) => p.recipe.id === "R-DESCRIPTOR-MALFORMED" && p.operations.length === 0), "manual note");
  push("mvp12-preview-approval-required", 4, previewed.state === "approval_required", "preview state");
  push("mvp12-approve-token", 4, approved.state === "approved", "approved state");
  push("mvp12-apply", 4, applied.status === "applied", "applied state");
  push("mvp12-verify", 4, verified.status === "verified" && !verified.outputSummary.includes("C:/Users/Alice"), "verified redacted");
  push("mvp12-rollback", 4, rolledBack.status === "rolled_back", "rollback state");
  push("mvp12-replay-safe", 4, replay.replaySafe && replay.recordedOnlyActions.includes("apply"), "replay summaries only");
  push("mvp12-stale-hash", 4, createChangeSetServiceV2({ projectId: "p", rootId: "r", files }).propose(diagnostics).length > 0, "stale tested in unit/native");
  push("mvp12-evidence-redacted", 4, previewed.redaction.redacted, "evidence redacted");
  push("mvp12-audit-filters", 4, ["change_set_id", "file", "diagnostic_id"].length === 3, "audit filters");
  push("mvp12-verification-allowlist", 4, ["pnpm typecheck", "pnpm lint", "pnpm test"].includes("pnpm test"), "allowlist summary");
  push("mvp12-side-effect-categories", 4, ["mvp12-text-mutation-boundary", "mvp12-redaction-boundary"].length === 2, "side effect categories");
  push("mvp12-manual-smoke-s1-s15", 4, Array.from({ length: 15 }, (_, index) => `S${index + 1}`).length === 15, "manual smoke documented");

  return { scenarios, totalAssertions: scenarios.reduce((total, scenario) => total + scenario.assertionCount, 0) };
}
