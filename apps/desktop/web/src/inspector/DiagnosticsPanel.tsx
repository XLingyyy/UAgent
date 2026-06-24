import { InspectorSummaryCard } from "./InspectorSummaryCard";
import { diagnosticSummary } from "./inspector-data";
import "./DiagnosticsPanel.css";

const TONE_LABEL_CLASS: Record<string, string> = {
  default: "ua-diagnostics-item__state--default",
  warning: "ua-diagnostics-item__state--warning",
  accent: "ua-diagnostics-item__state--accent",
  success: "ua-diagnostics-item__state--success",
};

export function DiagnosticsPanel() {
  return (
    <section className="ua-diagnostics-panel" aria-label="Diagnostics panel">
      <div className="ua-diagnostics-panel__summary">
        <InspectorSummaryCard label="Diagnostics" value={diagnosticSummary.status} tone="warning" />
      </div>
      <h3 className="ua-diagnostics-panel__section-title">Runtime health</h3>
      <div className="ua-diagnostics-panel__items">
        {diagnosticSummary.items.map((item) => (
          <div key={item.id} className="ua-diagnostics-item" aria-label={item.label}>
            <div className="ua-diagnostics-item__header">
              <span className="ua-diagnostics-item__label">{item.label}</span>
              <span
                className={`ua-diagnostics-item__state ${
                  TONE_LABEL_CLASS[item.tone] ?? TONE_LABEL_CLASS.default
                }`}
              >
                {item.state}
              </span>
            </div>
            <p className="ua-diagnostics-item__description">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
