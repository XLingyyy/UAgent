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
    <div className="ua-inspector-browser" role="region" aria-label="Browser preview">
      <div className="ua-inspector-browser__header">
        <span>Browser Preview</span>
        <span className="ua-inspector__badge">MVP10</span>
      </div>

      <div className="ua-inspector-browser__capability">
        <span className="ua-inspector-browser__capability-label">Capability:</span>
        <span className={`ua-inspector-browser__capability-value ${enabled ? "ua-text--enabled" : "ua-text--disabled"}`}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
        {!enabled && capability.reason && (
          <span className="ua-inspector-browser__capability-reason">({capability.reason})</span>
        )}
      </div>

      {enabled && (
        <div className="ua-inspector-browser__policy">
          <span className="ua-inspector-browser__policy-label">Policy:</span>
          <span className="ua-inspector-browser__policy-value">
            localhost/127.0.0.1/trusted output file allowed, external blocked
          </span>
        </div>
      )}

      <div className="ua-inspector-browser__capability">
        <span className="ua-inspector-browser__capability-label">Requested:</span>
        <span className="ua-inspector-browser__capability-value">
          {requestedDisplay ?? "None"}
        </span>
      </div>

      <div className="ua-inspector-browser__capability">
        <span className="ua-inspector-browser__capability-label">Classification:</span>
        <span className="ua-inspector-browser__capability-value">
          {classification ?? "not_requested"}
        </span>
      </div>

      <div className="ua-inspector-browser__capability">
        <span className="ua-inspector-browser__capability-label">Preview status:</span>
        <span className="ua-inspector-browser__capability-value">
          {stage}
        </span>
      </div>

      {blockedReason && (
        <div className="ua-inspector-browser__capability">
          <span className="ua-inspector-browser__capability-label">Blocked reason:</span>
          <span className="ua-inspector-browser__capability-value">
            {blockedReason}
          </span>
        </div>
      )}

      {lastError && (
        <div className="ua-inspector-browser__capability">
          <span className="ua-inspector-browser__capability-label">Last error:</span>
          <span className="ua-inspector-browser__capability-value">
            {lastError}
          </span>
        </div>
      )}

      <div className="ua-inspector-browser__url-bar">
        <input
          type="text"
          className="ua-inspector-browser__url-input"
          placeholder="Enter URL (local only by default)"
          value={urlInput}
          onChange={handleUrlChange}
          aria-label="URL input"
        />
        <button
          className="ua-btn ua-btn--primary"
          type="button"
          onClick={handlePreview}
          aria-label="Preview URL"
        >
          Preview
        </button>
      </div>

      {stage === "idle" && (
        <div className="ua-inspector-browser__status">
          <p className="ua-inspector-browser__status-text">
            {enabled
              ? "Enter a localhost URL or file path to preview. External URLs are blocked."
              : "Real browser preview is disabled. Enable with UAGENT_ENABLE_REAL_BROWSER=1"}
          </p>
        </div>
      )}

      {stage === "blocked" && (
        <div className="ua-inspector-browser__status ua-inspector-browser__status--blocked">
          <p className="ua-inspector-browser__status-text">
            Target blocked: {requestedDisplay ?? "[blocked target]"} - {blockedReason}
          </p>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label="Clear blocked URL"
          >
            Clear
          </button>
        </div>
      )}

      {stage === "failed" && (
        <div className="ua-inspector-browser__status ua-inspector-browser__status--blocked">
          <p className="ua-inspector-browser__status-text">
            Preview failed: {lastError}
          </p>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label="Clear error"
          >
            Clear
          </button>
        </div>
      )}

      {stage === "active" && session && (
        <div className="ua-inspector-browser__session">
          <div className="ua-inspector-browser__session-info">
            <div>URL: {session.displayUrl || redactUrlForDisplay(session.url)}</div>
            <div>Status: {session.status}</div>
          </div>
          <button
            className="ua-btn ua-btn--primary"
            type="button"
            onClick={handleLaunchPreview}
            aria-label="Launch Preview"
          >
            Launch Preview
          </button>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label="Cancel browser preview"
          >
            Cancel
          </button>
        </div>
      )}

      {stage === "completed" && artifact && (
        <div className="ua-inspector-browser__artifact">
          <div className="ua-inspector-browser__artifact-info">
            <div>Artifact: {artifact.id}</div>
            <div>Kind: {artifact.kind}</div>
            <div>MIME: {artifact.mimeType}</div>
            <div>Size: {artifact.byteSize} bytes</div>
            <div>Redacted: {artifact.redacted ? "yes" : "no"}</div>
            <div>Label: {artifact.displayLabel}</div>
          </div>
          <button
            className="ua-btn ua-btn--secondary"
            type="button"
            onClick={handleReset}
            aria-label="New browser preview"
          >
            New Preview
          </button>
        </div>
      )}
    </div>
  );
}
