import { useUI } from "../app/providers";
import { TitleBar } from "./TitleBar";
import { MainLayout } from "./MainLayout";
import { GlobalOverlays } from "./GlobalOverlays";
import { SettingsShell } from "../settings/SettingsShell";

/**
 * UAgent desktop application shell.
 *
 * Composes the full window layout:
 *   TitleBar (top)
 *   Body:
 *     - MainLayout = LeftSidebar | Workspace | InspectorPane
 *     - SettingsShell = SettingsSidebar | SettingsContent
 *   GlobalOverlays (stacked above via z-index)
 *
 * When settings.open is true the body renders SettingsShell
 * instead of MainLayout. TitleBar and GlobalOverlays stay.
 */
export function AppShell() {
  const { state } = useUI();
  const settingsOpen = state.settings.open;

  return (
    <div className="ua-app" data-shell-mode={settingsOpen ? "settings" : "app"}>
      <TitleBar />
      <div className="ua-app__body">{settingsOpen ? <SettingsShell /> : <MainLayout />}</div>
      <GlobalOverlays />
    </div>
  );
}
