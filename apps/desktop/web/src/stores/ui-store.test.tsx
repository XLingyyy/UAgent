import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "../app/providers";
import {
  useComposerActions,
  useComposerStore,
  useLayoutActions,
  useLayoutStore,
  useProjectActions,
  useProjectStore,
  useProviderActions,
  useProviderStore,
  useSettingsActions,
  useSettingsStore,
  useThreadActions,
  useThreadStore,
} from "./ui-store";
import type { ProviderConfig } from "../types/provider";

const customProviders: ProviderConfig[] = [
  {
    providerId: "provider-a",
    displayName: "Provider A",
    baseUrl: "https://mock.provider-a.local/v1",
    wireApi: "responses",
    authMode: "env_key",
    envKey: "PROVIDER_A_KEY",
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

      <button type="button" onClick={layoutActions.toggleInspector}>
        toggle inspector
      </button>
      <button type="button" onClick={() => layoutActions.setActiveNav("projects")}>
        set nav projects
      </button>
      <button type="button" onClick={() => settingsActions.openSettings("provider")}>
        open provider settings
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

describe("ui-store", () => {
  it("starts each slice with its expected seeded defaults", () => {
    renderSliceProbe();

    expect(screen.getByTestId("inspector-open").textContent).toBe("true");
    expect(screen.getByTestId("active-nav").textContent).toBe("workspace");
    expect(screen.getByTestId("active-project").textContent).toBe("lyra");
    expect(screen.getByTestId("active-thread").textContent).toBe("thread-1");
    expect(screen.getByTestId("settings-open").textContent).toBe("false");
    expect(screen.getByTestId("settings-page").textContent).toBe("general");
    expect(screen.getByTestId("composer-input").textContent).toBe("");
    expect(screen.getByTestId("composer-model").textContent).toBe("provider-a-model-1");
    expect(screen.getByTestId("composer-reasoning").textContent).toBe("high");
    expect(screen.getByTestId("selected-provider").textContent).toBe("provider-a");
    expect(screen.getByTestId("default-provider").textContent).toBe("provider-a");
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

    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
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
});
