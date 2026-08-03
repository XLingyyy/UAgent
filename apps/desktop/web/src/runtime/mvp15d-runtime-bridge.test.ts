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

type NativeInvoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    bridgeVersion: "uagent.mvp15d.runtime-bridge.v1",
    phase: "ui-lifecycle",
    mode: "capability-only",
    taskId: "TASK-MVP15D-UAGENT-RUNTIME-BRIDGE",
    session: "uagent-runtime-bridge-session-0001",
    generation: 1,
    endpoint: null,
    projectRoot: null,
    renderedProductPath: "validate,add,confirmTrust",
    driverPollMilliseconds: 50,
    ...overrides,
  };
}

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

function clearDom() {
  document.body.innerHTML = "";
}

afterEach(() => {
  clearDom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  adapterMock.createDesktopRuntimeAdapter.mockReset();
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
    const configured = configuration({ phase: "product-capture" });
    const { invoke, steps } = stepCollectingInvoke();
    adapterMock.createDesktopRuntimeAdapter.mockReturnValue(productAdapter());
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
    expect(adapterMock.createDesktopRuntimeAdapter).toHaveBeenCalledTimes(1);
    // No operation was invoked in capability-only mode (no MCP/network/asset).
    const adapter = adapterMock.createDesktopRuntimeAdapter.mock.results[0].value;
    expect(adapter.connectMcp).not.toHaveBeenCalled();
    expect(adapter.discoverMcp).not.toHaveBeenCalled();
    expect(adapter.disconnectMcp).not.toHaveBeenCalled();
  });

  it("fails when a required product operation is missing", async () => {
    const configured = configuration({ phase: "product-capture" });
    adapterMock.createDesktopRuntimeAdapter.mockReturnValue(
      productAdapter({ getMvp15AssetTools: undefined }),
    );
    const { invoke } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configured as never);
      return invoke(command, payload);
    };
    await expect(startMvp15dRuntimeBridge(configuredInvoke)).rejects.toThrow(
      "mvp15d_normal_product_path_unavailable",
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
    await startMvp15dRuntimeBridge(configuredInvoke);
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
    const adapter = productAdapter({
      initialize: vi.fn(),
      setMcpEndpoint: vi.fn(),
    });
    adapterMock.createDesktopRuntimeAdapter.mockReturnValue(adapter);
    const configured = configuration({
      phase: "product-capture",
      mode: "live",
      endpoint: "http://127.0.0.1:18765/mcp",
    });
    const { invoke, steps } = stepCollectingInvoke("run-product-capture");
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
      "connect",
      "initialize",
      "discover",
      "normalize",
      "fingerprint",
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
      if (command === "mvp15d_bridge_take_driver_command") {
        // Simulate the native side enabling the trust button and recording the
        // trusted state after add, so the renderer wait-until polls resolve
        // without a real click handler in jsdom.
        return Promise.resolve("run-ui-lifecycle" as never);
      }
      if (command === "mvp15d_bridge_record_renderer_step") {
        const step = (payload as { input: { step: string } }).input.step;
        steps.push({ command, payload });
        if (step === "add") {
          const trust = Array.from(document.querySelectorAll("button")).find(
            (candidate) => candidate.textContent?.trim() === "Trust project root",
          );
          if (trust instanceof HTMLButtonElement) trust.disabled = false;
          // Reflect the trusted state so the renderer's confirmTrust wait
          // resolves in jsdom (no real click handler).
          const leaf = document.createElement("span");
          leaf.textContent = "trusted";
          leaf.dataset.mvp15dCapability = "true";
          document.body.append(leaf);
        }
        return Promise.resolve({ accepted: true } as never);
      }
      return invoke(command, payload);
    };
    return { configuredInvoke, steps };
  }

  it("drives validate, add, then confirmTrust in order on a mounted fixture root", async () => {
    mountUiControls();
    const projectRoot = "C:\\repo\\external\\mvp15d-final-d13-d16-20260731_120000";
    const { configuredInvoke, steps } = liveUiInvoke(projectRoot);
    await startMvp15dRuntimeBridge(configuredInvoke);
    const recordedSteps = steps
      .filter(({ command }) => command === "mvp15d_bridge_record_renderer_step")
      .map(({ payload }) => (payload as { input: { step: string } }).input.step);
    expect(recordedSteps[recordedSteps.length - 3]).toBe("validate");
    expect(recordedSteps[recordedSteps.length - 2]).toBe("add");
    expect(recordedSteps[recordedSteps.length - 1]).toBe("confirmTrust");
    expect(recordedSteps.length).toBeGreaterThanOrEqual(5);
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

  it("propagates product failure without completing the bridge (no terminal closeout)", async () => {
    const configured = configuration({ phase: "product-capture" });
    adapterMock.createDesktopRuntimeAdapter.mockReturnValue(
      productAdapter({ getMvp15AssetTools: undefined }),
    );
    const { invoke, steps } = stepCollectingInvoke();
    const configuredInvoke: NativeInvoke = (command, payload) => {
      if (command === "mvp15d_bridge_configuration") return Promise.resolve(configured as never);
      return invoke(command, payload);
    };
    await expect(startMvp15dRuntimeBridge(configuredInvoke)).rejects.toThrow(
      "mvp15d_normal_product_path_unavailable",
    );
    expect(steps.some(({ command }) => command === "mvp15d_bridge_complete")).toBe(false);
  });
});
