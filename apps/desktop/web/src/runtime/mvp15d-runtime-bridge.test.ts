/* global document */

// R5.3 renderer capability / live-branch binding regression.
//
// Proves that capability-only mode locates the actual rendered "Project root
// reference" control and the "Validate"/"Trust" buttons (rejecting missing,
// duplicate, or inaccessible controls), that the product capability verifies the
// complete operation surface without opening MCP/network, and that live branches
// drive ordered product/UI calls through a deterministic local fake transport.

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  startMvp15dRuntimeBridge,
} from "./mvp15d-runtime-bridge";

// The bridge imports the real adapter; isolate it so product-capability and
// live-product tests can inject a deterministic fake adapter that never opens a
// real MCP/network transport.
const adapterMock = vi.hoisted(() => ({
  createDesktopRuntimeAdapter: vi.fn(),
}));
vi.mock("./desktop-runtime-adapter", () => adapterMock);
const evidenceMock = vi.hoisted(() => ({
  readMvp15dProductStoreEvidence: vi.fn(() => ({ status: "ready" })),
  readMvp15dUiStoreEvidence: vi.fn(() => ({ status: "ready" })),
  runMvp15dUiBridgeAction: vi.fn(async (action: string) => {
    globalThis.window.dispatchEvent(new CustomEvent("uagent:mvp15d-asset-action", { detail: { action } }));
  }),
}));
vi.mock("../stores/ui-store", () => evidenceMock);

type NativeInvoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;
let bridgeAssetListener: ((event: Event) => void) | null = null;

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    bridgeVersion: "uagent.mvp15d.runtime-bridge.v5",
    phase: "ui-lifecycle",
    mode: "capability-only",
    taskId: "TASK-MVP15D-UAGENT-RUNTIME-BRIDGE",
    session: "uagent-runtime-bridge-session-0001",
    generation: 1,
    endpoint: null,
    projectRoot: null,
    renderedProductPath: "validate,add,confirmTrust",
    driverPollMilliseconds: 50,
    observationTimeoutMilliseconds: 1_000,
    approvalTtlWaitMilliseconds: 1,
    receiptLedgerEnabled: true,
    rendererHandoffPending: false,
    rendererHandoffId: null,
    rendererParentLifecycleStatus: null,
    rendererParentLifecycleFailure: null,
    rendererHandoffPredecessorMcpGeneration: null,
    rendererHandoffPredecessorWindowIdentitySha256: null,
    ...overrides,
  };
}

const fixedAuthorityAdapter = {
  activateMvp15dFixedObservationAuthority: vi.fn().mockResolvedValue(undefined),
};

function stepCollectingInvoke(driverCommand = "capability-handshake") {
  const steps: Array<{ command: string; payload: unknown }> = [];
  const callbacks: Record<string, () => unknown> = {
    mvp15d_bridge_take_driver_command: () => driverCommand,
  };
  const invoke: NativeInvoke = (command, payload) => {
    steps.push({ command, payload });
    const custom = callbacks[command as string];
    if (typeof custom === "function") return Promise.resolve(custom() as never);
    return Promise.resolve({ accepted: true } as never);
  };
  return { invoke, steps };
}

function mountUiControls() {
  document.body.innerHTML = `
    <form>
      <label for="projectRootRef">Project root reference</label>
      <input id="projectRootRef" type="text" value="" />
      <button type="button">Validate project root</button>
      <button type="button">Trust project root</button>
    </form>
  `;
}

function mountProductControls(clicks: string[]) {
  document.body.innerHTML = `
    <button type="button" aria-label="Back to app">Back</button>
    <button type="button" aria-label="Open utility drawer">Tools</button>
    <aside aria-label="Utility drawer" aria-hidden="false">
       <button role="tab" type="button" aria-selected="false">UE</button>
       <button role="tab" type="button" aria-selected="false">Assets</button>
      <section aria-label="Editor panel">
        <span data-mvp15d-observation="editor-session-state">idle</span>
        <span data-mvp15d-observation="editor-process">none discovered</span>
        <span data-mvp15d-observation="editor-heartbeat">not recorded</span>
        <span data-mvp15d-observation="editor-snapshot">not recorded</span>
        <button type="button" aria-label="Discover editor processes">Discover</button>
        <button type="button" aria-label="Attach editor observation session" disabled>Observe</button>
        <button type="button" aria-label="Read editor observation snapshot" disabled>Snapshot</button>
        <button type="button" aria-label="Stop editor observation session" disabled>Stop</button>
      </section>
      <section aria-label="Asset mutation panel">
        <label>Source asset path <input aria-label="Source asset path" type="text" /></label>
        <span data-mvp15d-observation="asset-execution-mode"></span>
        <span data-mvp15d-observation="asset-binding">local_fixture</span>
        <span data-mvp15d-observation="asset-registration">required</span>
        <span data-mvp15d-observation="asset-execution"></span>
        <span data-mvp15d-observation="asset-verification"></span>
        <span data-mvp15d-observation="asset-rollback"></span>
        <span data-mvp15d-observation="asset-replay"></span>
        <span data-mvp15d-observation="asset-final-verification">idle</span>
        <span data-mvp15d-observation="asset-replay-inspection">idle</span>
        <button type="button" aria-label="Dry-run sandbox asset mutation">Dry-run</button>
        <button type="button" aria-label="Approve sandbox asset mutation" disabled>Approve</button>
        <button type="button" aria-label="Execute sandbox asset mutation" disabled>Execute</button>
        <button type="button" aria-label="Verify sandbox asset mutation" disabled>Verify</button>
        <button type="button" aria-label="Rollback sandbox asset mutation" disabled>Rollback</button>
        <button type="button" aria-label="Final verify restored Content" disabled>Final verify</button>
        <button type="button" aria-label="Inspect recorded asset replay" disabled>Inspect replay</button>
      </section>
    </aside>
    <label for="projectRootRef">Project root reference</label>
    <input id="projectRootRef" type="text" value="" />
    <span data-mvp15d-observation="project-trust">untrusted</span>
    <button type="button">Validate project root</button>
    <button type="button" disabled>Trust project root</button>
    <div aria-label="MCP connection">
      <label>Endpoint <input aria-label="MCP endpoint URL" type="text" value="" /></label>
      <span data-mvp15d-observation="mcp-status">disconnected</span>
      <span data-mvp15d-observation="mcp-protocol">Not initialized</span>
      <button type="button">Connect</button>
      <button type="button" disabled>Discover</button>
      <button type="button" disabled>Disconnect</button>
    </div>
    <section aria-label="UAgent UE Companion Plugin">
      <span data-mvp15d-observation="companion-status">Installed unverified</span>
      <span data-mvp15d-observation="companion-fingerprint">unverified</span>
      <span data-mvp15d-observation="companion-tools">0 / 0 (0 summaries)</span>
      <button type="button" disabled>Verify companion identity</button>
    </section>
  `;
  const allButtons = Array.from(document.querySelectorAll("button"));
  const named = (name: string) =>
    allButtons.find(
      (button) => button.getAttribute("aria-label") === name || button.textContent?.trim() === name,
    )!;
  for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))) {
    tab.addEventListener("click", () => {
      for (const candidate of document.querySelectorAll('[role="tab"]')) candidate.setAttribute("aria-selected", "false");
      tab.setAttribute("aria-selected", "true");
    });
  }
  named("Validate project root").addEventListener("click", () => {
    clicks.push("validate");
    named("Trust project root").disabled = false;
  });
  named("Trust project root").addEventListener("click", () => {
    clicks.push("trust");
    document.querySelector('[data-mvp15d-observation="project-trust"]')!.textContent = "trusted";
  });
  const editor = document.querySelector('[aria-label="Editor panel"]')!;
  const editorButton = (name: string) =>
    editor.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;
  editorButton("Discover editor processes").addEventListener("click", () => {
    clicks.push("editor-discover");
    editor.querySelector('[data-mvp15d-observation="editor-process"]')!.textContent = "UnrealEditor / running";
    editorButton("Attach editor observation session").disabled = false;
  });
  editorButton("Attach editor observation session").addEventListener("click", () => {
    clicks.push("editor-attach");
    editor.querySelector('[data-mvp15d-observation="editor-session-state"]')!.textContent = "attached";
    editorButton("Read editor observation snapshot").disabled = false;
    editorButton("Stop editor observation session").disabled = false;
  });
  editorButton("Read editor observation snapshot").addEventListener("click", () => {
    clicks.push("editor-snapshot");
    editor.querySelector('[data-mvp15d-observation="editor-heartbeat"]')!.textContent = "ready / alive true";
    editor.querySelector('[data-mvp15d-observation="editor-snapshot"]')!.textContent = "idle / FinalHost";
  });
  editorButton("Stop editor observation session").addEventListener("click", () => {
    clicks.push("editor-stop");
    editor.querySelector('[data-mvp15d-observation="editor-session-state"]')!.textContent = "stopped";
  });
  const region = document.querySelector('[aria-label="MCP connection"]')!;
  const buttons = Array.from(region.querySelectorAll("button"));
  const [connect, discover, disconnect] = buttons;
  connect.addEventListener("click", () => {
    clicks.push("connect");
    region.querySelector('[data-mvp15d-observation="mcp-status"]')!.textContent = "connected";
    region.querySelector('[data-mvp15d-observation="mcp-protocol"]')!.textContent = "2025-06-18";
    connect.disabled = true;
    discover.disabled = false;
    disconnect.disabled = false;
  });
  discover.addEventListener("click", () => {
    clicks.push("discover");
    const companion = document.querySelector('[aria-label="UAgent UE Companion Plugin"]')!;
    companion.querySelector('[data-mvp15d-observation="companion-tools"]')!.textContent =
      "1700000000000 / 6 (6 summaries)";
    (named("Verify companion identity") as HTMLButtonElement).disabled = false;
  });
  named("Verify companion identity").addEventListener("click", () => {
    clicks.push("verify-companion");
    const companion = document.querySelector('[aria-label="UAgent UE Companion Plugin"]')!;
    companion.querySelector('[data-mvp15d-observation="companion-status"]')!.textContent = "Verified";
    companion.querySelector('[data-mvp15d-observation="companion-fingerprint"]')!.textContent = "abc123…";
  });
  disconnect.addEventListener("click", () => {
    clicks.push("disconnect");
    region.querySelector('[data-mvp15d-observation="mcp-status"]')!.textContent = "disconnected";
  });
  const asset = document.querySelector('[aria-label="Asset mutation panel"]')!;
  const assetButton = (name: string) =>
    asset.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;
  if (bridgeAssetListener) globalThis.window.removeEventListener("uagent:mvp15d-asset-action", bridgeAssetListener);
  bridgeAssetListener = (event) => {
    const action = (event as CustomEvent<{ action?: string }>).detail?.action;
    const names: Record<string, string> = {
      dryRun: "Dry-run sandbox asset mutation",
      approve: "Approve sandbox asset mutation",
      execute: "Execute sandbox asset mutation",
      verify: "Verify sandbox asset mutation",
      rollback: "Rollback sandbox asset mutation",
      finalVerify: "Final verify restored Content",
      replay: "Inspect recorded asset replay",
    };
    if (action && names[action]) assetButton(names[action]).click();
  };
  globalThis.window.addEventListener("uagent:mvp15d-asset-action", bridgeAssetListener);
  assetButton("Dry-run sandbox asset mutation").addEventListener("click", () => {
    clicks.push("dry-run");
    asset.querySelector('[data-mvp15d-observation="asset-execution-mode"]')!.textContent = "real";
    asset.querySelector('[data-mvp15d-observation="asset-binding"]')!.textContent = "external_bound";
    assetButton("Approve sandbox asset mutation").disabled = false;
  });
  assetButton("Approve sandbox asset mutation").addEventListener("click", () => {
    clicks.push("approve");
    asset.querySelector('[data-mvp15d-observation="asset-registration"]')!.textContent = "registered";
    assetButton("Execute sandbox asset mutation").disabled = false;
  });
  assetButton("Execute sandbox asset mutation").addEventListener("click", () => {
    clicks.push("execute");
    asset.querySelector('[data-mvp15d-observation="asset-execution"]')!.textContent = "executed";
    assetButton("Verify sandbox asset mutation").disabled = false;
    assetButton("Rollback sandbox asset mutation").disabled = false;
  });
  assetButton("Verify sandbox asset mutation").addEventListener("click", () => {
    clicks.push("verify");
    asset.querySelector('[data-mvp15d-observation="asset-verification"]')!.textContent = "passed";
  });
  assetButton("Rollback sandbox asset mutation").addEventListener("click", () => {
    clicks.push("rollback");
    asset.querySelector('[data-mvp15d-observation="asset-rollback"]')!.textContent = "rolled_back";
    asset.querySelector('[data-mvp15d-observation="asset-replay"]')!.textContent = "recorded summaries only / 0 runtime side effects";
    assetButton("Final verify restored Content").disabled = false;
  });
  assetButton("Final verify restored Content").addEventListener("click", () => {
    clicks.push("final-verify");
    asset.querySelector('[data-mvp15d-observation="asset-final-verification"]')!.textContent = "passed";
    assetButton("Inspect recorded asset replay").disabled = false;
  });
  assetButton("Inspect recorded asset replay").addEventListener("click", () => {
    clicks.push("inspect-replay");
    asset.querySelector('[data-mvp15d-observation="asset-replay-inspection"]')!.textContent = "recorded";
  });
}

function clearDom() {
  document.body.innerHTML = "";
}

afterEach(() => {
  if (bridgeAssetListener) globalThis.window.removeEventListener("uagent:mvp15d-asset-action", bridgeAssetListener);
  bridgeAssetListener = null;
  clearDom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  adapterMock.createDesktopRuntimeAdapter.mockReset();
  evidenceMock.readMvp15dProductStoreEvidence.mockClear();
  evidenceMock.readMvp15dUiStoreEvidence.mockClear();
  evidenceMock.runMvp15dUiBridgeAction.mockClear();
});

function productAdapter(overrides: Record<string, unknown> = {}) {
  const base = {
    setMcpEndpoint: vi.fn(),
    connectMcp: vi.fn().mockResolvedValue(undefined),
    discoverMcp: vi.fn(),
    getMcpState: () => ({
      status: "connected",
      endpoint: "http://127.0.0.1:1/mcp",
      protocolVersion: "2025-06-18",
    }),
    getMcpDiscovery: () => ({ tools: [{ name: "ue.asset.read" }] }),
    getMvp15AssetTools: () => [{ name: "ue.asset.read" }],
    getMvp15LiveAssetToolsetFingerprint: () => ({ discoveryGeneration: 1 }),
    disconnectMcp: vi.fn(),
  };
  return { ...base, ...overrides };
}

describe("R5.3 capability-only product binding", () => {
  it("verifies the complete operation surface without opening MCP/network/asset", async () => {
    mountProductControls([]);
    const configured = configuration({ phase: "product-capture" });
    const { invoke, steps } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configured as never);
      return invoke(command, payload);
    };
    await startMvp15dRuntimeBridge(configuredInvoke);
    const recordedSteps = steps
      .filter(({ command }) => command === "mvp15d_bridge_record_renderer_step")
      .map(({ payload }) => (payload as { input: { step: string } }).input.step);
    expect(recordedSteps).toEqual([
      "renderer_ready",
      "native_bridge_bound",
      "normal_product_path_bound",
      "capability_confirmed",
    ]);
    expect(adapterMock.createDesktopRuntimeAdapter).not.toHaveBeenCalled();
  });

  it("fails when a required rendered product control is missing", async () => {
    mountProductControls([]);
    Array.from(document.querySelectorAll('[aria-label="MCP connection"] button')).find(
      (candidate) => candidate.textContent?.trim() === "Discover",
    )?.remove();
    const configured = configuration({ phase: "product-capture" });
    const { invoke } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configured as never);
      return invoke(command, payload);
    };
    await expect(startMvp15dRuntimeBridge(configuredInvoke)).rejects.toThrow(
      "mvp15d_rendered_button_missing",
    );
  });
});

describe("R5.3 capability-only rendered UI binding", () => {
  it("locates the actual root control and validate/trust buttons", async () => {
    mountUiControls();
    const { invoke, steps } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configuration() as never);
      return invoke(command, payload);
    };
    await startMvp15dRuntimeBridge(configuredInvoke, fixedAuthorityAdapter);
    const recordedSteps = steps
      .filter(({ command }) => command === "mvp15d_bridge_record_renderer_step")
      .map(({ payload }) => (payload as { input: { step: string } }).input.step);
    expect(recordedSteps).toEqual([
      "renderer_ready",
      "native_bridge_bound",
      "rendered_driver_bound",
      "capability_confirmed",
    ]);
  });

  it("rejects a missing root control", async () => {
    document.body.innerHTML = `<button>Validate project root</button><button>Trust project root</button>`;
    const { invoke } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configuration() as never);
      return invoke(command, payload);
    };
    await expect(startMvp15dRuntimeBridge(configuredInvoke)).rejects.toThrow(
      "mvp15d_rendered_input_missing",
    );
  });

  it("rejects duplicate rendered buttons", async () => {
    document.body.innerHTML = `
      <label for="projectRootRef2">Project root reference</label>
      <input id="projectRootRef2" type="text" />
      <button>Validate project root</button>
      <button>Validate project root</button>
      <button>Trust project root</button>
    `;
    const { invoke } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configuration() as never);
      return invoke(command, payload);
    };
    await expect(startMvp15dRuntimeBridge(configuredInvoke)).rejects.toThrow(
      "mvp15d_rendered_button_duplicate",
    );
  });
});

describe("R5.3 live product ordered calls through a deterministic local fake transport", () => {
  it("calls connect -> initialize -> discover -> normalize -> fingerprint in order", async () => {
    mountProductControls([]);
    const configured = configuration({
      phase: "product-capture",
      mode: "live",
      endpoint: "http://127.0.0.1:18765/mcp",
      projectRoot: "C:\\repo\\external\\mvp15d-final-d13-d16-20260731_120000\\project\\FinalHost",
    });
    const { invoke, steps } = stepCollectingInvoke("run-product-capture");
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configured as never);
      return invoke(command, payload);
    };
    await startMvp15dRuntimeBridge(configuredInvoke, fixedAuthorityAdapter);
    const recordedSteps = steps
      .filter(({ command }) => command === "mvp15d_bridge_record_renderer_step")
      .map(({ payload }) => (payload as { input: { step: string } }).input.step);
    expect(recordedSteps).toEqual([
      "renderer_ready",
      "native_bridge_bound",
      "validate",
      "add",
      "confirmTrust",
      "observationDiscover",
      "observationAttach",
      "observationReady",
      "connect",
      "initialize",
      "discover",
      "normalize",
      "fingerprint",
      "disconnect",
    ]);
    expect(evidenceMock.runMvp15dUiBridgeAction).toHaveBeenCalledWith("productAuthority");
  });

  it("drives the mounted product UI without constructing a second runtime adapter", async () => {
    const clicks: string[] = [];
    mountProductControls(clicks);
    adapterMock.createDesktopRuntimeAdapter.mockReturnValue(productAdapter());
    const configured = configuration({
      phase: "product-capture",
      mode: "live",
      endpoint: "http://127.0.0.1:18765/mcp",
      projectRoot: "C:\\repo\\external\\mvp15d-final-d13-d16-20260731_120000\\project\\FinalHost",
    });
    const { invoke } = stepCollectingInvoke("run-product-capture");
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configured as never);
      return invoke(command, payload);
    };

    await startMvp15dRuntimeBridge(configuredInvoke, fixedAuthorityAdapter);

    expect(adapterMock.createDesktopRuntimeAdapter).not.toHaveBeenCalled();
    expect(clicks).toEqual([
      "validate",
      "trust",
      "editor-discover",
      "editor-attach",
      "editor-snapshot",
      "connect",
      "discover",
      "verify-companion",
      "disconnect",
    ]);
  });
});

describe("R5.3 live UI validate/add/confirmTrust ordering on a task-owned fixture root", () => {
  function liveUiInvoke(projectRoot: string) {
    const { invoke, steps } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") {
        return Promise.resolve(
          configuration({
            mode: "live",
            projectRoot,
            endpoint: "http://127.0.0.1:18765/mcp",
          }) as never,
        );
      }
      if (command === "mvp15d_bridge_take_driver_command") return Promise.resolve("run-ui-lifecycle" as never);
      if (command === "mvp15d_bridge_record_renderer_step") {
        steps.push({ command, payload });
        return Promise.resolve({ accepted: true } as never);
      }
      return invoke(command, payload);
    };
    return { configuredInvoke, steps };
  }

  it("drives validate, add, then confirmTrust in order on a mounted fixture root", async () => {
    mountProductControls([]);
    const projectRoot = "C:\\repo\\external\\mvp15d-final-d13-d16-20260731_120000";
    const { configuredInvoke, steps } = liveUiInvoke(projectRoot);
    await startMvp15dRuntimeBridge(configuredInvoke, fixedAuthorityAdapter);
    const recordedSteps = steps
      .filter(({ command }) => command === "mvp15d_bridge_record_renderer_step")
      .map(({ payload }) => (payload as { input: { step: string } }).input.step);
    expect(recordedSteps).toEqual([
      "renderer_ready",
      "native_bridge_bound",
      "validate",
      "add",
      "confirmTrust",
      "observationDiscover",
      "observationAttach",
      "observationReady",
      "mcpConnect",
      "mcpInitialize",
      "mcpDiscover",
      "mcpNormalize",
      "mcpFingerprint",
      "dryRun",
      "approve",
      "register",
      "execute",
      "verify",
      "crossTtl",
      "rollback",
      "finalVerify",
      "replay",
      "observationStop",
      "mcpDisconnect",
    ]);
    expect(evidenceMock.runMvp15dUiBridgeAction).toHaveBeenCalledWith("uiAuthority");
  });
});

describe("R5.3 default off, error propagation and terminal closeout absence", () => {
  it("does nothing when the bridge is disabled in ordinary startup", async () => {
    const { invoke, steps } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") {
        return Promise.resolve(configuration({ enabled: false }) as never);
      }
      return invoke(command, payload);
    };
    await startMvp15dRuntimeBridge(configuredInvoke);
    expect(
      steps.some(({ command }) => command === "mvp15d_bridge_record_renderer_step"),
    ).toBe(false);
    expect(steps.some(({ command }) => command === "mvp15d_bridge_complete")).toBe(false);
  });

  it.each([
    ["pending", null, "mvp15d_renderer_parent_lifecycle_acknowledgement_missing"],
    ["failed", "successor_build_failed", "mvp15d_renderer_parent_lifecycle_failed:successor_build_failed"],
  ] as const)(
    "fails immediately for a %s parent lifecycle acknowledgement",
    async (status, failure, expectedError) => {
      const commands: string[] = [];
      const invoke: NativeInvoke = async <T,>(command: string) => {
        commands.push(command);
        if (command === "mvp15d_bridge_configuration") {
          return configuration({
            mode: "live",
            phase: "product-capture",
            rendererHandoffPending: false,
            rendererHandoffId: `renderer-handoff:${"a".repeat(64)}`,
            rendererParentLifecycleStatus: status,
            rendererParentLifecycleFailure: failure,
          }) as T;
        }
        throw new Error(`unexpected_parent_lifecycle_command:${command}`);
      };

      await expect(startMvp15dRuntimeBridge(invoke)).rejects.toThrow(expectedError);
      expect(commands).toEqual(["mvp15d_bridge_configuration"]);
    },
  );

  it("rejects an acknowledged successor configuration without the parent-issued window identity", async () => {
    const invoke: NativeInvoke = async <T,>(command: string) => {
      if (command === "mvp15d_bridge_configuration") {
        return configuration({
          mode: "live",
          phase: "product-capture",
          rendererHandoffPending: true,
          rendererHandoffId: `renderer-handoff:${"a".repeat(64)}`,
          rendererParentLifecycleStatus: "acknowledged",
          rendererHandoffPredecessorMcpGeneration: 3,
        }) as T;
      }
      throw new Error(`unexpected_window_identity_command:${command}`);
    };

    await expect(startMvp15dRuntimeBridge(invoke)).rejects.toThrow(
      "mvp15d_renderer_predecessor_window_identity_missing",
    );
  });

  it("propagates product failure without completing the bridge (no terminal closeout)", async () => {
    mountProductControls([]);
    Array.from(document.querySelectorAll('[aria-label="MCP connection"] button')).find(
      (candidate) => candidate.textContent?.trim() === "Discover",
    )?.remove();
    const configured = configuration({ phase: "product-capture" });
    const { invoke, steps } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configured as never);
      return invoke(command, payload);
    };
    await expect(startMvp15dRuntimeBridge(configuredInvoke, fixedAuthorityAdapter)).rejects.toThrow(
      "mvp15d_rendered_button_missing",
    );
    expect(steps.some(({ command }) => command === "mvp15d_bridge_complete")).toBe(false);
  });
});
