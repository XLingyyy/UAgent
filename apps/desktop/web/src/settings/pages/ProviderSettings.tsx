import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { providerPageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

export function ProviderSettings() {
  return (
    <SettingsPageLayout page={providerPageData}>
      {providerPageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.id === "provider-list" && <ProviderList />}
          {section.id === "provider-actions" && <ProviderActions />}
        </SettingsSection>
      ))}
      <div className="ua-settings-page__note">
        Provider configuration form will be implemented in UI-014. This is a UI-only mock. No
        provider is saved or connected.
      </div>
    </SettingsPageLayout>
  );
}

function ProviderList() {
  return (
    <div className="ua-settings-page__provider-list">
      <div className="ua-settings-page__provider-empty">
        <span className="ua-settings-page__provider-empty-icon" aria-hidden>
          +
        </span>
        <span className="ua-settings-page__provider-empty-text">No providers configured</span>
        <span className="ua-settings-page__provider-empty-hint">
          Provider management will be available in UI-014.
        </span>
      </div>
    </div>
  );
}

function ProviderActions() {
  return (
    <div className="ua-settings-page__provider-actions">
      <button type="button" className="ua-settings-page__action-btn" disabled aria-disabled="true">
        Add provider
      </button>
      <button type="button" className="ua-settings-page__action-btn" disabled aria-disabled="true">
        Edit provider
      </button>
      <button type="button" className="ua-settings-page__action-btn" disabled aria-disabled="true">
        Delete provider
      </button>
      <button type="button" className="ua-settings-page__action-btn" disabled aria-disabled="true">
        Save provider
      </button>
      <button type="button" className="ua-settings-page__action-btn" disabled aria-disabled="true">
        Test connection
      </button>
    </div>
  );
}
