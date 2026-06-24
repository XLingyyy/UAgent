/**
 * UAgent UI type definitions
 *
 * Shared types for the desktop UI shell layer.
 */

/** Inspector pane visibility state. */
export interface InspectorState {
  /** Whether the Inspector pane is currently visible. */
  open: boolean;
}

/** Theme variants supported by the UI shell. */
export type UATheme = "dark";

/** Global UI shell state consumed by AppShell and child regions. */
export interface UIShellState {
  /** Current theme. */
  theme: UATheme;
  /** Inspector pane state. */
  inspector: InspectorState;
}

/** Toggle the inspector open/closed. */
export type ToggleInspector = () => void;

/** Context value exposed by the UI provider. */
export interface UIContextValue {
  state: UIShellState;
  toggleInspector: ToggleInspector;
  setInspectorOpen: (open: boolean) => void;
}
