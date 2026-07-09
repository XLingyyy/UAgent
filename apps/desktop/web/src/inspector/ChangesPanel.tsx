import { useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function ChangesPanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const events = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const changeSetEvents = events.filter((e) => e.type.startsWith("change_set_"));
  const sandboxEvents = events.filter((e) => e.type.startsWith("sandbox_"));
  const lastChangeSet = changeSetEvents[changeSetEvents.length - 1];
  const mvp12 = runtime?.mvp12;
  const mvp13 = runtime?.mvp13;
  const mvp15 = runtime?.mvp15;
  const activeChangeSet = mvp12?.activeChangeSet ?? null;

  return (
    <section className="ua-utility-placeholder" aria-label="Changes panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">Runtime-derived</span>
          <h3 className="ua-utility-placeholder__title">Changes</h3>
        </div>
        <span className="ua-utility-placeholder__state">
          {activeChangeSet ? activeChangeSet.state : activeTaskId ? `${changeSetEvents.length} change events` : "idle"}
        </span>
      </div>

      <ul className="ua-utility-placeholder__list">
        {mvp12 && (
          <>
            <li className="ua-utility-placeholder__item">
              MVP12 proposals: {mvp12.proposals.length} / apply {mvp12.applyStatus} / verify{" "}
              {mvp12.verifyStatus} / rollback {mvp12.rollbackStatus}
            </li>
            {activeChangeSet && (
              <>
                <li className="ua-utility-placeholder__item">
                  Active ChangeSet: {activeChangeSet.title} ({activeChangeSet.risk})
                </li>
                <li className="ua-utility-placeholder__item">Diff: {activeChangeSet.diffSummary}</li>
                <li className="ua-utility-placeholder__item">
                  Approval: {activeChangeSet.state === "approval_required" ? "Required" : activeChangeSet.state}
                </li>
                <li className="ua-utility-placeholder__item">
                  Rollback: {activeChangeSet.rollback?.available ? activeChangeSet.rollback.id : "Unavailable"}
                </li>
              </>
            )}
          </>
        )}

        {mvp13 && (
          <>
            <li className="ua-utility-placeholder__item">
              MVP13 editor proposals: {mvp13.editorProposals.length} / MCP dry-runs {mvp13.mcpDryRuns.length} / asset plans{" "}
              {mvp13.assetPlans.length}
            </li>
            {mvp13.mcpDryRuns.slice(-2).map((dryRun) => (
              <li key={dryRun.id} className="ua-utility-placeholder__item">
                MCP dry-run: {dryRun.toolName} / {dryRun.textBacked ? "ChangeSet v2" : dryRun.assetRisk ? "blocked asset plan" : "state-only"}
              </li>
            ))}
          </>
        )}

        {mvp15 && mvp15.changeSets.length > 0 && (
          <>
            <li className="ua-utility-placeholder__item">
              Asset ChangeSets: {mvp15.changeSets.length} / gate {mvp15.gate.mode}
            </li>
            {mvp15.activeChangeSet && (
              <li className="ua-utility-placeholder__item">
                Asset ChangeSet: {mvp15.activeChangeSet.state} / {mvp15.activeChangeSet.risk}
              </li>
            )}
          </>
        )}

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
