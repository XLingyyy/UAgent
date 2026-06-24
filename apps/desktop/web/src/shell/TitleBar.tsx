import { useUI } from "../app/providers";
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
  const { state, toggleInspector } = useUI();

  return (
    <header className="ua-titlebar" data-tauri-drag-region>
      <div className="ua-titlebar__left" data-tauri-drag-region>
        <span className="ua-titlebar__brand" data-tauri-drag-region>
          {title}
        </span>
      </div>
      <div className="ua-titlebar__center" data-tauri-drag-region />
      <div className="ua-titlebar__right">
        <button
          className="ua-titlebar__btn"
          onClick={toggleInspector}
          aria-label={state.inspector.open ? "Close inspector" : "Open inspector"}
          aria-pressed={state.inspector.open}
          type="button"
        >
          <span aria-hidden>Inspect</span>
        </button>
        <span className="ua-titlebar__badge">MVP0</span>
      </div>
    </header>
  );
}
