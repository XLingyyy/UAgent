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
  indexSnapshot?: ProjectIndexSnapshot | null;
  scanStatus?: ProjectIndexSnapshot["status"] | "idle";
  assetFilter?: string;
  onAssetFilterChange?: (filter: string) => void;
  onScanProject?: () => void;
  onCancelScan?: () => void;
  onPreviewFile?: (rootRelativePath: string) => void;
  selectedAssetPath?: string | null;
  preview?: SafeFilePreviewResult | null;
  diagnosticCounts?: Record<string, number>;
  mutationMarkers?: Record<string, string[]>;
}

function ProjectSummary({
  project,
  emptyText,
  showActions = false,
}: {
  project: MockProject | null;
  emptyText: string;
  showActions?: boolean;
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
      {showActions && (
        <div className="ua-project-card__actions">
          <button className="ua-project-card__btn" type="button" disabled>
            {uiText("Open Project")}{" "}</button>
          <button className="ua-project-card__btn" type="button" disabled>
            {uiText("Switch")}{" "}</button>
        </div>
      )}
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
  indexSnapshot = null,
  scanStatus = "idle",
  assetFilter = "",
  onAssetFilterChange,
  onScanProject,
  onCancelScan,
  onPreviewFile,
  selectedAssetPath = null,
  preview = null,
  diagnosticCounts = {},
  mutationMarkers = {},
}: ProjectSectionProps) {
  const {text: uiText,t} = useI18n();
  if (mode === "projects") {
    return (
      <section
        className="ua-project-section ua-project-section--projects"
        aria-label={uiText("Project resource browser")}
      >
        <div className="ua-project-section__header">
          <span className="ua-project-section__label">{uiText("Projects")}</span>
          <span className="ua-project-section__hint">{uiText("Local mock list")}</span>
        </div>
        <div className="ua-project-browser">
          <div className="ua-project-list" role="listbox" aria-label={uiText("Mock project list")}>
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
              emptyText="Select a local mock project from the list"
              showActions
            />
          </div>
          <div className="ua-project-index-banner" role="status">
            <span>{indexSnapshot ? uiText("Index ready") : uiText("No project root registered")}</span>
            <span>
              {indexSnapshot
                ? t("project.indexSummary",{count:Object.values(diagnosticCounts).reduce((sum,count)=>sum+count,0)})
                : uiText("Fixture fallback")}
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
            {preview ? (
              <>
                <span className="ua-project-section__label">
                  {preview.status} · {preview.reason}
                </span>
                <pre>{preview.content || preview.reason}</pre>
                <span>
                  {uiText("Redaction:")}{" "}{preview.redaction.replacedSecrets} {uiText("secrets /")}{" "}
                  {preview.redaction.replacedPaths} {uiText("paths")}{" "}</span>
              </>
            ) : (
              <span>{uiText("No file preview requested")}</span>
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
      <ProjectSummary project={project} emptyText={uiText("Simple questions do not need a project.")} />
    </section>
  );
}
