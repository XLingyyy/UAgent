import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { UIProvider } from "../app/providers";

function renderAppShell() {
  return render(
    <UIProvider>
      <AppShell />
    </UIProvider>,
  );
}

describe("AppShell", () => {
  it("renders the title bar with UAgent brand", () => {
    renderAppShell();
    expect(screen.getByText("UAgent")).toBeTruthy();
  });

  it("renders all four shell regions", () => {
    const { container } = renderAppShell();
    expect(container.querySelector(".ua-titlebar")).toBeTruthy();
    expect(container.querySelector(".ua-sidebar")).toBeTruthy();
    expect(container.querySelector(".ua-workspace")).toBeTruthy();
    expect(container.querySelector(".ua-inspector")).toBeTruthy();
    expect(container.querySelector(".ua-global-overlays")).toBeTruthy();
  });

  it("renders the ComposerDock placeholder in the workspace", () => {
    renderAppShell();
    expect(screen.getByText("ComposerDock placeholder")).toBeTruthy();
  });

  it("does not render any microphone or voice button", () => {
    const { container } = renderAppShell();
    const micElements = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(micElements.length).toBe(0);
  });
});
