import type { MockProject, ProjectTreeNode as ProjectTreeNodeType } from "../types/ui";
import { ProjectTree } from "./ProjectTree";
import "./ProjectSection.css";

export interface ProjectSectionProps {
  mode?: "workspace" | "projects";
  project: MockProject | null;
  treeNodes: ProjectTreeNodeType[];
  projects?: MockProject[];
  activeProjectId?: string | null;
  onProjectSelect?: (projectId: string) => void;
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
          {project && (
            <ProjectTree
              key={project.id}
              nodes={treeNodes}
              label="Asset Browser"
              ariaLabel={`${project.name} asset browser`}
            />
          )}
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
