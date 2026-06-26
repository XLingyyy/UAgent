import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { configPageData } from "../settings-page-data";
import { useRuntimeActions, useRuntimeStore } from "../../stores/ui-store";
import "../pages/SettingsPages.css";

export function ConfigSettings() {
  return (
    <SettingsPageLayout page={configPageData}>
      {configPageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.id === "mcp" && <McpConnectionDisplay />}
          {section.id === "approval" && <ApprovalDisplay />}
          {section.id === "sandbox" && <SandboxDisplay />}
          {section.id === "paths" && <ConfigPathDisplay />}
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
  return <span className="ua-settings-page__static-value">Always ask</span>;
}

function SandboxDisplay() {
  return (
    <div className="ua-settings-page__static-stack">
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

function ConfigPathDisplay() {
  return (
    <div className="ua-settings-page__path-display">
      <code className="ua-settings-page__path-text">~/uagent/config/profiles/default.json</code>
    </div>
  );
}

function DiagnosticsDisplay() {
  return (
    <div className="ua-settings-page__static-stack">
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

function ResetWorkspaceDisplay() {
  return (
    <button type="button" className="ua-settings-page__danger-btn" disabled aria-disabled="true">
      Reset all workspace data
    </button>
  );
}
