import { useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function ChangesPanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const events = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const changeSetEvents = events.filter((e) => e.type.startsWith("change_set_"));
  const sandboxEvents = events.filter((e) => e.type.startsWith("sandbox_"));
  const lastChangeSet = changeSetEvents[changeSetEvents.length - 1];

  return (
    <section className="ua-utility-placeholder" aria-label="Changes panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">Runtime-derived</span>
          <h3 className="ua-utility-placeholder__title">Changes</h3>
        </div>
        <span className="ua-utility-placeholder__state">
          {activeTaskId ? `${changeSetEvents.length} change events` : "idle"}
        </span>
      </div>

      <ul className="ua-utility-placeholder__list">
        {!activeTaskId && (
          <li className="ua-utility-placeholder__item">No active task. Submit a task to see change events.</li>
        )}

        {activeTaskId && changeSetEvents.length === 0 && sandboxEvents.length === 0 && (
          <li className="ua-utility-placeholder__item">No change set or sandbox events for the active task.</li>
        )}

        {changeSetEvents.length > 0 && (
          <>
            <li className="ua-utility-placeholder__item">Change set events: {changeSetEvents.length}</li>
            {changeSetEvents.slice(-5).map((event) => (
              <li key={event.id} className="ua-utility-placeholder__item">
                {event.type.replace("change_set_", "")}: {event.title}
              </li>
            ))}
          </>
        )}

        {sandboxEvents.length > 0 && (
          <>
            <li className="ua-utility-placeholder__item">Sandbox events: {sandboxEvents.length}</li>
            {sandboxEvents.slice(-3).map((event) => (
              <li key={event.id} className="ua-utility-placeholder__item">
                {event.type.replace("sandbox_", "")}: {event.title}
              </li>
            ))}
          </>
        )}

        {lastChangeSet && (() => {
          const payload = lastChangeSet.payload as Record<string, unknown> | undefined;
          const diffSummary = payload?.diffSummary as string | undefined;
          if (!diffSummary) return null;
          return (
            <li className="ua-utility-placeholder__item">
              Diff: {diffSummary}
            </li>
          );
        })()}
      </ul>
    </section>
  );
}
