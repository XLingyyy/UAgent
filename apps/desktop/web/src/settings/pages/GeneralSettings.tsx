import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { generalPageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

export function GeneralSettings() {
  return (
    <SettingsPageLayout page={generalPageData}>
      {generalPageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.id === "work-mode" && <WorkModeControls />}
          {section.id === "permission-defaults" && <PermissionDefaultDisplay />}
          {section.id === "language" && <LanguageDisplay />}
          {section.id === "bottom-panel" && <BottomPanelDisplay />}
        </SettingsSection>
      ))}
      <div className="ua-settings-page__note">
        This is a UI-only mock. No configuration is saved or applied.
      </div>
    </SettingsPageLayout>
  );
}

function WorkModeControls() {
  return (
    <div
      className="ua-settings-page__option-group"
      role="radiogroup"
      aria-label="Default work mode"
    >
      <label className="ua-settings-page__option ua-settings-page__option--selected">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>UE development</span>
      </label>
      <label className="ua-settings-page__option">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>General task</span>
      </label>
    </div>
  );
}

function PermissionDefaultDisplay() {
  return <span className="ua-settings-page__static-value">Request approval</span>;
}

function LanguageDisplay() {
  return <span className="ua-settings-page__static-value">English</span>;
}

function BottomPanelDisplay() {
  return (
    <div
      className="ua-settings-page__option-group"
      role="radiogroup"
      aria-label="Bottom panel default view"
    >
      <label className="ua-settings-page__option ua-settings-page__option--selected">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>Diagnostics</span>
      </label>
      <label className="ua-settings-page__option">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>Terminal</span>
      </label>
    </div>
  );
}
