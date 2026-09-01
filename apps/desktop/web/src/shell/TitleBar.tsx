import { useEffect, useState } from "react";
import { useLayoutActions, useLayoutStore, useProjectStore, useRuntimeStore } from "../stores/ui-store";
import "./TitleBar.css";

export interface TitleBarProps {
  /** Application title shown in the left area. */
  title?: string;
}

type TauriWindowInternals = {
  invoke: (
    command: string,
    args?: Record<string, unknown> | undefined,
  ) => Promise<unknown>;
};

const MAIN_WINDOW_LABEL = "main";

/**
 * Resolve the Tauri window IPC invoker exposed on `window.__TAURI_INTERNALS__`.
 *
 * In the real Tauri desktop shell this object is injected by the runtime and
 * `@tauri-apps/api/window` calls `invoke('plugin:window|<cmd>', { label })`
 * through it. Inspecting it directly avoids pulling `@tauri-apps/api` into the
 * web bundle (the project has no such dependency today) while still driving
 * the real window controls. In the browser dev preview and Vitest it is
 * absent, so callers degrade to no-ops instead of throwing.
 */
function getTauriWindowInternals(): TauriWindowInternals | null {
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : undefined;
  const internals = w?.__TAURI_INTERNALS__;
  if (!internals || typeof (internals as TauriWindowInternals).invoke !== "function") {
    return null;
  }
  return internals as TauriWindowInternals;
}

async function invokeWindow(internals: TauriWindowInternals, command: string): Promise<void> {
  try {
    await internals.invoke(`plugin:window|${command}`, { label: MAIN_WINDOW_LABEL });
  } catch {
    // Swallow IPC errors (browser dev preview, hostile test mocks, or a real
    // shell error) so a click never surfaces an unhandled rejection. The window
    // control simply becomes a no-op in that case.
  }
}

/** Minimize the main window. No-op outside the Tauri shell. */
async function minimizeWindow(): Promise<void> {
  const internals = getTauriWindowInternals();
  if (!internals) return;
  await invokeWindow(internals, "minimize");
}

/** Close the main window. No-op outside the Tauri shell. */
async function closeWindow(): Promise<void> {
  const internals = getTauriWindowInternals();
  if (!internals) return;
  await invokeWindow(internals, "close");
}

/** Query whether the main window is maximized. Returns false outside the shell. */
async function isWindowMaximized(): Promise<boolean> {
  const internals = getTauriWindowInternals();
  if (!internals) return false;
  try {
    const result = await internals.invoke("plugin:window|is_maximized", { label: MAIN_WINDOW_LABEL });
    return Boolean(result);
  } catch {
    return false;
  }
}

/** Toggle maximize/restore based on the current window state. No-op outside. */
async function toggleMaximizeWindow(): Promise<void> {
  const internals = getTauriWindowInternals();
  if (!internals) return;
  const maximized = await isWindowMaximized();
  await invokeWindow(internals, maximized ? "unmaximize" : "maximize");
}

/**
 * Top-level window title bar.
 *
 * In the Tauri build this region hosts the custom window controls
 * (drag region + minimize/maximize/close). In the browser dev preview
 * it renders a static bar so the layout is visible.
 */
export function TitleBar({ title = "UAgent" }: TitleBarProps) {
  const inspectorOpen = useLayoutStore((state) => state.inspector.open);
  const mcpStatus = useRuntimeStore((state) => state.mcp.status);
  const editorStatus = useRuntimeStore((state) => state.mvp14.session?.status ?? state.mvp14.capability.reason);
  const editorCapabilityEnabled = useRuntimeStore((state) => Boolean(state.mvp14?.capability.enabled));
  const nativeSource = useProjectStore((state) => state.nativeSource);
  const { toggleInspector } = useLayoutActions();
  const toolsLabel = inspectorOpen ? "Close utility drawer" : "Open utility drawer";

  // Collapse the editor observation status into a short, readable label for the
  // titlebar pill. The underlying status/reason strings (e.g.
  // "native_adapter_unavailable") are verbose; we surface the full value via
  // the pill `title` instead of letting the visible text truncate to "UE: n...".
  const ueShortLabel = (() => {
    if (editorStatus === "attached" || editorStatus === "ready") return "attached";
    if (editorStatus === "degraded") return "degraded";
    if (editorStatus === "stopped") return "stopped";
    if (editorCapabilityEnabled) return "enabled";
    return "disabled";
  })();

  // Track maximized state so the restore/maximize button label swaps. In the
  // browser/Vitest preview this stays false (no IPC), so the button reads as
  // "Maximize window". Re-checked after a maximize/restore click so the label
  // reflects the new state in the real desktop shell.
  const [isMaximized, setIsMaximized] = useState(false);
  useEffect(() => {
    let active = true;
    void isWindowMaximized().then((value) => {
      if (active) setIsMaximized(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const maximizeAriaLabel = isMaximized ? "Restore window" : "Maximize window";

  const handleMinimize = () => {
    void minimizeWindow();
  };

  const handleToggleMaximize = () => {
    void toggleMaximizeWindow().then(() => {
      void isWindowMaximized().then((value) => setIsMaximized(value));
    });
  };

  const handleClose = () => {
    void closeWindow();
  };

  return (
    <header className="ua-titlebar" data-tauri-drag-region="">
      <div className="ua-titlebar__left" data-tauri-drag-region>
        <span className="ua-titlebar__brand" data-tauri-drag-region>
          {title}
        </span>
        <span className="ua-titlebar__crumb" data-tauri-drag-region>
          Project Workspace Shell
        </span>
      </div>
      <div className="ua-titlebar__center" data-tauri-drag-region>
        <span className="ua-titlebar__drag-hint">Local-first agent workspace</span>
      </div>
      <div className="ua-titlebar__right">
        <div className="ua-titlebar__status" aria-label="Connection summary">
          <span className="ua-titlebar__status-pill ua-titlebar__status-pill--key" title="Mock runtime / no live provider call">
            Mock
          </span>
          <span
            className="ua-titlebar__status-pill ua-titlebar__status-pill--key"
            title={`MCP ${mcpStatus}: read-only tools only; tile-mutating MCP calls are blocked.`}
          >
            MCP: RO
          </span>
          <span
            className="ua-titlebar__status-pill ua-titlebar__status-pill--p4"
            title="Provider: fixture (no live provider network by default)."
          >
            Provider: off
          </span>
          <span
            className="ua-titlebar__status-pill ua-titlebar__status-pill--p4"
            title="No network access by default."
          >
            No net
          </span>
          <span
            className={`ua-titlebar__status-pill ua-titlebar__status-pill--p3`}
            title={nativeSource === "native" ? "Native filesystem bridge: read-only" : nativeSource === "fixture" ? "Native filesystem bridge: fixture fallback" : "Native filesystem bridge: offline"}
          >
            {nativeSource === "native" ? "Native FS RO" : nativeSource === "fixture" ? "Native FS fix" : "Native FS off"}
          </span>
          <span
            className="ua-titlebar__status-pill ua-titlebar__status-pill--p2"
            title={`UE Editor: ${editorStatus}`}
          >
            UE: {ueShortLabel}
          </span>
        </div>
        <div className="ua-titlebar__controls">
          <button
            className="ua-titlebar__btn"
            onClick={toggleInspector}
            aria-label={toolsLabel}
            aria-pressed={inspectorOpen}
            type="button"
          >
            <span aria-hidden>Tools</span>
          </button>
          <span className="ua-titlebar__badge">MVP15 Complete</span>
          <span className="ua-titlebar__badge ua-titlebar__badge--subtle">Native FS OK</span>
        </div>
        <div
          className="ua-titlebar__window-controls"
          aria-label="Window controls"
        >
          <button
            className="ua-titlebar__window-btn"
            type="button"
            aria-label="Minimize window"
            onClick={handleMinimize}
          >
            <span className="ua-titlebar__win-icon ua-titlebar__win-icon--minimize" aria-hidden="true" />
          </button>
          <button
            className="ua-titlebar__window-btn"
            type="button"
            aria-label={maximizeAriaLabel}
            onClick={handleToggleMaximize}
          >
            <span
              className={`ua-titlebar__win-icon ${
                isMaximized ? "ua-titlebar__win-icon--restore" : "ua-titlebar__win-icon--maximize"
              }`}
              aria-hidden="true"
            />
          </button>
          <button
            className="ua-titlebar__window-btn ua-titlebar__window-btn--close"
            type="button"
            aria-label="Close window"
            onClick={handleClose}
          >
            <span className="ua-titlebar__win-icon ua-titlebar__win-icon--close" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
