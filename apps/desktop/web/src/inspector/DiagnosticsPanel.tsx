import type { TaskEvent } from "@uagent/shared";
import { InspectorSummaryCard } from "./InspectorSummaryCard";
import { diagnosticSummary } from "./inspector-data";
import { extractRuntimeDiagnostics } from "../runtime/event-view-models";
import { useOptionalRuntimeStore } from "../stores/ui-store";
import "./DiagnosticsPanel.css";

const TONE_LABEL_CLASS: Record<string, string> = {
  default: "ua-diagnostics-item__state--default",
  warning: "ua-diagnostics-item__state--warning",
  accent: "ua-diagnostics-item__state--accent",
  success: "ua-diagnostics-item__state--success",
};

function uniqueDiagnostics(events: TaskEvent[]): TaskEvent[] {
  const diagnosticsByReason = new Map<string, TaskEvent>();

  for (const event of events) {
    const key = event.body ?? event.title;
    const current = diagnosticsByReason.get(key);
    if (!current || diagnosticPriority(event) > diagnosticPriority(current)) {
      diagnosticsByReason.set(key, event);
    }
  }

  return [...diagnosticsByReason.values()];
}

function diagnosticPriority(event: TaskEvent): number {
  if (event.type === "task_failed") return 5;
  if (event.type === "task_cancelled") return 4;
  if (event.type === "mcp_tool_blocked") return 3;
  if (event.type === "agent_step_failed") return 2;
  if (event.level === "error") return 1;
  return 0;
}

export function DiagnosticsPanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const runtimeEvents = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const diagnostics = uniqueDiagnostics(extractRuntimeDiagnostics(runtimeEvents));

  if (diagnostics.length > 0) {
    return (
      <section className="ua-diagnostics-panel" aria-label="Diagnostics panel">
        <div className="ua-diagnostics-panel__summary">
          <InspectorSummaryCard label="Diagnostics" value={runtime?.status ?? "ready"} tone="warning" />
        </div>
        <h3 className="ua-diagnostics-panel__section-title">Runtime health</h3>
        <div className="ua-diagnostics-panel__items">
          {diagnostics.map((event) => (
            <div key={event.id} className="ua-diagnostics-item" aria-label={event.title}>
              <div className="ua-diagnostics-item__header">
                <span className="ua-diagnostics-item__label">{event.title}</span>
                <span className="ua-diagnostics-item__state ua-diagnostics-item__state--warning">
                  {event.level ?? "warning"}
                </span>
              </div>
              <p className="ua-diagnostics-item__description">{event.body}</p>
              {event.type === "provider_request_failed" && event.payload && typeof event.payload === "object" && "code" in event.payload ? (
                <span className="ua-diagnostics-item__code">Error code: {String((event.payload as Record<string, unknown>).code)}</span>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    );
  }

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
