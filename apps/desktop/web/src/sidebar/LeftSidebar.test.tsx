import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { LeftSidebar } from "./LeftSidebar";
import { UIProvider } from "../app/providers";
import { mockThreads } from "./sidebar-data";
import { MOCK_PROJECTS } from "../project/project-data";

const defaultProject = MOCK_PROJECTS.find((p) => p.id === "lyra")!;

function renderSidebar() {
  return render(
    <UIProvider>
      <LeftSidebar />
    </UIProvider>,
  );
}

describe("LeftSidebar", () => {
  it("renders the sidebar as an aside with aria-label Sidebar", () => {
    const { container } = renderSidebar();
    const aside = container.querySelector(".ua-sidebar");
    expect(aside).toBeTruthy();
    expect(aside?.getAttribute("aria-label")).toBe("Sidebar");
  });

  describe("PrimaryNav", () => {
    it("renders Workspace, Projects, and Settings nav items", () => {
      renderSidebar();
      const nav = screen.getByLabelText("Primary navigation");
      expect(within(nav).getByText("Workspace")).toBeTruthy();
      expect(within(nav).getByText("Projects")).toBeTruthy();
      expect(within(nav).getByText("Settings")).toBeTruthy();
    });

    it("marks Workspace as active by default", () => {
      renderSidebar();
      const wsBtn = screen.getByText("Workspace").closest("button");
      expect(wsBtn?.classList.contains("ua-primary-nav__item--active")).toBe(true);
      expect(wsBtn?.getAttribute("aria-current")).toBe("page");
    });

    it("switches active nav to Projects on click", () => {
      renderSidebar();
      const projectsBtn = screen.getByText("Projects").closest("button")!;
      fireEvent.click(projectsBtn);
      expect(projectsBtn.classList.contains("ua-primary-nav__item--active")).toBe(true);
      expect(projectsBtn.getAttribute("aria-current")).toBe("page");
      const wsBtn = screen.getByText("Workspace").closest("button")!;
      expect(wsBtn.classList.contains("ua-primary-nav__item--active")).toBe(false);
    });

    it("switches active nav to Settings on click", () => {
      renderSidebar();
      const nav = screen.getByLabelText("Primary navigation");
      const settingsBtn = within(nav).getByText("Settings").closest("button")!;
      fireEvent.click(settingsBtn);
      expect(settingsBtn.classList.contains("ua-primary-nav__item--active")).toBe(true);
      expect(settingsBtn.getAttribute("aria-current")).toBe("page");
    });
  });

  describe("ProjectSection", () => {
    it("renders the default project name", () => {
      renderSidebar();
      expect(screen.getByText(defaultProject.name)).toBeTruthy();
    });

    it("renders the engine version", () => {
      renderSidebar();
      expect(screen.getByText(defaultProject.engineVersion, { exact: false })).toBeTruthy();
    });

    it("renders the not-connected status", () => {
      renderSidebar();
      expect(screen.getByText(defaultProject.connectionStatus)).toBeTruthy();
    });

    it("renders the project path", () => {
      renderSidebar();
      const pathEl = screen.getByText(defaultProject.path);
      expect(pathEl).toBeTruthy();
      expect(pathEl.getAttribute("title")).toBe(defaultProject.path);
    });

    it("renders Open Project and Switch buttons as disabled", () => {
      renderSidebar();
      const openBtn = screen.getByText("Open Project");
      expect(openBtn).toBeTruthy();
      expect((openBtn as HTMLButtonElement).disabled).toBe(true);
      const switchBtn = screen.getByText("Switch");
      expect(switchBtn).toBeTruthy();
      expect((switchBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("ProjectSection with no project", () => {
    it("renders empty state when activeProjectId is null", () => {
      render(
        <UIProvider initialState={{ activeProjectId: null }}>
          <LeftSidebar />
        </UIProvider>,
      );

      expect(screen.getByText("No project selected")).toBeTruthy();
      expect(screen.getByText("Select a project from the composer dock")).toBeTruthy();
      expect(screen.queryByText("Open Project")).toBeNull();
    });

    it("does not render the project tree when no project is selected", () => {
      const { container } = render(
        <UIProvider initialState={{ activeProjectId: null }}>
          <LeftSidebar />
        </UIProvider>,
      );

      expect(screen.queryByText("Project Tree")).toBeNull();
      expect(container.querySelector('[role="tree"]')).toBeNull();
    });
  });

  describe("ProjectSelection sync from ComposerDock", () => {
    it("renders MechArena_Testbed when activeProjectId is mech", () => {
      render(
        <UIProvider initialState={{ activeProjectId: "mech" }}>
          <LeftSidebar />
        </UIProvider>,
      );

      expect(screen.getByText("MechArena_Testbed")).toBeTruthy();
      expect(screen.queryByText("Lyra_Prototype")).toBeNull();
    });

    it("renders Lyra_Prototype by default", () => {
      render(
        <UIProvider>
          <LeftSidebar />
        </UIProvider>,
      );

      expect(screen.getByText("Lyra_Prototype")).toBeTruthy();
    });
  });

  describe("ThreadSection", () => {
    it("renders all mock threads", () => {
      renderSidebar();
      for (const t of mockThreads) {
        expect(screen.getByText(t.title)).toBeTruthy();
      }
    });

    it("marks the first thread as selected by default", () => {
      renderSidebar();
      const firstBtn = screen.getByText(mockThreads[0].title).closest("button")!;
      expect(firstBtn.classList.contains("ua-thread-item--active")).toBe(true);
      expect(firstBtn.getAttribute("aria-selected")).toBe("true");
    });

    it("switches selected thread on click", () => {
      renderSidebar();
      const secondBtn = screen.getByText(mockThreads[1].title).closest("button")!;
      fireEvent.click(secondBtn);
      expect(secondBtn.classList.contains("ua-thread-item--active")).toBe(true);
      expect(secondBtn.getAttribute("aria-selected")).toBe("true");
      const firstBtn = screen.getByText(mockThreads[0].title).closest("button")!;
      expect(firstBtn.classList.contains("ua-thread-item--active")).toBe(false);
    });

    it("shows thread type badges", () => {
      renderSidebar();
      expect(screen.getByText("Plan")).toBeTruthy();
      expect(screen.getByText("Build")).toBeTruthy();
      expect(screen.getByText("Review")).toBeTruthy();
    });

    it("shows thread update times", () => {
      renderSidebar();
      expect(screen.getByText("2h ago")).toBeTruthy();
      expect(screen.getByText("5h ago")).toBeTruthy();
      expect(screen.getByText("1d ago")).toBeTruthy();
    });
  });

  describe("ProjectTree", () => {
    it("renders the Project Tree label", () => {
      renderSidebar();
      expect(screen.getByText("Project Tree")).toBeTruthy();
    });

    it("renders root nodes Content and Config", () => {
      renderSidebar();
      expect(screen.getByText("Content")).toBeTruthy();
      expect(screen.getByText("Config")).toBeTruthy();
    });

    it("renders Content children (Maps, Characters, Materials) by default", () => {
      renderSidebar();
      expect(screen.getByText("Maps")).toBeTruthy();
      expect(screen.getByText("Characters")).toBeTruthy();
      expect(screen.getByText("Materials")).toBeTruthy();
    });

    it("toggles folder expand on click", () => {
      renderSidebar();
      const contentToggles = screen
        .getAllByText("\u25B8")
        .filter((el) => el.closest('[role="treeitem"]')?.textContent?.includes("Content"));
      expect(contentToggles.length).toBeGreaterThan(0);
      fireEvent.click(contentToggles[0]);
      expect(screen.queryByText("Maps")).toBeNull();
    });

    it("selects a tree node on click", () => {
      renderSidebar();
      const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;
      fireEvent.click(contentItem);
      expect(contentItem.getAttribute("aria-selected")).toBe("true");
    });

    it("shows Config folder and its child", () => {
      renderSidebar();
      expect(screen.getByText("Config")).toBeTruthy();
      expect(screen.getByText("DefaultGame.ini")).toBeTruthy();
    });
  });

  describe("SidebarFooter", () => {
    it("renders the Settings entry button", () => {
      renderSidebar();
      expect(screen.getByLabelText("Open settings")).toBeTruthy();
    });

    it("renders the Account placeholder disabled", () => {
      renderSidebar();
      const accountBtn = screen.getByLabelText("Account (coming soon)") as HTMLButtonElement;
      expect(accountBtn).toBeTruthy();
      expect(accountBtn.disabled).toBe(true);
    });

    it("renders the version badge", () => {
      renderSidebar();
      expect(screen.getByText("UAgent MVP0")).toBeTruthy();
    });

    it("renders the local status indicator", () => {
      renderSidebar();
      expect(screen.getByText("Local · No UE connected")).toBeTruthy();
    });
  });

  describe("Forbidden content", () => {
    it("does not render any microphone or voice button", () => {
      const { container } = renderSidebar();
      const micElements = container.querySelectorAll(
        '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
      );
      expect(micElements.length).toBe(0);
    });
  });
});
