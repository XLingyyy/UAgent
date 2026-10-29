import {useI18n} from "../i18n";
import { useState, useCallback } from "react";
import { useProjectStore, useRuntimeStore, useRuntimeActions } from "../stores/ui-store";

function redactUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      const parts = parsed.pathname.split(/[/\\]/).filter(Boolean);
      const filename = parts.pop() ?? parsed.pathname;
      return `[local file] ${filename}`;
    }
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    if (url.startsWith("file://")) {
      const parts = url.replace("file://", "").split(/[/\\]/).filter(Boolean);
      return `[local file] ${parts.pop() ?? url}`;
    }
    return url.length > 50 ? url.slice(0, 50) + "..." : url;
  }
}

export function BrowserPanel() {
  const {text: uiText} = useI18n();
  const browserState = useRuntimeStore((s) => s.mvp9.browser);
  const activeProject = useProjectStore((s) =>
    s.registeredProjects.find((project) => project.id === s.activeProjectId) ?? null,
  );
  const { requestBrowserPreview, launchBrowserPreview, resetBrowser } = useRuntimeActions();
  const [urlInput, setUrlInput] = useState("");

  const { stage, request, session, artifact, blockedReason, capability, lastError } = browserState;
  const enabled = capability.enabled;
  const requestedDisplay = request?.displayTarget ?? session?.displayTarget ?? null;
  const classification = request?.policy ?? session?.policy ?? null;

  const handlePreview = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    await requestBrowserPreview(url, null, activeProject?.rootRef ?? null);
  }, [activeProject?.rootRef, urlInput, requestBrowserPreview]);

  const handleLaunchPreview = useCallback(async () => {
    await launchBrowserPreview();
  }, [launchBrowserPreview]);

  const handleReset = useCallback(() => {
    setUrlInput("");
    resetBrowser();
  }, [resetBrowser]);

  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setUrlInput(e.target.value);
    },
    [],
  );

  return (
    <div className="ua-inspector-browser" role="region" aria-label={uiText("Browser preview")}>
      <div className="ua-inspector-browser__header">
        <span>{uiText("Browser Preview")}</span>
        <span className="ua-inspector__badge">{uiText("MVP10")}</span>
      </div>

      <div className="ua-inspector-browser__capability">
        <span className="ua-inspector-browser__capability-label">{uiText("Capability:")}</span>
        <span className={`ua-inspector-browser__capability-value ${enabled ? "ua-text--enabled" : "ua-text--disabled"}`}>
          {enabled ? uiText("Enabled") : uiText("Disabled")}
        </span>
        {!enabled && capability.reason && (
          <span className="ua-inspector-browser__capability-reason">({capability.reason})</span>
        )}
      </div>

      {enabled && (
        <div className="ua-inspector-browser__policy">
          <span className="ua-inspector-browser__policy-label">{uiText("Policy:")}</span>
          <span className="ua-inspector-browser__policy-value">
            {uiText("localhost/127.0.0.1/trusted output file allowed, external blocked")}{" "}</span>
        </div>
      )}

      <div className="ua-inspector-browser__capability">
        <span className="ua-inspector-browser__capability-label">{uiText("Requested:")}</span>
        <span className="ua-inspector-browser__capability-value">
          {requestedDisplay ?? uiText("None")}
        </span>
      </div>

      <div className="ua-inspector-browser__capability">
        <span className="ua-inspector-browser__capability-label">{uiText("Classification:")}</span>
        <span className="ua-inspector-browser__capability-value">
          {classification ?? uiText("not_requested")}
        </span>
      </div>

      <div className="ua-inspector-browser__capability">
        <span className="ua-inspector-browser__capability-label">{uiText("Preview status:")}</span>
        <span className="ua-inspector-browser__capability-value">
          {stage}
        </span>
      </div>

      {blockedReason && (
        <div className="ua-inspector-browser__capability">
          <span className="ua-inspector-browser__capability-label">{uiText("Blocked reason:")}</span>
          <span className="ua-inspector-browser__capability-value">
            {blockedReason}
          </span>
        </div>
      )}

      {lastError && (
        <div className="ua-inspector-browser__capability">
          <span className="ua-inspector-browser__capability-label">{uiText("Last error:")}</span>
          <span className="ua-inspector-browser__capability-value">
            {lastError}
          </span>
        </div>
      )}

      <div className="ua-inspector-browser__url-bar">
        <input
          type="text"
          className="ua-inspector-browser__url-input"
          placeholder={uiText("Enter URL (local only by default)")}
          value={urlInput}
          onChange={handleUrlChange}
          aria-label={uiText("URL input")}
        />
        <button
          className="ua-btn ua-btn--primary"
          type="button"
          onClick={handlePreview}
          aria-label={uiText("Preview URL")}
        >
          {uiText("Preview")}{" "}</button>
      </div>

      {stage === "idle" && (
        <div className="ua-inspector-browser__status">
          <p className="ua-inspector-browser__status-text">
            {enabled
              ? uiText("Enter a localhost URL or file path to preview. External URLs are blocked.")
              : uiText("Real browser preview is disabled. Enable with UAGENT_ENABLE_REAL_BROWSER=1")}
          </p>
        </div>
      )}

      {stage === "blocked" && (
        <div className="ua-inspector-browser__status ua-inspector-browser__status--blocked">
          <p className="ua-inspector-browser__status-text">
            {uiText("Target blocked:")}{" "}{requestedDisplay ?? uiText("[blocked target]")} - {blockedReason}
          </p>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label={uiText("Clear blocked URL")}
          >
            {uiText("Clear")}{" "}</button>
        </div>
      )}

      {stage === "failed" && (
        <div className="ua-inspector-browser__status ua-inspector-browser__status--blocked">
          <p className="ua-inspector-browser__status-text">
            {uiText("Preview failed:")}{" "}{lastError}
          </p>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label={uiText("Clear error")}
          >
            {uiText("Clear")}{" "}</button>
        </div>
      )}

      {stage === "active" && session && (
        <div className="ua-inspector-browser__session">
          <div className="ua-inspector-browser__session-info">
            <div>{uiText("URL:")}{" "}{session.displayUrl || redactUrlForDisplay(session.url)}</div>
            <div>{uiText("Status:")}{" "}{session.status}</div>
          </div>
          <button
            className="ua-btn ua-btn--primary"
            type="button"
            onClick={handleLaunchPreview}
            aria-label={uiText("Launch Preview")}
          >
            {uiText("Launch Preview")}{" "}</button>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label={uiText("Cancel browser preview")}
          >
            {uiText("Cancel")}{" "}</button>
        </div>
      )}

      {stage === "completed" && artifact && (
        <div className="ua-inspector-browser__artifact">
          <div className="ua-inspector-browser__artifact-info">
            <div>{uiText("Artifact:")}{" "}{artifact.id}</div>
            <div>{uiText("Kind:")}{" "}{artifact.kind}</div>
            <div>{uiText("MIME:")}{" "}{artifact.mimeType}</div>
            <div>{uiText("Size:")}{" "}{artifact.byteSize} {uiText("bytes")}</div>
            <div>{uiText("Redacted:")}{" "}{artifact.redacted ? uiText("yes") : uiText("no")}</div>
            <div>{uiText("Label:")}{" "}{artifact.displayLabel}</div>
          </div>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label={uiText("New browser preview")}
          >
            {uiText("New Preview")}{" "}</button>
        </div>
      )}
    </div>
  );
}
