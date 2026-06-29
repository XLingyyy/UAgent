import { useCallback, useEffect } from "react";
import { useRuntimeStore, useRuntimeActions, useProjectStore } from "../stores/ui-store";

export function WatcherPanel() {
  const watcherState = useRuntimeStore((s) => s.mvp9.watcher);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const registeredProjects = useProjectStore((s) => s.registeredProjects);
  const { startWatcher, refreshWatcherCapability, refreshWatcherSession, computeWatcherDiff, stopWatcher, resetWatcher } = useRuntimeActions();

  const { stage, session, diff, stopReason, overflowed, capability, lastError } = watcherState;
  const dirty = watcherState.dirty ?? false;
  const queuedCount = watcherState.queuedCount ?? 0;

  const activeProject = registeredProjects.find(
    (p) => p.id === activeProjectId,
  );

  const handleStart = useCallback(() => {
    if (capability?.mode === "disabled") return;
    const pid = activeProject?.id ?? activeProjectId ?? "project-id";
    const ref = activeProject?.rootRef ?? "[project-root]";
    startWatcher(pid, ref);
  }, [startWatcher, activeProject, activeProjectId, capability?.mode]);

  const handleComputeDiff = useCallback(() => {
    computeWatcherDiff();
  }, [computeWatcherDiff]);

  const handleStop = useCallback(() => {
    stopWatcher();
  }, [stopWatcher]);

  const handleReset = useCallback(() => {
    resetWatcher();
  }, [resetWatcher]);

  const displayRoot = session?.displayRoot ?? activeProject?.displayRoot ?? "[project-root]";
  const watcherDisabled = capability?.mode === "disabled";

  useEffect(() => {
    if (!capability || capability.reason === "native_capability_status_pending") {
      void refreshWatcherCapability();
    }
  }, [refreshWatcherCapability, capability]);

  useEffect(() => {
    if (stage !== "active" || !session?.id) return;
    void refreshWatcherSession();
    const id = window.setInterval(() => {
      void refreshWatcherSession();
    }, Math.max(500, capability?.debounceMs ?? 500));
    return () => window.clearInterval(id);
  }, [stage, session?.id, refreshWatcherSession, capability?.debounceMs]);

  return (
    <div
      className="ua-inspector-watcher"
      role="region"
      aria-label="File watcher"
    >
      <div className="ua-inspector-watcher__header">
        <span>File Watcher</span>
        <span className="ua-inspector__badge">MVP10</span>
      </div>

      {stage === "idle" && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">Idle</span>
          </div>
          <div className="ua-inspector-watcher__info">
            {watcherDisabled ? (
              <>
                <p>Real watcher disabled: {capability?.reason ?? "feature_disabled"}</p>
                <p>
                  Trusted root required. Debounce {capability?.debounceMs ?? 500}ms,
                  queue limit {capability?.maxQueueSize ?? 10000}, overflow {capability?.overflowAction ?? "warn"},
                  read diff only.
                </p>
              </>
            ) : (
              <p>
                File watcher monitors the project root for changes. It produces
                dirty state and a diff summary. No automatic rescan or side
                effects.
              </p>
            )}
            {activeProject && (
              <p className="ua-inspector-watcher__root">
                Project root: {activeProject.displayRoot}
              </p>
            )}
          </div>
          <div className="ua-inspector-watcher__actions">
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleStart}
              disabled={watcherDisabled}
              aria-label="Start watching project root"
            >
              Start Watching
            </button>
          </div>
        </>
      )}

      {stage === "blocked" && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">Blocked</span>
          </div>
          <div className="ua-inspector-watcher__info">
            <p>Cannot start watcher: {stopReason}</p>
          </div>
          <div className="ua-inspector-watcher__actions">
            <button
              className="ua-btn ua-btn--secondary"
              type="button"
              onClick={handleReset}
              aria-label="Reset watcher"
            >
              Reset
            </button>
          </div>
        </>
      )}

      {stage === "active" && session && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">Active</span>
            <span className="ua-inspector-watcher__status-detail">
              Root: {displayRoot}
            </span>
          </div>

          {overflowed && (
            <div className="ua-inspector-watcher__overflow">
              <span className="ua-inspector-watcher__overflow-warning">
                Overflow warning: too many change events
              </span>
            </div>
          )}

          <div className="ua-inspector-watcher__dirty-state">
            <span className="ua-inspector-watcher__dirty-label">
              {dirty ? "Dirty" : "Not dirty"}
            </span>
            <span className="ua-inspector-watcher__status-detail">
              Queued changes: {queuedCount}
            </span>
          </div>

          {lastError && (
            <div className="ua-inspector-watcher__info">
              <p>Watcher error: {lastError}</p>
            </div>
          )}

          {diff && (
            <div className="ua-inspector-watcher__diff">
              <div className="ua-inspector-watcher__diff-header">
                Diff Summary
              </div>
              <ul className="ua-inspector-watcher__diff-list">
                <li>Added: {diff.summary.added}</li>
                <li>Modified: {diff.summary.modified}</li>
                <li>Deleted: {diff.summary.deleted}</li>
                <li>Ignored: {diff.summary.ignored}</li>
              </ul>
              {diff.entries.length > 0 && (
                <ul className="ua-inspector-watcher__diff-entries">
                  {diff.entries.map((entry, idx) => (
                    <li key={idx} className="ua-inspector-watcher__diff-entry">
                      <span className="ua-inspector-watcher__diff-entry-kind">{entry.kind}:</span>
                      <span className="ua-inspector-watcher__diff-entry-path">{entry.displayPath}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="ua-inspector-watcher__actions">
            <button
              className="ua-btn ua-btn--secondary"
              type="button"
              onClick={handleComputeDiff}
              aria-label="Read diff"
            >
              Read Diff
            </button>
            <button
              className="ua-btn ua-btn--danger"
              type="button"
              onClick={handleStop}
              aria-label="Stop watching project root"
            >
              Stop Watching
            </button>
          </div>
        </>
      )}

      {stage === "stopped" && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">Stopped</span>
          </div>
          <div className="ua-inspector-watcher__info">
            <p>Watcher stopped. Reason: {stopReason ?? "unknown"}</p>
          </div>
          <div className="ua-inspector-watcher__actions">
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleReset}
              aria-label="Start watching project root"
            >
              Start Watching
            </button>
          </div>
        </>
      )}
    </div>
  );
}
