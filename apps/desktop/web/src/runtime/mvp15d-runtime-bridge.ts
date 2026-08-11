import {
  readMvp15dProductStoreEvidence,
  readMvp15dUiStoreEvidence,
  runMvp15dUiBridgeAction,
} from "../stores/ui-store";
import { getFixedAppRuntimeAdapter } from "./runtime-store";
import type { DesktopRuntimeAdapter } from "./desktop-runtime-adapter";

type NativeInvoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

interface BridgeConfiguration {
  enabled: boolean;
  bridgeVersion: string;
  phase: "disabled" | "product-capture" | "ui-lifecycle";
  mode: "disabled" | "capability-only" | "live";
  taskId: string;
  session: string;
  generation: number;
  endpoint: string | null;
  projectRoot: string | null;
  renderedProductPath: string;
  driverPollMilliseconds: number;
  observationTimeoutMilliseconds: number;
  approvalTtlWaitMilliseconds: number;
  receiptLedgerEnabled: boolean;
  rendererHandoffPending: boolean;
  rendererHandoffId: string | null;
  rendererParentLifecycleStatus: "pending" | "acknowledged" | "failed" | null;
  rendererParentLifecycleFailure: string | null;
  rendererHandoffPredecessorMcpGeneration: number | null;
  rendererHandoffPredecessorWindowIdentitySha256: string | null;
}

let observationTimeoutMilliseconds = 30_000;

function getNativeInvoke(): NativeInvoke | null {
  return (
    (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } }).__TAURI_INTERNALS__
      ?.invoke ?? null
  );
}

async function waitForDriver(invoke: NativeInvoke, pollMilliseconds: number): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const command = await invoke<string | null>("mvp15d_bridge_take_driver_command");
    if (command) return command;
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollMilliseconds));
  }
  throw new Error("mvp15d_bridge_driver_readiness_timeout");
}

async function recordStep(invoke: NativeInvoke, step: string): Promise<void> {
  await invoke("mvp15d_bridge_record_renderer_step", { input: { step } });
}

export async function publishMvp15dProductStoreEvidence(
  invoke: NativeInvoke,
  missingEvidenceCode = "mvp15d_product_store_evidence_missing",
): Promise<void> {
  const productEvidence = readMvp15dProductStoreEvidence();
  if (!productEvidence || productEvidence.status !== "ready") {
    throw new Error(missingEvidenceCode);
  }
  await invoke("mvp15d_bridge_publish_product_evidence", { input: productEvidence });
}

async function runCapabilityHandshake(
  invoke: NativeInvoke,
  configuration: BridgeConfiguration,
): Promise<void> {
  await recordStep(invoke, "renderer_ready");
  await recordStep(invoke, "native_bridge_bound");
  openCapabilitySettingsPage();
  await waitUntil(
    () => document.querySelector("label, button") !== null,
    "mvp15d_rendered_driver_contract_unavailable",
  );
  if (configuration.phase === "product-capture") {
    const mcpRegion = findRegion("MCP connection");
    findInputByAccessibleName("MCP endpoint URL");
    findButton("Connect", mcpRegion);
    findButton("Discover", mcpRegion);
    findButton("Disconnect", mcpRegion);
    findRegion("UAgent UE Companion Plugin");
    await recordStep(invoke, "normal_product_path_bound");
  } else {
    // Capability-only: the actual renderer is expected to present the rendered
    // "Project root reference" control and the "Validate"/"Trust" buttons. The
    // product renders these on the Settings "config" page; request that the app
    // open it (a capability-only navigation, not a mutation of the controls),
    // then wait for the actual controls to be present and rendered.
    const projectRootInput = findInput("Project root reference");
    const validateButton = findButton("Validate project root");
    const trustButton = findButton("Trust project root");
    if (
      !projectRootInput ||
      !validateButton ||
      !trustButton ||
      !validateButton.textContent ||
      !trustButton.textContent
    ) {
      throw new Error("mvp15d_rendered_driver_contract_unavailable");
    }
    // The capability handshake binds the actual rendered control identities.
    await recordStep(invoke, "rendered_driver_bound");
  }
  await recordStep(invoke, "capability_confirmed");
}

async function runProductCapture(
  invoke: NativeInvoke,
  configuration: BridgeConfiguration,
): Promise<void> {
  if (!configuration.endpoint) throw new Error("mvp15d_product_endpoint_missing");
  if (!configuration.projectRoot) throw new Error("mvp15d_product_project_root_missing");
  await recordStep(invoke, "renderer_ready");
  await recordStep(invoke, "native_bridge_bound");
  await prepareTrustedObservation(invoke, configuration.projectRoot);
  await openSettingsPage();
  const mcpRegion = findRegion("MCP connection");
  setInputValue(findInputByAccessibleName("MCP endpoint URL"), configuration.endpoint);
  await settleRenderedInput();
  findButton("Connect", mcpRegion).click();
  await waitUntil(
    () => observationText("mcp-status", mcpRegion) === "connected",
    "mvp15d_product_connect_failed",
  );
  await recordStep(invoke, "connect");
  await waitUntil(
    () => {
      const protocol = observationText("mcp-protocol", mcpRegion);
      return protocol.length > 0 && protocol !== "Not initialized";
    },
    "mvp15d_product_initialize_missing",
  );
  await recordStep(invoke, "initialize");
  findButton("Discover", mcpRegion).click();
  await waitUntil(
    () => observationText("companion-tools", findRegion("UAgent UE Companion Plugin")).includes("6 summaries"),
    "mvp15d_product_discovery_missing",
  );
  await recordStep(invoke, "discover");
  const companionRegion = findRegion("UAgent UE Companion Plugin");
  await waitUntil(
    () => !findButton("Verify companion identity", companionRegion).disabled,
    "mvp15d_product_attestation_unavailable",
  );
  findButton("Verify companion identity", companionRegion).click();
  await waitUntil(
    () => observationText("companion-status", companionRegion) === "Verified",
    "mvp15d_product_attestation_failed",
  );
  const tools = observationText("companion-tools", companionRegion);
  if (!/^\d+\s*\/\s*6\s*\(6 summaries\)$/.test(tools)) {
    throw new Error("mvp15d_product_normalization_missing");
  }
  await recordStep(invoke, "normalize");
  const fingerprint = observationText("companion-fingerprint", companionRegion);
  if (!fingerprint || fingerprint === "unverified") {
    throw new Error("mvp15d_product_fingerprint_missing");
  }
  await recordStep(invoke, "fingerprint");
  await runMvp15dUiBridgeAction("productAuthority");
  await waitUntil(
    () => observationText("companion-status", companionRegion) === "Verified",
    "mvp15d_product_retraction_orchestration_failed",
  );
  findButton("Disconnect", mcpRegion).click();
  await waitUntil(
    () => observationText("mcp-status", mcpRegion) === "disconnected",
    "mvp15d_product_disconnect_failed",
  );
  await recordStep(invoke, "disconnect");
  await publishMvp15dProductStoreEvidence(invoke);
}

async function runProductSuccessor(
  invoke: NativeInvoke,
  configuration: BridgeConfiguration,
): Promise<void> {
  if (!configuration.endpoint || !configuration.projectRoot || !configuration.rendererHandoffId) {
    throw new Error("mvp15d_product_successor_context_missing");
  }
  await prepareTrustedObservation(invoke, configuration.projectRoot, false);
  await openSettingsPage();
  const mcpRegion = findRegion("MCP connection");
  setInputValue(findInputByAccessibleName("MCP endpoint URL"), configuration.endpoint);
  await settleRenderedInput();
  findButton("Connect", mcpRegion).click();
  await waitUntil(
    () => observationText("mcp-status", mcpRegion) === "connected",
    "mvp15d_product_successor_connect_failed",
  );
  findButton("Discover", mcpRegion).click();
  await waitUntil(
    () => observationText("companion-tools", findRegion("UAgent UE Companion Plugin")).includes("6 summaries"),
    "mvp15d_product_successor_discovery_failed",
  );
  const companionRegion = findRegion("UAgent UE Companion Plugin");
  await waitUntil(
    () => !findButton("Verify companion identity", companionRegion).disabled,
    "mvp15d_product_successor_attestation_unavailable",
  );
  findButton("Verify companion identity", companionRegion).click();
  await waitUntil(
    () => observationText("companion-status", companionRegion) === "Verified",
    "mvp15d_product_successor_attestation_failed",
  );
  await runMvp15dUiBridgeAction(
    "productAuthoritySuccessor",
    `${configuration.rendererHandoffId}\n${configuration.endpoint}`,
  );
  findButton("Disconnect", mcpRegion).click();
  await waitUntil(
    () => observationText("mcp-status", mcpRegion) === "disconnected",
    "mvp15d_product_successor_disconnect_failed",
  );
  await recordStep(invoke, "disconnect");
  await publishMvp15dProductStoreEvidence(
    invoke,
    "mvp15d_product_successor_store_evidence_missing",
  );
}

// Capability-only UI binding: request that the real renderer open the Settings
// "config" page so the actual Project-root controls are present. This is a
// navigation request, not a mutation of the target controls. It is a no-op
// outside the native/Tauri webview (guard absent window).
function openCapabilitySettingsPage(): void {
  if (typeof globalThis.window === "undefined") return;
  globalThis.window.dispatchEvent(new globalThis.Event("uagent:mvp15d-open-capability-settings"));
}

async function openSettingsPage(): Promise<void> {
  openCapabilitySettingsPage();
  await waitUntil(
    () => document.querySelector('[aria-label="MCP connection"]') !== null,
    "mvp15d_normal_product_path_unavailable",
  );
}

function isRendered(element: Element): boolean {
  if (!element.isConnected || (element as HTMLElement).hidden) return false;
  const style = globalThis.getComputedStyle?.(element);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

function findLabel(labelText: string): HTMLLabelElement {
  const labels = Array.from(document.querySelectorAll("label")).filter(
    (candidate) => candidate.textContent?.trim() === labelText,
  );
  if (labels.length !== 1) {
    // Missing is distinct from duplicated; both fail capability binding.
    throw new Error(
      labels.length === 0 ? "mvp15d_rendered_input_missing" : "mvp15d_rendered_input_duplicate",
    );
  }
  const label = labels[0];
  if (!isRendered(label)) {
    throw new Error("mvp15d_rendered_input_inaccessible");
  }
  return label;
}

function findInput(labelText: string): HTMLInputElement {
  const label = findLabel(labelText);
  const controls: HTMLInputElement[] = [];
  if (label.htmlFor) {
    const referenced = document.getElementById(label.htmlFor);
    if (referenced instanceof HTMLInputElement) controls.push(referenced);
  }
  const nested = label.querySelector("input");
  if (nested instanceof HTMLInputElement) controls.push(nested);
  if (controls.length !== 1) {
    throw new Error(
      controls.length === 0 ? "mvp15d_rendered_input_missing" : "mvp15d_rendered_input_duplicate",
    );
  }
  const control = controls[0];
  if (!isRendered(control)) {
    throw new Error("mvp15d_rendered_input_inaccessible");
  }
  return control;
}

function findInputByAccessibleName(name: string): HTMLInputElement {
  const controls = Array.from(document.querySelectorAll("input")).filter((candidate) => {
    if (!isRendered(candidate)) return false;
    if (candidate.getAttribute("aria-label") === name) return true;
    const label = candidate.closest("label");
    return label?.textContent?.trim() === name;
  });
  if (controls.length !== 1) {
    throw new Error(
      controls.length === 0 ? "mvp15d_rendered_input_missing" : "mvp15d_rendered_input_duplicate",
    );
  }
  return controls[0];
}

function findRegion(name: string): HTMLElement {
  const regions = Array.from(document.querySelectorAll(`[aria-label="${name}"]`)).filter(
    (candidate): candidate is HTMLElement => candidate instanceof HTMLElement && isRendered(candidate),
  );
  if (regions.length !== 1) {
    throw new Error(
      regions.length === 0 ? "mvp15d_rendered_region_missing" : "mvp15d_rendered_region_duplicate",
    );
  }
  return regions[0];
}

function observationText(name: string, root: ParentNode = document): string {
  const observations = Array.from(
    root.querySelectorAll(`[data-mvp15d-observation="${name}"]`),
  ).filter(isRendered);
  if (observations.length !== 1) return "";
  return observations[0].getAttribute("data-mvp15d-value") ?? observations[0].textContent?.trim() ?? "";
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const InputConstructor = input.ownerDocument.defaultView?.HTMLInputElement ?? globalThis.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(InputConstructor.prototype, "value")?.set;
  setter?.call(input, value);
  const EventConstructor = input.ownerDocument.defaultView?.Event ?? globalThis.Event;
  input.dispatchEvent(new EventConstructor("input", { bubbles: true }));
  input.dispatchEvent(new EventConstructor("change", { bubbles: true }));
}

async function settleRenderedInput(): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function findButton(name: string, root: ParentNode = document): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll("button")).filter(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (buttons.length !== 1) {
    throw new Error(
      buttons.length === 0 ? "mvp15d_rendered_button_missing" : "mvp15d_rendered_button_duplicate",
    );
  }
  const button = buttons[0];
  if (!isRendered(button)) {
    throw new Error("mvp15d_rendered_button_inaccessible");
  }
  return button;
}

function findButtonByAccessibleName(name: string, root: ParentNode = document): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll("button")).filter(
    (candidate) =>
      isRendered(candidate) &&
      (candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name),
  );
  if (buttons.length !== 1) {
    throw new Error(
      buttons.length === 0 ? "mvp15d_rendered_button_missing" : "mvp15d_rendered_button_duplicate",
    );
  }
  return buttons[0];
}

async function dispatchAssetAction(
  accessibleName: string,
  action: "dryRun" | "approve" | "execute" | "verify" | "rollback" | "finalVerify" | "replay",
  sourceAssetPath?: string,
): Promise<void> {
  const button = findButtonByAccessibleName(accessibleName, findRegion("Asset mutation panel"));
  if (button.disabled) throw new Error("mvp15d_rendered_button_disabled");
  button.focus();
  await runMvp15dUiBridgeAction(action, sourceAssetPath);
}

function findTab(name: string): HTMLButtonElement {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]')).filter(
    (candidate): candidate is HTMLButtonElement =>
      candidate instanceof HTMLButtonElement &&
      isRendered(candidate) &&
      candidate.textContent?.trim() === name,
  );
  if (tabs.length !== 1) throw new Error("mvp15d_rendered_tab_unavailable");
  return tabs[0];
}

async function activateTab(name: string): Promise<void> {
  findTab(name).click();
  await waitUntil(
    () => findTab(name).getAttribute("aria-selected") === "true",
    "mvp15d_rendered_tab_activation_timeout",
  );
}

async function waitUntil(predicate: () => boolean, code: string): Promise<void> {
  const deadline = Date.now() + observationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  throw new Error(code);
}

async function prepareTrustedObservation(
  invoke: NativeInvoke,
  projectRoot: string,
  recordRendererSteps = true,
): Promise<void> {
  await openSettingsPage();
  const input = findInput("Project root reference");
  setInputValue(input, projectRoot);
  await settleRenderedInput();
  findButton("Validate project root").click();
  await waitUntil(
    () => !findButton("Trust project root").disabled,
    "mvp15d_ui_validation_timeout",
  );
  if (recordRendererSteps) {
    await recordStep(invoke, "validate");
    await recordStep(invoke, "add");
  }
  findButton("Trust project root").click();
  await waitUntil(
    () => observationText("project-trust") === "trusted",
    "mvp15d_ui_trust_timeout",
  );
  if (recordRendererSteps) await recordStep(invoke, "confirmTrust");

  const back = findButtonByAccessibleName("Back to app");
  back.click();
  await waitUntil(
    () => document.querySelector('[aria-label="Utility drawer"]') !== null,
    "mvp15d_utility_drawer_unavailable",
  );
  const drawer = findRegion("Utility drawer");
  if (drawer.getAttribute("aria-hidden") === "true") {
    findButtonByAccessibleName("Open utility drawer").click();
    await waitUntil(
      () => findRegion("Utility drawer").getAttribute("aria-hidden") === "false",
      "mvp15d_utility_drawer_unavailable",
    );
  }
  await activateTab("UE");
  await waitUntil(
    () => document.querySelector('[aria-label="Editor panel"]') !== null,
    "mvp15d_editor_panel_unavailable",
  );
  const editor = findRegion("Editor panel");
  findButtonByAccessibleName("Discover editor processes", editor).click();
  await waitUntil(
    () => !findButtonByAccessibleName("Attach editor observation session", findRegion("Editor panel")).disabled,
    "mvp15d_editor_discovery_timeout",
  );
  if (recordRendererSteps) await recordStep(invoke, "observationDiscover");
  findButtonByAccessibleName("Attach editor observation session", findRegion("Editor panel")).click();
  await waitUntil(
    () => !findButtonByAccessibleName("Read editor observation snapshot", findRegion("Editor panel")).disabled,
    "mvp15d_editor_attach_timeout",
  );
  if (recordRendererSteps) await recordStep(invoke, "observationAttach");
  findButtonByAccessibleName("Read editor observation snapshot", findRegion("Editor panel")).click();
  await waitUntil(
    () =>
      observationText("editor-heartbeat", findRegion("Editor panel")).includes("alive true") &&
      observationText("editor-snapshot", findRegion("Editor panel")) !== "not recorded",
    "mvp15d_editor_observation_timeout",
  );
  if (recordRendererSteps) await recordStep(invoke, "observationReady");
}

async function runUiLifecycle(
  invoke: NativeInvoke,
  configuration: BridgeConfiguration,
): Promise<void> {
  if (!configuration.projectRoot) throw new Error("mvp15d_ui_project_root_missing");
  if (!configuration.endpoint) throw new Error("mvp15d_ui_endpoint_missing");
  await recordStep(invoke, "renderer_ready");
  await recordStep(invoke, "native_bridge_bound");
  await prepareTrustedObservation(invoke, configuration.projectRoot);
  await openSettingsPage();
  const mcpRegion = findRegion("MCP connection");
  setInputValue(findInputByAccessibleName("MCP endpoint URL"), configuration.endpoint);
  await settleRenderedInput();
  findButton("Connect", mcpRegion).click();
  await waitUntil(
    () => observationText("mcp-status", mcpRegion) === "connected",
    "mvp15d_ui_mcp_connect_timeout",
  );
  await recordStep(invoke, "mcpConnect");
  await waitUntil(
    () => observationText("mcp-protocol", mcpRegion) !== "Not initialized",
    "mvp15d_ui_mcp_initialize_timeout",
  );
  await recordStep(invoke, "mcpInitialize");
  findButton("Discover", mcpRegion).click();
  const companionRegion = findRegion("UAgent UE Companion Plugin");
  await waitUntil(
    () => observationText("companion-tools", companionRegion).includes("6 summaries"),
    "mvp15d_ui_mcp_discovery_timeout",
  );
  await recordStep(invoke, "mcpDiscover");
  await waitUntil(
    () => !findButton("Verify companion identity", companionRegion).disabled,
    "mvp15d_ui_companion_attestation_unavailable",
  );
  findButton("Verify companion identity", companionRegion).click();
  await waitUntil(
    () =>
      observationText("companion-status", companionRegion) === "Verified" &&
      observationText("companion-fingerprint", companionRegion) !== "unverified",
    "mvp15d_ui_companion_attestation_failed",
  );
  await recordStep(invoke, "mcpNormalize");
  await recordStep(invoke, "mcpFingerprint");

  findButtonByAccessibleName("Back to app").click();
  await waitUntil(() => document.querySelector('[role="tab"]') !== null, "mvp15d_asset_panel_unavailable");
  await activateTab("Assets");
  await waitUntil(
    () => document.querySelector('[aria-label="Asset mutation panel"]') !== null,
    "mvp15d_asset_panel_unavailable",
  );
  setInputValue(findInputByAccessibleName("Source asset path"), "/Game/Test01");
  await settleRenderedInput();
  await dispatchAssetAction("Dry-run sandbox asset mutation", "dryRun", "/Game/Test01");
  await waitUntil(
    () =>
      observationText("asset-execution-mode", findRegion("Asset mutation panel")) === "real" &&
      observationText("asset-binding", findRegion("Asset mutation panel")) === "external_bound" &&
      !findButtonByAccessibleName("Approve sandbox asset mutation", findRegion("Asset mutation panel")).disabled,
    "mvp15d_ui_dry_run_timeout",
  );
  await recordStep(invoke, "dryRun");
  await dispatchAssetAction("Approve sandbox asset mutation", "approve");
  await waitUntil(
    () => observationText("asset-registration", findRegion("Asset mutation panel")) === "registered",
    "mvp15d_ui_registration_timeout",
  );
  await recordStep(invoke, "approve");
  await recordStep(invoke, "register");
  await dispatchAssetAction("Execute sandbox asset mutation", "execute");
  await waitUntil(
    () => observationText("asset-execution", findRegion("Asset mutation panel")) === "executed",
    "mvp15d_ui_execute_timeout",
  );
  await recordStep(invoke, "execute");
  await dispatchAssetAction("Verify sandbox asset mutation", "verify");
  await waitUntil(
    () => observationText("asset-verification", findRegion("Asset mutation panel")) === "passed",
    "mvp15d_ui_verify_timeout",
  );
  await recordStep(invoke, "verify");
  await new Promise((resolve) =>
    globalThis.setTimeout(resolve, configuration.approvalTtlWaitMilliseconds),
  );
  await recordStep(invoke, "crossTtl");
  await dispatchAssetAction("Rollback sandbox asset mutation", "rollback");
  await waitUntil(
    () => observationText("asset-rollback", findRegion("Asset mutation panel")) === "rolled_back",
    "mvp15d_ui_rollback_timeout",
  );
  await recordStep(invoke, "rollback");
  await dispatchAssetAction("Final verify restored Content", "finalVerify");
  await waitUntil(
    () => observationText("asset-final-verification", findRegion("Asset mutation panel")) === "passed",
    "mvp15d_ui_final_verification_timeout",
  );
  await recordStep(invoke, "finalVerify");
  await dispatchAssetAction("Inspect recorded asset replay", "replay");
  await waitUntil(
    () => observationText("asset-replay-inspection", findRegion("Asset mutation panel")) === "recorded",
    "mvp15d_ui_replay_timeout",
  );
  await recordStep(invoke, "replay");
  await runMvp15dUiBridgeAction("uiAuthority");

  await activateTab("UE");
  await waitUntil(() => document.querySelector('[aria-label="Editor panel"]') !== null, "mvp15d_editor_panel_unavailable");
  findButtonByAccessibleName("Stop editor observation session", findRegion("Editor panel")).click();
  await waitUntil(
    () => observationText("editor-session-state", findRegion("Editor panel")) === "stopped",
    "mvp15d_ui_observation_stop_timeout",
  );
  await recordStep(invoke, "observationStop");
  await openSettingsPage();
  findButton("Disconnect", findRegion("MCP connection")).click();
  await waitUntil(
    () => observationText("mcp-status", findRegion("MCP connection")) === "disconnected",
    "mvp15d_ui_mcp_disconnect_timeout",
  );
  await recordStep(invoke, "mcpDisconnect");
  const uiEvidence = readMvp15dUiStoreEvidence();
  if (!uiEvidence || uiEvidence.status !== "ready") {
    throw new Error("mvp15d_ui_store_evidence_missing");
  }
  await invoke("mvp15d_bridge_publish_ui_evidence", { input: uiEvidence });
}

export async function startMvp15dRuntimeBridge(
  invoke: NativeInvoke | null = getNativeInvoke(),
  runtimeAdapterOverride: Pick<DesktopRuntimeAdapter, "activateMvp15dFixedObservationAuthority"> | null = null,
): Promise<void> {
  if (!invoke) return;
  const configuration = await invoke<BridgeConfiguration>("mvp15d_bridge_configuration");
  if (!configuration.enabled) return;
  if (configuration.rendererHandoffId && !configuration.rendererHandoffPending) {
    if (configuration.rendererParentLifecycleStatus === "failed") {
      throw new Error(
        `mvp15d_renderer_parent_lifecycle_failed:${configuration.rendererParentLifecycleFailure ?? "unknown"}`,
      );
    }
    throw new Error("mvp15d_renderer_parent_lifecycle_acknowledgement_missing");
  }
  if (
    configuration.rendererHandoffPending &&
    !/^[0-9a-f]{64}$/.test(configuration.rendererHandoffPredecessorWindowIdentitySha256 ?? "")
  ) {
    throw new Error("mvp15d_renderer_predecessor_window_identity_missing");
  }
  observationTimeoutMilliseconds = configuration.observationTimeoutMilliseconds;
  const command = configuration.rendererHandoffPending
    ? "renderer-successor"
    : await waitForDriver(invoke, configuration.driverPollMilliseconds);
  if (configuration.mode === "live") {
    const runtimeAdapter = runtimeAdapterOverride ?? getFixedAppRuntimeAdapter();
    if (!runtimeAdapter?.activateMvp15dFixedObservationAuthority) {
      throw new Error("mvp15d_fixed_app_runtime_adapter_unavailable");
    }
    await runtimeAdapter.activateMvp15dFixedObservationAuthority({
      taskId: configuration.taskId,
      phase: configuration.phase as "product-capture" | "ui-lifecycle",
      session: configuration.session,
      generation: configuration.generation,
      receiptLedgerEnabled: configuration.receiptLedgerEnabled,
      minimumMcpGeneration: configuration.rendererHandoffPredecessorMcpGeneration ?? undefined,
      predecessorWindowIdentitySha256:
        configuration.rendererHandoffPredecessorWindowIdentitySha256 ?? undefined,
    });
  }
  if (
    configuration.mode === "live" &&
    configuration.phase === "product-capture" &&
    command === "renderer-successor"
  ) {
    await runProductSuccessor(invoke, configuration);
  } else if (configuration.mode === "capability-only" && command === "capability-handshake") {
    await runCapabilityHandshake(invoke, configuration);
  } else if (
    configuration.mode === "live" &&
    configuration.phase === "product-capture" &&
    command === "run-product-capture"
  ) {
    try {
      await runProductCapture(invoke, configuration);
    } catch (error) {
      if (error instanceof Error && error.message === "mvp15d_renderer_restart_handoff_requested") {
        return;
      }
      throw error;
    }
  } else if (
    configuration.mode === "live" &&
    configuration.phase === "ui-lifecycle" &&
    command === "run-ui-lifecycle"
  ) {
    await runUiLifecycle(invoke, configuration);
  } else {
    throw new Error("mvp15d_bridge_driver_command_rejected");
  }
  await invoke("mvp15d_bridge_complete");
}
