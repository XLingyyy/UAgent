import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";

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
}

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

async function runCapabilityHandshake(
  invoke: NativeInvoke,
  configuration: BridgeConfiguration,
): Promise<void> {
  await recordStep(invoke, "renderer_ready");
  await recordStep(invoke, "native_bridge_bound");
  if (configuration.phase === "product-capture") {
    const adapter = createDesktopRuntimeAdapter();
    // Complete required operation surface: Connect -> Initialize -> Discover ->
    // Normalize -> Fingerprint, including the normalization getter.
    const productOperations = [
      adapter.setMcpEndpoint,
      adapter.connectMcp,
      adapter.discoverMcp,
      adapter.getMvp15AssetTools,
      adapter.getMvp15LiveAssetToolsetFingerprint,
    ];
    if (
      productOperations.some(
        (operation) => typeof operation !== "function",
      )
    ) {
      throw new Error("mvp15d_normal_product_path_unavailable");
    }
    await recordStep(invoke, "normal_product_path_bound");
  } else {
    // Capability-only: the actual renderer is expected to present the rendered
    // "Project root reference" control and the "Validate"/"Trust" buttons. The
    // product renders these on the Settings "config" page; request that the app
    // open it (a capability-only navigation, not a mutation of the controls),
    // then wait for the actual controls to be present and rendered.
    openCapabilitySettingsPage();
    await waitUntil(
      () => document.querySelector("label, button") !== null,
      "mvp15d_rendered_driver_contract_unavailable",
    );
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
  const adapter = createDesktopRuntimeAdapter();
  await recordStep(invoke, "renderer_ready");
  await recordStep(invoke, "native_bridge_bound");
  adapter.setMcpEndpoint(configuration.endpoint);
  await adapter.connectMcp();
  if (adapter.getMcpState().status !== "connected") {
    throw new Error("mvp15d_product_connect_failed");
  }
  await recordStep(invoke, "connect");
  if (!adapter.getMcpState().protocolVersion) {
    throw new Error("mvp15d_product_initialize_missing");
  }
  await recordStep(invoke, "initialize");
  await adapter.discoverMcp();
  if (!adapter.getMcpDiscovery()) throw new Error("mvp15d_product_discovery_missing");
  await recordStep(invoke, "discover");
  if (adapter.getMvp15AssetTools().length === 0) {
    throw new Error("mvp15d_product_normalization_missing");
  }
  await recordStep(invoke, "normalize");
  const fingerprint = adapter.getMvp15LiveAssetToolsetFingerprint?.();
  if (!fingerprint || fingerprint.discoveryGeneration < 1) {
    throw new Error("mvp15d_product_fingerprint_missing");
  }
  await recordStep(invoke, "fingerprint");
  adapter.disconnectMcp();
}

// Capability-only UI binding: request that the real renderer open the Settings
// "config" page so the actual Project-root controls are present. This is a
// navigation request, not a mutation of the target controls. It is a no-op
// outside the native/Tauri webview (guard absent window).
function openCapabilitySettingsPage(): void {
  if (typeof globalThis.window === "undefined") return;
  globalThis.window.dispatchEvent(new globalThis.Event("uagent:mvp15d-open-capability-settings"));
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

function findButton(name: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll("button")).filter(
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

async function waitUntil(predicate: () => boolean, code: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  throw new Error(code);
}

async function runUiLifecycle(
  invoke: NativeInvoke,
  configuration: BridgeConfiguration,
): Promise<void> {
  if (!configuration.projectRoot) throw new Error("mvp15d_ui_project_root_missing");
  await recordStep(invoke, "renderer_ready");
  await recordStep(invoke, "native_bridge_bound");
  const input = findInput("Project root reference");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, configuration.projectRoot);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  findButton("Validate project root").click();
  await waitUntil(() => !findButton("Trust project root").disabled, "mvp15d_ui_validation_timeout");
  await recordStep(invoke, "validate");
  await recordStep(invoke, "add");
  findButton("Trust project root").click();
  await waitUntil(
    () => document.body.textContent?.includes("trusted") === true,
    "mvp15d_ui_trust_timeout",
  );
  await recordStep(invoke, "confirmTrust");
}

export async function startMvp15dRuntimeBridge(
  invoke: NativeInvoke | null = getNativeInvoke(),
): Promise<void> {
  if (!invoke) return;
  const configuration = await invoke<BridgeConfiguration>("mvp15d_bridge_configuration");
  if (!configuration.enabled) return;
  const command = await waitForDriver(invoke, configuration.driverPollMilliseconds);
  if (configuration.mode === "capability-only" && command === "capability-handshake") {
    await runCapabilityHandshake(invoke, configuration);
  } else if (
    configuration.mode === "live" &&
    configuration.phase === "product-capture" &&
    command === "run-product-capture"
  ) {
    await runProductCapture(invoke, configuration);
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
