import { useEffect } from "react";
import { useLayoutStore, useSettingsActions, useSettingsStore } from "../stores/ui-store";
import { TitleBar } from "./TitleBar";
import { MainLayout } from "./MainLayout";
import { GlobalOverlays } from "./GlobalOverlays";
import { SettingsShell } from "../settings/SettingsShell";
import { useMotionKey } from "../hooks/useMotionKey";

// Capability-only R5.3 binding: when the native task bridge requests the
// Settings "config" page so the real Project-root controls render, open it.
const MVP15D_CAPABILITY_OPEN_SETTINGS_EVENT = "uagent:mvp15d-open-capability-settings";

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
  const theme = useLayoutStore((state) => state.theme);
  const { openSettings } = useSettingsActions();
  const shellMode = settingsOpen ? "settings" : "app";
  const motionKey = useMotionKey(shellMode);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onCapabilityOpen = () => openSettings("config");
    globalThis.window.addEventListener(MVP15D_CAPABILITY_OPEN_SETTINGS_EVENT, onCapabilityOpen);
    return () =>
      globalThis.window.removeEventListener(MVP15D_CAPABILITY_OPEN_SETTINGS_EVENT, onCapabilityOpen);
  }, [openSettings]);

  return (
    <div className="ua-app" data-shell-mode={shellMode} data-theme={theme}>
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
