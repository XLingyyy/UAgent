import {useI18n} from "../i18n";
import { FIXTURES_ENABLED } from "../runtime/build-capabilities";
import { useEffect, useState, useRef, useCallback } from "react";
import { useLayoutActions, useLayoutStore, useSettingsStore, useProjectStore, useRuntimeStore } from "../stores/ui-store";
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
async function isWindowMaximized(): Promise<boolean | null> {
  const internals = getTauriWindowInternals();
  if (!internals) return null;
  try {
    const result = await internals.invoke("plugin:window|is_maximized", { label: MAIN_WINDOW_LABEL });
    return typeof result === "boolean" ? result : null;
  } catch {
    return null;
  }
}

/** Toggle maximize/restore based on the current window state. No-op outside. */
async function toggleMaximizeWindow(): Promise<void> {
  const internals = getTauriWindowInternals();
  if (!internals) return;
  const maximized = await isWindowMaximized();
  if (maximized === null) return;
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
  const {text: uiText,t} = useI18n();
  const settingsOpen = useSettingsStore((state) => state.open);
  const inspectorOpen = useLayoutStore((state) => state.inspector.open);
  const mcpStatus = useRuntimeStore((state) => state.mcp.status);
  const editorStatus = useRuntimeStore((state) => state.mvp14.session?.status ?? state.mvp14.capability.reason);
  const editorCapabilityEnabled = useRuntimeStore((state) => Boolean(state.mvp14?.capability.enabled));
  const nativeSource = useProjectStore((state) => state.nativeSource);
  const { toggleInspector } = useLayoutActions();
  const toolsLabel = t(inspectorOpen ? "nav.closeTools" : "nav.openTools");

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
  // browser/Vitest preview this stays unknown (no IPC), so the button reads as
  // "Window state unavailable". Re-checked after a maximize/restore click so the label
  // reflects the new state in the real desktop shell.
  const [isMaximized, setIsMaximized] = useState<boolean | null>(null);
  const [windowBusy, setWindowBusy] = useState(false);
  const windowGeneration = useRef(0);
  const mounted = useRef(false);
  const busy = useRef(false);
  const refreshWindow = useCallback(async () => {
    const request = ++windowGeneration.current;
    const value = await isWindowMaximized();
    if (mounted.current && request === windowGeneration.current) setIsMaximized(value);
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refreshWindow();
    window.addEventListener("resize", refreshWindow);
    window.addEventListener("focus", refreshWindow);
    return () => {
      mounted.current = false;
      windowGeneration.current++;
      window.removeEventListener("resize", refreshWindow);
      window.removeEventListener("focus", refreshWindow);
    };
  }, [refreshWindow]);
  const maximizeAriaLabel = t(isMaximized === null ? "shell.windowUnavailable" : isMaximized ? "shell.restore" : "shell.maximize");
  const handleMinimize = () => { void minimizeWindow(); };
  const handleToggleMaximize = async () => {
    if (busy.current) return;
    busy.current = true;
    setWindowBusy(true);
    try { await toggleMaximizeWindow(); await refreshWindow(); }
    finally { busy.current = false; if (mounted.current) setWindowBusy(false); }
  };

  const handleClose = () => {
    void closeWindow();
  };

  // Tauri 2.11's deep region covers all non-interactive descendants, including
  // right-side gaps and status text. Buttons explicitly opt out. Leave dragging
  // and double-click maximization to Tauri's injected native window handler.
  return (
    <header className="ua-titlebar" data-tauri-drag-region="deep">
      <div className="ua-titlebar__left">
        <span className="ua-titlebar__brand">
          {title}
        </span>
        <span className="ua-titlebar__crumb">
          {uiText("Unreal workspace")}{" "}</span>
      </div>
      <div className="ua-titlebar__center">
        <span className="ua-titlebar__drag-hint"></span>
      </div>
      <div className="ua-titlebar__right">
        <div className="ua-titlebar__status" aria-label={uiText("Connection summary")}>
          <span className="ua-titlebar__status-pill ua-titlebar__status-pill--key" title={uiText("Deterministic planning; provider analysis does not authorize execution")}>
            {FIXTURES_ENABLED ? uiText("Fixture") : uiText("Local planner")}
          </span>
          <span
            className="ua-titlebar__status-pill ua-titlebar__status-pill--key"
            title={t("shell.mcpPolicyHint",{status:uiText(mcpStatus === "disconnected"?"Not connected":mcpStatus==="connected"?"Connected":mcpStatus)})}
          >
            {uiText("MCP:")}{" "}{uiText(mcpStatus === "disconnected" ? "Not connected" : mcpStatus === "connected" ? "Connected" : mcpStatus)}
          </span>
          <span
            className="ua-titlebar__status-pill ua-titlebar__status-pill--p4"
            title={uiText("No provider connectivity has been verified by this interface.")}
          >
            {uiText("Provider: unverified")}{" "}</span>
          <span
            className="ua-titlebar__status-pill ua-titlebar__status-pill--p4"
            title={uiText("Network access depends on the explicitly connected MCP endpoint.")}
          >
            {uiText("Explicit connections")}{" "}</span>
          <span
            className={`ua-titlebar__status-pill ua-titlebar__status-pill--p3`}
            title={nativeSource === "native" ? uiText("Native filesystem bridge: read-only") : nativeSource === "fixture" ? uiText("Native filesystem bridge: fixture fallback") : uiText("Native filesystem bridge: offline")}
          >
            {nativeSource === "native" ? uiText("Native FS RO") : nativeSource === "fixture" ? uiText("Native FS fix") : uiText("Native FS off")}
          </span>
          <span
            className="ua-titlebar__status-pill ua-titlebar__status-pill--p2"
            title={t("shell.editorStatusLabel",{status:editorStatus})}
          >
            {uiText("UE:")}{" "}{ueShortLabel}
          </span>
        </div>
        <div className="ua-titlebar__controls">
          {!settingsOpen && <button
            data-tauri-drag-region="false"
            className="ua-titlebar__btn"
            onClick={toggleInspector}
            aria-label={toolsLabel}
            aria-pressed={inspectorOpen}
            type="button"
          >
            <span aria-hidden>{uiText("Tools")}</span>
          </button>}


        </div>
        <div
          className="ua-titlebar__window-controls"
          aria-label={uiText("Window controls")}
        >
          <button
            data-tauri-drag-region="false"
            className="ua-titlebar__window-btn"
            type="button"
            aria-label={uiText("Minimize window")}
            disabled={!getTauriWindowInternals()}
            onClick={handleMinimize}
          >
            <span className="ua-titlebar__win-icon ua-titlebar__win-icon--minimize" aria-hidden="true" />
          </button>
          <button
            data-tauri-drag-region="false"
            className="ua-titlebar__window-btn"
            type="button"
            aria-label={maximizeAriaLabel}
            disabled={isMaximized === null || windowBusy}
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
            data-tauri-drag-region="false"
            className="ua-titlebar__window-btn ua-titlebar__window-btn--close"
            type="button"
            aria-label={uiText("Close window")}
            disabled={!getTauriWindowInternals()}
            onClick={handleClose}
          >
            <span className="ua-titlebar__win-icon ua-titlebar__win-icon--close" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
