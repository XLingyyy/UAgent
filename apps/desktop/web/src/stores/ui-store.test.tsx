import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UIProvider } from "../app/providers";
import { ConfigSettings } from "../settings/pages/ConfigSettings";
import {
  useComposerActions,
  useComposerStore,
  useLayoutActions,
  useLayoutStore,
  useProjectActions,
  useProjectStore,
  useProviderActions,
  useProviderStore,
  useRuntimeActions,
  useSettingsActions,
  useSettingsStore,
  useThreadActions,
  useThreadStore,
} from "./ui-store";
import type { ProviderConfig } from "../types/provider";
import {
  createDesktopRuntimeAdapter,
  type Mvp15dProductObservationPort,
} from "../runtime/desktop-runtime-adapter";

const tauriGlobal = globalThis as typeof globalThis & {
  __TAURI_INTERNALS__?: { invoke?: (command: string, payload?: unknown) => Promise<unknown> };
};
const previousTauriInternals = tauriGlobal.__TAURI_INTERNALS__;

afterEach(() => {
  tauriGlobal.__TAURI_INTERNALS__ = previousTauriInternals;
  vi.restoreAllMocks();
});

const customProviders: ProviderConfig[] = [
  {
    providerId: "provider-a",
    displayName: "Provider A",
    baseUrl: "https://mock.provider-a.local/v1",
    wireApi: "responses",
    authMode: "env_key",
    secretRef: "PROVIDER_A_KEY",
    enabled: true,
    models: [
      {
        id: "provider-a-model-1",
        label: "Provider A Model 1",
        contextWindow: 200000,
        supportsReasoning: true,
        reasoningEfforts: ["medium", "high"],
      },
      {
        id: "provider-a-model-2",
        label: "Provider A Model 2",
        contextWindow: 128000,
        supportsReasoning: true,
        reasoningEfforts: ["low", "medium"],
      },
    ],
    defaultModel: "provider-a-model-1",
    defaultReasoningEffort: "high",
  },
  {
    providerId: "provider-b",
    displayName: "Provider B",
    baseUrl: "http://127.0.0.1:11434/v1",
    wireApi: "openai_compatible",
    authMode: "none",
    enabled: true,
    models: [
      {
        id: "provider-b-model-1",
        label: "Provider B Model 1",
        contextWindow: 64000,
        supportsReasoning: true,
        reasoningEfforts: ["low", "medium", "high"],
      },
    ],
    defaultModel: "provider-b-model-1",
    defaultReasoningEffort: "low",
  },
];

function SliceProbe() {
  const inspectorOpen = useLayoutStore((state) => String(state.inspector.open));
  const activeNav = useLayoutStore((state) => state.sidebar.activeNav);
  const activeProjectId = useProjectStore((state) => state.activeProjectId ?? "null");
  const activeThreadId = useThreadStore((state) => state.activeThreadId ?? "null");
  const settingsOpen = useSettingsStore((state) => String(state.open));
  const settingsPage = useSettingsStore((state) => state.activePageId);
  const composerInput = useComposerStore((state) => state.input);
  const composerModel = useComposerStore((state) => state.selectedModelId);
  const composerReasoning = useComposerStore((state) => state.reasoningEffort);
  const selectedProviderId = useProviderStore((state) => state.selectedProviderId ?? "null");
  const defaultProviderId = useProviderStore((state) => state.defaultProviderId ?? "null");
  const providerTestStatus = useProviderStore((state) => state.testStatus);

  const layoutActions = useLayoutActions();
  const settingsActions = useSettingsActions();
  const projectActions = useProjectActions();
  const threadActions = useThreadActions();
  const composerActions = useComposerActions();
  const providerActions = useProviderActions();

  return (
    <div>
      <span data-testid="inspector-open">{inspectorOpen}</span>
      <span data-testid="active-nav">{activeNav}</span>
      <span data-testid="active-project">{activeProjectId}</span>
      <span data-testid="active-thread">{activeThreadId}</span>
      <span data-testid="settings-open">{settingsOpen}</span>
      <span data-testid="settings-page">{settingsPage}</span>
      <span data-testid="composer-input">{composerInput}</span>
      <span data-testid="composer-model">{composerModel}</span>
      <span data-testid="composer-reasoning">{composerReasoning}</span>
      <span data-testid="selected-provider">{selectedProviderId}</span>
      <span data-testid="default-provider">{defaultProviderId}</span>
      <span data-testid="provider-test-status">{providerTestStatus}</span>

      <button type="button" onClick={layoutActions.toggleInspector}>
        toggle inspector
      </button>
      <button type="button" onClick={() => layoutActions.setActiveNav("projects")}>
        set nav projects
      </button>
      <button type="button" onClick={() => layoutActions.setActiveNav("settings")}>
        set nav settings
      </button>
      <button type="button" onClick={() => settingsActions.openSettings("provider")}>
        open provider settings
      </button>
      <button type="button" onClick={settingsActions.closeSettings}>
        close settings
      </button>
      <button type="button" onClick={() => projectActions.setActiveProject("mech")}>
        set active project
      </button>
      <button type="button" onClick={() => threadActions.setActiveThread("thread-2")}>
        set active thread
      </button>
      <button type="button" onClick={() => composerActions.setComposerInput("draft prompt")}>
        set composer input
      </button>
      <button type="button" onClick={() => composerActions.setComposerModel("provider-a-model-2")}>
        set composer model
      </button>
      <button type="button" onClick={() => providerActions.setSelectedProvider("provider-b")}>
        select provider b
      </button>
      <button
        type="button"
        onClick={() =>
          providerActions.saveProvider({
            ...customProviders[0],
            defaultModel: "provider-a-model-2",
            defaultReasoningEffort: "low",
          })
        }
      >
        save provider a alt default
      </button>
      <button type="button" onClick={() => providerActions.setDefaultProvider("provider-b")}>
        set default provider b
      </button>
      <button type="button" onClick={() => providerActions.deleteProvider("provider-b")}>
        delete provider b
      </button>
      <button type="button" onClick={() => providerActions.setProviderTestStatus("success")}>
        set provider test success
      </button>
    </div>
  );
}

function renderSliceProbe() {
  return render(
    <UIProvider
      initialState={{
        provider: {
          providers: customProviders,
          selectedProviderId: "provider-a",
          defaultProviderId: "provider-a",
        },
      }}
    >
      <SliceProbe />
    </UIProvider>,
  );
}

function ProjectStateJsonProbe() {
  const project = useProjectStore((state) => state);

  return <pre data-testid="project-json">{JSON.stringify(project)}</pre>;
}

function RuntimeActionProbe() {
  const { requestBrowserPreview } = useRuntimeActions();

  return (
    <button
      type="button"
      onClick={() =>
        requestBrowserPreview(
          "file:///[project-root]/Saved/Automation/report.html",
          "task-browser",
          "root:active-project",
        )
      }
    >
      request trusted file preview
    </button>
  );
}

describe("ui-store", () => {
  it("starts each slice with its expected seeded defaults", () => {
    renderSliceProbe();

    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
    expect(screen.getByTestId("active-nav").textContent).toBe("workspace");
    expect(screen.getByTestId("active-project").textContent).toBe("lyra");
    expect(screen.getByTestId("active-thread").textContent).toBe("null");
    expect(screen.getByTestId("settings-open").textContent).toBe("false");
    expect(screen.getByTestId("settings-page").textContent).toBe("general");
    expect(screen.getByTestId("composer-input").textContent).toBe("");
    expect(screen.getByTestId("composer-model").textContent).toBe("provider-a-model-1");
    expect(screen.getByTestId("composer-reasoning").textContent).toBe("high");
    expect(screen.getByTestId("selected-provider").textContent).toBe("provider-a");
    expect(screen.getByTestId("default-provider").textContent).toBe("provider-a");
    expect(screen.getByTestId("provider-test-status").textContent).toBe("idle");
  });

  it("updates each domain through its dedicated slice actions", () => {
    renderSliceProbe();

    fireEvent.click(screen.getByText("toggle inspector"));
    fireEvent.click(screen.getByText("set nav projects"));
    fireEvent.click(screen.getByText("open provider settings"));
    fireEvent.click(screen.getByText("set active project"));
    fireEvent.click(screen.getByText("set active thread"));
    fireEvent.click(screen.getByText("set composer input"));
    fireEvent.click(screen.getByText("set composer model"));
    fireEvent.click(screen.getByText("select provider b"));

    expect(screen.getByTestId("inspector-open").textContent).toBe("true");
    expect(screen.getByTestId("active-nav").textContent).toBe("projects");
    expect(screen.getByTestId("settings-open").textContent).toBe("true");
    expect(screen.getByTestId("settings-page").textContent).toBe("provider");
    expect(screen.getByTestId("active-project").textContent).toBe("mech");
    expect(screen.getByTestId("active-thread").textContent).toBe("thread-2");
    expect(screen.getByTestId("composer-input").textContent).toBe("draft prompt");
    expect(screen.getByTestId("composer-model").textContent).toBe("provider-a-model-2");
    expect(screen.getByTestId("selected-provider").textContent).toBe("provider-b");
    expect(screen.getByTestId("default-provider").textContent).toBe("provider-a");
  });

  it("resets Settings navigation to Workspace when closing Settings", () => {
    renderSliceProbe();

    fireEvent.click(screen.getByText("set nav settings"));
    fireEvent.click(screen.getByText("open provider settings"));
    fireEvent.click(screen.getByText("close settings"));

    expect(screen.getByTestId("settings-open").textContent).toBe("false");
    expect(screen.getByTestId("active-nav").textContent).toBe("workspace");
  });

  it("preserves non-Settings navigation and active page when closing Settings", () => {
    renderSliceProbe();

    fireEvent.click(screen.getByText("set nav projects"));
    fireEvent.click(screen.getByText("open provider settings"));
    fireEvent.click(screen.getByText("close settings"));

    expect(screen.getByTestId("settings-open").textContent).toBe("false");
    expect(screen.getByTestId("active-nav").textContent).toBe("projects");
    expect(screen.getByTestId("settings-page").textContent).toBe("provider");
  });

  it("resyncs composer defaults when provider defaults change or disappear", () => {
    renderSliceProbe();

    fireEvent.click(screen.getByText("save provider a alt default"));
    expect(screen.getByTestId("composer-model").textContent).toBe("provider-a-model-2");
    expect(screen.getByTestId("composer-reasoning").textContent).toBe("low");

    fireEvent.click(screen.getByText("set default provider b"));
    expect(screen.getByTestId("default-provider").textContent).toBe("provider-b");
    expect(screen.getByTestId("composer-model").textContent).toBe("provider-b-model-1");
    expect(screen.getByTestId("composer-reasoning").textContent).toBe("low");

    fireEvent.click(screen.getByText("delete provider b"));
    expect(screen.getByTestId("default-provider").textContent).toBe("null");
    expect(screen.getByTestId("composer-model").textContent).toBe("not-configured");
    expect(screen.getByTestId("composer-reasoning").textContent).toBe("medium");
  });

  it("tracks provider fixture test status without changing provider config", () => {
    renderSliceProbe();

    fireEvent.click(screen.getByText("set provider test success"));

    expect(screen.getByTestId("provider-test-status").textContent).toBe("success");
    expect(screen.getByTestId("selected-provider").textContent).toBe("provider-a");
  });

  it("keeps raw native project root input out of project store and DOM after validation", async () => {
    const rawRoot = "C:/Users/Ada/LyraStarter";
    const invoke = vi.fn(async (command: string) => {
      if (command === "validate_native_project_root") {
        return {
          ok: true,
          reason: "valid",
          displayRoot: "[user-home]/LyraStarter",
          projectName: "LyraStarter",
          engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    tauriGlobal.__TAURI_INTERNALS__ = { invoke };

    render(
      <UIProvider>
        <ConfigSettings />
        <ProjectStateJsonProbe />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Project root reference"), {
      target: { value: rawRoot },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate project root" }));

    expect(await screen.findByText("Validation ready: LyraStarter")).toBeTruthy();
    const addProjectRoot = screen.getByRole("button", { name: "Add project root" });
    const trustProjectRoot = screen.getByRole("button", { name: "Trust project root" });
    await waitFor(() => expect((addProjectRoot as HTMLButtonElement).disabled).toBe(false));
    expect((trustProjectRoot as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-mvp15d-observation="project-validation"]')?.getAttribute("data-mvp15d-value"))
      .toBe("valid");
    fireEvent.click(addProjectRoot);
    expect(await screen.findByText("[user-home]/LyraStarter")).toBeTruthy();
    await waitFor(() => expect((trustProjectRoot as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelector('[data-mvp15d-observation="project-add"]')?.getAttribute("data-mvp15d-value"))
      .toBe("added");
    expect(invoke).toHaveBeenCalledWith("validate_native_project_root", {
      input: { rootRef: rawRoot },
    });

    await waitFor(() => {
      expect(screen.getByTestId("project-json").textContent).not.toContain("C:/Users/Ada");
    });
    expect(screen.queryByDisplayValue(rawRoot)).toBeNull();
    expect(document.body.textContent).not.toContain("C:/Users/Ada");
  });

  it("routes rendered MVP15D product controls through the ordered store handlers", async () => {
    const calls: string[] = [];
    let generation = 0;
    const receipt = (label: string, request: Record<string, unknown> = {}) => ({
      receiptId: `fixture-receipt:${label}`,
      request,
    });
    const productPort: Mvp15dProductObservationPort = {
      readMutationCounters: async () => ({ dryRun: 0, execute: 0, rollback: 0 }),
      discover: async ({ toolSearchEnabled }) => {
        generation += 1;
        const mode = toolSearchEnabled ? "on" as const : "off" as const;
        calls.push(`discover:${mode}`);
        return {
          mode,
          configCall: receipt(`config-${generation}`, { intent: { toolSearchMode: mode } }),
          rendererInstanceCall: receipt(`renderer-${generation}`),
          connectCall: receipt(`connect-${generation}`),
          initializeCall: receipt(`initialize-${generation}`),
          discoverCall: receipt(`discover-${generation}`),
          normalizeCall: receipt(`normalize-${generation}`),
          fingerprintCall: receipt(`fingerprint-${generation}`),
          nativeAttestation: receipt(`attestation-${generation}`),
          mutationCounterCall: receipt(`counter-${generation}`),
          toolSearchCalls: toolSearchEnabled ? [receipt(`tool-search-${generation}`)] : [],
        };
      },
      retract: async (reason) => {
        generation += 1;
        calls.push(`retract:${reason}`);
        return {
          reason,
          readyDiscovery: {
            mode: "off",
            configCall: receipt(`ready-config-${generation}`, { intent: { toolSearchMode: "off" } }),
            rendererInstanceCall: receipt(`ready-renderer-${generation}`),
            connectCall: receipt(`ready-connect-${generation}`),
            initializeCall: receipt(`ready-initialize-${generation}`),
            discoverCall: receipt(`ready-discover-${generation}`),
            normalizeCall: receipt(`ready-normalize-${generation}`),
            fingerprintCall: receipt(`ready-fingerprint-${generation}`),
            nativeAttestation: receipt(`ready-attestation-${generation}`),
            mutationCounterCall: receipt(`ready-counter-${generation}`),
            toolSearchCalls: [],
          },
          rendererInstanceCall: receipt(`retraction-renderer-${generation}`),
          transitionCall: receipt(`transition-${generation}`, { reason }),
          nativeRetraction: receipt(`native-retraction-${generation}`, { reason }),
        };
      },
    };
    const runtimeClient = createDesktopRuntimeAdapter({
      nativeInvoke: null,
      mvp15dFixtureProductObservationPort: productPort,
    });
    render(
      <UIProvider runtimeClient={runtimeClient}>
        <ConfigSettings />
      </UIProvider>,
    );

    const controls: Array<[string, string]> = [
      ["Tool Search ON", "tool_search_on"],
      ["Tool Search OFF", "tool_search_off"],
      ["RefreshTools", "tools_refreshed"],
      ["MCP reconnect", "mcp_reconnected"],
      ["Change MCP endpoint", "endpoint_changed"],
      ["Restart renderer", "renderer_restart_completed"],
      ["Retract after UE restart", "ue_restart_retracted"],
      ["Reject stale completion", "stale_completion_retracted"],
    ];
    for (const [name, status] of controls) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => {
        expect(document.querySelector('[data-mvp15d-observation="product-control-status"]')?.getAttribute("data-mvp15d-value"))
          .toBe(status);
      });
    }

    expect(calls).toEqual([
      "discover:on",
      "discover:off",
      "retract:refresh_tools",
      "retract:reconnect",
      "retract:endpoint_change",
      "retract:renderer_restart",
      "retract:ue_restart",
      "retract:stale_completion",
    ]);
    expect(screen.getByRole("button", { name: "Tool Search OFF" }).getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("forwards trusted browser preview root to the runtime service", () => {
    const runtimeClient = createDesktopRuntimeAdapter();
    const requestPreview = vi
      .spyOn(runtimeClient.getMvp9().browser, "requestPreview")
      .mockResolvedValue(undefined);

    render(
      <UIProvider runtimeClient={runtimeClient}>
        <RuntimeActionProbe />
      </UIProvider>,
    );

    fireEvent.click(screen.getByText("request trusted file preview"));

    expect(requestPreview).toHaveBeenCalledWith(
      "file:///[project-root]/Saved/Automation/report.html",
      "task-browser",
      "root:active-project",
    );
  });
});
