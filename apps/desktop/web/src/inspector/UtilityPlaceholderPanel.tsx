import {
  reviewSummary,
  utilityEvidencePanel,
  type UtilityPlaceholderPanelData,
} from "./inspector-data";
import "./UtilityPlaceholderPanel.css";

interface UtilityPlaceholderPanelProps {
  panel: UtilityPlaceholderPanelData;
}

export function UtilityPlaceholderPanel({ panel }: UtilityPlaceholderPanelProps) {
  return (
    <section className="ua-utility-placeholder" aria-label={`${panel.title} placeholder`}>
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">{panel.badge}</span>
          <h3 className="ua-utility-placeholder__title">{panel.title}</h3>
        </div>
        <span
          className={`ua-utility-placeholder__state${
            panel.state === "Not connected" ? " ua-utility-placeholder__state--warning" : ""
          }`}
        >
          {panel.state}
        </span>
      </div>

      <ul className="ua-utility-placeholder__list">
        {panel.items.map((item) => (
          <li key={item} className="ua-utility-placeholder__item">
            {item}
          </li>
        ))}
      </ul>

      <button className="ua-utility-placeholder__action" type="button" disabled>
        {panel.actionLabel}
      </button>
    </section>
  );
}

export function UtilityEvidencePanel() {
  return (
    <section className="ua-utility-placeholder" aria-label="Evidence placeholder">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">{utilityEvidencePanel.badge}</span>
          <h3 className="ua-utility-placeholder__title">{utilityEvidencePanel.title}</h3>
        </div>
        <span className="ua-utility-placeholder__state">{utilityEvidencePanel.state}</span>
      </div>

      <ul className="ua-utility-placeholder__list">
        {reviewSummary.evidenceItems.map((item) => (
          <li key={item.id} className="ua-utility-placeholder__item">
            <span className="ua-utility-placeholder__item-state">{item.status}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>

      <button className="ua-utility-placeholder__action" type="button" disabled>
        {utilityEvidencePanel.actionLabel}
      </button>
    </section>
  );
}
