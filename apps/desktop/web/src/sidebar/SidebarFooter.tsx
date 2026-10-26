import { useAccessiblePopup } from "../hooks/useAccessiblePopup";
import { useState, useRef, useCallback } from "react";
import { useSettingsActions } from "../stores/ui-store";
import "./SidebarFooter.css";

export function SidebarFooter() {
  const { openSettings } = useSettingsActions();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setAccountMenuOpen(false), []);
  useAccessiblePopup(accountMenuOpen, triggerRef, ".ua-sidebar-footer__menu", closeMenu);

  function openSettingsPage(pageId: "general" | "profile") {
    setAccountMenuOpen(false);
    openSettings(pageId);
  }

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
        <div className="ua-sidebar-footer__account">
          <button
            type="button"
            className="ua-sidebar-footer__btn"
            onClick={() => setAccountMenuOpen((open) => !open)}
            ref={triggerRef}
            aria-label="Open profile menu"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
          >
            <span className="ua-sidebar-footer__btn-icon" aria-hidden>
              &#x25CF;
            </span>
            Account
          </button>
          {accountMenuOpen && (
            <div className="ua-sidebar-footer__menu" role="menu" aria-label="Account menu">
              <button
                type="button"
                role="menuitem"
                className="ua-sidebar-footer__menu-item"
                onClick={() => openSettingsPage("general")}
              >
                Open settings
              </button>
              <button
                type="button"
                role="menuitem"
                className="ua-sidebar-footer__menu-item"
                onClick={() => openSettingsPage("profile")}
              >
                Open profile
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="ua-sidebar-footer__meta">
        <span className="ua-sidebar-footer__version">UAgent MVP15</span>
        <span className="ua-sidebar-footer__status">Local / No UE writes</span>
      </div>
    </div>
  );
}
