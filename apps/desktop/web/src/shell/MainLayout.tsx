import { LeftSidebar } from "../sidebar/LeftSidebar";
import { Workspace } from "../workspace/Workspace";
import { InspectorPane } from "../inspector/InspectorPane";
import { useUI } from "../app/providers";
import "./MainLayout.css";

/**
 * Main three-column layout: Sidebar | Workspace | Inspector.
 *
 * The inspector participates in the flex flow on wide screens.
 * On narrow screens it becomes an overlay so the Composer dock
 * area in the Workspace is never squeezed.
 */
export function MainLayout() {
  const { state, toggleInspector } = useUI();

  return (
    <div className="ua-main-layout">
      <LeftSidebar />
      <Workspace />
      <InspectorPane open={state.inspector.open} onClose={toggleInspector} />
    </div>
  );
}
