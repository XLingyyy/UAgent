import {useI18n} from "../../i18n";
import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { profilePageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

export function ProfileSettings() {
  const {text: uiText} = useI18n();
  return (
    <SettingsPageLayout page={profilePageData}>
      {profilePageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.id === "profile-summary" && <LocalProfileSummary />}
          {section.id === "account-status" && <AccountStatus />}
          {section.id === "future-account-sync" && <FutureAccountSync />}
        </SettingsSection>
      ))}
      <div className="ua-settings-page__note">
        {uiText("This local profile is a UI-only mock. It is not synced or uploaded.")}{" "}</div>
    </SettingsPageLayout>
  );
}

function LocalProfileSummary() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__static-stack">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Display name")}</span>
        <span className="ua-settings-page__static-value">{uiText("Local Operator")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Role")}</span>
        <span className="ua-settings-page__static-value">{uiText("Unreal workflow owner")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Workspace")}</span>
        <span className="ua-settings-page__static-value">{uiText("UAgent local desktop")}</span>
      </div>
    </div>
  );
}

function AccountStatus() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__status-grid">
      <div className="ua-settings-page__status-card">
        <span className="ua-settings-page__status-label">{uiText("Profile scope")}</span>
        <span className="ua-settings-page__status-value">{uiText("Local only")}</span>
      </div>
      <div className="ua-settings-page__status-card">
        <span className="ua-settings-page__status-label">{uiText("Account session")}</span>
        <span className="ua-settings-page__status-value">{uiText("Not signed in")}</span>
      </div>
    </div>
  );
}

function FutureAccountSync() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__profile-sync">
      <button type="button" className="ua-settings-page__action-btn" disabled aria-disabled="true">
        {uiText("Sync profile")}{" "}</button>
      <span className="ua-settings-page__profile-sync-copy">
        {uiText("Account sync is unavailable in MVP6. This page does not access a remote account, upload profile data, or start an account session flow.")}{" "}</span>
    </div>
  );
}
