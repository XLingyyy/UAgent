import {NativeSettingsNotice} from "../runtime/NativeSettingsNotice";
import {OfflineDemoBanner} from "../runtime/OfflineDemoBanner";
import { ACCEPTANCE_ENABLED } from "../runtime/build-capabilities";
import { useNarrowViewport } from "./useNarrowViewport";
import { useEffect } from "react";
import { useLayoutStore, useSettingsActions, useSettingsStore } from "../stores/ui-store";
import { TitleBar } from "./TitleBar";
import { MainLayout } from "./MainLayout";
import { GlobalOverlays } from "./GlobalOverlays";
import { SettingsShell } from "../settings/SettingsShell";

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
 * MainLayout stays mounted while settings are visible so live sessions
 * and in-progress composer configuration retain their owners.
 */
export function AppShell() {
  const settingsOpen = useSettingsStore((state) => state.open);
  const inspectorOpen = useLayoutStore((state) => state.inspector.open);
  const modal = useNarrowViewport() && inspectorOpen && !settingsOpen;
  const theme = useLayoutStore((state) => state.theme);
  const { openSettings } = useSettingsActions();
  const shellMode = settingsOpen ? "settings" : "app";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!ACCEPTANCE_ENABLED) return;
    const onCapabilityOpen = () => openSettings("config");
    globalThis.window.addEventListener(MVP15D_CAPABILITY_OPEN_SETTINGS_EVENT, onCapabilityOpen);
    return () =>
      globalThis.window.removeEventListener(MVP15D_CAPABILITY_OPEN_SETTINGS_EVENT, onCapabilityOpen);
  }, [openSettings]);

  return (
    <div className="ua-app" data-build-commit={import.meta.env.VITE_UAGENT_BUILD_COMMIT??"development"} data-shell-mode={shellMode} data-theme={theme}>
      <div {...(modal ? { inert: "" } : {})} aria-hidden={modal || undefined}><TitleBar /></div>
      <OfflineDemoBanner/>
      <NativeSettingsNotice/>
      <div className="ua-app__body">
        <div className="ua-workbench-page" hidden={settingsOpen}>
          <MainLayout />
        </div>
        {settingsOpen && <div className="ua-motion-page" data-motion="page"><SettingsShell /></div>}
      </div>
      <GlobalOverlays />
    </div>
  );
}
