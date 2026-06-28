import { useState, useCallback } from "react";
import { useRuntimeStore, useRuntimeActions } from "../stores/ui-store";

const QUICK_ACTIONS = ["pnpm typecheck", "pnpm lint", "pnpm test"] as const;
const FIXTURE_CWD = "/repo";

function getRiskClass(risk: string): string {
  if (risk === "allowlisted") return "ua-inspector-terminal__risk--low";
  if (risk === "unknown") return "ua-inspector-terminal__risk--medium";
  return "ua-inspector-terminal__risk--high";
}

function getRiskLabel(risk: string): string {
  const labels: Record<string, string> = {
    allowlisted: "allowlisted",
    unknown: "unknown",
    denied_combination: "Blocked",
    dangerous_command: "Blocked",
    shell_metachar: "Blocked",
    root_escape: "Blocked",
    network_hint: "Blocked",
  };
  return labels[risk] ?? "Blocked";
}

export function TerminalPanel() {
  const terminalState = useRuntimeStore((s) => s.mvp9.terminal);
  const {
    proposeTerminalCommand,
    approveTerminalProposal,
    rejectTerminalProposal,
    cancelTerminalExecution,
    resetTerminal,
  } = useRuntimeActions();
  const [input, setInput] = useState("");

  const { stage, activeProposal, executionResult, approvalState } = terminalState;

  const handlePropose = useCallback((cmd: string) => {
    proposeTerminalCommand(cmd, FIXTURE_CWD, null);
  }, [proposeTerminalCommand]);

  const handleApprove = useCallback(() => {
    if (!activeProposal) return;
    void approveTerminalProposal(activeProposal.id, "user", "Approved via TerminalPanel");
  }, [activeProposal, approveTerminalProposal]);

  const handleReject = useCallback(() => {
    if (!activeProposal) return;
    rejectTerminalProposal(activeProposal.id, "user", "Rejected by user");
  }, [activeProposal, rejectTerminalProposal]);

  const handleCancel = useCallback(() => {
    if (executionResult) {
      cancelTerminalExecution(executionResult.id);
    }
    resetTerminal();
    setInput("");
  }, [executionResult, cancelTerminalExecution, resetTerminal]);

  const handleReset = useCallback(() => {
    resetTerminal();
    setInput("");
  }, [resetTerminal]);

  const handleSubmitInput = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim()) handlePropose(input.trim());
    },
    [input, handlePropose],
  );

  if (stage === "rejected") {
    return (
      <div className="ua-inspector-terminal" role="region" aria-label="Terminal proposal rejected">
        <div className="ua-inspector-terminal__header">
          <span>Terminal</span>
          <span className="ua-inspector__badge">MVP9</span>
        </div>
        <div className="ua-inspector-terminal__proposal">
          <div className="ua-inspector-terminal__field">
            <label>Status</label>
            <span>Rejected</span>
          </div>
          {approvalState?.reason && (
            <div className="ua-inspector-terminal__field">
              <label>Reason</label>
              <span>{approvalState.reason}</span>
            </div>
          )}
        </div>
        <div className="ua-inspector-terminal__actions">
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label="Reset terminal"
          >
            Reset
          </button>
        </div>
      </div>
    );
  }

  if (stage === "executing" || stage === "completed" || stage === "failed") {
    const isRunning = stage === "executing";
    const chunks = executionResult?.chunks ?? [];
    return (
      <div className="ua-inspector-terminal" role="region" aria-label="Terminal execution">
        <div className="ua-inspector-terminal__header">
          <span>Terminal</span>
          <span className="ua-inspector__badge">MVP9</span>
        </div>
        <div className="ua-inspector-terminal__proposal">
          <div className="ua-inspector-terminal__field">
            <label>Status</label>
            <span>{isRunning ? "Running..." : stage === "completed" ? "Completed" : "Failed"}</span>
          </div>
          {activeProposal && (
            <div className="ua-inspector-terminal__field">
              <label>Command</label>
              <code>{activeProposal.command}</code>
            </div>
          )}
          {executionResult?.exitState && !isRunning && (
            <div className="ua-inspector-terminal__field">
              <label>Exit code</label>
              <span>{executionResult.exitState.code}</span>
            </div>
          )}
          {executionResult?.redactionSummary && !isRunning && (
            <div className="ua-inspector-terminal__field">
              <label>Redactions</label>
              <span>
                {executionResult.redactionSummary.replacedSecrets} secrets,{" "}
                {executionResult.redactionSummary.replacedPaths} paths
              </span>
            </div>
          )}
        </div>
        {chunks.length > 0 && (
          <div className="ua-inspector-terminal__output">
            {chunks.map((chunk) => (
              <div
                key={chunk.index}
                className="ua-inspector-terminal__output-line"
                data-stream={chunk.stream}
              >
                <span className="ua-inspector-terminal__output-stream">
                  [{chunk.stream}]
                </span>
                <span>{chunk.text}</span>
              </div>
            ))}
          </div>
        )}
        <div className="ua-inspector-terminal__actions">
          {isRunning ? (
            <button
              className="ua-btn ua-btn--danger"
              type="button"
              onClick={handleCancel}
              aria-label="Cancel execution"
            >
              Cancel
            </button>
          ) : (
            <button
              className="ua-btn ua-btn--secondary"
              type="button"
              onClick={handleReset}
              aria-label="Clear terminal"
            >
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
    const timeoutSeconds = Math.round(activeProposal.timeoutMs / 1000);
    const approveDisabled = (classification.risk !== "allowlisted" && classification.risk !== "unknown");
    return (
      <div className="ua-inspector-terminal" role="region" aria-label="Terminal proposal">
        <div className="ua-inspector-terminal__header">
          <span>Command Proposal</span>
          <span className="ua-inspector__badge">MVP9</span>
        </div>
        <div className="ua-inspector-terminal__proposal">
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
            <code>[project-root]</code>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Timeout</label>
            <span>{timeoutSeconds}s</span>
          </div>
          <div className="ua-inspector-terminal__field">
            <label>Output limit</label>
            <span>
              {Math.round(activeProposal.outputLimitBytes / 1024)} KB /{" "}
              {activeProposal.outputLimitLines} lines
            </span>
          </div>
        </div>
        <div className="ua-inspector-terminal__actions">
          <button
            className="ua-btn ua-btn--primary"
            type="button"
            disabled={approveDisabled}
            onClick={handleApprove}
            aria-label="Approve and execute command"
          >
            Approve &amp; Execute
          </button>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReject}
            aria-label="Reject command proposal"
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="ua-inspector-terminal ua-inspector-terminal--idle"
      role="region"
      aria-label="Terminal"
    >
      <div className="ua-inspector-terminal__header">
        <span>Terminal</span>
        <span className="ua-inspector__badge">MVP9</span>
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
          <button
            className="ua-btn ua-btn--primary"
            type="submit"
            aria-label="Propose command"
          >
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
