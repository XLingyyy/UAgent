import { SettingsSidebar } from "./SettingsSidebar";
import { SettingsContent } from "./SettingsContent";
import "./SettingsShell.css";

export function SettingsShell() {
  return (
    <div className="ua-settings-shell" aria-label="Settings" data-settings-state="open">
      <SettingsSidebar />
      <SettingsContent />
    </div>
  );
}
