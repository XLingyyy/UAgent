import type { AgentObservation, EvidenceRecord, TaskEvent } from "@uagent/shared";
import {
  reviewSummary,
  utilityEvidencePanel,
  type UtilityPlaceholderPanelData,
} from "./inspector-data";
import { extractRuntimeEvidence } from "../runtime/event-view-models";
import { useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

interface EvidenceDisplayItem {
  id: string;
  status: string;
  summary: string;
  source: string;
  evidenceId: string;
}

interface UtilityPlaceholderPanelProps {
  panel: UtilityPlaceholderPanelData;
}

function payloadRecord(event: TaskEvent): Record<string, unknown> | null {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : null;
}

function extractEvidenceItem(event: TaskEvent): EvidenceDisplayItem {
  const payload = payloadRecord(event);
  const observation =
    payload?.observation && typeof payload.observation === "object"
      ? (payload.observation as AgentObservation)
      : null;
  const evidence =
    payload?.evidence && typeof payload.evidence === "object"
      ? (payload.evidence as EvidenceRecord)
      : null;
  const id = evidence?.id ?? observation?.id ?? event.id;
  const source = evidence?.source ?? observation?.source ?? "runtime";
  const summary = evidence?.summary ?? observation?.summary ?? event.body ?? event.title;

  return {
    id,
    status: event.level === "warning" ? "pending" : "checked",
    summary,
    source,
    evidenceId: id,
  };
}

function uniqueEvidenceItems(events: TaskEvent[]): EvidenceDisplayItem[] {
  const seen = new Set<string>();
  const items: EvidenceDisplayItem[] = [];

  for (const event of events) {
    const item = extractEvidenceItem(event);
    const key = `${item.evidenceId}:${item.summary}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(item);
  }

  return items;
}

export function UtilityPlaceholderPanel({ panel }: UtilityPlaceholderPanelProps) {
  const runtime = useOptionalRuntimeStore((state) => state);
  if (panel.id === "ue" && runtime) {
    const capabilities = runtime.mcp.capabilities;
    const mcpLabel =
      runtime.mcp.status === "connected" && capabilities
        ? "MCP read-only"
        : runtime.mcp.status === "connected"
          ? "Discovery required"
          : "Mock only";
    return (
      <section className="ua-utility-placeholder" aria-label="UE runtime context">
        <div className="ua-utility-placeholder__header">
          <div className="ua-utility-placeholder__title-group">
            <span className="ua-utility-placeholder__eyebrow">{mcpLabel}</span>
            <h3 className="ua-utility-placeholder__title">UE</h3>
          </div>
          <span
            className={`ua-utility-placeholder__state${
              runtime.mcp.status !== "connected" ? " ua-utility-placeholder__state--warning" : ""
            }`}
          >
            {runtime.mcp.status}
          </span>
        </div>
        <ul className="ua-utility-placeholder__list">
          <li className="ua-utility-placeholder__item">
            Server: {runtime.mcp.serverInfo?.name ?? "Not connected"}
          </li>
          <li className="ua-utility-placeholder__item">
            Protocol: {runtime.mcp.protocolVersion ?? "Not initialized"}
          </li>
          <li className="ua-utility-placeholder__item">
            Capabilities:{" "}
            {capabilities
              ? `${capabilities.resources} resources, ${capabilities.readOnlyTools} read-only tools, ${capabilities.blockedTools} blocked`
              : "No discovery snapshot"}
          </li>
        </ul>
        <button className="ua-utility-placeholder__action" type="button" disabled>
          Read-only MCP context
        </button>
      </section>
    );
  }

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
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const runtimeEvents = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const evidenceEvents = extractRuntimeEvidence(runtimeEvents);
  const evidenceItems = uniqueEvidenceItems(evidenceEvents);

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
        {evidenceEvents.length > 0
          ? evidenceItems.map((item, index) => (
              <li key={`${item.id}-${index}`} className="ua-utility-placeholder__item">
                <span className="ua-utility-placeholder__item-state">{item.status}</span>
                <span>{item.summary}</span>
                <span className="ua-utility-placeholder__item-state">{item.source}</span>
                <span className="ua-utility-placeholder__item-state">{item.evidenceId}</span>
              </li>
            ))
          : reviewSummary.evidenceItems.map((item) => (
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
