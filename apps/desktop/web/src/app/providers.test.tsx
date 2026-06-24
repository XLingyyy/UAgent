import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UIProvider, useUI } from "./providers";

function Probe() {
  const { state, toggleInspector } = useUI();
  return (
    <div>
      <span data-testid="inspector-open">{String(state.inspector.open)}</span>
      <button type="button" onClick={toggleInspector}>
        toggle
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
});
