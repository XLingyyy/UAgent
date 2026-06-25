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

function renderAppShellWithSettings(page?: string) {
  return render(
    <UIProvider
      initialState={{
        settings: {
          open: true,
          activePageId: (page as never) ?? "general",
        },
      }}
    >
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

  describe("settings shell", () => {
    it("renders MainLayout by default and not SettingsShell", () => {
      const { container } = renderAppShell();
      expect(container.querySelector(".ua-main-layout")).toBeTruthy();
      expect(container.querySelector(".ua-settings-shell")).toBeNull();
    });

    it("exposes data-shell-mode='app' by default", () => {
      const { container } = renderAppShell();
      const app = container.querySelector(".ua-app");
      expect(app?.getAttribute("data-shell-mode")).toBe("app");
    });

    it("renders SettingsShell when settings.open is true", () => {
      const { container } = renderAppShellWithSettings();
      expect(container.querySelector(".ua-main-layout")).toBeNull();
      expect(container.querySelector(".ua-settings-shell")).toBeTruthy();
    });

    it("exposes data-shell-mode='settings' when settings are open", () => {
      const { container } = renderAppShellWithSettings();
      const app = container.querySelector(".ua-app");
      expect(app?.getAttribute("data-shell-mode")).toBe("settings");
    });

    it("renders TitleBar when SettingsShell is open", () => {
      const { container } = renderAppShellWithSettings();
      expect(container.querySelector(".ua-titlebar")).toBeTruthy();
    });

    it("renders GlobalOverlays when SettingsShell is open", () => {
      const { container } = renderAppShellWithSettings();
      expect(container.querySelector(".ua-global-overlays")).toBeTruthy();
    });

    it("renders Settings sidebar with Back to app button when open", () => {
      renderAppShellWithSettings();
      expect(screen.getByLabelText("Back to app")).toBeTruthy();
    });

    it("renders six MVP0 settings entries when open", () => {
      renderAppShellWithSettings();
      const nav = screen.getByLabelText("Settings navigation");
      expect(within(nav).getByText("General")).toBeTruthy();
      expect(within(nav).getByText("Appearance")).toBeTruthy();
      expect(within(nav).getByText("Config")).toBeTruthy();
      expect(within(nav).getByText("Personalization")).toBeTruthy();
      expect(within(nav).getByText("Archived chats")).toBeTruthy();
      expect(within(nav).getByText("Provider")).toBeTruthy();
    });

    it("renders disabled future entries when open", () => {
      renderAppShellWithSettings();
      expect(screen.getByText("MCP servers")).toBeTruthy();
      expect(screen.getByText("Git")).toBeTruthy();
    });

    it("opens SettingsShell from the sidebar settings entry", () => {
      const { container } = renderAppShell();
      fireEvent.click(screen.getByLabelText("Open settings"));

      expect(container.querySelector(".ua-app")?.getAttribute("data-shell-mode")).toBe("settings");
      expect(container.querySelector(".ua-main-layout")).toBeNull();
      expect(container.querySelector(".ua-settings-shell")).toBeTruthy();
    });

    it("returns to MainLayout from Back to app and preserves inspector state", () => {
      const { container } = renderAppShell();
      const inspectBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      fireEvent.click(inspectBtn);

      fireEvent.click(screen.getByLabelText("Open settings"));
      fireEvent.click(screen.getByLabelText("Back to app"));

      const layout = container.querySelector(".ua-main-layout");
      expect(container.querySelector(".ua-app")?.getAttribute("data-shell-mode")).toBe("app");
      expect(container.querySelector(".ua-settings-shell")).toBeNull();
      expect(layout).toBeTruthy();
      expect(layout?.getAttribute("data-inspector-state")).toBe("closed");
    });

    it("does not render ComposerDock when SettingsShell is open", () => {
      renderAppShellWithSettings();
      expect(screen.queryByLabelText("Composer dock")).toBeNull();
    });

    it("does not render microphone or voice controls in settings shell", () => {
      const { container } = renderAppShellWithSettings();
      const micElements = container.querySelectorAll(
        '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
      );
      expect(micElements.length).toBe(0);
    });
  });
});
