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

  let id: string;
  let source: string;
  let summary: string;

  if (event.type === "terminal_output" && payload?.kind === "terminal_output") {
    id = (payload.id as string) ?? event.id;
    source = (payload.source as string) ?? "capability-bridge";
    summary = (payload.summary as string) ?? event.body ?? event.title;
  } else {
    id = evidence?.id ?? observation?.id ?? event.id;
    source = evidence?.source ?? observation?.source ?? "runtime";
    summary = evidence?.summary ?? observation?.summary ?? event.body ?? event.title;
  }

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
  const mvp11 = runtime?.mvp11;
  const mvp12 = runtime?.mvp12;
  const mvp14 = runtime?.mvp14;
  const mvp11EvidenceItems = mvp11
    ? [
        ...(mvp11.metadata
          ? [
              {
                id: "mvp11-ue-metadata",
                status: mvp11.metadataStatus,
                summary: `UE metadata: ${mvp11.metadata.modules.length} modules, ${mvp11.metadata.targets.length} targets, UE ${mvp11.metadata.engineAssociation ?? "unknown"}`,
                source: "ue_project_metadata",
                evidenceId: mvp11.metadata.projectId,
              },
            ]
          : []),
        ...(mvp11.buildAnalysis
          ? [
              {
                id: "mvp11-build-failure",
                status: mvp11.buildAnalysisStatus,
                summary: `Build diagnostics: ${mvp11.buildAnalysis.errorCount} errors, ${mvp11.buildAnalysis.warningCount} warnings`,
                source: "build_failure_summary",
                evidenceId: "recorded_terminal_output",
              },
            ]
          : []),
        ...(mvp11.contextPack
          ? [
              {
                id: "mvp11-context-pack",
                status: mvp11.contextPackStatus,
                summary: `Context Pack: ${mvp11.contextPack.title}`,
                source: "context_pack_summary",
                evidenceId: mvp11.contextPack.id,
              },
            ]
          : []),
      ]
    : [];
  const mvp12EvidenceItems = mvp12?.activeChangeSet
    ? [
        {
          id: "mvp12-change-set",
          status: mvp12.activeChangeSet.state,
          summary: `ChangeSet: ${mvp12.activeChangeSet.diffSummary}`,
          source: "change_set_v2",
          evidenceId: mvp12.activeChangeSet.id,
        },
        {
          id: "mvp12-rollback",
          status: mvp12.activeChangeSet.rollback?.available ? "available" : "unavailable",
          summary: `Rollback: ${mvp12.activeChangeSet.rollback?.id ?? "none"}`,
          source: "rollback_snapshot",
          evidenceId: mvp12.activeChangeSet.rollback?.id ?? "rollback_unavailable",
        },
        {
          id: "mvp12-redaction",
          status: mvp12.activeChangeSet.redaction.redacted ? "redacted" : "clean",
          summary: `Redaction: ${mvp12.activeChangeSet.redaction.replacedPaths} paths / ${mvp12.activeChangeSet.redaction.replacedSecrets} secrets`,
          source: "diff_summary",
          evidenceId: mvp12.activeChangeSet.id,
        },
      ]
    : [];
  const mvp14EvidenceItems =
    mvp14 && (mvp14.status?.heartbeat || mvp14.snapshot?.snapshot || mvp14.replaySummary)
      ? [
          ...(mvp14.status?.heartbeat
            ? [
                {
                  id: "mvp14-heartbeat",
                  status: mvp14.status.status,
                  summary: `Editor heartbeat: ${mvp14.status.heartbeat.statusReason}`,
                  source: "editor_heartbeat",
                  evidenceId: mvp14.status.heartbeat.sessionId,
                },
              ]
            : []),
          ...(mvp14.snapshot?.snapshot
            ? [
                {
                  id: "mvp14-snapshot",
                  status: mvp14.snapshot.status,
                  summary: `Editor snapshot: ${mvp14.snapshot.snapshot.editorState} / ${mvp14.snapshot.snapshot.displayProject}`,
                  source: "editor_snapshot",
                  evidenceId: mvp14.snapshot.snapshot.sessionId,
                },
              ]
            : []),
          ...(mvp14.replaySummary
            ? [
                {
                  id: "mvp14-replay",
                  status: "recorded",
                  summary: `Replay: ${mvp14.replaySummary.recordedOnlyActions.join(", ")}`,
                  source: "editor_process_observation",
                  evidenceId: mvp14.replaySummary.sessionId,
                },
              ]
            : []),
        ]
      : [];
  const fallbackEvidenceItems = [
    ...reviewSummary.evidenceItems.map((item) => ({
      id: item.id,
      status: item.status,
      label: item.label,
    })),
    { id: "mvp11-ue-metadata", status: "ready", label: "UE metadata evidence" },
    { id: "mvp11-build-failure", status: "ready", label: "Build failure evidence" },
    { id: "mvp11-context-pack", status: "ready", label: "Context pack evidence" },
  ];

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
        {[...mvp14EvidenceItems, ...mvp12EvidenceItems, ...mvp11EvidenceItems].length > 0
          ? [...mvp14EvidenceItems, ...mvp12EvidenceItems, ...mvp11EvidenceItems].map((item) => (
              <li key={item.id} className="ua-utility-placeholder__item">
                <span className="ua-utility-placeholder__item-state">{item.status}</span>
                <span>{item.summary}</span>
                <span className="ua-utility-placeholder__item-state">{item.source}</span>
                <span className="ua-utility-placeholder__item-state">{item.evidenceId}</span>
              </li>
            ))
          : evidenceEvents.length > 0
            ? evidenceItems.map((item, index) => (
                <li key={`${item.id}-${index}`} className="ua-utility-placeholder__item">
                  <span className="ua-utility-placeholder__item-state">{item.status}</span>
                <span>{item.summary}</span>
                <span className="ua-utility-placeholder__item-state">{item.source}</span>
                <span className="ua-utility-placeholder__item-state">{item.evidenceId}</span>
              </li>
            ))
          : fallbackEvidenceItems.map((item) => (
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
