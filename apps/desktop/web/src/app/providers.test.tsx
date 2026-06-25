import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UIProvider, useUI } from "./providers";

function Probe() {
  const {
    state,
    toggleInspector,
    setActiveProject,
    openSettings,
    closeSettings,
    setActiveSettingsPage,
  } = useUI();
  return (
    <div>
      <span data-testid="inspector-open">{String(state.inspector.open)}</span>
      <span data-testid="active-project">{state.activeProjectId ?? "null"}</span>
      <span data-testid="settings-open">{String(state.settings.open)}</span>
      <span data-testid="settings-page">{state.settings.activePageId}</span>
      <button type="button" onClick={toggleInspector}>
        toggle
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
    </div>
  );
}

describe("UIProvider", () => {
  it("starts with the inspector open by default", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("inspector-open").textContent).toBe("true");
  });

  it("toggles the inspector closed then open", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    const button = screen.getByText("toggle");
    fireEvent.click(button);
    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
    fireEvent.click(button);
    expect(screen.getByTestId("inspector-open").textContent).toBe("true");
  });

  it("respects a custom initial inspector state", () => {
    render(
      <UIProvider initialState={{ inspector: { open: false } }}>
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
      <UIProvider initialState={{ activeProjectId: "city" }}>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-project").textContent).toBe("city");
  });

  it("accepts null initial activeProjectId", () => {
    render(
      <UIProvider initialState={{ activeProjectId: null }}>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-project").textContent).toBe("null");
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
