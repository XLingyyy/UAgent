import {useI18n} from "../i18n";
import { ComingSoonGate, type ComingSoonPhase } from "../components/ComingSoonGate";
import { useSettingsActions, useSettingsStore } from "../stores/ui-store";
import { getSettingsGroups, type SettingsPageEntry } from "./settings-pages";
import "./SettingsSidebar.css";

export function SettingsSidebar() {
  const {text: uiText,t} = useI18n();
  const activePageId = useSettingsStore((state) => state.activePageId);
  const { closeSettings, setActiveSettingsPage } = useSettingsActions();
  const groups = getSettingsGroups();

  function handlePageClick(page: SettingsPageEntry) {
    if (!page.enabled) return;
    setActiveSettingsPage(page.id);
  }

  return (
    <aside
      className="ua-settings-sidebar ua-motion-panel"
      aria-label={uiText("Settings navigation")}
      data-motion="panel"
    >
      <div className="ua-settings-sidebar__header">
        <h2 className="ua-settings-sidebar__title">{uiText("Settings")}</h2>
        <button
          type="button"
          className="ua-settings-sidebar__back"
          onClick={closeSettings}
          aria-label={uiText("Back to app")}
        >
          <span className="ua-settings-sidebar__back-icon" aria-hidden>
            &#x2190;
          </span>
          {uiText("Back to app")}{" "}</button>
      </div>

      <div className="ua-settings-sidebar__search" hidden>
        <input
          type="text"
          className="ua-settings-sidebar__search-input"
          placeholder={uiText("Search settings...")}
          disabled
          aria-label={uiText("Search settings")}
        />
      </div>

      <nav className="ua-settings-sidebar__nav">
        {groups.map((group) => (
          <div key={group.name} className="ua-settings-sidebar__group">
            <div className="ua-settings-sidebar__group-label">{t(group.name==="Account"?"settings.group.account":group.name==="Preferences"?"settings.group.preferences":"settings.group.system")}</div>
            <ul className="ua-settings-sidebar__group-list">
              {group.pages.filter(page => !["profile","personalization"].includes(page.id)).map((page) => {
                const isActive = page.enabled && page.id === activePageId;
                const button = (
                  <button
                    type="button"
                    className={`ua-settings-sidebar__item${isActive ? " ua-settings-sidebar__item--active" : ""}${!page.enabled ? " ua-settings-sidebar__item--disabled" : ""}`}
                    onClick={() => handlePageClick(page)}
                    aria-disabled={!page.enabled || undefined}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="ua-settings-sidebar__item-text">{uiText(page.title)}</span>
                    {!page.enabled && (
                      <span className="ua-settings-sidebar__item-disabled-reason">
                        {uiText(page.disabledReason ?? "")}
                      </span>
                    )}
                  </button>
                );
                return (
                  <li key={page.id}>
                    {page.enabled ? (
                      button
                    ) : (
                      <ComingSoonGate phase={page.phase as ComingSoonPhase} reason={page.summary}>
                        {button}
                      </ComingSoonGate>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
