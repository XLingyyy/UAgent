import {useI18n} from "../i18n";
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
  const {text: uiText,t} = useI18n();
  const terminalState = useRuntimeStore((s) => s.mvp9.mvp10.terminal);
  const buildAnalysis = useRuntimeStore((s) => s.mvp11.buildAnalysis);
  const activeProject = useProjectStore((s) =>
    s.activeProjectId ? s.registeredProjects.find((p) => p.id === s.activeProjectId) ?? null : null,
  );
  const {
    proposeMvp10TerminalCommand,
    approveMvp10TerminalProposal,
    rejectMvp10TerminalProposal,
    cancelMvp10TerminalExecution,
    resetMvp10Terminal,
    analyzeBuildOutputEvidence,
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
      <div className="ua-inspector-terminal" role="region" aria-label={uiText("Terminal")}>
        <div className="ua-inspector-terminal__header">
          <span>{uiText("Terminal")}</span>
          <span className="ua-inspector__badge">{uiText("MVP10")}</span>
        </div>
        <div className="ua-inspector-terminal__blocked">
          <p>{uiText("Real terminal execution is disabled.")}</p>
          <p className="ua-inspector-terminal__blocked-hint">
            {uiText("Enable in Settings → Config → Terminal Execution.")}{" "}</p>
          <p className="ua-inspector-terminal__blocked-hint">
            {uiText("Only allowlisted commands (typecheck, lint, test, git status/diff) are supported.")}{" "}</p>
        </div>
      </div>
    );
  }

  if (stage === "rejected") {
    return (
      <div className="ua-inspector-terminal" role="region" aria-label={uiText("Terminal proposal rejected")}>
        <div className="ua-inspector-terminal__header">
          <span>{uiText("Terminal")}</span>
          <span className="ua-inspector__badge">{uiText("MVP10")}</span>
        </div>
        <div className="ua-inspector-terminal__body">
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Status")}</label>
            <span className="ua-inspector-terminal__status--rejected">{uiText("Rejected")}</span>
          </div>
          {approvalState?.reason && (
            <div className="ua-inspector-terminal__field">
              <label>{uiText("Reason")}</label>
              <span>{approvalState.reason}</span>
            </div>
          )}
          {approvalError && (
            <div className="ua-inspector-terminal__field">
              <label>{uiText("Error")}</label>
              <span className="ua-inspector-terminal__error">{approvalError}</span>
            </div>
          )}
        </div>
        <div className="ua-inspector-terminal__actions">
          <button className="ua-btn ua-btn--secondary" type="button" onClick={handleReset} aria-label={uiText("Reset terminal")}>
            {uiText("Reset")}{" "}</button>
        </div>
      </div>
    );
  }

  if (stage === "executing" || stage === "completed" || stage === "failed" || stage === "timed_out" || stage === "cancelled") {
    const isRunning = stage === "executing";
    const chunks = executionResult?.chunks ?? [];
    return (
      <div className="ua-inspector-terminal" role="region" aria-label={uiText("Terminal execution")}>
        <div className="ua-inspector-terminal__header">
          <span>{uiText("Terminal")}</span>
          <span className="ua-inspector__badge">{uiText("MVP10")}</span>
        </div>
        <div className="ua-inspector-terminal__body">
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Status")}</label>
            <span className={`ua-inspector-terminal__status--${stage}`}>
              {stage === "executing" ? uiText("Running...") :
               stage === "completed" ? uiText("Completed") :
               stage === "timed_out" ? uiText("Timed out") :
               stage === "cancelled" ? uiText("Cancelled") :
               uiText("Failed")}
            </span>
          </div>
          {activeProposal && (
            <>
              <div className="ua-inspector-terminal__field">
                <label>{uiText("Proposal ID")}</label>
                <code className="ua-text-mono">{activeProposal.id}</code>
              </div>
              <div className="ua-inspector-terminal__field">
                <label>{uiText("Command")}</label>
                <code>{activeProposal.command}</code>
              </div>
              <div className="ua-inspector-terminal__field">
                <label>{uiText("Risk")}</label>
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
                  <label>{uiText("Exit code")}</label>
                  <span>{executionResult.exitState.code}</span>
                </div>
              )}
              <div className="ua-inspector-terminal__field">
                <label>{uiText("Duration")}</label>
                <span>{executionResult.exitState ? formatDuration(executionResult.exitState.durationMs) : uiText("N/A")}</span>
              </div>
              {executionResult.redactionSummary && (
                <div className="ua-inspector-terminal__field">
                  <label>{uiText("Redactions")}</label>
                  <span>
                    {executionResult.redactionSummary.replacedSecrets} {uiText("secrets,")}{" "}{" "}{executionResult.redactionSummary.replacedPaths} {uiText("paths")}{" "}</span>
                </div>
              )}
              {executionResult.outputTruncated && (
                <div className="ua-inspector-terminal__field">
                  <label>{uiText("Truncation")}</label>
                  <span>
                    {uiText("Output limited to")}{" "}{executionResult.totalLines} {uiText("lines /")}{" "}{Math.round(executionResult.totalBytes / 1024)} {uiText("KB")}{" "}</span>
                </div>
              )}
            </>
          )}
        </div>
        {chunks.length > 0 && (
          <div className="ua-inspector-terminal__output" aria-label={uiText("Command output")}>
            {chunks.map((chunk) => (
              <div key={chunk.index} className="ua-inspector-terminal__output-line" data-stream={chunk.stream}>
                <span className="ua-inspector-terminal__output-stream">[{chunk.stream}]</span>
                <span>{chunk.text}</span>
                {chunk.truncated && <span className="ua-inspector-terminal__truncated">{uiText("…truncated")}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="ua-inspector-terminal__actions">
          {isRunning ? (
            <button className="ua-btn ua-btn--danger" type="button" onClick={handleCancel} aria-label={uiText("Cancel execution")}>
              {uiText("Cancel")}{" "}</button>
          ) : (
            <>
              <button className="ua-btn ua-btn--primary" type="button" onClick={analyzeBuildOutputEvidence} aria-label={uiText("Analyze output")}>
                {uiText("Analyze output")}{" "}</button>
              <button className="ua-btn ua-btn--secondary" type="button" onClick={handleReset} aria-label={uiText("Clear terminal")}>
                {uiText("Clear")}{" "}</button>
            </>
          )}
        </div>
        {buildAnalysis && (
          <div className="ua-inspector-terminal__body" aria-label={uiText("Build failure analysis")}>
            <div className="ua-inspector-terminal__field">
              <label>{uiText("Build diagnostics")}</label>
              <span>{buildAnalysis.errorCount} {uiText("errors,")}{" "}{buildAnalysis.warningCount} {uiText("warnings")}</span>
            </div>
            {buildAnalysis.topIssues.slice(0, 3).map((issue) => (
              <div key={issue} className="ua-inspector-terminal__field">
                <label>{uiText("Issue")}</label>
                <span>{issue}</span>
              </div>
            ))}
            <div className="ua-inspector-terminal__field">
              <label>{uiText("Next checks")}</label>
              <span>{buildAnalysis.nextChecks.join(" ")}</span>
            </div>
          </div>
        )}
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
      <div className="ua-inspector-terminal" role="region" aria-label={uiText("Terminal proposal")}>
        <div className="ua-inspector-terminal__header">
          <span>{uiText("Command Proposal")}</span>
          <span className="ua-inspector__badge">{uiText("MVP10")}</span>
        </div>
        <div className="ua-inspector-terminal__body">
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Status")}</label>
            <span className={`ua-inspector-terminal__status--${stage}`}>
              {isApproved ? uiText("Approved") : uiText("Pending approval")}
            </span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Proposal ID")}</label>
            <code className="ua-text-mono">{activeProposal.id}</code>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Command")}</label>
            <code>{activeProposal.command}</code>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Risk")}</label>
            <span className={riskClass}>
              {riskLabel} {"—"}{" "}{classification.reason}
            </span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Working directory")}</label>
            <code>{activeProposal.cwd}</code>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Expires")}</label>
            <span>{formatExpiry(activeProposal.expiresAt)}</span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Timeout")}</label>
            <span>{timeoutSeconds}{uiText("s")}</span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>{uiText("Output limit")}</label>
            <span>{Math.round(activeProposal.outputLimitBytes / 1024)} {uiText("KB /")}{" "}{activeProposal.outputLimitLines} {uiText("lines")}</span>
          </div>
          {token && (
            <div className="ua-inspector-terminal__field">
              <label>{uiText("Token")}</label>
              <span className="ua-inspector-terminal__token-status">
                {uiText("Issued &middot; expires in")}{" "}{formatExpiry(token.expiresAt)}
              </span>
            </div>
          )}
          {approvalError && (
            <div className="ua-inspector-terminal__field">
              <label>{uiText("Error")}</label>
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
                aria-label={approveDisabled ? uiText("Command not allowlisted") : uiText("Approve and execute command")}
              >
                {approveDisabled ? uiText("Blocked") : uiText("Approve & Execute")}
              </button>
              <button
                className="ua-btn ua-btn--secondary"
                type="button"
                onClick={handleReject}
                aria-label={uiText("Reject command proposal")}
              >
                {uiText("Reject")}{" "}</button>
            </>
          )}
          {isApproved && (
            <button className="ua-btn ua-btn--secondary" type="button" onClick={handleReset} aria-label={uiText("Reset terminal")}>
              {uiText("Reset")}{" "}</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ua-inspector-terminal ua-inspector-terminal--idle" role="region" aria-label={uiText("Terminal")}>
      <div className="ua-inspector-terminal__header">
        <span>{uiText("Terminal")}</span>
        <span className="ua-inspector__badge">{uiText("MVP10")}</span>
      </div>
      <p className="ua-inspector-terminal__empty">{uiText("No active proposal")}</p>
      <form onSubmit={handleSubmitInput}>
        <div className="ua-inspector-terminal__field">
          <label htmlFor="terminal-command-input">{uiText("Command")}</label>
          <input
            id="terminal-command-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={uiText("Enter a command...")}
          />
        </div>
        <div className="ua-inspector-terminal__actions">
          <button className="ua-btn ua-btn--primary" type="submit" aria-label={uiText("Propose command")}>
            {uiText("Propose")}{" "}</button>
        </div>
      </form>
      <div className="ua-inspector-terminal__quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={() => handlePropose(action)}
            aria-label={t("terminal.quickActionLabel",{action})}
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}
