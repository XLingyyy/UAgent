import {useI18n} from "../i18n";
import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function EditorPanel() {
  const {text: uiText,t} = useI18n();
  const mvp13 = useOptionalRuntimeStore((state) => state.mvp13);
  const mvp14 = useOptionalRuntimeStore((state) => state.mvp14);
  const actions = useOptionalRuntimeActions();
  const latestProposal = mvp13?.editorProposals[mvp13.editorProposals.length - 1] ?? null;
  const latestResult = mvp13?.editorResults[mvp13.editorResults.length - 1] ?? null;
  const latestProcess = mvp14?.discovery?.processes[0] ?? null;
  const canPropose = Boolean(mvp13?.editorSession && mvp13.editorCapability.enabled);
  const canApprove = latestProposal?.status === "approval_required" || latestProposal?.status === "proposed";
  const canExecute = latestProposal?.status === "approved";
  const canCancel = canApprove || canExecute;

  return (
    <section className="ua-utility-placeholder" aria-label={uiText("Editor panel")}>
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">{uiText("MVP14 safe observation")}</span>
          <h3 className="ua-utility-placeholder__title">{uiText("UE Editor")}</h3>
        </div>
          <span className="ua-utility-placeholder__state" data-mvp15d-observation="editor-session-state">
          {mvp14?.session?.status ?? mvp14?.capability.reason ?? mvp13?.editorSession?.status ?? uiText("disabled")}
        </span>
      </div>
      <ul className="ua-utility-placeholder__list">
        <li className="ua-utility-placeholder__item">
          {uiText("Observation:")}{" "}{mvp14?.capability.enabled ? mvp14.capability.mode : uiText("disabled")} {uiText("/ trusted root required")}{" "}</li>
        <li
          className="ua-utility-placeholder__item"
          data-mvp15d-observation="editor-process"
          data-mvp15d-value={latestProcess ? `${latestProcess.displayName} / ${latestProcess.processState}` : "none discovered"}
        >
          {uiText("Process:")}{" "}{latestProcess ? `${latestProcess.displayName} / ${latestProcess.processState}` : uiText("none discovered")}
        </li>
        <li
          className="ua-utility-placeholder__item"
          data-mvp15d-observation="editor-heartbeat"
          data-mvp15d-value={mvp14?.status?.heartbeat
            ? t("editor.heartbeatSummary",{reason:mvp14.status.heartbeat.statusReason,alive:String(mvp14.status.heartbeat.processAlive)})
            : "not recorded"}
        >
          {uiText("Heartbeat:")}{" "}
          {mvp14?.status?.heartbeat
            ? t("editor.heartbeatSummary",{reason:mvp14.status.heartbeat.statusReason,alive:String(mvp14.status.heartbeat.processAlive)})
            : uiText("not recorded")}
        </li>
        <li
          className="ua-utility-placeholder__item"
          data-mvp15d-observation="editor-snapshot"
          data-mvp15d-value={mvp14?.snapshot?.snapshot
            ? `${mvp14.snapshot.snapshot.editorState} / ${mvp14.snapshot.snapshot.displayProject}`
            : "not recorded"}
        >
          {uiText("Snapshot:")}{" "}
          {mvp14?.snapshot?.snapshot
            ? `${mvp14.snapshot.snapshot.editorState} / ${mvp14.snapshot.snapshot.displayProject}`
            : uiText("not recorded")}
        </li>
        <li className="ua-utility-placeholder__item">{mvp14?.safetyBoundaries.map(uiText).join(" / ")}</li>
        <li className="ua-utility-placeholder__item">
          <span className="ua-utility-placeholder__action-row">
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Refresh editor observation capability")}
              title={uiText("Refresh editor observation capability")}
              onClick={() => actions?.refreshMvp14ObservationCapability()}
            >
              {uiText("Refresh observation")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Discover editor processes")}
              title={uiText("Discover editor processes")}
              onClick={() => actions?.discoverMvp14EditorProcesses()}
            >
              {uiText("Discover")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Attach editor observation session")}
              title={uiText("Attach editor observation session")}
              disabled={!latestProcess}
              onClick={() => actions?.attachMvp14EditorProcess()}
            >
              {uiText("Observe")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Read editor observation snapshot")}
              title={uiText("Read editor observation snapshot")}
              disabled={!mvp14?.session || mvp14.session.status === "stopped"}
              onClick={() => {
                actions?.readMvp14EditorStatus();
                actions?.readMvp14EditorSnapshot();
              }}
            >
              {uiText("Snapshot")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Stop editor observation session")}
              title={uiText("Stop editor observation session")}
              disabled={!mvp14?.session || mvp14.session.status === "stopped"}
              onClick={() => actions?.stopMvp14ObservationSession()}
            >
              {uiText("Stop")}{" "}</button>
          </span>
        </li>
        <li className="ua-utility-placeholder__item">
          {uiText("Capability:")}{" "}{mvp13?.editorCapability.enabled ? mvp13.editorCapability.mode : uiText("disabled")} /{" "}
          {mvp13?.editorCapability.mutationExecution ?? uiText("blocked")}
        </li>
        <li className="ua-utility-placeholder__item">
          {uiText("Session:")}{" "}{mvp13?.editorSession ? `${mvp13.editorSession.status} (${mvp13.editorSession.mode})` : uiText("none")}
        </li>
        <li className="ua-utility-placeholder__item">
          {uiText("Queue:")}{" "}{mvp13?.editorProposals.length ?? 0} {uiText("proposals /")}{" "}{mvp13?.editorResults.length ?? 0} {uiText("results")}{" "}</li>
        <li className="ua-utility-placeholder__item">
          <span className="ua-utility-placeholder__action-row">
            <button className="ua-utility-placeholder__button" type="button" aria-label={uiText("Refresh editor capability")} title={uiText("Refresh editor capability")} onClick={() => actions?.refreshMvp13EditorCapability()}>
              {uiText("Refresh")}{" "}</button>
            <button className="ua-utility-placeholder__button" type="button" aria-label={uiText("Attach fixture editor session")} title={uiText("Attach fixture editor session")} onClick={() => actions?.attachMvp13FixtureEditorSession()}>
              {uiText("Attach")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Propose state-only editor operation")}
              title={uiText("Propose state-only editor operation")}
              disabled={!canPropose}
              onClick={() => actions?.proposeMvp13StateOnlyEditorOperation()}
            >
              {uiText("Propose")}{" "}</button>
          </span>
        </li>
        {latestProposal && (
          <li className="ua-utility-placeholder__item">
            {uiText("Proposal:")}{" "}{latestProposal.operationKind} / {latestProposal.status} / {latestProposal.risk}
          </li>
        )}
        {latestProposal && (
          <li className="ua-utility-placeholder__item">
            <span className="ua-utility-placeholder__action-row">
              <button
                className="ua-utility-placeholder__button"
                type="button"
                aria-label={uiText("Approve editor operation")}
                title={uiText("Approve editor operation")}
                disabled={!canApprove}
                onClick={() => actions?.approveMvp13EditorOperation()}
              >
                {uiText("Approve")}{" "}</button>
              <button
                className="ua-utility-placeholder__button"
                type="button"
                aria-label={uiText("Execute editor operation")}
                title={uiText("Execute editor operation")}
                disabled={!canExecute}
                onClick={() => actions?.["executeMvp13EditorOperation"]()}
              >
                {uiText("Execute")}{" "}</button>
              <button
                className="ua-utility-placeholder__button"
                type="button"
                aria-label={uiText("Cancel editor operation")}
                title={uiText("Cancel editor operation")}
                disabled={!canCancel}
                onClick={() => actions?.cancelMvp13EditorOperation()}
              >
                {uiText("Cancel")}{" "}</button>
            </span>
          </li>
        )}
        {latestResult && (
          <li className="ua-utility-placeholder__item">
            {uiText("Result:")}{" "}{latestResult.status} / {latestResult.replayOnly ? uiText("replay-only") : uiText("recorded")}
          </li>
        )}
        {latestResult?.evidenceId && (
          <li className="ua-utility-placeholder__item">
            {uiText("Evidence:")}{" "}{latestResult.evidenceId}
          </li>
        )}
      </ul>
    </section>
  );
}
