import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LeftSidebar } from "./LeftSidebar";
import { UIProvider } from "../app/providers";
import { mockProject, mockThreads } from "./sidebar-data";

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
      expect(screen.getByText("Workspace")).toBeTruthy();
      expect(screen.getByText("Projects")).toBeTruthy();
      expect(screen.getByText("Settings")).toBeTruthy();
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
      const settingsBtn = screen.getByText("Settings").closest("button")!;
      fireEvent.click(settingsBtn);
      expect(settingsBtn.classList.contains("ua-primary-nav__item--active")).toBe(true);
      expect(settingsBtn.getAttribute("aria-current")).toBe("page");
    });
  });

  describe("ProjectSection", () => {
    it("renders the project name", () => {
      renderSidebar();
      expect(screen.getByText(mockProject.name)).toBeTruthy();
    });

    it("renders the engine version", () => {
      renderSidebar();
      expect(screen.getByText(mockProject.engineVersion, { exact: false })).toBeTruthy();
    });

    it("renders the not-connected status", () => {
      renderSidebar();
      expect(screen.getByText(mockProject.connectionStatus)).toBeTruthy();
    });

    it("renders the project path", () => {
      renderSidebar();
      const pathEl = screen.getByText(mockProject.path);
      expect(pathEl).toBeTruthy();
      expect(pathEl.getAttribute("title")).toBe(mockProject.path);
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
        .getAllByText("▸")
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

  describe("Footer", () => {
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
