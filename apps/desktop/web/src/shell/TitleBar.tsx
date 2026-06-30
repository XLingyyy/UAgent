import { useLayoutActions, useLayoutStore, useProjectStore, useRuntimeStore } from "../stores/ui-store";
import "./TitleBar.css";

export interface TitleBarProps {
  /** Application title shown in the left area. */
  title?: string;
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
  const nativeSource = useProjectStore((state) => state.nativeSource);
  const { toggleInspector } = useLayoutActions();
  const toolsLabel = inspectorOpen ? "Close utility drawer" : "Open utility drawer";

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
          <span className="ua-titlebar__status-pill">Mock</span>
          <span className="ua-titlebar__status-pill">
            {mcpStatus === "connected" ? "MCP read-only" : "MCP read-only"}
          </span>
          <span className="ua-titlebar__status-pill">Provider fixture</span>
          <span className="ua-titlebar__status-pill">No network</span>
          <span className="ua-titlebar__status-pill">
            {nativeSource === "native" ? "Native FS: read-only" : nativeSource === "fixture" ? "Native FS: fixture" : "Native FS: offline"}
          </span>
          <span className="ua-titlebar__status-pill">UE Editor: {editorStatus}</span>
        </div>
        <button
          className="ua-titlebar__btn"
          onClick={toggleInspector}
          aria-label={toolsLabel}
          aria-pressed={inspectorOpen}
          type="button"
        >
          <span aria-hidden>Tools</span>
        </button>
        <span className="ua-titlebar__badge">MVP14 In Progress</span>
        <span className="ua-titlebar__badge ua-titlebar__badge--subtle">Native FS OK</span>
      </div>
    </header>
  );
}
