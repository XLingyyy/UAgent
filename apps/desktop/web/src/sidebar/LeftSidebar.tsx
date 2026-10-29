import {useI18n} from "../i18n";
import { FIXTURES_ENABLED } from "../runtime/build-capabilities";
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
import {conversationKey} from "../runtime/conversation-context";
import type { ProjectTreeNode, SidebarViewMode } from "../types/ui";
import type { AssetIndexEntry } from "@uagent/shared";
import "./LeftSidebar.css";

const SIDEBAR_MODES: Array<{ id: SidebarViewMode; label: string }> = [
  { id: "project", label: "Projects" },
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
  const {text: uiText,t} = useI18n();
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
  const mockProject = FIXTURES_ENABLED && activeProjectId
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
    : FIXTURES_ENABLED && activeProject
      ? mockProjectTree
      : [];
  const diagnosticCounts = Object.fromEntries(
    Object.entries(runtime.mvp11.affectedFiles).map(([path, summary]) => [path, summary.total]),
  );
  for (const [path, markers] of Object.entries(runtime.mvp12.fileMarkers)) {
    diagnosticCounts[path] = (diagnosticCounts[path] ?? 0) + markers.length;
  }
  const mutationMarkers = runtime.mvp13.fileMarkers;
  const canScanRegisteredProject = Boolean(
    registeredProject && registeredProject.trustState === "trusted",
  );
  const seenConversations=new Set<string>();
  const runtimeThreads = getRuntimeTaskIds(runtime).filter(taskId=>{const task=runtime.tasksById[taskId],key=conversationKey(task);if(task.draft.projectId!==activeProjectId||seenConversations.has(key))return false;seenConversations.add(key);return true;}).map((taskId) => ({
    id: taskId,
    title: runtime.tasksById[taskId].title,
    type: "Runtime" as const,
    updatedAt: runtime.tasksById[taskId].state === "completed" ? "done" : runtime.tasksById[taskId].state,
  }));

  return (
    <aside
      className="ua-sidebar ua-motion-panel"
      aria-label={uiText("Sidebar")}
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
      <button type="button" className="ua-chat-new" onClick={()=>setActiveThread(null)}>{t("chat.new")}</button>
      <div className="ua-sidebar__mode-tabs" role="tablist" aria-label={uiText("Project workspace sidebar modes")}>
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
            {uiText(item.label)}
          </button>
        ))}
      </div>
      <div className={`ua-sidebar__body ua-sidebar__body--${sidebarView}`}>
        {sidebarView === "asset-browser" ? (
          <ProjectSection
            mode="projects"
            project={activeProject}
            projects={projectState.registeredProjects.map((p) => ({ id: p.id, name: p.name, engineVersion: p.engine.label, connectionStatus: p.trustState, path: p.displayRoot }))}
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
            diagnosticCounts={diagnosticCounts}
            mutationMarkers={mutationMarkers}
          />
        ) : sidebarView === "conversation" ? (
          <>
            <ProjectSection mode="workspace" project={activeProject} treeNodes={[]} />
            <ThreadSection
              threads={[...runtimeThreads, ...(FIXTURES_ENABLED ? mockThreads : [])]}
              activeThreadId={activeThreadId}
              onThreadSelect={setActiveThread}
            />
          </>
        ) : (
          <>
            <ProjectSection mode="workspace" project={activeProject} treeNodes={assetTreeNodes} onPreviewFile={previewProjectFile} />

          </>
        )}
      </div>
      <SidebarFooter />
    </aside>
  );
}
