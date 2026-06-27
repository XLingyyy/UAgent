import { PrimaryNav } from "./PrimaryNav";
import { ProjectSection } from "./ProjectSection";
import { ThreadSection } from "./ThreadSection";
import { SidebarFooter } from "./SidebarFooter";
import { mockThreads } from "./sidebar-data";
import { mockProjectTree } from "./project-tree-data";
import { MOCK_PROJECTS } from "../project/project-data";
import {
  useLayoutActions,
  useLayoutStore,
  useProjectActions,
  useProjectStore,
  useRuntimeStore,
  useSettingsActions,
  useThreadActions,
  useThreadStore,
} from "../stores/ui-store";
import { getRuntimeTaskIds } from "../runtime/runtime-store";
import type { SidebarViewMode } from "../types/ui";
import "./LeftSidebar.css";

const SIDEBAR_MODES: Array<{ id: SidebarViewMode; label: string }> = [
  { id: "project", label: "Project" },
  { id: "conversation", label: "Conversation" },
  { id: "asset-browser", label: "Asset Browser" },
];

export function LeftSidebar() {
  const activeNav = useLayoutStore((state) => state.sidebar.activeNav);
  const sidebarView = useLayoutStore((state) => state.sidebar.viewMode);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const runtime = useRuntimeStore((state) => state);
  const { setActiveNav, setSidebarViewMode } = useLayoutActions();
  const { setActiveProject } = useProjectActions();
  const { setActiveThread } = useThreadActions();
  const { openSettings } = useSettingsActions();

  const activeProject = activeProjectId
    ? (MOCK_PROJECTS.find((p) => p.id === activeProjectId) ?? null)
    : null;
  const runtimeThreads = getRuntimeTaskIds(runtime).map((taskId) => ({
    id: taskId,
    title: runtime.tasksById[taskId].title,
    type: "Runtime" as const,
    updatedAt: runtime.tasksById[taskId].state === "completed" ? "done" : runtime.tasksById[taskId].state,
  }));

  return (
    <aside
      className="ua-sidebar ua-motion-panel"
      aria-label="Sidebar"
      data-motion="panel"
      data-sidebar-view={sidebarView}
    >
      <div className="ua-sidebar__top">
        <PrimaryNav
          activeNav={activeNav}
          onNavChange={setActiveNav}
          onSettingsOpen={() => openSettings("general")}
        />
      </div>
      <div className="ua-sidebar__mode-tabs" role="tablist" aria-label="Project workspace sidebar modes">
        {SIDEBAR_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`ua-sidebar__mode-tab${
              sidebarView === item.id ? " ua-sidebar__mode-tab--active" : ""
            }`}
            aria-selected={sidebarView === item.id}
            onClick={() => setSidebarViewMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={`ua-sidebar__body ua-sidebar__body--${sidebarView}`}>
        {sidebarView === "asset-browser" ? (
          <ProjectSection
            mode="projects"
            project={activeProject}
            projects={MOCK_PROJECTS}
            activeProjectId={activeProjectId}
            onProjectSelect={setActiveProject}
            treeNodes={activeProject ? mockProjectTree : []}
          />
        ) : sidebarView === "conversation" ? (
          <>
            <ProjectSection mode="workspace" project={activeProject} treeNodes={[]} />
            <ThreadSection
              threads={[...runtimeThreads, ...mockThreads]}
              activeThreadId={activeThreadId}
              onThreadSelect={setActiveThread}
            />
          </>
        ) : (
          <>
            <ProjectSection mode="workspace" project={activeProject} treeNodes={[]} />
            <ThreadSection
              threads={[...runtimeThreads, ...mockThreads]}
              activeThreadId={activeThreadId}
              onThreadSelect={setActiveThread}
            />
          </>
        )}
      </div>
      <SidebarFooter />
    </aside>
  );
}
