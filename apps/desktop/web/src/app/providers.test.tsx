import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UIProvider, useUI } from "./providers";
import type { ProviderConfig } from "../types/provider";

function Probe() {
  const {
    state,
    toggleInspector,
    setActiveProject,
    setActiveNav,
    setActiveThread,
    setTheme,
    openSettings,
    closeSettings,
    setActiveSettingsPage,
    setComposerInput,
    setComposerPermission,
    setComposerModel,
    setComposerReasoning,
  } = useUI();

  return (
    <div>
      <span data-testid="inspector-open">{String(state.layout.inspector.open)}</span>
      <span data-testid="theme">{state.layout.theme}</span>
      <span data-testid="active-nav">{state.layout.sidebar.activeNav}</span>
      <span data-testid="active-project">{state.project.activeProjectId ?? "null"}</span>
      <span data-testid="active-thread">{state.thread.activeThreadId ?? "null"}</span>
      <span data-testid="settings-open">{String(state.settings.open)}</span>
      <span data-testid="settings-page">{state.settings.activePageId}</span>
      <span data-testid="composer-input">{state.composer.input}</span>
      <span data-testid="composer-permission">{state.composer.permission}</span>
      <span data-testid="composer-model">{state.composer.selectedModelId}</span>
      <span data-testid="composer-reasoning">{state.composer.reasoningEffort}</span>
      <button type="button" onClick={toggleInspector}>
        toggle
      </button>
      <button type="button" onClick={() => setTheme("light")} data-testid="set-light-theme">
        set light
      </button>
      <button type="button" onClick={() => setActiveNav("projects")} data-testid="set-projects">
        set projects
      </button>
      <button type="button" onClick={() => setActiveThread("thread-2")} data-testid="set-thread">
        set thread
      </button>
      <button type="button" onClick={() => setActiveProject("mech")} data-testid="set-mech">
        set mech
      </button>
      <button type="button" onClick={() => setActiveProject(null)} data-testid="set-none">
        set none
      </button>
      <button type="button" onClick={() => openSettings()} data-testid="open-settings-default">
        open settings
      </button>
      <button
        type="button"
        onClick={() => openSettings("provider")}
        data-testid="open-settings-provider"
      >
        open provider
      </button>
      <button
        type="button"
        onClick={() => setActiveSettingsPage("appearance")}
        data-testid="set-page-appearance"
      >
        set appearance
      </button>
      <button type="button" onClick={closeSettings} data-testid="close-settings">
        close settings
      </button>
      <button
        type="button"
        onClick={() => setComposerInput("draft prompt")}
        data-testid="set-composer-input"
      >
        set composer input
      </button>
      <button
        type="button"
        onClick={() => setComposerPermission("auto-approve")}
        data-testid="set-composer-permission"
      >
        set composer permission
      </button>
      <button
        type="button"
        onClick={() => setComposerModel("openai-gpt-5")}
        data-testid="set-composer-model"
      >
        set composer model
      </button>
      <button
        type="button"
        onClick={() => setComposerReasoning("high")}
        data-testid="set-composer-reasoning"
      >
        set composer reasoning
      </button>
    </div>
  );
}

describe("UIProvider", () => {
  it("starts with the inspector closed by default", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
  });

  it("starts with dark theme by default", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("updates theme through setTheme", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("set-light-theme"));
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("toggles the inspector open then closed", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    const button = screen.getByText("toggle");
    fireEvent.click(button);
    expect(screen.getByTestId("inspector-open").textContent).toBe("true");
    fireEvent.click(button);
    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
  });

  it("respects a custom initial inspector state", () => {
    render(
      <UIProvider initialState={{ layout: { inspector: { open: false } } }}>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
  });

  it("starts with default active project lyra", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-project").textContent).toBe("lyra");
  });

  it("sets active project to mech", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("set-mech"));
    expect(screen.getByTestId("active-project").textContent).toBe("mech");
  });

  it("sets active project to null (no project)", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("set-none"));
    expect(screen.getByTestId("active-project").textContent).toBe("null");
  });

  it("accepts custom initial activeProjectId", () => {
    render(
      <UIProvider initialState={{ project: { activeProjectId: "city" } }}>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-project").textContent).toBe("city");
  });

  it("accepts null initial activeProjectId", () => {
    render(
      <UIProvider initialState={{ project: { activeProjectId: null } }}>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-project").textContent).toBe("null");
  });

  it("starts with workspace nav and no active thread selected", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-nav").textContent).toBe("workspace");
    expect(screen.getByTestId("active-thread").textContent).toBe("null");
  });

  it("updates nav and thread in their own stores", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );

    fireEvent.click(screen.getByTestId("set-projects"));
    fireEvent.click(screen.getByTestId("set-thread"));

    expect(screen.getByTestId("active-nav").textContent).toBe("projects");
    expect(screen.getByTestId("active-thread").textContent).toBe("thread-2");
  });

  describe("composer store", () => {
    it("starts with the default mock composer values", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );

      expect(screen.getByTestId("composer-input").textContent).toBe("");
      expect(screen.getByTestId("composer-permission").textContent).toBe("request-approval");
      expect(screen.getByTestId("composer-model").textContent).toBe("not-configured");
      expect(screen.getByTestId("composer-reasoning").textContent).toBe("medium");
    });

    it("updates composer slices through dedicated actions", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );

      fireEvent.click(screen.getByTestId("set-composer-input"));
      fireEvent.click(screen.getByTestId("set-composer-permission"));
      fireEvent.click(screen.getByTestId("set-composer-model"));
      fireEvent.click(screen.getByTestId("set-composer-reasoning"));

      expect(screen.getByTestId("composer-input").textContent).toBe("draft prompt");
      expect(screen.getByTestId("composer-permission").textContent).toBe("auto-approve");
      expect(screen.getByTestId("composer-model").textContent).toBe("openai-gpt-5");
      expect(screen.getByTestId("composer-reasoning").textContent).toBe("high");
    });

    it("derives initial composer selection from the provider store default", () => {
      const customProviders: ProviderConfig[] = [
        {
          providerId: "studio",
          displayName: "Studio",
          baseUrl: "https://mock.studio.local/v1",
          wireApi: "responses",
          authMode: "env_key",
          secretRef: "STUDIO_KEY",
          enabled: true,
          models: [
            {
              id: "studio-gpt-5-1",
              label: "GPT-5.1 Custom",
              contextWindow: 256000,
              supportsReasoning: true,
              reasoningEfforts: ["medium", "high", "xhigh"],
            },
          ],
          defaultModel: "studio-gpt-5-1",
          defaultReasoningEffort: "high",
        },
      ];

      render(
        <UIProvider
          initialState={{
            provider: {
              providers: customProviders,
              selectedProviderId: "studio",
              defaultProviderId: "studio",
            },
          }}
        >
          <Probe />
        </UIProvider>,
      );

      expect(screen.getByTestId("composer-model").textContent).toBe("studio-gpt-5-1");
      expect(screen.getByTestId("composer-reasoning").textContent).toBe("high");
    });
  });

  describe("settings state", () => {
    it("starts with settings closed by default", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      expect(screen.getByTestId("settings-open").textContent).toBe("false");
    });

    it("defaults active settings page to general", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      expect(screen.getByTestId("settings-page").textContent).toBe("general");
    });

    it("opens settings with default page on openSettings()", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("open-settings-default"));
      expect(screen.getByTestId("settings-open").textContent).toBe("true");
      expect(screen.getByTestId("settings-page").textContent).toBe("general");
    });

    it("opens settings to provider page on openSettings('provider')", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("open-settings-provider"));
      expect(screen.getByTestId("settings-open").textContent).toBe("true");
      expect(screen.getByTestId("settings-page").textContent).toBe("provider");
    });

    it("sets active settings page to appearance", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("set-page-appearance"));
      expect(screen.getByTestId("settings-page").textContent).toBe("appearance");
    });

    it("closes settings on closeSettings()", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("open-settings-default"));
      fireEvent.click(screen.getByTestId("close-settings"));
      expect(screen.getByTestId("settings-open").textContent).toBe("false");
    });

    it("preserves active page after close and reopen with same page", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("open-settings-provider"));
      fireEvent.click(screen.getByTestId("close-settings"));
      fireEvent.click(screen.getByTestId("open-settings-provider"));
      expect(screen.getByTestId("settings-page").textContent).toBe("provider");
    });
  });
});
