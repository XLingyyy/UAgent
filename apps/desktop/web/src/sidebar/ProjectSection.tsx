import { IndexedProjectFiles } from "./IndexedProjectFiles";
import {useI18n} from "../i18n";
import type { MockProject, ProjectTreeNode as ProjectTreeNodeType } from "../types/ui";
import type { ProjectIndexSnapshot, SafeFilePreviewResult } from "@uagent/shared";
import { ProjectTree } from "./ProjectTree";
import "./ProjectSection.css";

export interface ProjectSectionProps {
  mode?: "workspace" | "projects";
  project: MockProject | null;
  treeNodes: ProjectTreeNodeType[];
  projects?: MockProject[];
  activeProjectId?: string | null;
  onProjectSelect?: (projectId: string) => void;
  onProjectSetup?: () => void;
  indexSnapshot?: ProjectIndexSnapshot | null;
  scanStatus?: ProjectIndexSnapshot["status"] | "idle";
  assetFilter?: string;
  onAssetFilterChange?: (filter: string) => void;
  onScanProject?: () => void;
  onCancelScan?: () => void;
  onPreviewFile?: (rootRelativePath: string) => void;
  selectedAssetPath?: string | null;
  preview?: SafeFilePreviewResult | null;
  previewError?: string | null;
  diagnosticCounts?: Record<string, number>;
  mutationMarkers?: Record<string, string[]>;
}

function ProjectSummary({
  project,
  emptyText,
  onProjectSetup,
}: {
  project: MockProject | null;
  emptyText: string;
  onProjectSetup?: () => void;
}) {
  const {text: uiText} = useI18n();
  if (!project) {
    return (
      <div className="ua-project-card ua-project-card--empty">
        <span className="ua-project-card__name ua-project-card__name--empty">
          {uiText("No project selected")}{" "}</span>
        <span className="ua-project-card__empty-text">{emptyText}</span>
      </div>
    );
  }

  return (
    <div className="ua-project-card">
      <div className="ua-project-card__info">
        <span className="ua-project-card__name">{project.name}</span>
        <span className="ua-project-card__meta">
          {project.engineVersion}
          <span className="ua-project-card__sep" aria-hidden>
            ·
          </span>
          <span className="ua-project-card__status">{project.connectionStatus}</span>
        </span>
        <span className="ua-project-card__path" title={project.path}>
          {project.path}
        </span>
      </div>
      {onProjectSetup && <button className="ua-project-card__btn" type="button" onClick={onProjectSetup}>{uiText("Open Project")}</button>}
    </div>
  );
}

export function ProjectSection({
  mode = "workspace",
  project,
  treeNodes,
  projects = [],
  activeProjectId,
  onProjectSelect,
  onProjectSetup,
  indexSnapshot = null,
  scanStatus = "idle",
  assetFilter = "",
  onAssetFilterChange,
  onScanProject,
  onCancelScan,
  onPreviewFile,
  selectedAssetPath = null,
  preview = null,
  previewError = null,
  diagnosticCounts = {},
  mutationMarkers = {},
}: ProjectSectionProps) {
  const {text: uiText,t,locale} = useI18n();
  const currentIndex=project&&indexSnapshot?.projectId===project.id?indexSnapshot:null;
  const currentPreview=project&&preview?.projectId===project.id&&preview.rootRelativePath===selectedAssetPath?preview:null;
  if (mode === "projects") {
    return (
      <section
        className="ua-project-section ua-project-section--projects"
        aria-label={uiText("Project resource browser")}
      >
        <div className="ua-project-section__header">
          <span className="ua-project-section__label">{uiText("Projects")}</span>
          <span className="ua-project-section__hint">{locale==="zh-CN"?"\u5df2\u6dfb\u52a0\u5de5\u7a0b":"Registered projects"}</span>
        </div>
        {onProjectSetup&&<button className="ua-project-card__btn" type="button" onClick={onProjectSetup}>{locale==="zh-CN"?"\u6dfb\u52a0\u6216\u7ba1\u7406\u5de5\u7a0b":"Add or manage projects"}</button>}
        <div className="ua-project-browser">
          <div className="ua-project-list" role="listbox" aria-label={locale==="zh-CN"?"\u5de5\u7a0b\u5217\u8868":"Project list"}>
            {projects.map((projectOption) => {
              const isActive = activeProjectId === projectOption.id;
              return (
                <button
                  key={projectOption.id}
                  className={`ua-project-option${isActive ? " ua-project-option--active" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onProjectSelect?.(projectOption.id)}
                >
                  <span className="ua-project-option__name">{projectOption.name}</span>
                  <span className="ua-project-option__meta">
                    {projectOption.engineVersion}
                    <span className="ua-project-option__sep" aria-hidden>
                      ·
                    </span>
                    <span className="ua-project-option__status">
                      {projectOption.connectionStatus}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ua-project-details" aria-label={uiText("Active project details")}>
            <ProjectSummary
              project={project}
              emptyText={locale==="zh-CN"?"\u5148\u6dfb\u52a0\u5de5\u7a0b\uff0c\u518d\u4ece\u5217\u8868\u9009\u62e9\u3002":"Add a project, then select it from this list."}
            />
          </div>
          <div className="ua-project-index-banner" role="status">
            <span>{indexSnapshot ? uiText("Index ready") : uiText("No project root registered")}</span>
            <span>
              {indexSnapshot
                ? t("project.indexSummary",{count:Object.values(diagnosticCounts).reduce((sum,count)=>sum+count,0)})
                : (locale==="zh-CN"?"\u6309\u9700\u6388\u6743\u540e\u626b\u63cf":"Scan after confirming project trust")}
            </span>
            <button
              className="ua-project-card__btn"
              type="button"
              disabled={!onScanProject || scanStatus === "scanning"}
              onClick={onScanProject}
            >
              {uiText("Scan project")}{" "}</button>
            <button
              className="ua-project-card__btn"
              type="button"
              disabled={scanStatus !== "scanning" || !onCancelScan}
              onClick={onCancelScan}
            >
              {uiText("Cancel")}{" "}</button>
          </div>
          {currentIndex&&<IndexedProjectFiles key={currentIndex.projectId+":"+currentIndex.id+":"+currentIndex.summary.scannedAt} snapshot={currentIndex} selectedPath={selectedAssetPath} onPreview={onPreviewFile}/>}
          <label className="ua-project-filter">
            <span>{uiText("Indexed asset filter")}</span>
            <input
              value={assetFilter}
              onChange={(event) => onAssetFilterChange?.(event.target.value)}
              aria-label={uiText("Filter indexed assets")}
              placeholder={uiText("Filter by name, type, or path")}
            />
          </label>
          <span className="ua-project-filter__hint">{uiText("Filter only; no scan triggered")}</span>
          {project && (
            <ProjectTree
              key={project.id}
              nodes={treeNodes}
              label={indexSnapshot ? "Indexed Asset Browser" : "Asset Browser"}
              ariaLabel={`${project.name} · ${uiText(indexSnapshot ? "Indexed asset browser" : "Asset Browser")}`}
              diagnosticCounts={diagnosticCounts}
              mutationMarkers={mutationMarkers}
              onNodeSelect={(node) => {
                if (node.rootRelativePath) {
                  onPreviewFile?.(node.rootRelativePath);
                }
              }}
            />
          )}
          <div className="ua-project-asset-details" aria-label={uiText("Asset details region")}>
            <span className="ua-project-section__label">{uiText("Asset details")}</span>
            <span>{selectedAssetPath ?? uiText("Select an indexed asset")}</span>
            <button
              className="ua-project-card__btn"
              type="button"
              disabled={!onPreviewFile}
              onClick={() => onPreviewFile?.("Config/DefaultGame.ini")}
            >
              {uiText("DefaultGame.ini")}{" "}</button>
          </div>
          <div className="ua-project-preview" aria-label={uiText("File preview panel")}>
            {currentPreview ? (
              <>
                <span className="ua-project-section__label">
                  {currentPreview.status} · {currentPreview.reason}
                </span>
                <p><code>{currentPreview.rootRelativePath}</code></p>
                {currentPreview.status==="truncated"&&<p role="status">{locale==="zh-CN"?"只显示受限片段，并非完整文件。":"This is a bounded excerpt, not the complete file."}</p>}
                <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:360,overflow:"auto"}}>{currentPreview.content || currentPreview.reason}</pre>
                <span>
                  {uiText("Redaction:")}{" "}{currentPreview.redaction.replacedSecrets} {uiText("secrets /")}{" "}
                  {currentPreview.redaction.replacedPaths} {uiText("paths")}{" "}</span>
              </>
            ) : (
              <span role={previewError==="file_preview_failed"?"alert":undefined}>{previewError==="file_preview_failed"
                ?(locale==="zh-CN"?"读取失败，未显示旧内容。请重新点选文件；原生读取策略仍适用。":"File reading failed; previous text was cleared. Select the file again to retry under the native read policy.")
                :selectedAssetPath?(locale==="zh-CN"?"尚未取得所选文件的预览内容。":"No preview content is available for the selected file yet."):uiText("No file preview requested")}</span>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="ua-project-section ua-project-section--workspace"
      aria-label={uiText("Workspace project summary")}
    >
      <div className="ua-project-section__header">
        <span className="ua-project-section__label">{uiText("Current Project")}</span>
        <span className="ua-project-section__hint">{uiText("Local context")}</span>
      </div>
      <ProjectSummary project={project} emptyText={locale==="zh-CN"?"\u8bbe\u7f6e\u5de5\u7a0b\u4ee5\u4f7f\u7528\u5de5\u7a0b\u529f\u80fd\u548c Codex \u4f1a\u8bdd\u5f52\u6863\u3002":"Set up a project for project tools and Codex conversation storage."} />
      {onProjectSetup&&<button className="ua-project-card__btn" type="button" onClick={onProjectSetup}>{locale==="zh-CN"?"\u6dfb\u52a0\u6216\u7ba1\u7406\u5de5\u7a0b":"Add or manage projects"}</button>}
    </section>
  );
}
