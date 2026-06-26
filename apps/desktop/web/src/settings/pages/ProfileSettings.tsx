import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { profilePageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

export function ProfileSettings() {
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
        This local profile is a UI-only mock. It is not synced or uploaded.
      </div>
    </SettingsPageLayout>
  );
}

function LocalProfileSummary() {
  return (
    <div className="ua-settings-page__static-stack">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Display name</span>
        <span className="ua-settings-page__static-value">Local Operator</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Role</span>
        <span className="ua-settings-page__static-value">Unreal workflow owner</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Workspace</span>
        <span className="ua-settings-page__static-value">UAgent local desktop</span>
      </div>
    </div>
  );
}

function AccountStatus() {
  return (
    <div className="ua-settings-page__status-grid">
      <div className="ua-settings-page__status-card">
        <span className="ua-settings-page__status-label">Profile scope</span>
        <span className="ua-settings-page__status-value">Local only</span>
      </div>
      <div className="ua-settings-page__status-card">
        <span className="ua-settings-page__status-label">Account session</span>
        <span className="ua-settings-page__status-value">Not signed in</span>
      </div>
    </div>
  );
}

function FutureAccountSync() {
  return (
    <div className="ua-settings-page__profile-sync">
      <button type="button" className="ua-settings-page__action-btn" disabled aria-disabled="true">
        Sync profile
      </button>
      <span className="ua-settings-page__profile-sync-copy">
        Account sync is unavailable in MVP0. This page does not access a remote account, upload
        profile data, or start an account session flow.
      </span>
    </div>
  );
}
