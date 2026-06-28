import { useCallback } from "react";
import { useRuntimeStore, useRuntimeActions } from "../stores/ui-store";

export function ScreenshotPanel() {
  const screenshotState = useRuntimeStore((s) => s.mvp9.screenshot);
  const { requestScreenshotCapture, approveScreenshot, denyScreenshot, resetScreenshot } = useRuntimeActions();

  const { stage, request, result } = screenshotState;

  const handleRequest = useCallback(() => {
    requestScreenshotCapture("full_page", "User requested screenshot capture", null);
  }, [requestScreenshotCapture]);

  const handleApprove = useCallback(() => {
    approveScreenshot();
  }, [approveScreenshot]);

  const handleDeny = useCallback(() => {
    denyScreenshot("User denied screenshot capture request");
  }, [denyScreenshot]);

  const handleNewCapture = useCallback(() => {
    resetScreenshot();
  }, [resetScreenshot]);

  return (
    <div
      className="ua-inspector-screenshot"
      role="region"
      aria-label="Screenshot capture"
    >
      <div className="ua-inspector-screenshot__header">
        <span>Screenshot Capture</span>
        <span className="ua-inspector__badge">MVP9</span>
      </div>

      {stage === "idle" && (
        <>
          <div className="ua-inspector-screenshot__info">
            <p>
              Screenshot capture requires explicit user approval. No background
              capture is performed. All captured screenshots are redacted.
            </p>
          </div>
          <div className="ua-inspector-screenshot__status">
            <span className="ua-inspector-screenshot__status-value">
              No active capture
            </span>
          </div>
          <button
            className="ua-btn ua-btn--primary"
            type="button"
            onClick={handleRequest}
            aria-label="Request screenshot capture"
          >
            Request Screenshot
          </button>
        </>
      )}

      {stage === "pending" && request && (
        <>
          <div className="ua-inspector-screenshot__info">
            <p>Capture requires approval</p>
          </div>
          <div className="ua-inspector-screenshot__request">
            <div className="ua-inspector-screenshot__field">
              <span>Scope:</span>
              <span>{request.scope}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>Reason:</span>
              <span>{request.reason}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>Permission:</span>
              <span>{request.permissionPrompt}</span>
            </div>
          </div>
          <div className="ua-inspector-screenshot__actions">
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleApprove}
              aria-label="Approve screenshot capture"
            >
              Approve
            </button>
            <button
              className="ua-btn ua-btn--danger"
              type="button"
              onClick={handleDeny}
              aria-label="Deny screenshot capture"
            >
              Deny
            </button>
          </div>
        </>
      )}

      {stage === "completed" && result && (
        <>
          <div className="ua-inspector-screenshot__info">
            <p>Capture completed</p>
          </div>
          <div className="ua-inspector-screenshot__result">
            <div className="ua-inspector-screenshot__field">
              <span>Dimensions:</span>
              <span>
                {result.metadata.width}x{result.metadata.height}
              </span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>MIME type:</span>
              <span>{result.metadata.mimeType}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>Size:</span>
              <span>{result.metadata.byteSize} bytes</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>Redacted:</span>
              <span>{result.metadata.redacted ? "yes" : "no"}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>Artifact:</span>
              <span>{result.artifactId ?? "none"}</span>
            </div>
          </div>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleNewCapture}
            aria-label="New screenshot capture"
          >
            New Capture
          </button>
        </>
      )}

      {stage === "denied" && result && (
        <>
          <div className="ua-inspector-screenshot__info">
            <p>Capture denied</p>
          </div>
          <div className="ua-inspector-screenshot__result">
            <div className="ua-inspector-screenshot__field">
              <span>Reason:</span>
              <span>{result.blockedReason}</span>
            </div>
          </div>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleNewCapture}
            aria-label="New screenshot capture"
          >
            New Capture
          </button>
        </>
      )}
    </div>
  );
}
