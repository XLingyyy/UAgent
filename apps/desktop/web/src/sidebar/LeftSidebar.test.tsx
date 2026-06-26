import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { LeftSidebar } from "./LeftSidebar";
import { UIProvider } from "../app/providers";
import { ComposerDock } from "../composer/ComposerDock";
import { useSettingsStore } from "../stores/ui-store";
import { mockThreads } from "./sidebar-data";
import { MOCK_PROJECTS } from "../project/project-data";

const defaultProject = MOCK_PROJECTS.find((p) => p.id === "lyra")!;
const mechProject = MOCK_PROJECTS.find((p) => p.id === "mech")!;
const cityProject = MOCK_PROJECTS.find((p) => p.id === "city")!;

function SettingsStateProbe() {
  const settingsOpen = useSettingsStore((state) => String(state.open));
  const activePage = useSettingsStore((state) => state.activePageId);

  return (
    <div>
      <span data-testid="settings-open">{settingsOpen}</span>
      <span data-testid="settings-page">{activePage}</span>
    </div>
  );
}

function renderSidebar() {
  return render(
    <UIProvider>
      <LeftSidebar />
      <SettingsStateProbe />
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
      const { container } = renderSidebar();
      const projectsBtn = screen.getByText("Projects").closest("button")!;
      fireEvent.click(projectsBtn);
      expect(projectsBtn.classList.contains("ua-primary-nav__item--active")).toBe(true);
      expect(projectsBtn.getAttribute("aria-current")).toBe("page");
      const wsBtn = screen.getByText("Workspace").closest("button")!;
      expect(wsBtn.classList.contains("ua-primary-nav__item--active")).toBe(false);
      expect(container.querySelector(".ua-sidebar")?.getAttribute("data-sidebar-view")).toBe(
        "projects",
      );
    });

    it("switches active nav to Settings on click", () => {
      const { container } = renderSidebar();
      const nav = screen.getByLabelText("Primary navigation");
      const settingsBtn = within(nav).getByText("Settings").closest("button")!;
      fireEvent.click(settingsBtn);
      expect(settingsBtn.classList.contains("ua-primary-nav__item--active")).toBe(true);
      expect(settingsBtn.getAttribute("aria-current")).toBe("page");
      expect(container.querySelector(".ua-sidebar")?.getAttribute("data-sidebar-view")).toBe(
        "workspace",
      );
      expect(screen.queryByRole("tree")).toBeNull();
    });
  });

  describe("Workspace view", () => {
    it("exposes the workspace sidebar view by default", () => {
      const { container } = renderSidebar();
      const aside = container.querySelector(".ua-sidebar");
      expect(aside?.getAttribute("data-sidebar-view")).toBe("workspace");
    });

    it("renders a lightweight current project summary", () => {
      renderSidebar();
      const summary = screen.getByLabelText("Workspace project summary");

      expect(within(summary).getByText(defaultProject.name)).toBeTruthy();
      expect(
        within(summary).getByText(defaultProject.engineVersion, { exact: false }),
      ).toBeTruthy();
      expect(within(summary).getByText(defaultProject.connectionStatus)).toBeTruthy();
      const pathEl = within(summary).getByText(defaultProject.path);
      expect(pathEl).toBeTruthy();
      expect(pathEl.getAttribute("title")).toBe(defaultProject.path);
    });

    it("does not render the full asset tree by default", () => {
      renderSidebar();
      expect(screen.queryByRole("tree")).toBeNull();
      expect(screen.queryByText("Asset Browser")).toBeNull();
      expect(screen.queryByText("Content")).toBeNull();
    });

    it("renders empty state when activeProjectId is null", () => {
      render(
        <UIProvider initialState={{ project: { activeProjectId: null } }}>
          <LeftSidebar />
        </UIProvider>,
      );

      expect(screen.getByText("No project selected")).toBeTruthy();
      expect(screen.getByText("Select a project from the composer dock")).toBeTruthy();
      expect(screen.queryByText("Open Project")).toBeNull();
    });

    it("does not render the project tree when no project is selected", () => {
      const { container } = render(
        <UIProvider initialState={{ project: { activeProjectId: null } }}>
          <LeftSidebar />
        </UIProvider>,
      );

      expect(screen.queryByText("Project Tree")).toBeNull();
      expect(container.querySelector('[role="tree"]')).toBeNull();
    });

    it("renders MechArena_Testbed when activeProjectId is mech", () => {
      render(
        <UIProvider initialState={{ project: { activeProjectId: "mech" } }}>
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

  describe("Projects view", () => {
    function switchToProjects() {
      const nav = screen.getByLabelText("Primary navigation");
      fireEvent.click(within(nav).getByText("Projects").closest("button")!);
    }

    it("renders the mock project list after clicking Projects", () => {
      renderSidebar();
      switchToProjects();

      const projectList = screen.getByRole("listbox", { name: "Mock project list" });
      for (const project of MOCK_PROJECTS) {
        expect(
          within(projectList).getByRole("option", { name: new RegExp(project.name) }),
        ).toBeTruthy();
      }
    });

    it("marks the active project option as selected", () => {
      renderSidebar();
      switchToProjects();

      const projectList = screen.getByRole("listbox", { name: "Mock project list" });
      const lyraOption = within(projectList).getByRole("option", {
        name: /Lyra_Prototype/,
      });
      expect(lyraOption.getAttribute("aria-selected")).toBe("true");
      expect(lyraOption.getAttribute("aria-current")).toBe("true");
    });

    it("updates the active project summary when a project is clicked", () => {
      renderSidebar();
      switchToProjects();

      const projectList = screen.getByRole("listbox", { name: "Mock project list" });
      const mechOption = within(projectList).getByRole("option", {
        name: /MechArena_Testbed/,
      });
      fireEvent.click(mechOption);

      expect(mechOption.getAttribute("aria-selected")).toBe("true");
      const details = screen.getByLabelText("Active project details");
      expect(within(details).getByText(mechProject.name)).toBeTruthy();
      expect(within(details).getByText(mechProject.path)).toBeTruthy();
      expect(within(details).queryByText(defaultProject.path)).toBeNull();
    });

    it("shows the selected project status, path, and engine version", () => {
      render(
        <UIProvider
          initialState={{
            layout: { sidebar: { activeNav: "projects" } },
            project: { activeProjectId: "city" },
          }}
        >
          <LeftSidebar />
        </UIProvider>,
      );

      const details = screen.getByLabelText("Active project details");
      expect(within(details).getByText(cityProject.name)).toBeTruthy();
      expect(within(details).getByText(cityProject.engineVersion, { exact: false })).toBeTruthy();
      expect(within(details).getByText(cityProject.connectionStatus)).toBeTruthy();
      expect(within(details).getByText(cityProject.path)).toBeTruthy();
    });

    it("renders disabled future project actions without connecting to anything", () => {
      renderSidebar();
      switchToProjects();

      const openBtn = screen.getByText("Open Project");
      expect(openBtn).toBeTruthy();
      expect((openBtn as HTMLButtonElement).disabled).toBe(true);
      const switchBtn = screen.getByText("Switch");
      expect(switchBtn).toBeTruthy();
      expect((switchBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it("renders the current project asset browser only in Projects mode", () => {
      renderSidebar();
      switchToProjects();

      expect(screen.getByText("Asset Browser")).toBeTruthy();
      expect(
        screen.getByRole("tree", { name: `${defaultProject.name} asset browser` }),
      ).toBeTruthy();
      expect(screen.getByText("Content")).toBeTruthy();
      expect(screen.getByText("Config")).toBeTruthy();
    });

    it("updates the asset browser label when project selection changes", () => {
      renderSidebar();
      switchToProjects();

      const projectList = screen.getByRole("listbox", { name: "Mock project list" });
      fireEvent.click(within(projectList).getByRole("option", { name: /MechArena_Testbed/ }));

      expect(screen.getByRole("tree", { name: `${mechProject.name} asset browser` })).toBeTruthy();
    });
  });

  describe("ThreadSection", () => {
    it("renders all mock threads", () => {
      renderSidebar();
      for (const t of mockThreads) {
        expect(screen.getByText(t.title)).toBeTruthy();
      }
    });

    it("does not mark any thread as selected by default", () => {
      renderSidebar();
      for (const thread of mockThreads) {
        const button = screen.getByText(thread.title).closest("button")!;
        expect(button.classList.contains("ua-thread-item--active")).toBe(false);
        expect(button.getAttribute("aria-selected")).toBe("false");
      }
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

    it("shows runtime threads submitted from Composer", async () => {
      render(
        <UIProvider>
          <ComposerDock />
          <LeftSidebar />
        </UIProvider>,
      );

      fireEvent.change(screen.getByLabelText("Composer input"), {
        target: { value: "Review Lyra asset loading risks" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send mock task" }));

      const section = screen.getByLabelText("Threads");
      expect(await within(section).findByText("Review Lyra asset loading risks")).toBeTruthy();
      expect(within(section).getByText("Runtime")).toBeTruthy();
    });
  });

  describe("SidebarFooter", () => {
    it("renders the Settings entry button", () => {
      renderSidebar();
      expect(screen.getByLabelText("Open settings")).toBeTruthy();
    });

    it("opens local Profile settings from the Account entry", () => {
      renderSidebar();
      const accountBtn = screen.getByLabelText("Open profile settings") as HTMLButtonElement;

      expect(accountBtn).toBeTruthy();
      fireEvent.click(accountBtn);

      expect(screen.getByTestId("settings-open").textContent).toBe("true");
      expect(screen.getByTestId("settings-page").textContent).toBe("profile");
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
