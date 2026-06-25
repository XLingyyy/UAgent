import { useUI } from "../app/providers";
import { PrimaryNav } from "./PrimaryNav";
import { ProjectSection } from "./ProjectSection";
import { ThreadSection } from "./ThreadSection";
import { mockThreads } from "./sidebar-data";
import { mockProjectTree } from "./project-tree-data";
import { MOCK_PROJECTS } from "../project/project-data";
import "./LeftSidebar.css";

export function LeftSidebar() {
  const { state, setActiveNav, setActiveThread } = useUI();
  const { sidebar, activeProjectId } = state;

  const activeProject = activeProjectId
    ? (MOCK_PROJECTS.find((p) => p.id === activeProjectId) ?? null)
    : null;

  return (
    <aside className="ua-sidebar" aria-label="Sidebar">
      <div className="ua-sidebar__top">
        <PrimaryNav activeNav={sidebar.activeNav} onNavChange={setActiveNav} />
      </div>
      <div className="ua-sidebar__body">
        <ProjectSection project={activeProject} treeNodes={activeProject ? mockProjectTree : []} />
        <ThreadSection
          threads={mockThreads}
          activeThreadId={sidebar.activeThreadId}
          onThreadSelect={setActiveThread}
        />
      </div>
      <div className="ua-sidebar__footer">
        <span className="ua-sidebar__version">UAgent MVP0</span>
        <span className="ua-sidebar__status">Local · No UE connected</span>
      </div>
    </aside>
  );
}
