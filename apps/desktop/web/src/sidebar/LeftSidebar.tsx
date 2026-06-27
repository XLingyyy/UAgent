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
import type { ProjectTreeNode, SidebarViewMode } from "../types/ui";
import type { AssetIndexEntry } from "@uagent/shared";
import "./LeftSidebar.css";

const SIDEBAR_MODES: Array<{ id: SidebarViewMode; label: string }> = [
  { id: "project", label: "Project" },
  { id: "conversation", label: "Conversation" },
  { id: "asset-browser", label: "Asset Browser" },
];

function nodeTypeForAsset(asset: AssetIndexEntry) {
  switch (asset.assetType) {
    case "map":
      return "Map" as const;
    case "material":
      return "Material" as const;
    case "config":
      return "Config" as const;
    case "project":
      return "Project" as const;
    default:
      return "Asset" as const;
  }
}

function buildIndexedTree(assets: AssetIndexEntry[], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleAssets = normalizedFilter
    ? assets.filter((asset) =>
        [asset.displayName, asset.assetType, asset.rootRelativePath]
          .join(" ")
          .toLowerCase()
          .includes(normalizedFilter),
      )
    : assets;
  const children: ProjectTreeNode[] = [];
  const root: ProjectTreeNode = { id: "indexed:root", name: "Content", type: "Folder", children };

  for (const asset of visibleAssets) {
    children.push({
      id: asset.id,
      name: asset.displayName,
      type: nodeTypeForAsset(asset),
      rootRelativePath: asset.rootRelativePath,
    });
  }

  children.sort((a, b) => a.name.localeCompare(b.name));
  return children.length ? [root] : [];
}

export function LeftSidebar() {
  const activeNav = useLayoutStore((state) => state.sidebar.activeNav);
  const sidebarView = useLayoutStore((state) => state.sidebar.viewMode);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projectState = useProjectStore((state) => state);
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const runtime = useRuntimeStore((state) => state);
  const { setActiveNav, setSidebarViewMode } = useLayoutActions();
  const {
    setActiveProject,
    setAssetFilter,
    scanProjectIndex,
    cancelProjectScan,
    previewProjectFile,
  } = useProjectActions();
  const { setActiveThread } = useThreadActions();
  const { openSettings } = useSettingsActions();

  const registeredProject = projectState.registeredProjects.find((p) => p.id === activeProjectId) ?? null;
  const mockProject = activeProjectId
    ? (MOCK_PROJECTS.find((p) => p.id === activeProjectId) ?? null)
    : null;
  const activeProject = registeredProject
    ? {
        id: registeredProject.id,
        name: registeredProject.name,
        engineVersion: registeredProject.engine.label,
        connectionStatus: `${registeredProject.trustState} · ${registeredProject.indexStatus}`,
        path: registeredProject.displayRoot,
      }
    : mockProject;
  const assetTreeNodes = projectState.activeProjectIndex
    ? buildIndexedTree(projectState.activeProjectIndex.assets, projectState.assetFilter)
    : activeProject
      ? mockProjectTree
      : [];
  const canScanRegisteredProject = Boolean(
    registeredProject && registeredProject.trustState === "trusted",
  );
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
            treeNodes={assetTreeNodes}
            indexSnapshot={projectState.activeProjectIndex}
            scanStatus={projectState.scanStatus}
            assetFilter={projectState.assetFilter}
            onAssetFilterChange={setAssetFilter}
            onScanProject={canScanRegisteredProject ? () => scanProjectIndex(registeredProject!.id) : undefined}
            onCancelScan={registeredProject ? () => cancelProjectScan(registeredProject.id) : undefined}
            onPreviewFile={previewProjectFile}
            selectedAssetPath={projectState.selectedAssetPath}
            preview={projectState.preview}
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
