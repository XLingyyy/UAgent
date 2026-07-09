import { useState } from "react";
import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { configPageData } from "../settings-page-data";
import {
  useProjectActions,
  useProjectStore,
  useRuntimeActions,
  useRuntimeStore,
} from "../../stores/ui-store";
import "../pages/SettingsPages.css";

export function ConfigSettings() {
  return (
    <SettingsPageLayout page={configPageData}>
      {configPageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.id === "mcp" && <McpConnectionDisplay />}
          {section.id === "approval" && <ApprovalDisplay />}
          {section.id === "sandbox" && <SandboxDisplay />}
          {section.id === "audit-session" && <AuditSessionDisplay />}
          {section.id === "paths" && <ConfigPathDisplay />}
          {section.id === "paths" && <ProjectRootsDisplay />}
          {section.id === "terminal-execution" && <TerminalExecutionDisplay />}
          {section.id === "diagnostics" && <DiagnosticsDisplay />}
          {section.id === "danger-zone" && <ResetWorkspaceDisplay />}
        </SettingsSection>
      ))}
      <div className="ua-settings-page__note">
        This is a UI-only mock. No configuration is saved or applied.
      </div>
    </SettingsPageLayout>
  );
}

function ProjectRootsDisplay() {
  const [projectRootDraft, setProjectRootDraft] = useState("");
  const project = useProjectStore((state) => state);
  const {
    validateProjectRoot,
    trustProjectRoot,
    scanProjectIndex,
    cancelProjectScan,
    refreshCapabilityStatus,
  } = useProjectActions();
  const activeProject =
    project.registeredProjects.find((item) => item.id === project.activeProjectId) ??
    project.registeredProjects[0] ??
    null;
  const canTrust = Boolean(activeProject && activeProject.trustState !== "trusted");
  const canScan = Boolean(activeProject && activeProject.trustState === "trusted");
  const handleValidateProjectRoot = async () => {
    await validateProjectRoot(projectRootDraft);
    setProjectRootDraft("");
  };

  return (
    <div className="ua-settings-page__static-stack" aria-label="Project roots and index">
      <label className="ua-settings-page__field">
        <span className="ua-settings-page__field-label">Project root reference</span>
        <input
          className="ua-settings-page__input"
          value={projectRootDraft}
          onChange={(event) => setProjectRootDraft(event.target.value)}
          placeholder="fixture://lyra"
          aria-label="Project root reference"
        />
      </label>
      <div className="ua-settings-page__provider-actions">
        <button
          className="ua-settings-page__action-btn ua-settings-page__action-btn--primary"
          type="button"
          onClick={() => void handleValidateProjectRoot()}
        >
          Validate project root
        </button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!canTrust}
          onClick={() => activeProject && trustProjectRoot(activeProject.id)}
        >
          Trust project root
        </button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!canScan || project.scanStatus === "scanning"}
          onClick={() => activeProject && scanProjectIndex(activeProject.id)}
        >
          Scan project index
        </button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!activeProject || project.scanStatus !== "scanning"}
          onClick={() => activeProject && cancelProjectScan(activeProject.id)}
        >
          Cancel scan
        </button>
      </div>
      <div className="ua-settings-page__provider-summary" role="status">
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Validation</span>
          <span className="ua-settings-page__provider-summary-value">
            {project.validation?.ok
              ? `Validation ready: ${project.validation.projectName}`
              : project.validation?.reason ?? "Not validated"}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Trust</span>
          <span className="ua-settings-page__provider-summary-value">
            {activeProject?.trustState ?? "untrusted"}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Index</span>
          <span className="ua-settings-page__provider-summary-value">
            {project.activeProjectIndex ? "Index ready" : project.scanStatus}
          </span>
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Root display</span>
        <span className="ua-settings-page__static-value">
          {activeProject?.displayRoot ?? "No project root registered"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Index policy</span>
        <span className="ua-settings-page__static-value">
          Read-only · ignored dirs: .git, Intermediate, Saved, DerivedDataCache, Binaries, node_modules, .vs
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Source</span>
        <span className="ua-settings-page__static-value">{project.nativeSource}</span>
      </div>
      <div className="ua-settings-page__provider-actions">
        <button
          className="ua-settings-page__action-btn"
          type="button"
          onClick={refreshCapabilityStatus}
        >
          Refresh capability status
        </button>
      </div>
      {project.capabilityStatus.length > 0 && (
        <div className="ua-settings-page__provider-summary" aria-label="Capability status">
          {project.capabilityStatus.map((cap) => (
            <span key={cap.kind} className="ua-settings-page__provider-summary-item">
              <span className="ua-settings-page__provider-summary-label">{cap.kind}</span>
              <span className="ua-settings-page__provider-summary-value">
                {cap.mode} · {cap.status}
              </span>
            </span>
          ))}
        </div>
      )}
      {project.fsPolicy && (
        <div className="ua-settings-page__static-stack" aria-label="Filesystem policy">
          <div className="ua-settings-page__static-row">
            <span className="ua-settings-page__static-label">Ignored dirs</span>
            <span className="ua-settings-page__static-value">
              {project.fsPolicy.ignoredDirs.join(", ")}
            </span>
          </div>
          <div className="ua-settings-page__static-row">
            <span className="ua-settings-page__static-label">Max depth</span>
            <span className="ua-settings-page__static-value">{project.fsPolicy.maxDepth}</span>
          </div>
          <div className="ua-settings-page__static-row">
            <span className="ua-settings-page__static-label">Max nodes</span>
            <span className="ua-settings-page__static-value">{project.fsPolicy.maxNodes}</span>
          </div>
          <div className="ua-settings-page__static-row">
            <span className="ua-settings-page__static-label">Redaction</span>
            <span className="ua-settings-page__static-value">{project.fsPolicy.redactionLevel}</span>
          </div>
        </div>
      )}
      {project.lastError && (
        <p className="ua-settings-page__provider-help-text">{project.lastError}</p>
      )}
    </div>
  );
}

function McpConnectionDisplay() {
  const mcp = useRuntimeStore((state) => state.mcp);
  const { setMcpEndpoint, connectMcp, discoverMcp, disconnectMcp } = useRuntimeActions();
  const endpoint = mcp.profile?.endpoint ?? "";
  const isBusy = mcp.status === "connecting" || mcp.status === "discovering";
  const isConnected = mcp.status === "connected";

  return (
    <div className="ua-settings-page__mcp">
      <label className="ua-settings-page__field">
        <span className="ua-settings-page__field-label">Endpoint</span>
        <input
          className="ua-settings-page__input"
          value={endpoint}
          onChange={(event) => setMcpEndpoint(event.target.value)}
          placeholder="http://127.0.0.1:8765/mcp"
          aria-label="MCP endpoint URL"
        />
      </label>
      <div className="ua-settings-page__provider-summary">
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Status</span>
          <span className="ua-settings-page__provider-summary-value">{mcp.status}</span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Protocol</span>
          <span className="ua-settings-page__provider-summary-value">
            {mcp.protocolVersion ?? "Not initialized"}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Server</span>
          <span className="ua-settings-page__provider-summary-value">
            {mcp.serverInfo?.name ?? "Not connected"}
          </span>
        </span>
      </div>
      {mcp.capabilities && (
        <div className="ua-settings-page__provider-summary" aria-label="MCP discovery counts">
          <span className="ua-settings-page__provider-summary-item">
            <span className="ua-settings-page__provider-summary-label">Tools</span>
            <span className="ua-settings-page__provider-summary-value">{mcp.capabilities.tools}</span>
          </span>
          <span className="ua-settings-page__provider-summary-item">
            <span className="ua-settings-page__provider-summary-label">Resources</span>
            <span className="ua-settings-page__provider-summary-value">
              {mcp.capabilities.resources}
            </span>
          </span>
          <span className="ua-settings-page__provider-summary-item">
            <span className="ua-settings-page__provider-summary-label">Prompts</span>
            <span className="ua-settings-page__provider-summary-value">{mcp.capabilities.prompts}</span>
          </span>
          <span className="ua-settings-page__provider-summary-item">
            <span className="ua-settings-page__provider-summary-label">Blocked</span>
            <span className="ua-settings-page__provider-summary-value">
              {mcp.capabilities.blockedTools}
            </span>
          </span>
        </div>
      )}
      {mcp.lastError && <p className="ua-settings-page__provider-help-text">{mcp.lastError}</p>}
      <div className="ua-settings-page__provider-actions">
        <button
          className="ua-settings-page__action-btn ua-settings-page__action-btn--primary"
          type="button"
          disabled={isBusy || isConnected}
          onClick={() => void connectMcp()}
        >
          Connect
        </button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!isConnected || isBusy}
          onClick={() => void discoverMcp()}
        >
          Discover
        </button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!isConnected}
          onClick={disconnectMcp}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function ApprovalDisplay() {
  return (
    <div className="ua-settings-page__static-stack" aria-label="Approval safety controls">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Default policy</span>
        <span className="ua-settings-page__static-value">Request approval</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Read-only</span>
        <span className="ua-settings-page__static-value">Allow</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Medium/high write</span>
        <span className="ua-settings-page__static-value">Pause for approval</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Destructive</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--staged">Blocked</span>
      </div>
    </div>
  );
}

function SandboxDisplay() {
  return (
    <div className="ua-settings-page__static-stack" aria-label="Sandbox mode controls">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Mode</span>
        <span className="ua-settings-page__static-value">Fixture only</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">File system</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--staged">Staged · not yet enabled</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Commands</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--staged">Staged · not yet enabled</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Network</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--staged">Staged · not yet enabled</span>
      </div>
    </div>
  );
}

function AuditSessionDisplay() {
  return (
    <div className="ua-settings-page__static-stack" aria-label="Audit and session controls">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Audit log</span>
        <span className="ua-settings-page__static-value">Append-only projection</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Retention</span>
        <span className="ua-settings-page__static-value">Local session history</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Replay</span>
        <span className="ua-settings-page__static-value">Redacted events only</span>
      </div>
    </div>
  );
}

function ConfigPathDisplay() {
  return (
    <div className="ua-settings-page__path-display">
      <code className="ua-settings-page__path-text">~/uagent/config/profiles/default.json</code>
    </div>
  );
}

function DiagnosticsDisplay() {
  const mvp11 = useRuntimeStore((state) => state.mvp11);
  const mvp12 = useRuntimeStore((state) => state.mvp12);
  const mvp14 = useRuntimeStore((state) => state.mvp14);
  const mvp15 = useRuntimeStore((state) => state.mvp15);
  const mcp = useRuntimeStore((state) => state.mcp);
  const diagnosticCounts = `${mvp11.diagnosticCounts.error} ${
    mvp11.diagnosticCounts.error === 1 ? "error" : "errors"
  } / ${mvp11.diagnosticCounts.warning} ${
    mvp11.diagnosticCounts.warning === 1 ? "warning" : "warnings"
  }`;

  return (
    <div className="ua-settings-page__static-stack">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Diagnostic Engine</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--success">
          {mvp11.metadataStatus === "failed" || mvp11.contextPackStatus === "failed"
            ? "Attention"
            : "Enabled"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Mode</span>
        <span className="ua-settings-page__static-value">Read-only diagnostics + controlled text mutation</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Text Mutation</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--accent">
          {mvp12.capability.mode} / approval {mvp12.capability.approvalRequired ? "required" : "not required"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Allowed extensions</span>
        <span className="ua-settings-page__static-value">{mvp12.capability.allowedExtensions.join(", ")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Blocked dirs</span>
        <span className="ua-settings-page__static-value">{mvp12.capability.blockedDirectories.join(", ")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">MVP11 status</span>
        <span className="ua-settings-page__static-value">{mvp11.metadataStatus}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">MVP11 counts</span>
        <span className="ua-settings-page__static-value">{diagnosticCounts}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Provider</span>
        <span className="ua-settings-page__static-value">Provider live off</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">MCP</span>
        <span className="ua-settings-page__static-value">
          {mcp.capabilities
            ? `${mcp.status} / ${mcp.capabilities.readOnlyTools} read-only / ${mcp.capabilities.blockedTools} blocked`
            : `${mcp.status} / MCP read-only`}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">UE Editor Observation</span>
        <span className="ua-settings-page__static-value">
          {mvp14.capability.enabled ? mvp14.capability.mode : "disabled"} / launch gate separate / trusted root required
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Editor safety</span>
        <span className="ua-settings-page__static-value">{mvp14.safetyBoundaries.join(", ")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Asset mutation gate</span>
        <span className="ua-settings-page__static-value">
          {mvp15.gate.mode} / {mvp15.gate.sandboxRoot}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Log level</span>
        <span className="ua-settings-page__static-value">Info</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Enabled probes</span>
        <span className="ua-settings-page__static-value">Runtime, Verifier</span>
      </div>
    </div>
  );
}

function TerminalExecutionDisplay() {
  const runtimeStore = useRuntimeStore((state) => state);
  const projectStore = useProjectStore((state) => state);

  const mvp10Terminal = runtimeStore.mvp9.mvp10?.terminal;
  const hasProposals = mvp10Terminal && mvp10Terminal.proposals.length > 0;
  const latestStage = mvp10Terminal?.stage ?? "idle";
  const trustedRoot = projectStore.registeredProjects.find((p) => p.id === projectStore.activeProjectId)?.displayRoot;
  const capability = mvp10Terminal?.capability;
  const currentMode: { mode: string; tone: string } = {
    mode: capability?.enabled ? "real-enabled" : "fixture",
    tone: capability?.enabled ? "success" : "",
  };

  return (
    <div className="ua-settings-page__static-stack" aria-label="MVP10 Terminal Execution status">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Real terminal</span>
        <span className={`ua-settings-page__static-value${currentMode.tone ? ` ua-settings-page__static-value--${currentMode.tone}` : ""}`}>
          {capability?.enabled ? "Enabled" : "Disabled"} &middot; {capability?.reason ?? capability?.mode ?? "native"} &middot; {latestStage}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Allowlist</span>
        <span className="ua-settings-page__static-value">
          {capability?.allowlistSummary ?? "MVP10 verification commands only"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Trusted root</span>
        <span className="ua-settings-page__static-value">
          {trustedRoot ?? "Not configured"} &middot; {capability?.trustedRootRequired ? "required for execution" : "not required"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Approval</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--accent">
          {capability?.approvalRequired ? "Required" : "Not required"} &middot; one-time token
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Timeout</span>
        <span className="ua-settings-page__static-value">Default {Math.round((capability?.timeoutMs ?? 60_000) / 1000)}s &middot; max 300s</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Output limit</span>
        <span className="ua-settings-page__static-value">
          {Math.round((capability?.outputLimitBytes ?? 1_048_576) / 1024 / 1024)} MB / {capability?.outputLimitLines ?? 5000} lines
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Current mode</span>
        <span className="ua-settings-page__static-value">
          {currentMode.mode === "fixture" ? "Fixture mode — proposals only, no execution" :
           currentMode.mode === "real-gated" ? "Real-gated — approved, awaiting execution" :
           "Real-enabled — execution active"}
        </span>
      </div>
      {hasProposals && (
        <div className="ua-settings-page__static-row">
          <span className="ua-settings-page__static-label">Recent proposals</span>
          <span className="ua-settings-page__static-value">{mvp10Terminal!.proposals.length} total</span>
        </div>
      )}
    </div>
  );
}

function ResetWorkspaceDisplay() {
  return (
    <button type="button" className="ua-settings-page__danger-btn" disabled aria-disabled="true">
      Reset all workspace data
    </button>
  );
}
