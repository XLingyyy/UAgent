import "./GlobalOverlays.css";

/**
 * Global overlay layer.
 *
 * Placeholder for future modals, command palette, toasts, and
 * confirmation dialogs. Rendered last in the AppShell so it
 * stacks above all other regions via z-index.
 */
export function GlobalOverlays() {
  return <div className="ua-global-overlays" aria-hidden="true" />;
}
