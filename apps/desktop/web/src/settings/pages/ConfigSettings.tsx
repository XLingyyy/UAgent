import {useI18n} from "../../i18n";
import { LocalWorkspacePanel } from "./LocalWorkspacePanel";
import { ACCEPTANCE_ENABLED } from "../../runtime/build-capabilities";
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
  const {text: uiText} = useI18n();
  return (
    <SettingsPageLayout page={configPageData}>
      <LocalWorkspacePanel />
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
      {ACCEPTANCE_ENABLED && <Mvp15dProductControls />}
      {ACCEPTANCE_ENABLED && <Mvp15dNegativeAcceptanceControls />}
      <div className="ua-settings-page__note">
        {uiText("Use Save local configuration to retain project roots and selection. MCP sessions, trust, approval tokens and credentials are never restored automatically.")}{" "}</div>
    </SettingsPageLayout>
  );
}

function Mvp15dNegativeAcceptanceControls() {
  const {text: uiText,t} = useI18n();
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
    let lastPartialStep = "action_dispatched";
    setBusy(true);
    setStatus("running:partial-unknown");
    try {
      setStatus("running:partial-unknown:action_dispatched");
      await runMvp15dUiBridgeAction("partialUnknownDiagnostic", undefined, (step) => {
        lastPartialStep = step;
        setStatus(`running:partial-unknown:${step}`);
      });
      setStatus("completed:partial-unknown");
    } catch (error) {
      const errorRecord = error && typeof error === "object"
        ? error as Record<string, unknown>
        : null;
      const nestedStrings = errorRecord
        ? Object.values(errorRecord).flatMap((value) =>
            value && typeof value === "object"
              ? Object.values(value as Record<string, unknown>)
              : [value],
          )
        : [];
      const diagnosticCandidates = [
        error instanceof Error ? error.message : null,
        typeof error === "string" ? error : null,
        errorRecord?.code,
        errorRecord?.message,
        errorRecord?.error,
        ...nestedStrings,
        error == null ? null : String(error),
      ].filter((candidate): candidate is string => typeof candidate === "string");
      const reasonCode = diagnosticCandidates
        .map(
          (candidate) =>
            /(?:^|[^A-Za-z0-9_])(mvp15d_[a-z0-9_]+|MVP15D_[A-Z0-9_]+)(?:$|[^A-Za-z0-9_])/
              .exec(candidate)?.[1] ?? "",
        )
        .find((candidate) => candidate.length > 0 && candidate.length <= 128);
      if (reasonCode) {
        setStatus(reasonCode);
      } else {
        const diagnosticText = diagnosticCandidates.find(
          (candidate) => candidate.length > 0 && candidate !== "[object Object]",
        ) ?? JSON.stringify(error) ?? Object.prototype.toString.call(error);
        const digest = await globalThis.crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(diagnosticText),
        );
        const shortHash = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("");
        setStatus(`mvp15d_partial_unknown_control_error_at_${lastPartialStep}_${shortHash}`);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ua-settings-page__static-stack" aria-label={uiText("MVP15D negative acceptance controls")}>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Rendered negative case")}</span>
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
            {t("config.runNegativeCaseLabel",{number:caseNumber})}
          </button>
        ))}
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={busy}
          onClick={() => void runPartialUnknown()}
        >
          {uiText("Run rendered partial and unknown matrix")}{" "}</button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={busy}
          onClick={() => void runChildRegistration()}
        >
          {uiText("Attempt N2 gate-off approval registration")}{" "}</button>
      </div>
    </section>
  );
}

function CompanionPluginStatusDisplay() {
  const {text: uiText} = useI18n();
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
    <section className="ua-settings-page__static-stack" aria-label={uiText("UAgent UE Companion Plugin")}>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("UAgent UE Companion Plugin")}</span>
        <span className="ua-settings-page__static-value" data-mvp15d-observation="companion-status">
          {uiText(labels[companion.status])}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Plugin / contract")}</span>
        <span className="ua-settings-page__static-value">
          {companion.pluginVersion ?? uiText("unverified")} / {companion.contractVersion ?? uiText("unverified")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Manifest SHA")}</span>
        <span className="ua-settings-page__static-value">
          {companion.manifestSha256Prefix ? `${companion.manifestSha256Prefix}…` : uiText("unverified")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Live fingerprint")}</span>
        <span className="ua-settings-page__static-value" data-mvp15d-observation="companion-fingerprint">
          {companion.liveFingerprintSha256Prefix ? `${companion.liveFingerprintSha256Prefix}…` : uiText("unverified")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Generation / tools")}</span>
        <span className="ua-settings-page__static-value" data-mvp15d-observation="companion-tools">
          {companion.currentGeneration} / {companion.toolCount} ({companion.perToolSummaryCount} {uiText("summaries)")}{" "}</span>
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
          {uiText("Verify companion identity")}{" "}</button>
      </div>
    </section>
  );
}

function ProjectRootsDisplay() {
  const {text: uiText,t} = useI18n();
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
    <div className="ua-settings-page__static-stack" aria-label={uiText("Project roots and index")}>
      <label className="ua-settings-page__field">
        <span className="ua-settings-page__field-label">{uiText("Project root reference")}</span>
        <input
          className="ua-settings-page__input"
          value={projectRootDraft}
          onChange={(event) => {
            setProjectRootDraft(event.target.value);
            setValidatedRootRef(null);
            setAddedProjectId(null);
          }}
          placeholder={uiText("fixture://lyra")}
          aria-label={uiText("Project root reference")}
        />
      </label>
      <div className="ua-settings-page__provider-actions">
        <button
          className="ua-settings-page__action-btn ua-settings-page__action-btn--primary"
          type="button"
          onClick={() => void handleValidateProjectRoot()}
        >
          {uiText("Validate project root")}{" "}</button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!isValidated || isAdded}
          onClick={() => void handleAddProjectRoot()}
        >
          {uiText("Add project root")}{" "}</button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!canTrust}
          onClick={() => activeProject && trustProjectRoot(activeProject.id)}
        >
          {uiText("Trust project root")}{" "}</button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!canScan || project.scanStatus === "scanning"}
          onClick={() => activeProject && scanProjectIndex(activeProject.id)}
        >
          {uiText("Scan project index")}{" "}</button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!activeProject || project.scanStatus !== "scanning"}
          onClick={() => activeProject && cancelProjectScan(activeProject.id)}
        >
          {uiText("Cancel scan")}{" "}</button>
      </div>
      <div className="ua-settings-page__provider-summary" role="status">
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">{uiText("Validation")}</span>
          <span
            className="ua-settings-page__provider-summary-value"
            data-mvp15d-observation="project-validation"
            data-mvp15d-value={isValidated ? "valid" : "not_validated"}
          >
            {project.validation?.ok
              ? t("project.validationReady",{project:project.validation.projectName??uiText("Unknown")})
              : project.validation?.reason ?? uiText("Not validated")}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">{uiText("Registration")}</span>
          <span
            className="ua-settings-page__provider-summary-value"
            data-mvp15d-observation="project-add"
            data-mvp15d-value={isAdded ? "added" : "not_added"}
          >
            {isAdded ? uiText("added") : uiText("not added")}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">{uiText("Trust")}</span>
          <span
            className="ua-settings-page__provider-summary-value"
            data-mvp15d-observation="project-trust"
            data-mvp15d-value={activeProject?.trustState ?? "untrusted"}
          >
            {activeProject?.trustState ?? uiText("untrusted")}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">{uiText("Index")}</span>
          <span className="ua-settings-page__provider-summary-value">
            {project.activeProjectIndex ? uiText("Index ready") : project.scanStatus}
          </span>
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Root display")}</span>
        <span className="ua-settings-page__static-value">
          {activeProject?.displayRoot ?? uiText("No project root registered")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Index policy")}</span>
        <span className="ua-settings-page__static-value">
          {uiText("Read-only · ignored dirs: .git, Intermediate, Saved, DerivedDataCache, Binaries, node_modules, .vs")}{" "}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Source")}</span>
        <span className="ua-settings-page__static-value">{project.nativeSource}</span>
      </div>
      <div className="ua-settings-page__provider-actions">
        <button
          className="ua-settings-page__action-btn"
          type="button"
          onClick={refreshCapabilityStatus}
        >
          {uiText("Refresh capability status")}{" "}</button>
      </div>
      {project.capabilityStatus.length > 0 && (
        <div className="ua-settings-page__provider-summary" aria-label={uiText("Capability status")}>
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
        <div className="ua-settings-page__static-stack" aria-label={uiText("Filesystem policy")}>
          <div className="ua-settings-page__static-row">
            <span className="ua-settings-page__static-label">{uiText("Ignored dirs")}</span>
            <span className="ua-settings-page__static-value">
              {project.fsPolicy.ignoredDirs.join(", ")}
            </span>
          </div>
          <div className="ua-settings-page__static-row">
            <span className="ua-settings-page__static-label">{uiText("Max depth")}</span>
            <span className="ua-settings-page__static-value">{project.fsPolicy.maxDepth}</span>
          </div>
          <div className="ua-settings-page__static-row">
            <span className="ua-settings-page__static-label">{uiText("Max nodes")}</span>
            <span className="ua-settings-page__static-value">{project.fsPolicy.maxNodes}</span>
          </div>
          <div className="ua-settings-page__static-row">
            <span className="ua-settings-page__static-label">{uiText("Redaction")}</span>
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
  const {text: uiText} = useI18n();
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
    <section className="ua-settings-page__static-stack" aria-label={uiText("MVP15D product controls")}>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Tool Search")}</span>
        <span
          className="ua-settings-page__static-value"
          data-mvp15d-observation="tool-search-mode"
          data-mvp15d-value={toolSearchMode}
        >
          {toolSearchMode.toUpperCase()}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Acceptance control")}</span>
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
          {uiText("Tool Search ON")}{" "}</button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          aria-pressed={toolSearchMode === "off"}
          disabled={busy}
          onClick={() => void runControl("productDiscoveryOff", "tool_search_off")}
        >
          {uiText("Tool Search OFF")}{" "}</button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionReconnect", "mcp_reconnected")}>
          {uiText("MCP reconnect")}{" "}</button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionEndpointChange", "endpoint_changed")}>
          {uiText("Change MCP endpoint")}{" "}</button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionRefreshTools", "tools_refreshed")}>
          {uiText("RefreshTools")}{" "}</button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionUeRestart", "ue_restart_retracted")}>
          {uiText("Retract after UE restart")}{" "}</button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionStaleCompletion", "stale_completion_retracted")}>
          {uiText("Reject stale completion")}{" "}</button>
        <button className="ua-settings-page__action-btn" type="button" disabled={busy} onClick={() => void runControl("productRetractionRendererRestart", "renderer_restart_completed")}>
          {uiText("Restart renderer")}{" "}</button>
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
          {uiText("Resume renderer restart")}{" "}</button>
      </div>
    </section>
  );
}

function McpConnectionDisplay() {
  const {text: uiText} = useI18n();
  const mcp = useRuntimeStore((state) => state.mcp);
  const { setMcpEndpoint, connectMcp, discoverMcp, disconnectMcp } = useRuntimeActions();
  const endpoint = mcp.profile?.endpoint ?? "";
  const isBusy = mcp.status === "connecting" || mcp.status === "discovering";
  const isConnected = mcp.status === "connected";

  return (
    <div className="ua-settings-page__mcp" aria-label={uiText("MCP connection")}>
      <label className="ua-settings-page__field">
        <span className="ua-settings-page__field-label">{uiText("Endpoint")}</span>
        <input
          className="ua-settings-page__input"
          value={endpoint}
          onChange={(event) => setMcpEndpoint(event.target.value)}
          placeholder="http://127.0.0.1:8765/mcp"
          aria-label={uiText("MCP endpoint URL")}
        />
      </label>
      <div className="ua-settings-page__provider-summary">
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">{uiText("Status")}</span>
          <span className="ua-settings-page__provider-summary-value" data-mvp15d-observation="mcp-status">{mcp.status}</span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">{uiText("Protocol")}</span>
          <span
            className="ua-settings-page__provider-summary-value"
            data-mvp15d-observation="mcp-protocol"
            data-mvp15d-value={mcp.protocolVersion ?? "Not initialized"}
          >
            {mcp.protocolVersion ?? uiText("Not initialized")}
          </span>
        </span>
        <span className="ua-settings-page__provider-summary-item">
          <span className="ua-settings-page__provider-summary-label">{uiText("Server")}</span>
          <span className="ua-settings-page__provider-summary-value">
            {mcp.serverInfo?.name ?? uiText("Not connected")}
          </span>
        </span>
      </div>
      {mcp.capabilities && (
        <div className="ua-settings-page__provider-summary" aria-label={uiText("MCP discovery counts")}>
          <span className="ua-settings-page__provider-summary-item">
            <span className="ua-settings-page__provider-summary-label">{uiText("Tools")}</span>
            <span className="ua-settings-page__provider-summary-value">{mcp.capabilities.tools}</span>
          </span>
          <span className="ua-settings-page__provider-summary-item">
            <span className="ua-settings-page__provider-summary-label">{uiText("Resources")}</span>
            <span className="ua-settings-page__provider-summary-value">
              {mcp.capabilities.resources}
            </span>
          </span>
          <span className="ua-settings-page__provider-summary-item">
            <span className="ua-settings-page__provider-summary-label">{uiText("Prompts")}</span>
            <span className="ua-settings-page__provider-summary-value">{mcp.capabilities.prompts}</span>
          </span>
          <span className="ua-settings-page__provider-summary-item">
            <span className="ua-settings-page__provider-summary-label">{uiText("Blocked")}</span>
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
          {uiText("Connect")}{" "}</button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!isConnected || isBusy}
          onClick={() => void discoverMcp()}
        >
          {uiText("Discover")}{" "}</button>
        <button
          className="ua-settings-page__action-btn"
          type="button"
          disabled={!isConnected}
          onClick={disconnectMcp}
        >
          {uiText("Disconnect")}{" "}</button>
      </div>
    </div>
  );
}

function ApprovalDisplay() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__static-stack" aria-label={uiText("Approval safety controls")}>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Default policy")}</span>
        <span className="ua-settings-page__static-value">{uiText("Request approval")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Read-only")}</span>
        <span className="ua-settings-page__static-value">{uiText("Allow")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Medium/high write")}</span>
        <span className="ua-settings-page__static-value">{uiText("Pause for approval")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Destructive")}</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--staged">{uiText("Blocked")}</span>
      </div>
    </div>
  );
}

function SandboxDisplay() {
  const {text: uiText} = useI18n();
  const gate = useRuntimeStore((state) => state.mvp15.gate);
  const enabled = gate.mode === "sandbox-enabled";
  return (
    <div className="ua-settings-page__static-stack" aria-label={uiText("Sandbox mode controls")}>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Mode")}</span>
        <span className="ua-settings-page__static-value">
          {enabled ? uiText("Task sandbox enabled") : uiText("Read-only / fixture")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("File system")}</span>
        <span className="ua-settings-page__static-value">
          {enabled ? uiText("Trusted project + fixed run root") : uiText("Read-only")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Commands")}</span>
        <span className="ua-settings-page__static-value">
          {enabled ? uiText("Allowlisted with approval") : uiText("Blocked")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Network")}</span>
        <span className="ua-settings-page__static-value">
          {enabled ? uiText("Loopback MCP only") : uiText("Disabled")}
        </span>
      </div>
    </div>
  );
}

function AuditSessionDisplay() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__static-stack" aria-label={uiText("Audit and session controls")}>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Audit log")}</span>
        <span className="ua-settings-page__static-value">{uiText("Append-only projection")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Retention")}</span>
        <span className="ua-settings-page__static-value">{uiText("Local session history")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Replay")}</span>
        <span className="ua-settings-page__static-value">{uiText("Redacted events only")}</span>
      </div>
    </div>
  );
}

function ConfigPathDisplay() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__path-display">
      <code className="ua-settings-page__path-text">{uiText("~/uagent/config/profiles/default.json")}</code>
    </div>
  );
}

function DiagnosticsDisplay() {
  const {text: uiText,t} = useI18n();
  const mvp11 = useRuntimeStore((state) => state.mvp11);
  const mvp12 = useRuntimeStore((state) => state.mvp12);
  const mvp14 = useRuntimeStore((state) => state.mvp14);
  const mvp15 = useRuntimeStore((state) => state.mvp15);
  const mcp = useRuntimeStore((state) => state.mcp);
  const diagnosticCounts=t("terminal.issueCounts",{errors:mvp11.diagnosticCounts.error,warnings:mvp11.diagnosticCounts.warning});

  return (
    <div className="ua-settings-page__static-stack">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Diagnostic Engine")}</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--success">
          {mvp11.metadataStatus === "failed" || mvp11.contextPackStatus === "failed"
            ? uiText("Attention")
            : uiText("Enabled")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Mode")}</span>
        <span className="ua-settings-page__static-value">{uiText("Read-only diagnostics + controlled text mutation")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Text Mutation")}</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--accent">
          {mvp12.capability.mode} {uiText("/ approval")}{" "}{mvp12.capability.approvalRequired ? uiText("required") : uiText("not required")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Allowed extensions")}</span>
        <span className="ua-settings-page__static-value">{mvp12.capability.allowedExtensions.join(", ")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Blocked dirs")}</span>
        <span className="ua-settings-page__static-value">{mvp12.capability.blockedDirectories.join(", ")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("MVP11 status")}</span>
        <span className="ua-settings-page__static-value">{mvp11.metadataStatus}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("MVP11 counts")}</span>
        <span className="ua-settings-page__static-value">{diagnosticCounts}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Provider")}</span>
        <span className="ua-settings-page__static-value">{uiText("Provider live off")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("MCP")}</span>
        <span className="ua-settings-page__static-value">
          {mcp.capabilities
            ? t("mcp.statusCounts",{status:mcp.status,readOnly:mcp.capabilities.readOnlyTools,blocked:mcp.capabilities.blockedTools})
            : t("mcp.statusReadOnly",{status:mcp.status})}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("UE Editor Observation")}</span>
        <span className="ua-settings-page__static-value">
          {mvp14.capability.enabled ? mvp14.capability.mode : uiText("disabled")} {uiText("/ launch gate separate / trusted root required")}{" "}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Editor safety")}</span>
        <span className="ua-settings-page__static-value">{mvp14.safetyBoundaries.map(uiText).join(", ")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Asset mutation gate")}</span>
        <span className="ua-settings-page__static-value">
          {mvp15.gate.mode} / {mvp15.gate.sandboxRoot}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Log level")}</span>
        <span className="ua-settings-page__static-value">{uiText("Info")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Enabled probes")}</span>
        <span className="ua-settings-page__static-value">{uiText("Runtime, Verifier")}</span>
      </div>
    </div>
  );
}

function TerminalExecutionDisplay() {
  const {text: uiText} = useI18n();
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
    <div className="ua-settings-page__static-stack" aria-label={uiText("MVP10 Terminal Execution status")}>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Real terminal")}</span>
        <span className={`ua-settings-page__static-value${currentMode.tone ? ` ua-settings-page__static-value--${currentMode.tone}` : ""}`}>
          {capability?.enabled ? uiText("Enabled") : uiText("Disabled")} {"·"}{" "}{capability?.reason ?? capability?.mode ?? uiText("native")} {"·"}{" "}{latestStage}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Allowlist")}</span>
        <span className="ua-settings-page__static-value">
          {capability?.allowlistSummary ?? uiText("MVP10 verification commands only")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Trusted root")}</span>
        <span className="ua-settings-page__static-value">
          {trustedRoot ?? uiText("Not configured")} {"·"}{" "}{capability?.trustedRootRequired ? uiText("required for execution") : uiText("not required")}
        </span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Approval")}</span>
        <span className="ua-settings-page__static-value ua-settings-page__static-value--accent">
          {capability?.approvalRequired ? uiText("Required") : uiText("Not required")} {uiText("One-time token")}{" "}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Timeout")}</span>
        <span className="ua-settings-page__static-value">{uiText("Default")}{" "}{Math.round((capability?.timeoutMs ?? 60_000) / 1000)}{uiText("s &middot; max 300s")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Output limit")}</span>
        <span className="ua-settings-page__static-value">
          {Math.round((capability?.outputLimitBytes ?? 1_048_576) / 1024 / 1024)} {uiText("MB /")}{" "}{capability?.outputLimitLines ?? 5000} {uiText("lines")}{" "}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Current mode")}</span>
        <span className="ua-settings-page__static-value">
          {currentMode.mode === "fixture" ? uiText("Fixture mode — proposals only, no execution") :
           currentMode.mode === "real-gated" ? uiText("Real-gated — approved, awaiting execution") :
           uiText("Real-enabled — execution active")}
        </span>
      </div>
      {hasProposals && (
        <div className="ua-settings-page__static-row">
          <span className="ua-settings-page__static-label">{uiText("Recent proposals")}</span>
          <span className="ua-settings-page__static-value">{mvp10Terminal!.proposals.length} {uiText("total")}</span>
        </div>
      )}
    </div>
  );
}

function ResetWorkspaceDisplay() {
  const {text: uiText} = useI18n();
  return (
    <button type="button" className="ua-settings-page__danger-btn" disabled aria-disabled="true">
      {uiText("Reset all workspace data")}{" "}</button>
  );
}
