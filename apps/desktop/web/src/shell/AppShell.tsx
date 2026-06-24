import { TitleBar } from "./TitleBar";
import { MainLayout } from "./MainLayout";
import { GlobalOverlays } from "./GlobalOverlays";

/**
 * UAgent desktop application shell.
 *
 * Composes the full window layout:
 *   TitleBar (top)
 *   MainLayout = LeftSidebar | Workspace | InspectorPane
 *   GlobalOverlays (stacked above via z-index)
 *
 * This is a structural skeleton — real panel content is added
 * in subsequent UI tasks.
 */
export function AppShell() {
  return (
    <div className="ua-app">
      <TitleBar />
      <div className="ua-app__body">
        <MainLayout />
      </div>
      <GlobalOverlays />
    </div>
  );
}
