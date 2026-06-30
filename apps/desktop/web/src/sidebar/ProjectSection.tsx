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
  if (!project) {
    return (
      <div className="ua-project-card ua-project-card--empty">
        <span className="ua-project-card__name ua-project-card__name--empty">
          No project selected
        </span>
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
            Open Project
          </button>
          <button className="ua-project-card__btn" type="button" disabled>
            Switch
          </button>
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
  if (mode === "projects") {
    return (
      <section
        className="ua-project-section ua-project-section--projects"
        aria-label="Project resource browser"
      >
        <div className="ua-project-section__header">
          <span className="ua-project-section__label">Projects</span>
          <span className="ua-project-section__hint">Local mock list</span>
        </div>
        <div className="ua-project-browser">
          <div className="ua-project-list" role="listbox" aria-label="Mock project list">
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
          <div className="ua-project-details" aria-label="Active project details">
            <ProjectSummary
              project={project}
              emptyText="Select a local mock project from the list"
              showActions
            />
          </div>
          <div className="ua-project-index-banner" role="status">
            <span>{indexSnapshot ? "Index ready" : "No project root registered"}</span>
            <span>
              {indexSnapshot
                ? `Read-only project index / ${Object.values(diagnosticCounts).reduce((sum, count) => sum + count, 0)} diagnostics`
                : "Fixture fallback"}
            </span>
            <button
              className="ua-project-card__btn"
              type="button"
              disabled={!onScanProject || scanStatus === "scanning"}
              onClick={onScanProject}
            >
              Scan project
            </button>
            <button
              className="ua-project-card__btn"
              type="button"
              disabled={scanStatus !== "scanning" || !onCancelScan}
              onClick={onCancelScan}
            >
              Cancel
            </button>
          </div>
          <label className="ua-project-filter">
            <span>Indexed asset filter</span>
            <input
              value={assetFilter}
              onChange={(event) => onAssetFilterChange?.(event.target.value)}
              aria-label="Filter indexed assets"
              placeholder="Filter by name, type, or path"
            />
          </label>
          <span className="ua-project-filter__hint">Filter only; no scan triggered</span>
          {project && (
            <ProjectTree
              key={project.id}
              nodes={treeNodes}
              label={indexSnapshot ? "Indexed Asset Browser" : "Asset Browser"}
              ariaLabel={`${project.name} ${indexSnapshot ? "indexed " : ""}asset browser`}
              diagnosticCounts={diagnosticCounts}
              mutationMarkers={mutationMarkers}
              onNodeSelect={(node) => {
                if (node.rootRelativePath) {
                  onPreviewFile?.(node.rootRelativePath);
                }
              }}
            />
          )}
          <div className="ua-project-asset-details" aria-label="Asset details region">
            <span className="ua-project-section__label">Asset details</span>
            <span>{selectedAssetPath ?? "Select an indexed asset"}</span>
            <button
              className="ua-project-card__btn"
              type="button"
              disabled={!onPreviewFile}
              onClick={() => onPreviewFile?.("Config/DefaultGame.ini")}
            >
              DefaultGame.ini
            </button>
          </div>
          <div className="ua-project-preview" aria-label="File preview panel">
            {preview ? (
              <>
                <span className="ua-project-section__label">
                  {preview.status} · {preview.reason}
                </span>
                <pre>{preview.content || preview.reason}</pre>
                <span>
                  Redaction: {preview.redaction.replacedSecrets} secrets /{" "}
                  {preview.redaction.replacedPaths} paths
                </span>
              </>
            ) : (
              <span>No file preview requested</span>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="ua-project-section ua-project-section--workspace"
      aria-label="Workspace project summary"
    >
      <div className="ua-project-section__header">
        <span className="ua-project-section__label">Current Project</span>
        <span className="ua-project-section__hint">Local context</span>
      </div>
      <ProjectSummary project={project} emptyText="Select a project from the composer dock" />
    </section>
  );
}
