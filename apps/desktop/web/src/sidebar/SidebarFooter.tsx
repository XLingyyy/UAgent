import {useI18n} from "../i18n";
import { useAccessiblePopup } from "../hooks/useAccessiblePopup";
import { useState, useRef, useCallback } from "react";
import { useSettingsActions } from "../stores/ui-store";
import "./SidebarFooter.css";

export function SidebarFooter() {
  const {text: uiText} = useI18n();
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
          aria-label={uiText("Open settings")}
        >
          <span className="ua-sidebar-footer__btn-icon" aria-hidden>
            &#x2699;
          </span>
          {uiText("Settings")}{" "}</button>
        <div className="ua-sidebar-footer__account">
          <button
            type="button"
            className="ua-sidebar-footer__btn"
            onClick={() => setAccountMenuOpen((open) => !open)}
            ref={triggerRef}
            aria-label={uiText("Open profile menu")}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
          >
            <span className="ua-sidebar-footer__btn-icon" aria-hidden>
              &#x25CF;
            </span>
            {uiText("Account")}{" "}</button>
          {accountMenuOpen && (
            <div className="ua-sidebar-footer__menu" role="menu" aria-label={uiText("Account menu")}>
              <button
                type="button"
                role="menuitem"
                className="ua-sidebar-footer__menu-item"
                onClick={() => openSettingsPage("general")}
              >
                {uiText("Open settings")}{" "}</button>
              <button
                type="button"
                role="menuitem"
                className="ua-sidebar-footer__menu-item"
                onClick={() => openSettingsPage("profile")}
              >
                {uiText("Open profile")}{" "}</button>
            </div>
          )}
        </div>
      </div>
      <div className="ua-sidebar-footer__meta">
        <span className="ua-sidebar-footer__version">{uiText("UAgent · desktop")}</span>
        <span className="ua-sidebar-footer__status">{uiText("Local workspace")}</span>
      </div>
    </div>
  );
}
