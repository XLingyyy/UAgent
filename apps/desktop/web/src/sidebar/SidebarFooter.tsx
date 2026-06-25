import { useUI } from "../app/providers";
import "./SidebarFooter.css";

export function SidebarFooter() {
  const { openSettings } = useUI();

  return (
    <div className="ua-sidebar-footer">
      <div className="ua-sidebar-footer__actions">
        <button
          type="button"
          className="ua-sidebar-footer__btn"
          onClick={() => openSettings("general")}
          aria-label="Open settings"
        >
          <span className="ua-sidebar-footer__btn-icon" aria-hidden>
            &#x2699;
          </span>
          Settings
        </button>
        <button
          type="button"
          className="ua-sidebar-footer__btn ua-sidebar-footer__btn--disabled"
          disabled
          aria-disabled="true"
          aria-label="Account (coming soon)"
        >
          <span className="ua-sidebar-footer__btn-icon" aria-hidden>
            &#x25CF;
          </span>
          Account
        </button>
      </div>
      <div className="ua-sidebar-footer__meta">
        <span className="ua-sidebar-footer__version">UAgent MVP0</span>
        <span className="ua-sidebar-footer__status">Local · No UE connected</span>
      </div>
    </div>
  );
}
