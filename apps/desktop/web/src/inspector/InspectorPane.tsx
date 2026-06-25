import { useState } from "react";
import { ReviewPanel } from "./ReviewPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import "./InspectorPane.css";

export type InspectorTab = "review" | "diagnostics";

export interface InspectorPaneProps {
  open: boolean;
  onClose?: () => void;
}

export function InspectorPane({ open, onClose }: InspectorPaneProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("review");

  return (
    <aside
      className={`ua-inspector ${open ? "ua-inspector--open" : "ua-inspector--closed"}`}
      aria-label="Inspector"
      aria-hidden={!open}
      data-state={open ? "open" : "closed"}
    >
      <div className="ua-inspector__header">
        <span className="ua-inspector__title">Inspector</span>
        {onClose && (
          <button
            className="ua-inspector__close"
            onClick={onClose}
            aria-label="Close inspector"
            type="button"
          >
            x
          </button>
        )}
      </div>
      <div className="ua-inspector__body">
        <div className="ua-inspector__tab-bar" role="tablist" aria-label="Inspector tabs">
          <button
            className={`ua-inspector__tab ${activeTab === "review" ? "ua-inspector__tab--active" : ""}`}
            role="tab"
            aria-selected={activeTab === "review"}
            onClick={() => setActiveTab("review")}
            type="button"
          >
            Review
          </button>
          <button
            className={`ua-inspector__tab ${activeTab === "diagnostics" ? "ua-inspector__tab--active" : ""}`}
            role="tab"
            aria-selected={activeTab === "diagnostics"}
            onClick={() => setActiveTab("diagnostics")}
            type="button"
          >
            Diagnostics
          </button>
        </div>
        <div className="ua-inspector__content" role="tabpanel">
          {activeTab === "review" ? <ReviewPanel /> : <DiagnosticsPanel />}
        </div>
      </div>
    </aside>
  );
}
