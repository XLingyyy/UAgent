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
  useProjectStore,
  useSettingsActions,
  useThreadActions,
  useThreadStore,
} from "../stores/ui-store";
import "./LeftSidebar.css";

export function LeftSidebar() {
  const activeNav = useLayoutStore((state) => state.sidebar.activeNav);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const { setActiveNav } = useLayoutActions();
  const { setActiveThread } = useThreadActions();
  const { openSettings } = useSettingsActions();

  const activeProject = activeProjectId
    ? (MOCK_PROJECTS.find((p) => p.id === activeProjectId) ?? null)
    : null;

  return (
    <aside className="ua-sidebar ua-motion-panel" aria-label="Sidebar" data-motion="panel">
      <div className="ua-sidebar__top">
        <PrimaryNav
          activeNav={activeNav}
          onNavChange={setActiveNav}
          onSettingsOpen={() => openSettings("general")}
        />
      </div>
      <div className="ua-sidebar__body">
        <ProjectSection project={activeProject} treeNodes={activeProject ? mockProjectTree : []} />
        <ThreadSection
          threads={mockThreads}
          activeThreadId={activeThreadId}
          onThreadSelect={setActiveThread}
        />
      </div>
      <SidebarFooter />
    </aside>
  );
}
