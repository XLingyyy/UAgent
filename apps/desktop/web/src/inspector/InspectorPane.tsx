import { useState } from "react";
import { ReviewPanel } from "./ReviewPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { RuntimePanel } from "./RuntimePanel";
import { AgentTracePanel } from "./AgentTracePanel";
import { UtilityEvidencePanel, UtilityPlaceholderPanel } from "./UtilityPlaceholderPanel";
import {
  utilityPlaceholderPanels,
  utilityTools,
  type UtilityPlaceholderToolId,
  type UtilityToolId,
} from "./inspector-data";
import "./InspectorPane.css";

export type InspectorTab = UtilityToolId;

export interface InspectorPaneProps {
  open: boolean;
  onClose?: () => void;
}

function isUtilityPlaceholderTool(toolId: UtilityToolId): toolId is UtilityPlaceholderToolId {
  return Object.prototype.hasOwnProperty.call(utilityPlaceholderPanels, toolId);
}

function renderToolPanel(toolId: UtilityToolId) {
  if (toolId === "review") {
    return <ReviewPanel />;
  }

  if (toolId === "diagnostics") {
    return <DiagnosticsPanel />;
  }

  if (toolId === "runtime") {
    return <RuntimePanel />;
  }

  if (toolId === "agent-trace") {
    return <AgentTracePanel />;
  }

  if (toolId === "evidence") {
    return <UtilityEvidencePanel />;
  }

  if (isUtilityPlaceholderTool(toolId)) {
    return <UtilityPlaceholderPanel panel={utilityPlaceholderPanels[toolId]} />;
  }

  return null;
}

export function InspectorPane({ open, onClose }: InspectorPaneProps) {
  const [activeToolId, setActiveToolId] = useState<UtilityToolId>("review");
  const activeTool = utilityTools.find((tool) => tool.id === activeToolId) ?? utilityTools[0];
  const activeTabId = `ua-utility-tool-${activeTool.id}`;
  const activePanelId = `ua-utility-panel-${activeTool.id}`;

  return (
    <aside
      className={`ua-inspector ua-motion-panel ${open ? "ua-inspector--open" : "ua-inspector--closed"}`}
      aria-label="Utility drawer"
      aria-hidden={!open}
      data-motion="panel"
      data-state={open ? "open" : "closed"}
    >
      <div className="ua-inspector__header">
        <span className="ua-inspector__title">Tools</span>
        {onClose && (
          <button
            className="ua-inspector__close"
            onClick={onClose}
            aria-label="Close tools"
            type="button"
          >
            Close
          </button>
        )}
      </div>
      <div className="ua-inspector__body">
        <div className="ua-inspector__summary" aria-live="polite">
          <span className="ua-inspector__summary-label">Utility drawer</span>
          <span className="ua-inspector__summary-text">{activeTool.summary}</span>
        </div>
        <div className="ua-inspector__tab-bar" role="tablist" aria-label="Utility tools">
          {utilityTools.map((tool) => {
            const selected = activeToolId === tool.id;
            const tabId = `ua-utility-tool-${tool.id}`;
            const panelId = `ua-utility-panel-${tool.id}`;

            return (
              <button
                key={tool.id}
                id={tabId}
                className={`ua-inspector__tab ${selected ? "ua-inspector__tab--active" : ""}`}
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                onClick={() => setActiveToolId(tool.id)}
                type="button"
              >
                {tool.label}
              </button>
            );
          })}
        </div>
        <div
          id={activePanelId}
          className="ua-inspector__content"
          role="tabpanel"
          aria-labelledby={activeTabId}
        >
          {renderToolPanel(activeTool.id)}
        </div>
      </div>
    </aside>
  );
}
