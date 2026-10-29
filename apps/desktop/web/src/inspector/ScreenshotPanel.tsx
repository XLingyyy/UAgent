import {useI18n} from "../i18n";
import { useCallback } from "react";
import { useRuntimeStore, useRuntimeActions } from "../stores/ui-store";

export function ScreenshotPanel() {
  const {text: uiText} = useI18n();
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
      aria-label={uiText("Screenshot capture")}
    >
      <div className="ua-inspector-screenshot__header">
        <span>{uiText("Screenshot Capture")}</span>
        <span className="ua-inspector__badge">{uiText("MVP9")}</span>
      </div>

      {stage === "idle" && (
        <>
          <div className="ua-inspector-screenshot__info">
            <p>
              {uiText("Screenshot capture requires explicit user approval. No background capture is performed. All captured screenshots are redacted.")}{" "}</p>
          </div>
          <div className="ua-inspector-screenshot__status">
            <span className="ua-inspector-screenshot__status-value">
              {uiText("No active capture")}{" "}</span>
          </div>
          <button
            className="ua-btn ua-btn--primary"
            type="button"
            onClick={handleRequest}
            aria-label={uiText("Request screenshot capture")}
          >
            {uiText("Request Screenshot")}{" "}</button>
        </>
      )}

      {stage === "pending" && request && (
        <>
          <div className="ua-inspector-screenshot__info">
            <p>{uiText("Capture requires approval")}</p>
          </div>
          <div className="ua-inspector-screenshot__request">
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("Scope:")}</span>
              <span>{request.scope}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("Reason:")}</span>
              <span>{request.reason}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("Permission:")}</span>
              <span>{request.permissionPrompt}</span>
            </div>
          </div>
          <div className="ua-inspector-screenshot__actions">
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleApprove}
              aria-label={uiText("Approve screenshot capture")}
            >
              {uiText("Approve")}{" "}</button>
            <button
              className="ua-btn ua-btn--danger"
              type="button"
              onClick={handleDeny}
              aria-label={uiText("Deny screenshot capture")}
            >
              {uiText("Deny")}{" "}</button>
          </div>
        </>
      )}

      {stage === "completed" && result && (
        <>
          <div className="ua-inspector-screenshot__info">
            <p>{uiText("Capture completed")}</p>
          </div>
          <div className="ua-inspector-screenshot__result">
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("Dimensions:")}</span>
              <span>
                {result.metadata.width}{uiText("x")}{result.metadata.height}
              </span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("MIME type:")}</span>
              <span>{result.metadata.mimeType}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("Size:")}</span>
              <span>{result.metadata.byteSize} {uiText("bytes")}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("Redacted:")}</span>
              <span>{result.metadata.redacted ? uiText("yes") : uiText("no")}</span>
            </div>
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("Artifact:")}</span>
              <span>{result.artifactId ?? uiText("none")}</span>
            </div>
          </div>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleNewCapture}
            aria-label={uiText("New screenshot capture")}
          >
            {uiText("New Capture")}{" "}</button>
        </>
      )}

      {stage === "denied" && result && (
        <>
          <div className="ua-inspector-screenshot__info">
            <p>{uiText("Capture denied")}</p>
          </div>
          <div className="ua-inspector-screenshot__result">
            <div className="ua-inspector-screenshot__field">
              <span>{uiText("Reason:")}</span>
              <span>{result.blockedReason}</span>
            </div>
          </div>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleNewCapture}
            aria-label={uiText("New screenshot capture")}
          >
            {uiText("New Capture")}{" "}</button>
        </>
      )}
    </div>
  );
}
