import {useI18n} from "../i18n";
import { useCallback, useEffect } from "react";
import { useRuntimeStore, useRuntimeActions, useProjectStore } from "../stores/ui-store";

export function WatcherPanel() {
  const {text: uiText} = useI18n();
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
      aria-label={uiText("File watcher")}
    >
      <div className="ua-inspector-watcher__header">
        <span>{uiText("File Watcher")}</span>
        <span className="ua-inspector__badge">{uiText("MVP10")}</span>
      </div>

      {stage === "idle" && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">{uiText("Idle")}</span>
          </div>
          <div className="ua-inspector-watcher__info">
            {watcherDisabled ? (
              <>
                <p>{uiText("Real watcher disabled:")}{" "}{capability?.reason ?? uiText("feature_disabled")}</p>
                <p>
                  {uiText("Trusted root required. Debounce")}{" "}{capability?.debounceMs ?? 500}{uiText("ms, queue limit")}{" "}{capability?.maxQueueSize ?? 10000}{uiText(", overflow")}{" "}{capability?.overflowAction ?? uiText("warn")}{uiText(", read diff only.")}{" "}</p>
              </>
            ) : (
              <p>
                {uiText("File watcher monitors the project root for changes. It produces dirty state and a diff summary. No automatic rescan or side effects.")}{" "}</p>
            )}
            {activeProject && (
              <p className="ua-inspector-watcher__root">
                {uiText("Project root:")}{" "}{activeProject.displayRoot}
              </p>
            )}
          </div>
          <div className="ua-inspector-watcher__actions">
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleStart}
              disabled={watcherDisabled}
              aria-label={uiText("Start watching project root")}
            >
              {uiText("Start Watching")}{" "}</button>
          </div>
        </>
      )}

      {stage === "blocked" && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">{uiText("Blocked")}</span>
          </div>
          <div className="ua-inspector-watcher__info">
            <p>{uiText("Cannot start watcher:")}{" "}{stopReason}</p>
          </div>
          <div className="ua-inspector-watcher__actions">
            <button
              className="ua-btn ua-btn--secondary"
              type="button"
              onClick={handleReset}
              aria-label={uiText("Reset watcher")}
            >
              {uiText("Reset")}{" "}</button>
          </div>
        </>
      )}

      {stage === "active" && session && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">{uiText("Active")}</span>
            <span className="ua-inspector-watcher__status-detail">
              {uiText("Root:")}{" "}{displayRoot}
            </span>
          </div>

          {overflowed && (
            <div className="ua-inspector-watcher__overflow">
              <span className="ua-inspector-watcher__overflow-warning">
                {uiText("Overflow warning: too many change events")}{" "}</span>
            </div>
          )}

          <div className="ua-inspector-watcher__dirty-state">
            <span className="ua-inspector-watcher__dirty-label">
              {dirty ? uiText("Dirty") : uiText("Not dirty")}
            </span>
            <span className="ua-inspector-watcher__status-detail">
              {uiText("Queued changes:")}{" "}{queuedCount}
            </span>
          </div>

          {lastError && (
            <div className="ua-inspector-watcher__info">
              <p>{uiText("Watcher error:")}{" "}{lastError}</p>
            </div>
          )}

          {diff && (
            <div className="ua-inspector-watcher__diff">
              <div className="ua-inspector-watcher__diff-header">
                {uiText("Diff Summary")}{" "}</div>
              <ul className="ua-inspector-watcher__diff-list">
                <li>{uiText("Added:")}{" "}{diff.summary.added}</li>
                <li>{uiText("Modified:")}{" "}{diff.summary.modified}</li>
                <li>{uiText("Deleted:")}{" "}{diff.summary.deleted}</li>
                <li>{uiText("Ignored:")}{" "}{diff.summary.ignored}</li>
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
              aria-label={uiText("Read diff")}
            >
              {uiText("Read Diff")}{" "}</button>
            <button
              className="ua-btn ua-btn--danger"
              type="button"
              onClick={handleStop}
              aria-label={uiText("Stop watching project root")}
            >
              {uiText("Stop Watching")}{" "}</button>
          </div>
        </>
      )}

      {stage === "stopped" && (
        <>
          <div className="ua-inspector-watcher__status">
            <span className="ua-inspector-watcher__status-value">{uiText("Stopped")}</span>
          </div>
          <div className="ua-inspector-watcher__info">
            <p>{uiText("Watcher stopped. Reason:")}{" "}{stopReason ?? uiText("unknown")}</p>
          </div>
          <div className="ua-inspector-watcher__actions">
            <button
              className="ua-btn ua-btn--primary"
              type="button"
              onClick={handleReset}
              aria-label={uiText("Start watching project root")}
            >
              {uiText("Start Watching")}{" "}</button>
          </div>
        </>
      )}
    </div>
  );
}
