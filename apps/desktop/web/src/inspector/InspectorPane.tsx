import "./InspectorPane.css";

export interface InspectorPaneProps {
  /** Whether the inspector is visible. */
  open: boolean;
  /** Callback to close the inspector. */
  onClose?: () => void;
}

/**
 * Right-side inspector pane.
 *
 * Will host the review tab, diagnostics, and detail panels in
 * subsequent UI tasks. For now it renders a structural placeholder
 * with a close button so the toggle interaction is testable.
 */
export function InspectorPane({ open, onClose }: InspectorPaneProps) {
  return (
    <aside
      className={`ua-inspector ${open ? "ua-inspector--open" : "ua-inspector--closed"}`}
      aria-label="Inspector"
      aria-hidden={!open}
    >
      <div className="ua-inspector__header">
        <span className="ua-inspector__title">Inspector</span>
        {onClose && (
          <button
            className="ua-inspector__close"
            onClick={onClose}
            aria-label="Close inspector"
            type="button"
          >
            ✕
          </button>
        )}
      </div>
      <div className="ua-inspector__body">
        <div className="ua-inspector__tab-bar">
          <button className="ua-inspector__tab ua-inspector__tab--active" type="button">
            Review
          </button>
          <button className="ua-inspector__tab" type="button">
            Diagnostics
          </button>
        </div>
        <div className="ua-inspector__content">
          <span className="ua-inspector__placeholder">Inspector content placeholder</span>
        </div>
      </div>
    </aside>
  );
}
