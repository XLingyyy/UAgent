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

function renderAppShellWithOpenInspector() {
  return render(
    <UIProvider initialState={{ layout: { inspector: { open: true } } }}>
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

  it("wraps the active shell body in a page motion surface", () => {
    const { container } = renderAppShell();
    expect(container.querySelector('.ua-app__body [data-motion="page"]')).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Open settings"));
    expect(container.querySelector('.ua-app__body [data-motion="page"]')).toBeTruthy();
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
    it("defaults with tools closed and the tools button showing Open tools", () => {
      renderAppShell();
      const toolsBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      expect(toolsBtn.textContent).toContain("Tools");
      expect(toolsBtn.getAttribute("aria-label")).toBe("Open tools");
      expect(toolsBtn.getAttribute("aria-pressed")).toBe("false");
    });

    it("toggles tools open and updates button label after clicking Tools", () => {
      renderAppShell();
      const toolsBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      fireEvent.click(toolsBtn);

      expect(toolsBtn.getAttribute("aria-label")).toBe("Close tools");
      expect(toolsBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("closes inspector via close button and syncs TitleBar", () => {
      renderAppShellWithOpenInspector();
      const closeBtn = document.querySelector(".ua-inspector__close") as HTMLButtonElement;
      fireEvent.click(closeBtn);

      const toolsBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      expect(toolsBtn.getAttribute("aria-label")).toBe("Open tools");
    });

    it("opens inspector via Tools button and syncs TitleBar", () => {
      renderAppShell();
      const toolsBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      fireEvent.click(toolsBtn);

      expect(toolsBtn.getAttribute("aria-label")).toBe("Close tools");
      expect(toolsBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("maintains data-inspector-state on MainLayout after toggle", () => {
      const { container } = renderAppShell();
      const layout = container.querySelector(".ua-main-layout");
      expect(layout?.getAttribute("data-inspector-state")).toBe("closed");
      expect(layout?.getAttribute("data-utility-pane-state")).toBe("closed");

      const toolsBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      fireEvent.click(toolsBtn);
      expect(layout?.getAttribute("data-inspector-state")).toBe("open");
      expect(layout?.getAttribute("data-utility-pane-state")).toBe("open");
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

    it("renders the six first-stage settings entries when open", () => {
      renderAppShellWithSettings();
      const nav = screen.getByLabelText("Settings navigation");
      expect(within(nav).getByText("General")).toBeTruthy();
      expect(within(nav).getByText("Profile")).toBeTruthy();
      expect(within(nav).getByText("Appearance")).toBeTruthy();
      expect(within(nav).getByText("Config")).toBeTruthy();
      expect(within(nav).getByText("Personalization")).toBeTruthy();
      expect(within(nav).getByText("Provider")).toBeTruthy();
    });

    it("does not render archived or future settings entries when open", () => {
      renderAppShellWithSettings();
      const nav = screen.getByLabelText("Settings navigation");
      expect(within(nav).queryByText("Archived chats")).toBeNull();
      expect(within(nav).queryByText("MCP servers")).toBeNull();
      expect(within(nav).queryByText("Browser")).toBeNull();
      expect(within(nav).queryByText("Computer control")).toBeNull();
      expect(within(nav).queryByText("Git")).toBeNull();
      expect(within(nav).queryByText("Worktrees")).toBeNull();
    });

    it("opens SettingsShell from the sidebar settings entry", () => {
      const { container } = renderAppShell();
      fireEvent.click(screen.getByLabelText("Open settings"));

      expect(container.querySelector(".ua-app")?.getAttribute("data-shell-mode")).toBe("settings");
      expect(container.querySelector(".ua-main-layout")).toBeNull();
      expect(container.querySelector(".ua-settings-shell")).toBeTruthy();
      expect(
        container.querySelector(".ua-settings-content")?.getAttribute("data-settings-page"),
      ).toBe("general");
    });

    it("opens Profile settings from the sidebar account entry", () => {
      const { container } = renderAppShell();
      fireEvent.click(screen.getByLabelText("Open profile settings"));

      expect(container.querySelector(".ua-app")?.getAttribute("data-shell-mode")).toBe("settings");
      expect(container.querySelector(".ua-main-layout")).toBeNull();
      expect(container.querySelector(".ua-settings-shell")).toBeTruthy();
      expect(
        container.querySelector(".ua-settings-content")?.getAttribute("data-settings-page"),
      ).toBe("profile");
      expect(screen.getByText("Local profile summary")).toBeTruthy();
    });

    it("returns to MainLayout from Back to app and preserves inspector state", () => {
      const { container } = renderAppShell();
      const toolsBtn = document.querySelector(".ua-titlebar__btn") as HTMLButtonElement;
      fireEvent.click(toolsBtn);

      fireEvent.click(screen.getByLabelText("Open settings"));
      fireEvent.click(screen.getByLabelText("Back to app"));

      const layout = container.querySelector(".ua-main-layout");
      expect(container.querySelector(".ua-app")?.getAttribute("data-shell-mode")).toBe("app");
      expect(container.querySelector(".ua-settings-shell")).toBeNull();
      expect(layout).toBeTruthy();
      expect(layout?.getAttribute("data-inspector-state")).toBe("open");
      expect(layout?.getAttribute("data-utility-pane-state")).toBe("open");
    });

    it("resyncs the composer defaults after switching the default provider in settings", () => {
      const { container } = renderAppShell();

      fireEvent.click(screen.getByLabelText("Open settings"));
      fireEvent.click(screen.getByText("Provider"));
      fireEvent.click(screen.getByText("Edit provider"));
      fireEvent.click(screen.getByLabelText("Use as default provider"));
      fireEvent.change(screen.getByLabelText("Default model"), {
        target: { value: "anthropic-claude-sonnet" },
      });
      fireEvent.change(screen.getByLabelText("Reasoning effort"), {
        target: { value: "high" },
      });
      fireEvent.click(screen.getByText("Save provider"));
      fireEvent.click(screen.getByLabelText("Back to app"));

      expect(
        screen.getByLabelText("Model selector: Claude Sonnet Mock, reasoning high"),
      ).toBeTruthy();

      fireEvent.click(screen.getByLabelText("Open settings"));
      fireEvent.click(screen.getByText("Provider"));
      fireEvent.click(screen.getByText("Provider B"));
      fireEvent.click(screen.getByText("Edit provider"));
      fireEvent.click(screen.getByLabelText("Use as default provider"));
      fireEvent.change(screen.getByLabelText("Reasoning effort"), {
        target: { value: "low" },
      });
      fireEvent.click(screen.getByText("Save provider"));

      fireEvent.click(screen.getByLabelText("Back to app"));

      expect(container.querySelector(".ua-app")?.getAttribute("data-shell-mode")).toBe("app");
      expect(screen.getByLabelText("Model selector: Local Qwen Mock, reasoning low")).toBeTruthy();
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
