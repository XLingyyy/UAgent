import { isTerminalTaskState } from "@uagent/shared";
import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function RuntimePanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const runtimeActions = useOptionalRuntimeActions();
  const activeTaskId = runtime?.activeTaskId ?? null;
  const activeTask = activeTaskId ? runtime?.tasksById[activeTaskId] : null;
  const events = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const canCancel = Boolean(activeTaskId && activeTask && runtimeActions && !isTerminalTaskState(activeTask.state));

  return (
    <section className="ua-utility-placeholder" aria-label="Runtime panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">Mock only</span>
          <h3 className="ua-utility-placeholder__title">Runtime context</h3>
        </div>
        <span className="ua-utility-placeholder__state">{runtime?.status ?? "ready"}</span>
      </div>

      <ul className="ua-utility-placeholder__list">
        <li className="ua-utility-placeholder__item">
          Task: {activeTask?.title ?? "No active runtime task"}
        </li>
        <li className="ua-utility-placeholder__item">
          State: {activeTask?.state ?? "idle"}
        </li>
        <li className="ua-utility-placeholder__item">{events.length} events</li>
        <li className="ua-utility-placeholder__item">
          {runtime?.mockOnlyWarning ?? "Mock runtime / no provider call"}
        </li>
        {events.slice(-3).map((event) => (
          <li key={event.id} className="ua-utility-placeholder__item">
            {event.title}
          </li>
        ))}
      </ul>

      <button
        className="ua-utility-placeholder__action"
        type="button"
        disabled={!canCancel}
        onClick={() => {
          if (activeTaskId) {
            void runtimeActions?.cancelRuntimeTask(activeTaskId);
          }
        }}
      >
        Cancel mock task
      </button>
    </section>
  );
}
