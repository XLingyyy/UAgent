import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function EditorPanel() {
  const mvp13 = useOptionalRuntimeStore((state) => state.mvp13);
  const actions = useOptionalRuntimeActions();
  const latestProposal = mvp13?.editorProposals[mvp13.editorProposals.length - 1] ?? null;
  const latestResult = mvp13?.editorResults[mvp13.editorResults.length - 1] ?? null;
  const canPropose = Boolean(mvp13?.editorSession && mvp13.editorCapability.enabled);
  const canApprove = latestProposal?.status === "approval_required" || latestProposal?.status === "proposed";
  const canExecute = latestProposal?.status === "approved";
  const canCancel = canApprove || canExecute;

  return (
    <section className="ua-utility-placeholder" aria-label="Editor panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">MVP13 controlled bridge</span>
          <h3 className="ua-utility-placeholder__title">UE Editor</h3>
        </div>
        <span className="ua-utility-placeholder__state">
          {mvp13?.editorSession?.status ?? mvp13?.editorCapability.reason ?? "disabled"}
        </span>
      </div>
      <ul className="ua-utility-placeholder__list">
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
          <button className="ua-utility-placeholder__button" type="button" aria-label="Refresh editor capability" onClick={() => actions?.refreshMvp13EditorCapability()}>
            Refresh
          </button>{" "}
          <button className="ua-utility-placeholder__button" type="button" aria-label="Attach fixture editor session" onClick={() => actions?.attachMvp13FixtureEditorSession()}>
            Attach
          </button>{" "}
          <button
            className="ua-utility-placeholder__button"
            type="button"
            aria-label="Propose state-only editor operation"
            disabled={!canPropose}
            onClick={() => actions?.proposeMvp13StateOnlyEditorOperation()}
          >
            Propose
          </button>
        </li>
        {latestProposal && (
          <li className="ua-utility-placeholder__item">
            Proposal: {latestProposal.operationKind} / {latestProposal.status} / {latestProposal.risk}
          </li>
        )}
        {latestProposal && (
          <li className="ua-utility-placeholder__item">
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Approve editor operation"
              disabled={!canApprove}
              onClick={() => actions?.approveMvp13EditorOperation()}
            >
              Approve
            </button>{" "}
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Execute editor operation"
              disabled={!canExecute}
              onClick={() => actions?.["executeMvp13EditorOperation"]()}
            >
              Execute
            </button>{" "}
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label="Cancel editor operation"
              disabled={!canCancel}
              onClick={() => actions?.cancelMvp13EditorOperation()}
            >
              Cancel
            </button>
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
