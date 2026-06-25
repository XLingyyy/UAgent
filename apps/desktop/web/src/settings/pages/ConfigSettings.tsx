import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { configPageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

export function ConfigSettings() {
  return (
    <SettingsPageLayout page={configPageData}>
      {configPageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
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

function ApprovalDisplay() {
  return <span className="ua-settings-page__static-value">Always ask</span>;
}

function SandboxDisplay() {
  return (
    <div className="ua-settings-page__static-stack">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">File system</span>
        <span className="ua-settings-page__static-value">Read / Write</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Commands</span>
        <span className="ua-settings-page__static-value">Approved only</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Network</span>
        <span className="ua-settings-page__static-value">Allowed</span>
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
