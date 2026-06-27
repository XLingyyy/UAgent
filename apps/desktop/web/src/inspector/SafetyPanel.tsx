import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function SafetyPanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const runtimeActions = useOptionalRuntimeActions();
  const activeTaskId = runtime?.activeTaskId ?? null;
  const events = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const approvalRequired = events.filter((e) => e.type === "approval_required");
  const approvalApproved = events.filter((e) => e.type === "approval_approved");
  const approvalDenied = events.filter((e) => e.type === "approval_denied");
  const approvalCancelled = events.filter((e) => e.type === "approval_cancelled");
  const approvalTimedOut = events.filter((e) => e.type === "approval_timed_out");
  const sandboxEvents = events.filter((e) => e.type.startsWith("sandbox_"));
  const pendingApproval = approvalRequired.length > 0 &&
    approvalApproved.length === 0 && approvalDenied.length === 0 &&
    approvalCancelled.length === 0 && approvalTimedOut.length === 0;
  const lastSandbox = sandboxEvents[sandboxEvents.length - 1];
  const latestApprovalReq = approvalRequired[approvalRequired.length - 1];
  const payload = latestApprovalReq?.payload as Record<string, unknown> | undefined;
  const riskLevel = payload?.riskLevel as string | undefined;
  const stepId = payload?.stepId as string | null | undefined;

  return (
    <section className="ua-utility-placeholder" aria-label="Safety panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">Runtime-derived</span>
          <h3 className="ua-utility-placeholder__title">Safety</h3>
        </div>
        <span className="ua-utility-placeholder__state">
          {pendingApproval ? "approval_required" : runtime?.activeTaskId ? "no_pending_approval" : "idle"}
        </span>
      </div>

      <ul className="ua-utility-placeholder__list">
        {!activeTaskId && (
          <li className="ua-utility-placeholder__item">No active task. Submit a task to see safety state.</li>
        )}

        {activeTaskId && approvalRequired.length === 0 && (
          <li className="ua-utility-placeholder__item">No approval events for the active task.</li>
        )}

        {activeTaskId && approvalRequired.length > 0 && (
          <>
            <li className="ua-utility-placeholder__item">
              Approval requests: {approvalRequired.length}
            </li>
            <li className="ua-utility-placeholder__item">
              Approved: {approvalApproved.length}
            </li>
            <li className="ua-utility-placeholder__item">
              Denied: {approvalDenied.length}
            </li>
            <li className="ua-utility-placeholder__item">
              Cancelled: {approvalCancelled.length}
            </li>
            <li className="ua-utility-placeholder__item">
              Timed out: {approvalTimedOut.length}
            </li>
            {riskLevel && (
              <li className="ua-utility-placeholder__item">
                Risk level: {riskLevel}
              </li>
            )}
            {latestApprovalReq && (
              <li className="ua-utility-placeholder__item">
                Last request: {latestApprovalReq.body}
              </li>
            )}
          </>
        )}

        {lastSandbox && (
          <li className="ua-utility-placeholder__item">
            Latest sandbox: {lastSandbox.type.replace("sandbox_", "")}
          </li>
        )}
      </ul>

      {pendingApproval && runtimeActions && (
        <div className="ua-utility-placeholder__actions">
          <button
            className="ua-utility-placeholder__action ua-utility-placeholder__action--primary"
            type="button"
            onClick={() => {
              void runtimeActions.submitApprovalDecision(
                activeTaskId!, stepId ?? null, "approved", "user", "Approved via Safety panel",
              );
            }}
          >
            Approve
          </button>
          <button
            className="ua-utility-placeholder__action ua-utility-placeholder__action--danger"
            type="button"
            onClick={() => {
              void runtimeActions.submitApprovalDecision(
                activeTaskId!, stepId ?? null, "denied", "user", "Denied via Safety panel",
              );
            }}
          >
            Deny
          </button>
          <button
            className="ua-utility-placeholder__action"
            type="button"
            onClick={() => {
              void runtimeActions.submitApprovalDecision(
                activeTaskId!, stepId ?? null, "cancelled", "user", "Cancelled via Safety panel",
              );
            }}
          >
            Cancel task
          </button>
        </div>
      )}
    </section>
  );
}
