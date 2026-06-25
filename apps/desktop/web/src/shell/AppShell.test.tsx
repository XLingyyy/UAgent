import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { UIProvider } from "../app/providers";

function renderAppShell() {
  return render(
    <UIProvider>
      <AppShell />
    </UIProvider>,
  );
}

function renderAppShellWithClosedInspector() {
  return render(
    <UIProvider initialState={{ inspector: { open: false } }}>
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

  it("renders the ComposerDock in the workspace with ProjectSelector", () => {
    renderAppShell();
    expect(screen.getByLabelText("Composer dock")).toBeTruthy();
    expect(screen.getByLabelText("Project selector: Lyra_Prototype")).toBeTruthy();
  });

  it("renders the LeftSidebar with current project", () => {
    renderAppShell();
    const projectNames = screen.getAllByText("Lyra_Prototype");
    expect(projectNames.length).toBeGreaterThanOrEqual(1);
  });

  it("syncs ProjectSelector changes to the LeftSidebar current project", () => {
    renderAppShell();

    const sidebar = screen.getByLabelText("Sidebar");
    expect(within(sidebar).getByText("Lyra_Prototype")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Project selector: Lyra_Prototype"));
    const mechOption = screen
      .getAllByRole("option")
      .find((option) => option.textContent?.includes("MechArena_Testbed"));
    fireEvent.click(mechOption!);

    expect(screen.getByLabelText("Project selector: MechArena_Testbed")).toBeTruthy();
    expect(within(sidebar).getByText("MechArena_Testbed")).toBeTruthy();
    expect(within(sidebar).queryByText("Lyra_Prototype")).toBeNull();
  });

  it("syncs No project selection to the LeftSidebar empty state", () => {
    renderAppShell();

    const sidebar = screen.getByLabelText("Sidebar");
    fireEvent.click(screen.getByLabelText("Project selector: Lyra_Prototype"));
    const noProjectOption = screen
      .getAllByRole("option")
      .find((option) => option.textContent?.includes("No project"));
    fireEvent.click(noProjectOption!);

    expect(screen.getByLabelText("Project selector: No project")).toBeTruthy();
    expect(within(sidebar).getByText("No project selected")).toBeTruthy();
    expect(within(sidebar).queryByText("Project Tree")).toBeNull();
  });

  describe("inspector toggle synchronization", () => {
    it("defaults with inspector open and Inspect button showing Close inspector", () => {
      renderAppShell();
      const inspectBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      expect(inspectBtn.getAttribute("aria-label")).toBe("Close inspector");
    });

    it("toggles inspector closed and updates button label after clicking Inspect", () => {
      renderAppShell();
      const inspectBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      fireEvent.click(inspectBtn);

      expect(inspectBtn.getAttribute("aria-label")).toBe("Open inspector");
      expect(inspectBtn.getAttribute("aria-pressed")).toBe("false");
    });

    it("closes inspector via close button and syncs TitleBar", () => {
      renderAppShell();
      const closeBtn = document.querySelector(".ua-inspector__close") as HTMLButtonElement;
      fireEvent.click(closeBtn);

      const inspectBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      expect(inspectBtn.getAttribute("aria-label")).toBe("Open inspector");
    });

    it("opens inspector via Inspect button and syncs TitleBar", () => {
      renderAppShellWithClosedInspector();
      const inspectBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      fireEvent.click(inspectBtn);

      expect(inspectBtn.getAttribute("aria-label")).toBe("Close inspector");
      expect(inspectBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("maintains data-inspector-state on MainLayout after toggle", () => {
      const { container } = renderAppShell();
      const layout = container.querySelector(".ua-main-layout");
      expect(layout?.getAttribute("data-inspector-state")).toBe("open");

      const inspectBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      fireEvent.click(inspectBtn);
      expect(layout?.getAttribute("data-inspector-state")).toBe("closed");
    });
  });

  it("does not render any microphone or voice button", () => {
    const { container } = renderAppShell();
    const micElements = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(micElements.length).toBe(0);
  });
});
