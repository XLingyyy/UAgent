import { useCallback } from "react";
import { useRuntimeStore, useRuntimeActions } from "../stores/ui-store";

export function WatcherPanel() {
  const watcherState = useRuntimeStore((s) => s.mvp9.watcher);
  const { startWatcher, generateWatcherChanges, computeWatcherDiff, applyWatcherChanges, rescanWatcher, stopWatcher, resetWatcher } = useRuntimeActions();

  const { stage, session, events, diff, stopReason, overflowed } = watcherState;

  const handleStart = useCallback(() => {
    startWatcher("project-id", "[project-root]");
  }, [startWatcher]);

  const handleGenerateChanges = useCallback(() => {
    generateWatcherChanges(3);
  }, [generateWatcherChanges]);

  const handleComputeDiff = useCallback(() => {
    computeWatcherDiff();
  }, [computeWatcherDiff]);

  const handleApplyChanges = useCallback(() => {
    applyWatcherChanges();
  }, [applyWatcherChanges]);

  const handleRescan = useCallback(() => {
    rescanWatcher();
  }, [rescanWatcher]);

  const handleStop = useCallback(() => {
    stopWatcher();
  }, [stopWatcher]);

  const handleReset = useCallback(() => {
    resetWatcher();
  }, [resetWatcher]);

  return (
    <div
      className="ua-inspector-watcher"
      role="region"
      aria-label="File watcher"
    >
      <div className="ua-inspector-watcher__header">
        <span>File Watcher</span>
        <span className="ua-inspector__badge">MVP9</span>
      </div>

      {stage === "idle" && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">Idle</span>
          </div>
          <div className="ua-inspector-watcher__info">
            <p>
              File watcher monitors the project root for changes. It produces
              dirty state and a diff summary. No automatic rescan or side
              effects.
            </p>
          </div>
          <div className="ua-inspector-watcher__actions">
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleStart}
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
              Root: {session.displayRoot}
            </span>
          </div>

          {overflowed && (
            <div className="ua-inspector-watcher__overflow">
              <span className="ua-inspector-watcher__overflow-warning">
                Overflow warning: too many change events
              </span>
            </div>
          )}

          {events.length > 0 && (
            <div className="ua-inspector-watcher__events">
              <div className="ua-inspector-watcher__events-header">
                Change Events ({events.length})
              </div>
              <ul className="ua-inspector-watcher__events-list">
                {events.map((ev) => (
                  <li key={ev.id} className="ua-inspector-watcher__event">
                    <span className="ua-inspector-watcher__event-kind">
                      {ev.kind}
                    </span>
                    <span className="ua-inspector-watcher__event-path">
                      {ev.displayPath}
                    </span>
                  </li>
                ))}
              </ul>
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
                      {entry.kind}: {entry.displayPath}
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
              onClick={handleGenerateChanges}
              aria-label="Generate change events"
            >
              Generate Changes
            </button>
            <button
              className="ua-btn ua-btn--secondary"
              type="button"
              onClick={handleComputeDiff}
              aria-label="Compute diff"
              disabled={events.length === 0}
            >
              Compute Diff
            </button>
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleApplyChanges}
              aria-label="Apply changes"
              disabled={!diff}
            >
              Apply Changes
            </button>
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleRescan}
              aria-label="Rescan"
            >
              Rescan
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
