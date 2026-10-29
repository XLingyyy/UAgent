import {useI18n} from "../i18n";
import { useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function ChangesPanel() {
  const {text: uiText,t} = useI18n();
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
  const rollbackAttempted = mvp15?.activeChangeSet?.rollbackPlan.actions.some((action) => (
    action.status === "completed" || action.status === "failed"
  )) === true;
  const assetAuditPhase = mvp15?.activeChangeSet?.state === "rolled_back" || rollbackAttempted ? "rollback" : "execute";

  return (
    <section className="ua-utility-placeholder" aria-label={uiText("Changes panel")}>
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">{uiText("Runtime-derived")}</span>
          <h3 className="ua-utility-placeholder__title">{uiText("Changes")}</h3>
        </div>
        <span className="ua-utility-placeholder__state">
          {activeChangeSet ? activeChangeSet.state : activeTaskId ? t("changes.eventCount",{count:changeSetEvents.length}) : uiText("idle")}
        </span>
      </div>

      <ul className="ua-utility-placeholder__list">
        {mvp12 && (
          <>
            <li className="ua-utility-placeholder__item">
              {uiText("MVP12 proposals:")}{" "}{mvp12.proposals.length} {uiText("/ apply")}{" "}{mvp12.applyStatus} {uiText("/ verify")}{" "}
              {mvp12.verifyStatus} {uiText("/ rollback")}{" "}{mvp12.rollbackStatus}
            </li>
            {activeChangeSet && (
              <>
                <li className="ua-utility-placeholder__item">
                  {uiText("Active ChangeSet:")}{" "}{activeChangeSet.title} ({activeChangeSet.risk})
                </li>
                <li className="ua-utility-placeholder__item">{uiText("Diff:")}{" "}{activeChangeSet.diffSummary}</li>
                <li className="ua-utility-placeholder__item">
                  {uiText("Approval:")}{" "}{activeChangeSet.state === "approval_required" ? uiText("Required") : activeChangeSet.state}
                </li>
                <li className="ua-utility-placeholder__item">
                  {uiText("Rollback:")}{" "}{activeChangeSet.rollback?.available ? activeChangeSet.rollback.id : uiText("Unavailable")}
                </li>
              </>
            )}
          </>
        )}

        {mvp13 && (
          <>
            <li className="ua-utility-placeholder__item">
              {uiText("MVP13 editor proposals:")}{" "}{mvp13.editorProposals.length} {uiText("/ MCP dry-runs")}{" "}{mvp13.mcpDryRuns.length} {uiText("/ asset plans")}{" "}
              {mvp13.assetPlans.length}
            </li>
            {mvp13.mcpDryRuns.slice(-2).map((dryRun) => (
              <li key={dryRun.id} className="ua-utility-placeholder__item">
                {uiText("MCP dry-run:")}{" "}{dryRun.toolName} / {dryRun.textBacked ? uiText("ChangeSet v2") : dryRun.assetRisk ? uiText("blocked asset plan") : uiText("state-only")}
              </li>
            ))}
          </>
        )}

        {mvp15 && mvp15.changeSets.length > 0 && (
          <>
            <li className="ua-utility-placeholder__item">
              {uiText("Asset ChangeSets:")}{" "}{mvp15.changeSets.length} {uiText("/ gate")}{" "}{mvp15.gate.mode}
            </li>
            {mvp15.lastError && (
              <li className="ua-utility-placeholder__item">{uiText("Asset blocked reason:")}{" "}{mvp15.lastError}</li>
            )}
            {mvp15.activeChangeSet && (
              <>
                <li className="ua-utility-placeholder__item">
                  {uiText("Asset ChangeSet:")}{" "}{mvp15.activeChangeSet.state} / {mvp15.activeChangeSet.risk}
                </li>
                {mvp15.latestExecution && (
                  <li className="ua-utility-placeholder__item">
                    {uiText("Asset execution audit:")}{" "}{mvp15.latestExecution.status} / {mvp15.latestExecution.affectedAssets.length} {uiText("affected assets")}{" "}</li>
                )}
                {mvp15.latestVerification && (
                  <li className="ua-utility-placeholder__item">
                    {uiText("Asset verification audit:")}{" "}{mvp15.latestVerification.status} / {mvp15.latestVerification.checks.length} {uiText("checks")}{" "}</li>
                )}
                {mvp15.activeChangeSet.state === "rolled_back" && (
                  <li className="ua-utility-placeholder__item">{uiText("Asset rollback audit: rolled_back")}</li>
                )}
                {mvp15.replaySummary?.replayOnly && (
                  <li className="ua-utility-placeholder__item">
                    {uiText("Asset replay audit: recorded-only /")}{" "}{mvp15.replaySummary.recordedOnlyActions?.length ?? 0} {uiText("actions / 0 runtime side effects")}{" "}</li>
                )}
                {mvp15.activeChangeSet.operations.map((operation) => {
                  const rollbackAction = mvp15.activeChangeSet?.rollbackPlan.actions.find((action) => action.operationId === operation.id);
                  const result = assetAuditPhase === "rollback"
                    ? (rollbackAction?.status ?? "not_applicable")
                    : (operation.executionStatus ?? "pending");
                  const evidenceId = assetAuditPhase === "rollback"
                    ? rollbackAction?.evidenceId
                    : operation.executionEvidenceId;
                  return (
                    <li key={`asset-audit:${operation.id}`} className="ua-utility-placeholder__item">
                      {uiText("Asset operation audit: phase")}{" "}{assetAuditPhase} {uiText("/ tool")}{" "}{operation.provenance?.exactToolName ?? uiText("fixture-local")} {uiText("/ virtual path")}{" "}{operation.assetPathAfter ?? operation.assetPathBefore ?? uiText("[redacted]")} {uiText("/ result")}{" "}{result} {uiText("/ evidence")}{" "}{evidenceId ?? uiText("recorded-only")}
                    </li>
                  );
                })}
              </>
            )}
          </>
        )}

        {!activeTaskId && (
          <li className="ua-utility-placeholder__item">{uiText("No active task. Submit a task to see change events.")}</li>
        )}

        {activeTaskId && changeSetEvents.length === 0 && sandboxEvents.length === 0 && (
          <li className="ua-utility-placeholder__item">{uiText("No change set or sandbox events for the active task.")}</li>
        )}

        {changeSetEvents.length > 0 && (
          <>
            <li className="ua-utility-placeholder__item">{uiText("Change set events:")}{" "}{changeSetEvents.length}</li>
            {changeSetEvents.slice(-5).map((event) => (
              <li key={event.id} className="ua-utility-placeholder__item">
                {event.type.replace("change_set_", "")}: {event.title}
              </li>
            ))}
          </>
        )}

        {sandboxEvents.length > 0 && (
          <>
            <li className="ua-utility-placeholder__item">{uiText("Sandbox events:")}{" "}{sandboxEvents.length}</li>
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
              {uiText("Diff:")}{" "}{diffSummary}
            </li>
          );
        })()}
      </ul>
    </section>
  );
}
