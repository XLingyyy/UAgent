import type {
  ApprovalToken,
  TerminalCommandProposal,
  TerminalExecutionCapabilityStatus,
  TerminalExecutionResult,
  TerminalOutputChunk,
} from "@uagent/shared";
import type { RealTerminalAdapter } from "@uagent/runtime";
import { resolveTrustedNativeRootRef, type NativeInvoke } from "./project-native-adapter";

type NativeProposeResult = {
  proposalId?: string;
  proposal_id?: string;
  command: string;
  risk: string;
  reason: string;
  requiresApproval?: boolean;
  requires_approval?: boolean;
  featureFlag?: string;
  feature_flag?: string;
  canonicalCwd?: string;
  canonical_cwd?: string;
  redactedCwd?: string;
  redacted_cwd?: string;
  expiresAt?: number;
  expires_at?: number;
  timeoutMs?: number;
  timeout_ms?: number;
  outputLimitBytes?: number;
  output_limit_bytes?: number;
  outputLimitLines?: number;
  output_limit_lines?: number;
};

type NativeApproveResult = {
  token: string;
  status: string;
};

type NativeExecuteResult = {
  status: TerminalExecutionResult["status"];
  chunks: TerminalOutputChunk[];
  exitCode?: number | null;
  exit_code?: number | null;
  durationMs?: number;
  duration_ms?: number;
  outputSummary?: string;
  output_summary?: string;
  outputTruncated?: boolean;
  output_truncated?: boolean;
  totalBytes?: number;
  total_bytes?: number;
  totalLines?: number;
  total_lines?: number;
  redactionSummary?: { replacedSecrets: number; replacedPaths: number };
  redaction_summary?: { replaced_secrets: number; replaced_paths: number };
};

type NativeCapabilityResult = {
  enabled?: boolean;
  mode?: "native" | "fixture" | "disabled";
  reason?: string | null;
  allowlistSummary?: string;
  allowlist_summary?: string;
  trustedRootRequired?: boolean;
  trusted_root_required?: boolean;
  approvalRequired?: boolean;
  approval_required?: boolean;
  timeoutMs?: number;
  timeout_ms?: number;
  outputLimitBytes?: number;
  output_limit_bytes?: number;
  outputLimitLines?: number;
  output_limit_lines?: number;
};

function normalizeRedactionSummary(
  redaction:
    | { replacedSecrets: number; replacedPaths: number }
    | { replaced_secrets: number; replaced_paths: number }
    | undefined,
): { replacedSecrets: number; replacedPaths: number } {
  if (!redaction) {
    return { replacedSecrets: 0, replacedPaths: 0 };
  }
  if ("replacedSecrets" in redaction) {
    return redaction;
  }
  return {
    replacedSecrets: redaction.replaced_secrets,
    replacedPaths: redaction.replaced_paths,
  };
}

interface NativeProposalRecord {
  canonicalCwd: string;
  token: string | null;
}

const DEFAULT_CAPABILITY: TerminalExecutionCapabilityStatus = {
  enabled: false,
  mode: "disabled",
  reason: "native_capability_status_pending",
  allowlistSummary: "typecheck, lint, test, desktop web build, cargo test, git status/diff",
  trustedRootRequired: true,
  approvalRequired: true,
  timeoutMs: 60_000,
  outputLimitBytes: 1_048_576,
  outputLimitLines: 5_000,
};

function getGlobalInvoke(): NativeInvoke | null {
  const tauriInternals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } })
    .__TAURI_INTERNALS__;
  return tauriInternals?.invoke ?? null;
}

function mapRisk(risk: string): TerminalCommandProposal["classification"]["risk"] {
  if (risk === "allowlisted") return "allowlisted";
  if (risk === "dangerous") return "dangerous_command";
  if (risk === "shell_metachar") return "shell_metachar";
  if (risk === "cwd_escape") return "root_escape";
  if (risk === "blocked") return "denied_combination";
  return "unknown";
}

function normalizeCapability(raw: NativeCapabilityResult): TerminalExecutionCapabilityStatus {
  const enabled = Boolean(raw.enabled);
  return {
    enabled,
    mode: raw.mode ?? (enabled ? "native" : "disabled"),
    reason: raw.reason ?? (enabled ? null : "feature_disabled"),
    allowlistSummary: raw.allowlistSummary ?? raw.allowlist_summary ?? DEFAULT_CAPABILITY.allowlistSummary,
    trustedRootRequired: raw.trustedRootRequired ?? raw.trusted_root_required ?? DEFAULT_CAPABILITY.trustedRootRequired,
    approvalRequired: raw.approvalRequired ?? raw.approval_required ?? DEFAULT_CAPABILITY.approvalRequired,
    timeoutMs: raw.timeoutMs ?? raw.timeout_ms ?? DEFAULT_CAPABILITY.timeoutMs,
    outputLimitBytes: raw.outputLimitBytes ?? raw.output_limit_bytes ?? DEFAULT_CAPABILITY.outputLimitBytes,
    outputLimitLines: raw.outputLimitLines ?? raw.output_limit_lines ?? DEFAULT_CAPABILITY.outputLimitLines,
  };
}

export function createDesktopTerminalAdapter(invoke: NativeInvoke): RealTerminalAdapter {
  const records = new Map<string, NativeProposalRecord>();
  let capability = DEFAULT_CAPABILITY;

  return {
    getCapability() {
      return capability;
    },

    async refreshCapability() {
      try {
        const raw = await invoke<NativeCapabilityResult>("terminal_capability_status");
        capability = normalizeCapability(raw);
      } catch {
        capability = {
          ...DEFAULT_CAPABILITY,
          reason: "native_capability_status_unavailable",
        };
      }
      return capability;
    },

    async propose(command, cwd, taskId, _trustedRoot, projectId) {
      const resolvedCwd =
        resolveTrustedNativeRootRef(cwd) ??
        resolveTrustedNativeRootRef(projectId) ??
        cwd;
      const raw = await invoke<NativeProposeResult>("propose_terminal_command", {
        input: { command, cwd: resolvedCwd, projectId: projectId ?? "default-project" },
      });
      const proposalId = raw.proposalId ?? raw.proposal_id ?? "";
      const canonicalCwd = raw.canonicalCwd ?? raw.canonical_cwd ?? cwd;
      const redactedCwd = raw.redactedCwd ?? raw.redacted_cwd ?? "[project-root]";
      const risk = proposalId ? mapRisk(raw.risk) : "denied_combination";
      const reason = raw.reason ?? (proposalId ? "native proposal created" : "native proposal rejected");
      const outputLimitBytes = raw.outputLimitBytes ?? raw.output_limit_bytes ?? capability.outputLimitBytes;
      const outputLimitLines = raw.outputLimitLines ?? raw.output_limit_lines ?? capability.outputLimitLines;
      const timeoutMs = raw.timeoutMs ?? raw.timeout_ms ?? capability.timeoutMs;

      const id = proposalId || `native-rejected-${Date.now()}`;
      records.set(id, { canonicalCwd, token: null });

      return {
        id,
        taskId,
        projectId,
        command: raw.command ?? command,
        cwd: redactedCwd,
        expiresAt: raw.expiresAt ?? raw.expires_at ?? Date.now() + 300_000,
        classification: {
          command: raw.command ?? command,
          risk,
          reason,
          matchedKeyword: null,
          cwd: redactedCwd,
          cwdIsContained: !reason.includes("cwd_escape"),
          hasShellMetachar: reason.includes("shell_metachar"),
          envHints: [],
        },
        outputLimitBytes,
        outputLimitLines,
        timeoutMs,
        proposedAt: Date.now(),
      };
    },

    async approve(proposal, actor, reason) {
      const ttlSecs = Math.max(1, Math.round(((proposal.expiresAt ?? Date.now() + 300_000) - Date.now()) / 1000));
      const raw = await invoke<NativeApproveResult>("approve_terminal_proposal", {
        input: {
          proposalId: proposal.id,
          actor,
          reason,
          ttlSecs,
        },
      });
      const record = records.get(proposal.id);
      if (!record) {
        throw new Error("native proposal record missing");
      }
      record.token = raw.token;
      const now = Date.now();
      const safeToken: ApprovalToken = {
        id: "[native-issued]",
        proposalId: proposal.id,
        taskId: proposal.taskId,
        status: raw.status === "approved" ? "issued" : "revoked",
        actor,
        createdAt: now,
        usedAt: null,
        expiresAt: proposal.expiresAt ?? now + 300_000,
      };
      return safeToken;
    },

    async execute(proposal) {
      const record = records.get(proposal.id);
      if (!record?.token) {
        throw new Error("native approval token missing");
      }
      const raw = await invoke<NativeExecuteResult>("execute_terminal_command_real", {
        input: {
          command: proposal.command,
          cwd: record.canonicalCwd,
          approvedToken: record.token,
          timeoutSecs: Math.max(1, Math.round(proposal.timeoutMs / 1000)),
        },
      });
      record.token = null;
      const now = Date.now();
      const exitCode = raw.exitCode ?? raw.exit_code ?? null;
      const durationMs = raw.durationMs ?? raw.duration_ms ?? 0;
      const redaction = normalizeRedactionSummary(raw.redactionSummary ?? raw.redaction_summary);
      return {
        id: `native-exec:${proposal.id}`,
        requestId: proposal.id,
        status: raw.status,
        chunks: (raw.chunks ?? []).map((chunk, index) => ({
          index: chunk.index ?? index,
          stream: chunk.stream,
          text: chunk.text,
          truncated: chunk.truncated,
          timestamp: chunk.timestamp,
        })),
        exitState: exitCode === null ? null : { code: exitCode, signal: null, durationMs },
        outputSummary: raw.outputSummary ?? raw.output_summary ?? "",
        outputTruncated: raw.outputTruncated ?? raw.output_truncated ?? false,
        totalBytes: raw.totalBytes ?? raw.total_bytes ?? 0,
        totalLines: raw.totalLines ?? raw.total_lines ?? 0,
        redactionSummary: {
          replacedSecrets: redaction.replacedSecrets,
          replacedPaths: redaction.replacedPaths,
        },
        createdAt: now - durationMs,
        completedAt: now,
      };
    },
  };
}

export function createDesktopTerminalAdapterFromEnvironment(
  invoke: NativeInvoke | null = getGlobalInvoke(),
): RealTerminalAdapter | null {
  return invoke ? createDesktopTerminalAdapter(invoke) : null;
}
