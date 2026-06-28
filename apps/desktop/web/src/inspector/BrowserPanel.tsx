import { useState, useCallback } from "react";
import { useRuntimeStore, useRuntimeActions } from "../stores/ui-store";

export function BrowserPanel() {
  const browserState = useRuntimeStore((s) => s.mvp9.browser);
  const { requestBrowserPreview, launchBrowserPreview, resetBrowser } = useRuntimeActions();
  const [urlInput, setUrlInput] = useState("");

  const { stage, session, artifact, blockedReason } = browserState;

  const handlePreview = useCallback(() => {
    const url = urlInput.trim();
    if (!url) return;
    requestBrowserPreview(url, null);
  }, [urlInput, requestBrowserPreview]);

  const handleLaunchPreview = useCallback(() => {
    launchBrowserPreview();
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
        <span className="ua-inspector__badge">MVP9</span>
      </div>

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

      <div className="ua-inspector-browser__policy">
        <span className="ua-inspector-browser__policy-label">Policy:</span>
        <span className="ua-inspector-browser__policy-value">
          {stage === "blocked" ? "blocked_external" : "local_only"}
        </span>
      </div>

      {stage === "idle" && (
        <div className="ua-inspector-browser__status">
          <p className="ua-inspector-browser__status-text">
            Enter a local URL to preview. External URLs are blocked by default policy.
          </p>
        </div>
      )}

      {stage === "blocked" && (
        <div className="ua-inspector-browser__status ua-inspector-browser__status--blocked">
          <p className="ua-inspector-browser__status-text">
            URL blocked: {blockedReason}
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

      {stage === "active" && session && (
        <div className="ua-inspector-browser__session">
          <div className="ua-inspector-browser__session-info">
            <div>URL: {session.displayUrl}</div>
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
