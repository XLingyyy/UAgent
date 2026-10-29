import {useI18n} from "../i18n";
import { LeftSidebar } from "../sidebar/LeftSidebar";
import { Workspace } from "../workspace/Workspace";
import { InspectorPane } from "../inspector/InspectorPane";
import { useLayoutActions, useLayoutStore } from "../stores/ui-store";
import { useNarrowViewport } from "./useNarrowViewport";
import "./MainLayout.css";

/**
 * Main center-first layout: Sidebar | Workspace | utility pane.
 *
 * The inspector participates in the flex flow on wide screens.
 * On narrow screens it becomes an overlay so the Composer dock
 * area in the Workspace is never squeezed.
 *
 * Exposes `data-inspector-state="open|closed"` for regression coverage
 * and `data-utility-pane-state="open|closed"` for utility drawer tasks.
 */
export function MainLayout() {
  const {text: uiText} = useI18n();
  const inspectorOpen = useLayoutStore((state) => state.inspector.open);
  const { toggleInspector } = useLayoutActions();

  const modal = useNarrowViewport() && inspectorOpen;

  return (
    <div
      className="ua-main-layout"
      data-inspector-state={inspectorOpen ? "open" : "closed"}
      data-utility-pane-state={inspectorOpen ? "open" : "closed"}
    >
      <div className="ua-main-layout__background" {...(modal ? { inert: "" } : {})} aria-hidden={modal || undefined}>
        <LeftSidebar />
        <Workspace />
      </div>
      {modal && <button className="ua-drawer-backdrop" aria-label={uiText("Close tools backdrop")} onClick={toggleInspector} tabIndex={-1} />}
      <InspectorPane open={inspectorOpen} onClose={toggleInspector} />
    </div>
  );
}
