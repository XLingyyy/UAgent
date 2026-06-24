import { useUI } from "../app/providers";
import { PrimaryNav } from "./PrimaryNav";
import { ProjectSection } from "./ProjectSection";
import { ThreadSection } from "./ThreadSection";
import { mockProject, mockThreads } from "./sidebar-data";
import { mockProjectTree } from "./project-tree-data";
import "./LeftSidebar.css";

export function LeftSidebar() {
  const { state, setActiveNav, setActiveThread } = useUI();
  const { sidebar } = state;

  return (
    <aside className="ua-sidebar" aria-label="Sidebar">
      <div className="ua-sidebar__top">
        <PrimaryNav activeNav={sidebar.activeNav} onNavChange={setActiveNav} />
      </div>
      <div className="ua-sidebar__body">
        <ProjectSection project={mockProject} treeNodes={mockProjectTree} />
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
