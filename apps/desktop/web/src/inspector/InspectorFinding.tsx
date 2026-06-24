import type { ReviewFinding } from "./inspector-data";
import "./InspectorFinding.css";

export type { ReviewFinding } from "./inspector-data";

const SEVERITY_LABEL: Record<string, string> = {
  info: "Info",
  warning: "Warning",
  passed: "Passed",
};

const SEVERITY_CLASS: Record<string, string> = {
  info: "ua-finding--info",
  warning: "ua-finding--warning",
  passed: "ua-finding--passed",
};

export function InspectorFinding({
  severity,
  title,
  description,
  scope,
  evidenceRef,
}: ReviewFinding) {
  return (
    <article
      className={`ua-finding ${SEVERITY_CLASS[severity] ?? ""}`}
      aria-label={`Finding: ${title}`}
    >
      <div className="ua-finding__header">
        <span className="ua-finding__severity">{SEVERITY_LABEL[severity] ?? severity}</span>
        <h4 className="ua-finding__title">{title}</h4>
      </div>
      <p className="ua-finding__description">{description}</p>
      <div className="ua-finding__meta">
        <span className="ua-finding__scope">{scope}</span>
        <span className="ua-finding__evidence">{evidenceRef}</span>
      </div>
    </article>
  );
}
