import { useState } from "react";
import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { configPageData } from "../settings-page-data";
import {
  runMvp15dUiBridgeAction,
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
      <CompanionPluginStatusDisplay />
      <Mvp15dProductControls />
      <Mvp15dNegativeAcceptanceControls />
      <div className="ua-settings-page__note">
        Connection and project-root changes apply to this local session only.
      </div>
    </SettingsPageLayout>
  );
}

function Mvp15dNegativeAcceptanceControls() {
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const uiGateEnabled = useRuntimeStore((state) => state.mvp15.gate.mode === "sandbox-enabled");
  const runNegative = async (caseId: number) => {
    if (busy) return;
    setBusy(true);
    setStatus(`running:N${caseId}`);
    try {
      await runMvp15dUiBridgeAction(`negativeN${caseId}` as Parameters<typeof runMvp15dUiBridgeAction>[0]);
      setStatus(`completed:N${caseId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "negative_control_failed");
    } finally {
      setBusy(false);
    }
  };
  const runChildRegistration = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("running:gate-off-child");
    try {
      const invoke = (globalThis as {
        __TAURI_INTERNALS__?: {
          invoke?: <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;
        };
      }).__TAURI_INTERNALS__?.invoke;
      if (!invoke) throw new Error("gate_off_child_native_bridge_unavailable");
      const result = await invoke<Record<string, unknown>>("mvp15d_gate_off_child_register", {
        uiGateEnabled,
      });
      if (
        result.uiGateEnabled !== true ||
        result.status !== "blocked" ||
        result.reason !== "feature_disabled" ||
        result.registrationCount !== 0 ||
        result.tokenCount !== 0 ||
        result.mcpMutationCount !== 0 ||
        result.manifestOwnershipCount !== 0 ||
        result.processResidualCount !== 0 ||
        result.portResidualCount !== 0 ||
        result.rootResidualCount !== 0
      ) {
        throw new Error("gate_off_child_registration_invalid");
      }
      setStatus("feature_disabled");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "gate_off_child_registration_failed");
    } finally {
      setBusy(false);
    }
  };
  const runPartialUnknown = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("running:partial-unknown");
    try {
      await runMvp15dUiBridgeAction("partialUnknownDiagnostic");
      setStatus("completed:partial-unknown");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "partial_unknown_control_failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ua-settings-page__static-stack" aria-label="MVP15D negative acceptance controls">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Rendered negative case</span>
        <span
          className="ua-settings-page__static-value"
          data-mvp15d-observation="negative-control-status"
          data-mvp15d-value={status}
        >
          {status}
        </span>
      </div>
      <div className="ua-settings-page__provider-actions">
        {Array.from({ length: 8 }, (_, index) => index + 1).map((caseNumber) => (
          <button
            key={caseNumber}
            id={`mvp15d-negative-n${caseNumber}`}
            className="ua-settings-page__action-btn"
            type="button"
            disabled={busy}
            onClick={() => void runNegative(caseNumber)}
          >
            {`Run N${caseNumber} rendered negative case`}
          </button>
        ))}
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={busy}
          onClick={() => void runPartialUnknown()}
        >
          Run rendered partial and unknown matrix
        </button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={busy}
          onClick={() => void runChildRegistration()}
        >
          Attempt N2 gate-off approval registration
        </button>
      </div>
    </section>
  );
}

function CompanionPluginStatusDisplay() {
  const companion = useRuntimeStore((state) => state.mvp15.companion);
  const mcpStatus = useRuntimeStore((state) => state.mcp.status);
  const editorSession = useRuntimeStore((state) => state.mvp14.session);
  const { refreshMvp15DCompanionAttestation } = useRuntimeActions();
  const labels = {
    not_installed: "Not installed",
    installed_unverified: "Installed unverified",
    verified: "Verified",
    incompatible: "Incompatible",
    update_required: "Update required",
  } as const;
  return (
    <section className="ua-settings-page__static-stack" aria-label="UAgent UE Companion Plugin">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">UAgent UE Companion Plugin</span>
        <span className="ua-settings-page__static-value" data-mvp15d-observation="companion-status">
          {labels[companion.status]}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Plugin / contract</span>
        <span className="ua-settings-page__static-value">
          {companion.pluginVersion ?? "unverified"} / {companion.contractVersion ?? "unverified"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Manifest SHA</span>
        <span className="ua-settings-page__static-value">
          {companion.manifestSha256Prefix ? `${companion.manifestSha256Prefix}…` : "unverified"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Live fingerprint</span>
        <span className="ua-settings-page__static-value" data-mvp15d-observation="companion-fingerprint">
          {companion.liveFingerprintSha256Prefix ? `${companion.liveFingerprintSha256Prefix}…` : "unverified"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Generation / tools</span>
        <span className="ua-settings-page__static-value" data-mvp15d-observation="companion-tools">
          {companion.currentGeneration} / {companion.toolCount} ({companion.perToolSummaryCount} summaries)
        </span>
      </div>
      {companion.blocker && (
        <p className="ua-settings-page__provider-help-text" role="status">
          {companion.blocker}: {companion.reason}
        </p>
      )}
      <div className="ua-settings-page__provider-actions">
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={mcpStatus !== "connected" || editorSession?.mode !== "attached"}
          onClick={() => void refreshMvp15DCompanionAttestation()}
        >
          Verify companion identity
        </button>
      </div>
    </section>
  );
}

function ProjectRootsDisplay() {
  const [projectRootDraft, setProjectRootDraft] = useState("");
  const [validatedRootRef, setValidatedRootRef] = useState<string | null>(null);
  const [addedProjectId, setAddedProjectId] = useState<string | null>(null);
  const project = useProjectStore((state) => state);
  const {
    validateProjectRoot,
    addProjectRoot,
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
    const rootRef = projectRootDraft.trim();
    const valid = await validateProjectRoot(rootRef);
    setValidatedRootRef(valid ? rootRef : null);
    setAddedProjectId(null);
    setProjectRootDraft("");
  };
  const handleAddProjectRoot = async () => {
    if (!validatedRootRef) return;
    const projectId = await addProjectRoot(validatedRootRef);
    if (projectId) setAddedProjectId(projectId);
  };
  const isValidated = Boolean(project.validation?.ok && validatedRootRef);
  const isAdded = Boolean(addedProjectId && activeProject?.id === addedProjectId);

  return (
    <div className="ua-settings-page__static-stack" aria-label="Project roots and index">
      <label className="ua-settings-page__field">
        <span className="ua-settings-page__field-label">Project root reference</span>
        <input
          className="ua-settings-page__input"
          value={projectRootDraft}
          onChange={(event) => {
            setProjectRootDraft(event.target.value);
            setValidatedRootRef(null);
            setAddedProjectId(null);
          }}
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
          disabled={!isValidated || isAdded}
          onClick={() => void handleAddProjectRoot()}
        >
          Add project root
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
          <span
            className="ua-settings-page__provider-summary-value"
            data-mvp15d-observation="project-validation"
            data-mvp15d-value={isValidated ? "valid" : "not_validated"}
          >
            {project.validation?.ok
              ? `Validation ready: ${project.validation.projectName}`
              : project.validation?.reason ?? "Not validated"}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Registration</span>
          <span
            className="ua-settings-page__provider-summary-value"
            data-mvp15d-observation="project-add"
            data-mvp15d-value={isAdded ? "added" : "not_added"}
          >
            {isAdded ? "added" : "not added"}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Trust</span>
          <span
            className="ua-settings-page__provider-summary-value"
            data-mvp15d-observation="project-trust"
            data-mvp15d-value={activeProject?.trustState ?? "untrusted"}
          >
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

type ProductControlAction =
  | "productDiscoveryOn"
  | "productDiscoveryOff"
  | "productRetractionReconnect"
  | "productRetractionEndpointChange"
  | "productRetractionRefreshTools"
  | "productRetractionUeRestart"
  | "productRetractionRendererRestart"
  | "productRetractionStaleCompletion"
  | "productAuthoritySuccessor";

function Mvp15dProductControls() {
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [toolSearchMode, setToolSearchMode] = useState<"on" | "off">("off");

  const runControl = async (
    action: ProductControlAction,
    completedStatus: string,
    context?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setStatus(`running:${completedStatus}`);
    try {
      await runMvp15dUiBridgeAction(action, context);
      if (action === "productDiscoveryOn") setToolSearchMode("on");
      if (action === "productDiscoveryOff") setToolSearchMode("off");
      setStatus(completedStatus);
    } catch (error) {
      if (
        action === "productRetractionRendererRestart" &&
        error instanceof Error &&
        error.message === "mvp15d_renderer_restart_handoff_requested"
      ) {
        setStatus("renderer_restart_requested");
      } else {
        setStatus(error instanceof Error ? error.message : "product_control_failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ua-settings-page__static-stack" aria-label="MVP15D product controls">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Tool Search</span>
        <span
          className="ua-settings-page__static-value"
          data-mvp15d-observation="tool-search-mode"
          data-mvp15d-value={toolSearchMode}
        >
          {toolSearchMode.toUpperCase()}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Acceptance control</span>
        <span
          className="ua-settings-page__static-value"
          data-mvp15d-observation="product-control-status"
          data-mvp15d-value={status}
        >
          {status}
        </span>
      </div>
      <div className="ua-settings-page__provider-actions">
        <button
          className="ua-settings-page__action-btn"
          type="button"
          aria-pressed={toolSearchMode === "on"}
          disabled={busy}
          onClick={() => void runControl("productDiscoveryOn", "tool_search_on")}
        >
          Tool Search ON
        </button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          aria-pressed={toolSearchMode === "off"}
          disabled={busy}
          onClick={() => void runControl("productDiscoveryOff", "tool_search_off")}
        >
          Tool Search OFF
        </button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionReconnect", "mcp_reconnected")}>
          MCP reconnect
        </button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionEndpointChange", "endpoint_changed")}>
          Change MCP endpoint
        </button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionRefreshTools", "tools_refreshed")}>
          RefreshTools
        </button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionUeRestart", "ue_restart_retracted")}>
          Retract after UE restart
        </button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionStaleCompletion", "stale_completion_retracted")}>
          Reject stale completion
        </button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionRendererRestart", "renderer_restart_completed")}>
          Restart renderer
        </button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={busy}
          onClick={(event) =>
            void runControl(
              "productAuthoritySuccessor",
              "renderer_restart_resumed",
              event.currentTarget.dataset.mvp15dContext,
            )
          }
        >
          Resume renderer restart
        </button>
      </div>
    </section>
  );
}

function McpConnectionDisplay() {
  const mcp = useRuntimeStore((state) => state.mcp);
  const { setMcpEndpoint, connectMcp, discoverMcp, disconnectMcp } = useRuntimeActions();
  const endpoint = mcp.profile?.endpoint ?? "";
  const isBusy = mcp.status === "connecting" || mcp.status === "discovering";
  const isConnected = mcp.status === "connected";

  return (
    <div className="ua-settings-page__mcp" aria-label="MCP connection">
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
          <span className="ua-settings-page__provider-summary-value" data-mvp15d-observation="mcp-status">{mcp.status}</span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">Protocol</span>
          <span
            className="ua-settings-page__provider-summary-value"
            data-mvp15d-observation="mcp-protocol"
            data-mvp15d-value={mcp.protocolVersion ?? "Not initialized"}
          >
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
  const gate = useRuntimeStore((state) => state.mvp15.gate);
  const enabled = gate.mode === "sandbox-enabled";
  return (
    <div className="ua-settings-page__static-stack" aria-label="Sandbox mode controls">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Mode</span>
        <span className="ua-settings-page__static-value">
          {enabled ? "Task sandbox enabled" : "Read-only / fixture"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">File system</span>
        <span className="ua-settings-page__static-value">
          {enabled ? "Trusted project + fixed run root" : "Read-only"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Commands</span>
        <span className="ua-settings-page__static-value">
          {enabled ? "Allowlisted with approval" : "Blocked"}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Network</span>
        <span className="ua-settings-page__static-value">
          {enabled ? "Loopback MCP only" : "Disabled"}
        </span>
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
