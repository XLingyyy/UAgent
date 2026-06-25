import { useUI } from "../app/providers";
import { getSettingsGroups, type SettingsPageEntry } from "./settings-pages";
import "./SettingsSidebar.css";

export function SettingsSidebar() {
  const { state, closeSettings, setActiveSettingsPage } = useUI();
  const { activePageId } = state.settings;
  const groups = getSettingsGroups();

  function handlePageClick(page: SettingsPageEntry) {
    if (!page.enabled) return;
    setActiveSettingsPage(page.id);
  }

  return (
    <aside className="ua-settings-sidebar" aria-label="Settings navigation">
      <div className="ua-settings-sidebar__header">
        <h2 className="ua-settings-sidebar__title">Settings</h2>
        <button
          type="button"
          className="ua-settings-sidebar__back"
          onClick={closeSettings}
          aria-label="Back to app"
        >
          <span className="ua-settings-sidebar__back-icon" aria-hidden>
            &#x2190;
          </span>
          Back to app
        </button>
      </div>

      <div className="ua-settings-sidebar__search">
        <input
          type="text"
          className="ua-settings-sidebar__search-input"
          placeholder="Search settings..."
          disabled
          aria-label="Search settings"
        />
      </div>

      <nav className="ua-settings-sidebar__nav">
        {groups.map((group) => (
          <div key={group.name} className="ua-settings-sidebar__group">
            <div className="ua-settings-sidebar__group-label">{group.name}</div>
            <ul className="ua-settings-sidebar__group-list">
              {group.pages.map((page) => {
                const isActive = page.enabled && page.id === activePageId;
                return (
                  <li key={page.id}>
                    <button
                      type="button"
                      className={`ua-settings-sidebar__item${isActive ? " ua-settings-sidebar__item--active" : ""}${!page.enabled ? " ua-settings-sidebar__item--disabled" : ""}`}
                      onClick={() => handlePageClick(page)}
                      disabled={!page.enabled}
                      aria-disabled={!page.enabled || undefined}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span className="ua-settings-sidebar__item-text">{page.title}</span>
                      {page.enabled ? (
                        <span className="ua-settings-sidebar__item-phase">{page.phase}</span>
                      ) : (
                        <span className="ua-settings-sidebar__item-disabled-reason">
                          {page.disabledReason}
                        </span>
                      )}
                    </button>
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
