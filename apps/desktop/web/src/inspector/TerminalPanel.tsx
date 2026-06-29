import { useState, useCallback } from "react";
import { useRuntimeStore, useRuntimeActions, useProjectStore } from "../stores/ui-store";

const QUICK_ACTIONS = ["pnpm typecheck", "pnpm lint", "pnpm test"] as const;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatExpiry(expiresAt: number | undefined): string {
  if (!expiresAt) return "N/A";
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "Expired";
  if (remaining < 60000) return `${Math.round(remaining / 1000)}s`;
  return `${Math.round(remaining / 60000)}m`;
}

function getRiskClass(risk: string): string {
  if (risk === "allowlisted") return "ua-inspector-terminal__risk--low";
  if (risk === "unknown") return "ua-inspector-terminal__risk--medium";
  return "ua-inspector-terminal__risk--high";
}

function getRiskLabel(risk: string): string {
  const labels: Record<string, string> = {
    allowlisted: "Allowlisted",
    unknown: "Unrecognized",
    denied_combination: "Denied",
    dangerous_command: "Dangerous",
    shell_metachar: "Shell metachar",
    root_escape: "Root escape",
    network_hint: "Network hint",
    blocked: "Blocked",
  };
  return labels[risk] ?? "Blocked";
}

export function TerminalPanel() {
  const terminalState = useRuntimeStore((s) => s.mvp9.mvp10.terminal);
  const activeProject = useProjectStore((s) =>
    s.activeProjectId ? s.registeredProjects.find((p) => p.id === s.activeProjectId) ?? null : null,
  );
  const {
    proposeMvp10TerminalCommand,
    approveMvp10TerminalProposal,
    rejectMvp10TerminalProposal,
    cancelMvp10TerminalExecution,
    resetMvp10Terminal,
  } = useRuntimeActions();

  const [input, setInput] = useState("");
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const {
    activeProposal,
    approvalState,
    token,
    executionResult,
    stage,
    capability = {
      enabled: false,
      mode: "disabled" as const,
      reason: "native_terminal_unavailable",
      allowlistSummary: "MVP10 verification commands only",
      trustedRootRequired: true,
      approvalRequired: true,
      timeoutMs: 60_000,
      outputLimitBytes: 1_048_576,
      outputLimitLines: 5_000,
    },
  } = terminalState;

  const nativeRoot = activeProject?.rootRef ?? null;

  const handlePropose = useCallback((cmd: string) => {
    if (!nativeRoot) {
      setApprovalError("Select and trust a project before proposing a command.");
      return;
    }
    const taskId = null;
    void proposeMvp10TerminalCommand(cmd, nativeRoot, taskId, nativeRoot, activeProject?.id ?? null);
  }, [activeProject?.id, nativeRoot, proposeMvp10TerminalCommand]);

  const handleApprove = useCallback(async () => {
    if (!activeProposal) return;
    setApprovalError(null);
    const result = await approveMvp10TerminalProposal(activeProposal.id, "user", "Approved via TerminalPanel");
    if (!result) {
      setApprovalError(activeProposal.classification.reason);
    }
  }, [activeProposal, approveMvp10TerminalProposal]);

  const handleReject = useCallback(() => {
    if (!activeProposal) return;
    rejectMvp10TerminalProposal(activeProposal.id, "user", "Rejected by user");
  }, [activeProposal, rejectMvp10TerminalProposal]);

  const handleCancel = useCallback(() => {
    if (executionResult) {
      cancelMvp10TerminalExecution(executionResult.id);
    }
    resetMvp10Terminal();
    setInput("");
  }, [executionResult, cancelMvp10TerminalExecution, resetMvp10Terminal]);

  const handleReset = useCallback(() => {
    resetMvp10Terminal();
    setInput("");
    setApprovalError(null);
  }, [resetMvp10Terminal]);

  const handleSubmitInput = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim()) handlePropose(input.trim());
    },
    [input, handlePropose],
  );

  if (!capability.enabled) {
    return (
      <div className="ua-inspector-terminal" role="region" aria-label="Terminal">
        <div className="ua-inspector-terminal__header">
          <span>Terminal</span>
          <span className="ua-inspector__badge">MVP10</span>
        </div>
        <div className="ua-inspector-terminal__blocked">
          <p>Real terminal execution is disabled.</p>
          <p className="ua-inspector-terminal__blocked-hint">
            Enable in Settings → Config → Terminal Execution.
          </p>
          <p className="ua-inspector-terminal__blocked-hint">
            Only allowlisted commands (typecheck, lint, test, git status/diff) are supported.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "rejected") {
    return (
      <div className="ua-inspector-terminal" role="region" aria-label="Terminal proposal rejected">
        <div className="ua-inspector-terminal__header">
          <span>Terminal</span>
          <span className="ua-inspector__badge">MVP10</span>
        </div>
        <div className="ua-inspector-terminal__body">
          <div className="ua-inspector-terminal__field">
            <label>Status</label>
            <span className="ua-inspector-terminal__status--rejected">Rejected</span>
          </div>
          {approvalState?.reason && (
            <div className="ua-inspector-terminal__field">
              <label>Reason</label>
              <span>{approvalState.reason}</span>
            </div>
          )}
          {approvalError && (
            <div className="ua-inspector-terminal__field">
              <label>Error</label>
              <span className="ua-inspector-terminal__error">{approvalError}</span>
            </div>
          )}
        </div>
        <div className="ua-inspector-terminal__actions">
          <button className="ua-btn ua-btn--secondary" type="button" onClick={handleReset} aria-label="Reset terminal">
            Reset
          </button>
        </div>
      </div>
    );
  }

  if (stage === "executing" || stage === "completed" || stage === "failed" || stage === "timed_out" || stage === "cancelled") {
    const isRunning = stage === "executing";
    const chunks = executionResult?.chunks ?? [];
    return (
      <div className="ua-inspector-terminal" role="region" aria-label="Terminal execution">
        <div className="ua-inspector-terminal__header">
          <span>Terminal</span>
          <span className="ua-inspector__badge">MVP10</span>
        </div>
        <div className="ua-inspector-terminal__body">
          <div className="ua-inspector-terminal__field">
            <label>Status</label>
            <span className={`ua-inspector-terminal__status--${stage}`}>
              {stage === "executing" ? "Running..." :
               stage === "completed" ? "Completed" :
               stage === "timed_out" ? "Timed out" :
               stage === "cancelled" ? "Cancelled" :
               "Failed"}
            </span>
          </div>
          {activeProposal && (
            <>
              <div className="ua-inspector-terminal__field">
                <label>Proposal ID</label>
                <code className="ua-text-mono">{activeProposal.id}</code>
              </div>
              <div className="ua-inspector-terminal__field">
                <label>Command</label>
                <code>{activeProposal.command}</code>
              </div>
              <div className="ua-inspector-terminal__field">
                <label>Risk</label>
                <span className={getRiskClass(activeProposal.classification.risk)}>
                  {getRiskLabel(activeProposal.classification.risk)}
                </span>
              </div>
            </>
          )}
          {executionResult && !isRunning && (
            <>
              {executionResult.exitState && (
                <div className="ua-inspector-terminal__field">
                  <label>Exit code</label>
                  <span>{executionResult.exitState.code}</span>
                </div>
              )}
              <div className="ua-inspector-terminal__field">
                <label>Duration</label>
                <span>{executionResult.exitState ? formatDuration(executionResult.exitState.durationMs) : "N/A"}</span>
              </div>
              {executionResult.redactionSummary && (
                <div className="ua-inspector-terminal__field">
                  <label>Redactions</label>
                  <span>
                    {executionResult.redactionSummary.replacedSecrets} secrets,
                    {" "}{executionResult.redactionSummary.replacedPaths} paths
                  </span>
                </div>
              )}
              {executionResult.outputTruncated && (
                <div className="ua-inspector-terminal__field">
                  <label>Truncation</label>
                  <span>
                    Output limited to {executionResult.totalLines} lines / {Math.round(executionResult.totalBytes / 1024)} KB
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        {chunks.length > 0 && (
          <div className="ua-inspector-terminal__output" aria-label="Command output">
            {chunks.map((chunk) => (
              <div key={chunk.index} className="ua-inspector-terminal__output-line" data-stream={chunk.stream}>
                <span className="ua-inspector-terminal__output-stream">[{chunk.stream}]</span>
                <span>{chunk.text}</span>
                {chunk.truncated && <span className="ua-inspector-terminal__truncated">…truncated</span>}
              </div>
            ))}
          </div>
        )}
        <div className="ua-inspector-terminal__actions">
          {isRunning ? (
            <button className="ua-btn ua-btn--danger" type="button" onClick={handleCancel} aria-label="Cancel execution">
              Cancel
            </button>
          ) : (
            <button className="ua-btn ua-btn--secondary" type="button" onClick={handleReset} aria-label="Clear terminal">
              Clear
            </button>
          )}
        </div>
      </div>
    );
  }

  if (stage === "proposed" || stage === "approved") {
    if (!activeProposal) return null;
    const { classification } = activeProposal;
    const riskClass = getRiskClass(classification.risk);
    const riskLabel = getRiskLabel(classification.risk);
    const approveDisabled = classification.risk !== "allowlisted";
    const timeoutSeconds = Math.round(activeProposal.timeoutMs / 1000);
    const isApproved = stage === "approved";
    return (
      <div className="ua-inspector-terminal" role="region" aria-label="Terminal proposal">
        <div className="ua-inspector-terminal__header">
          <span>Command Proposal</span>
          <span className="ua-inspector__badge">MVP10</span>
        </div>
        <div className="ua-inspector-terminal__body">
          <div className="ua-inspector-terminal__field">
            <label>Status</label>
            <span className={`ua-inspector-terminal__status--${stage}`}>
              {isApproved ? "Approved" : "Pending approval"}
            </span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Proposal ID</label>
            <code className="ua-text-mono">{activeProposal.id}</code>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Command</label>
            <code>{activeProposal.command}</code>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Risk</label>
            <span className={riskClass}>
              {riskLabel} &mdash; {classification.reason}
            </span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Working directory</label>
            <code>{activeProposal.cwd}</code>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Expires</label>
            <span>{formatExpiry(activeProposal.expiresAt)}</span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Timeout</label>
            <span>{timeoutSeconds}s</span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Output limit</label>
            <span>{Math.round(activeProposal.outputLimitBytes / 1024)} KB / {activeProposal.outputLimitLines} lines</span>
          </div>
          {token && (
            <div className="ua-inspector-terminal__field">
              <label>Token</label>
              <span className="ua-inspector-terminal__token-status">
                Issued &middot; expires in {formatExpiry(token.expiresAt)}
              </span>
            </div>
          )}
          {approvalError && (
            <div className="ua-inspector-terminal__field">
              <label>Error</label>
              <span className="ua-inspector-terminal__error">{approvalError}</span>
            </div>
          )}
        </div>
        <div className="ua-inspector-terminal__actions">
          {!isApproved && (
            <>
              <button
                className="ua-btn ua-btn--primary"
                type="button"
                disabled={approveDisabled}
                onClick={handleApprove}
                aria-label={approveDisabled ? "Command not allowlisted" : "Approve and execute command"}
              >
                {approveDisabled ? "Blocked" : "Approve & Execute"}
              </button>
              <button
                className="ua-btn ua-btn--secondary"
                type="button"
                onClick={handleReject}
                aria-label="Reject command proposal"
              >
                Reject
              </button>
            </>
          )}
          {isApproved && (
            <button className="ua-btn ua-btn--secondary" type="button" onClick={handleReset} aria-label="Reset terminal">
              Reset
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ua-inspector-terminal ua-inspector-terminal--idle" role="region" aria-label="Terminal">
      <div className="ua-inspector-terminal__header">
        <span>Terminal</span>
        <span className="ua-inspector__badge">MVP10</span>
      </div>
      <p className="ua-inspector-terminal__empty">No active proposal</p>
      <form onSubmit={handleSubmitInput}>
        <div className="ua-inspector-terminal__field">
          <label htmlFor="terminal-command-input">Command</label>
          <input
            id="terminal-command-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter a command..."
          />
        </div>
        <div className="ua-inspector-terminal__actions">
          <button className="ua-btn ua-btn--primary" type="submit" aria-label="Propose command">
            Propose
          </button>
        </div>
      </form>
      <div className="ua-inspector-terminal__quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={() => handlePropose(action)}
            aria-label={`Quick action: ${action}`}
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}
