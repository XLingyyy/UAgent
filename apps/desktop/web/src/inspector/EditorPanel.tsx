import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function EditorPanel() {
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
    <section className="ua-utility-placeholder" aria-label="Editor panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">MVP14 safe observation</span>
          <h3 className="ua-utility-placeholder__title">UE Editor</h3>
        </div>
        <span className="ua-utility-placeholder__state">
          {mvp14?.session?.status ?? mvp14?.capability.reason ?? mvp13?.editorSession?.status ?? "disabled"}
        </span>
      </div>
      <ul className="ua-utility-placeholder__list">
        <li className="ua-utility-placeholder__item">
          Observation: {mvp14?.capability.enabled ? mvp14.capability.mode : "disabled"} / trusted root required
        </li>
        <li className="ua-utility-placeholder__item">
          Process: {latestProcess ? `${latestProcess.displayName} / ${latestProcess.processState}` : "none discovered"}
        </li>
        <li className="ua-utility-placeholder__item">
          Heartbeat:{" "}
          {mvp14?.status?.heartbeat
            ? `${mvp14.status.heartbeat.statusReason} / alive ${String(mvp14.status.heartbeat.processAlive)}`
            : "not recorded"}
        </li>
        <li className="ua-utility-placeholder__item">
          Snapshot:{" "}
          {mvp14?.snapshot?.snapshot
            ? `${mvp14.snapshot.snapshot.editorState} / ${mvp14.snapshot.snapshot.displayProject}`
            : "not recorded"}
        </li>
        <li className="ua-utility-placeholder__item">{mvp14?.safetyBoundaries.join(" / ")}</li>
        <li className="ua-utility-placeholder__item">
          <span className="ua-utility-placeholder__action-row">
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Refresh editor observation capability"
              title="Refresh editor observation capability"
              onClick={() => actions?.refreshMvp14ObservationCapability()}
            >
              Refresh observation
            </button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Discover editor processes"
              title="Discover editor processes"
              onClick={() => actions?.discoverMvp14EditorProcesses()}
            >
              Discover
            </button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Attach editor observation session"
              title="Attach editor observation session"
              disabled={!latestProcess}
              onClick={() => actions?.attachMvp14EditorProcess()}
            >
              Observe
            </button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Read editor observation snapshot"
              title="Read editor observation snapshot"
              disabled={!mvp14?.session}
              onClick={() => {
                actions?.readMvp14EditorStatus();
                actions?.readMvp14EditorSnapshot();
              }}
            >
              Snapshot
            </button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Stop editor observation session"
              title="Stop editor observation session"
              disabled={!mvp14?.session}
              onClick={() => actions?.stopMvp14ObservationSession()}
            >
              Stop
            </button>
          </span>
        </li>
        <li className="ua-utility-placeholder__item">
          Capability: {mvp13?.editorCapability.enabled ? mvp13.editorCapability.mode : "disabled"} /{" "}
          {mvp13?.editorCapability.mutationExecution ?? "blocked"}
        </li>
        <li className="ua-utility-placeholder__item">
          Session: {mvp13?.editorSession ? `${mvp13.editorSession.status} (${mvp13.editorSession.mode})` : "none"}
        </li>
        <li className="ua-utility-placeholder__item">
          Queue: {mvp13?.editorProposals.length ?? 0} proposals / {mvp13?.editorResults.length ?? 0} results
        </li>
        <li className="ua-utility-placeholder__item">
          <span className="ua-utility-placeholder__action-row">
            <button className="ua-utility-placeholder__button" type="button" aria-label="Refresh editor capability" title="Refresh editor capability" onClick={() => actions?.refreshMvp13EditorCapability()}>
              Refresh
            </button>
            <button className="ua-utility-placeholder__button" type="button" aria-label="Attach fixture editor session" title="Attach fixture editor session" onClick={() => actions?.attachMvp13FixtureEditorSession()}>
              Attach
            </button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Propose state-only editor operation"
              title="Propose state-only editor operation"
              disabled={!canPropose}
              onClick={() => actions?.proposeMvp13StateOnlyEditorOperation()}
            >
              Propose
            </button>
          </span>
        </li>
        {latestProposal && (
          <li className="ua-utility-placeholder__item">
            Proposal: {latestProposal.operationKind} / {latestProposal.status} / {latestProposal.risk}
          </li>
        )}
        {latestProposal && (
          <li className="ua-utility-placeholder__item">
            <span className="ua-utility-placeholder__action-row">
              <button
                className="ua-utility-placeholder__button"
                type="button"
                aria-label="Approve editor operation"
                title="Approve editor operation"
                disabled={!canApprove}
                onClick={() => actions?.approveMvp13EditorOperation()}
              >
                Approve
              </button>
              <button
                className="ua-utility-placeholder__button"
                type="button"
                aria-label="Execute editor operation"
                title="Execute editor operation"
                disabled={!canExecute}
                onClick={() => actions?.["executeMvp13EditorOperation"]()}
              >
                Execute
              </button>
              <button
                className="ua-utility-placeholder__button"
                type="button"
                aria-label="Cancel editor operation"
                title="Cancel editor operation"
                disabled={!canCancel}
                onClick={() => actions?.cancelMvp13EditorOperation()}
              >
                Cancel
              </button>
            </span>
          </li>
        )}
        {latestResult && (
          <li className="ua-utility-placeholder__item">
            Result: {latestResult.status} / {latestResult.replayOnly ? "replay-only" : "recorded"}
          </li>
        )}
        {latestResult?.evidenceId && (
          <li className="ua-utility-placeholder__item">
            Evidence: {latestResult.evidenceId}
          </li>
        )}
      </ul>
    </section>
  );
}
