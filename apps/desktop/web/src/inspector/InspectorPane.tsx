import { useNarrowViewport } from "../shell/useNarrowViewport";
import { useEffect, useRef, useState } from "react";
import { ComingSoonGate } from "../components/ComingSoonGate";
import { ReviewPanel } from "./ReviewPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { RuntimePanel } from "./RuntimePanel";
import { AgentTracePanel } from "./AgentTracePanel";
import { SafetyPanel } from "./SafetyPanel";
import { AuditPanel } from "./AuditPanel";
import { ChangesPanel } from "./ChangesPanel";
import { TerminalPanel } from "./TerminalPanel";
import { BrowserPanel } from "./BrowserPanel";
import { ScreenshotPanel } from "./ScreenshotPanel";
import { WatcherPanel } from "./WatcherPanel";
import { EditorPanel } from "./EditorPanel";
import { McpMutationPanel } from "./McpMutationPanel";
import { AssetMutationPanel } from "./AssetMutationPanel";
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

  if (toolId === "safety") {
    return <SafetyPanel />;
  }

  if (toolId === "audit") {
    return <AuditPanel />;
  }

  if (toolId === "changes") {
    return <ChangesPanel />;
  }

  if (toolId === "terminal") {
    return <TerminalPanel />;
  }

  if (toolId === "browser") {
    return <BrowserPanel />;
  }

  if (toolId === "screenshot") {
    return <ScreenshotPanel />;
  }

  if (toolId === "files") {
    return <WatcherPanel />;
  }

  if (toolId === "evidence") {
    return <UtilityEvidencePanel />;
  }

  if (toolId === "ue") {
    return <EditorPanel />;
  }

  if (toolId === "mcp-mutation") {
    return <McpMutationPanel />;
  }

  if (toolId === "asset-mutation") {
    return <AssetMutationPanel />;
  }

  if (isUtilityPlaceholderTool(toolId)) {
    return <UtilityPlaceholderPanel panel={utilityPlaceholderPanels[toolId]} />;
  }

  return null;
}

function isFutureTool(toolId: UtilityToolId): boolean {
  return ["logs", "asset-search"].includes(toolId);
}

export function InspectorPane({ open, onClose }: InspectorPaneProps) {
  const [activeToolId, setActiveToolId] = useState<UtilityToolId>("review");
  const paneRef = useRef<HTMLElement>(null);
  const modal = useNarrowViewport();
  useEffect(() => {
    const openAssets = () => setActiveToolId("asset-mutation");
    window.addEventListener("uagent:open-asset-workflow", openAssets);
    return () => window.removeEventListener("uagent:open-asset-workflow", openAssets);
  }, []);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(pane.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter((e) => e.getAttribute("aria-disabled") !== "true");
    if (modal) focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose?.(); }
      if (modal && event.key === "Tab") {
        const nodes = focusable(); const index = nodes.indexOf(document.activeElement as HTMLElement);
        if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === nodes.length - 1)) {
          event.preventDefault(); (event.shiftKey ? nodes[nodes.length - 1] : nodes[0])?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (modal) queueMicrotask(() => previous?.isConnected && previous.focus()); };
  }, [open, modal, onClose]);
  const activeTool = utilityTools.find((tool) => tool.id === activeToolId) ?? utilityTools[0];
  const activeTabId = `ua-utility-tool-${activeTool.id}`;
  const activePanelId = `ua-utility-panel-${activeTool.id}`;

  return (
    <aside
      ref={paneRef}
      role={modal ? "dialog" : "region"}
      aria-modal={open && modal ? true : undefined}
      {...(!open ? { inert: "" } : {})}
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
            const tab = (
              <button
                key={tool.id}
                id={tabId}
                className={`ua-inspector__tab ${selected ? "ua-inspector__tab--active" : ""}`}
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                onClick={() => {
                  if (!isFutureTool(tool.id)) {
                    setActiveToolId(tool.id);
                  }
                }}
                type="button"
              >
                {tool.label}
              </button>
            );

            return isFutureTool(tool.id) ? (
              <ComingSoonGate
                key={tool.id}
                phase="MVP7"
                reason={`${tool.label} is not available in this version.`}
              >
                {tab}
              </ComingSoonGate>
            ) : (
              tab
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
