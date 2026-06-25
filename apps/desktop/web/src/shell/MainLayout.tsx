import { LeftSidebar } from "../sidebar/LeftSidebar";
import { Workspace } from "../workspace/Workspace";
import { InspectorPane } from "../inspector/InspectorPane";
import { useUI } from "../app/providers";
import { useInspectorAutoCollapse } from "./useInspectorAutoCollapse";
import "./MainLayout.css";

/**
 * Main three-column layout: Sidebar | Workspace | Inspector.
 *
 * The inspector participates in the flex flow on wide screens.
 * On narrow screens it becomes an overlay so the Composer dock
 * area in the Workspace is never squeezed.
 *
 * Exposes `data-inspector-state="open|closed"` for testing
 * and CSS constraint.
 */
export function MainLayout() {
  const { state, toggleInspector, setInspectorOpen } = useUI();
  const inspectorOpen = state.layout.inspector.open;

  useInspectorAutoCollapse(setInspectorOpen, 899);

  return (
    <div className="ua-main-layout" data-inspector-state={inspectorOpen ? "open" : "closed"}>
      <LeftSidebar />
      <Workspace />
      <InspectorPane open={inspectorOpen} onClose={toggleInspector} />
    </div>
  );
}
