import { workspaceStatusItems, type WorkspaceStatusItem } from "./workspace-data";
import { useProjectStore } from "../stores/ui-store";
import "./WorkspaceStatusStrip.css";

export interface WorkspaceStatusStripProps {
  items?: WorkspaceStatusItem[];
}

export function WorkspaceStatusStrip({ items = workspaceStatusItems }: WorkspaceStatusStripProps) {
  const project = useProjectStore((state) => state);
  const activeProject = project.registeredProjects.find((item) => item.id === project.activeProjectId);
  const projectItems: WorkspaceStatusItem[] = [
    {
      label: "Project index",
      value: project.activeProjectIndex ? "ready" : "fixture/local-only",
      tone: project.activeProjectIndex ? "accent" : "default",
    },
    {
      label: "Active project",
      value: activeProject?.name ?? "No project root registered",
      tone: activeProject ? "accent" : "default",
    },
    {
      label: "Capability mode",
      value: "disabled/fixture read-only",
      tone: "warning",
    },
  ];
  return (
    <section className="ua-workspace-status" aria-label="Workspace status">
      {[...items, ...projectItems].map((item) => (
        <div className="ua-workspace-status__item" key={item.label}>
          <span className="ua-workspace-status__label">{item.label}</span>
          <span
            className={[
              "ua-workspace-status__value",
              item.tone ? `ua-workspace-status__value--${item.tone}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {item.value}
          </span>
        </div>
      ))}
    </section>
  );
}
