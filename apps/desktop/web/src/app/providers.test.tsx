import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UIProvider, useUI } from "./providers";

function Probe() {
  const { state, toggleInspector, setActiveProject } = useUI();
  return (
    <div>
      <span data-testid="inspector-open">{String(state.inspector.open)}</span>
      <span data-testid="active-project">{state.activeProjectId ?? "null"}</span>
      <button type="button" onClick={toggleInspector}>
        toggle
      </button>
      <button type="button" onClick={() => setActiveProject("mech")} data-testid="set-mech">
        set mech
      </button>
      <button type="button" onClick={() => setActiveProject(null)} data-testid="set-none">
        set none
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
});
