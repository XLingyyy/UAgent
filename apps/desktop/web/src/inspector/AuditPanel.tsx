import {useI18n} from "../i18n";
import { useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function AuditPanel() {
  const {text: uiText,t} = useI18n();
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const events = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const workflowEvents = events.filter(
    (e) =>
      e.type.startsWith("task_") ||
      e.type.startsWith("agent_") ||
      e.type.startsWith("approval_") ||
      e.type.startsWith("sandbox_") ||
      e.type.startsWith("change_set_") ||
      e.type.startsWith("provider_") ||
      e.type.startsWith("mcp_"),
  );

  return (
    <section className="ua-utility-placeholder" aria-label={uiText("Audit panel")}>
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">{uiText("Runtime-derived")}</span>
          <h3 className="ua-utility-placeholder__title">{uiText("Audit")}</h3>
        </div>
        <span className="ua-utility-placeholder__state">
          {activeTaskId ? t("audit.eventCount",{count:workflowEvents.length}) : uiText("idle")}
        </span>
      </div>

      {!activeTaskId && (
        <ul className="ua-utility-placeholder__list">
          <li className="ua-utility-placeholder__item">{uiText("No active task. Submit a task to see audit events.")}</li>
        </ul>
      )}

      {activeTaskId && workflowEvents.length === 0 && (
        <ul className="ua-utility-placeholder__list">
          <li className="ua-utility-placeholder__item">{uiText("No workflow events recorded yet.")}</li>
        </ul>
      )}

      {activeTaskId && workflowEvents.length > 0 && (
        <ul className="ua-utility-placeholder__list">
          <li className="ua-utility-placeholder__item">{uiText("Task:")}{" "}{runtime?.tasksById[activeTaskId]?.title ?? activeTaskId}</li>
          <li className="ua-utility-placeholder__item">{uiText("State:")}{" "}{runtime?.tasksById[activeTaskId]?.state ?? uiText("unknown")}</li>
          <li className="ua-utility-placeholder__item">{uiText("Total workflow events:")}{" "}{workflowEvents.length}</li>
          {workflowEvents.slice(-10).map((event) => (
            <li key={event.id} className="ua-utility-placeholder__item">
              {event.type}: {event.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
