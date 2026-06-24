import { workspaceStatusItems, type WorkspaceStatusItem } from "./workspace-data";
import "./WorkspaceStatusStrip.css";

export interface WorkspaceStatusStripProps {
  items?: WorkspaceStatusItem[];
}

export function WorkspaceStatusStrip({ items = workspaceStatusItems }: WorkspaceStatusStripProps) {
  return (
    <section className="ua-workspace-status" aria-label="Workspace status">
      {items.map((item) => (
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
