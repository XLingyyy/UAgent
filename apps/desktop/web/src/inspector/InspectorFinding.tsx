import {useI18n} from "../i18n";
import { safeDisplay } from "./safe-display";
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
  const {text:uiText,t}=useI18n();
  return (
    <article
      className={`ua-finding ${SEVERITY_CLASS[severity] ?? ""}`}
      aria-label={t("review.findingLabel",{title:safeDisplay(title)})}
    >
      <div className="ua-finding__header">
        <span className="ua-finding__severity">{uiText(SEVERITY_LABEL[severity] ?? severity)}</span>
        <h4 className="ua-finding__title">{safeDisplay(title)}</h4>
      </div>
      <p className="ua-finding__description">{safeDisplay(description)}</p>
      <div className="ua-finding__meta">
        <span className="ua-finding__scope">{safeDisplay(scope)}</span>
        <span className="ua-finding__evidence">{safeDisplay(evidenceRef)}</span>
      </div>
    </article>
  );
}
