import { useSettingsStore } from "../stores/ui-store";
import { TitleBar } from "./TitleBar";
import { MainLayout } from "./MainLayout";
import { GlobalOverlays } from "./GlobalOverlays";
import { SettingsShell } from "../settings/SettingsShell";
import { useMotionKey } from "../hooks/useMotionKey";

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
  const settingsOpen = useSettingsStore((state) => state.open);
  const shellMode = settingsOpen ? "settings" : "app";
  const motionKey = useMotionKey(shellMode);

  return (
    <div className="ua-app" data-shell-mode={shellMode}>
      <TitleBar />
      <div className="ua-app__body">
        <div key={motionKey} className="ua-motion-page" data-motion="page">
          {settingsOpen ? <SettingsShell /> : <MainLayout />}
        </div>
      </div>
      <GlobalOverlays />
    </div>
  );
}
