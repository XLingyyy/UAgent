import type { MockProject } from "../types/ui";
import "./ProjectSection.css";

export interface ProjectSectionProps {
  project: MockProject;
}

export function ProjectSection({ project }: ProjectSectionProps) {
  return (
    <section className="ua-project-section" aria-label="Current project">
      <div className="ua-project-section__header">
        <span className="ua-project-section__label">Project</span>
      </div>
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
        <div className="ua-project-card__actions">
          <button className="ua-project-card__btn" type="button" disabled>
            Open Project
          </button>
          <button className="ua-project-card__btn" type="button" disabled>
            Switch
          </button>
        </div>
      </div>
    </section>
  );
}
