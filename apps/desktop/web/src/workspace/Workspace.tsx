import "./Workspace.css";
import { ConversationViewport } from "./ConversationViewport";
import { WelcomeHero } from "./WelcomeHero";
import { WorkspaceStatusStrip } from "./WorkspaceStatusStrip";
import { ComposerDock } from "../composer/ComposerDock";
import { useThreadStore } from "../stores/ui-store";

export function Workspace() {
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const workspaceMode = activeThreadId ? "thread" : "welcome";

  return (
    <main className="ua-workspace" aria-label="Workspace" data-workspace-mode={workspaceMode}>
      <div className={`ua-workspace__content ua-workspace__content--${workspaceMode}`}>
        {workspaceMode === "welcome" ? (
          <div className="ua-workspace__welcome-stack">
            <WelcomeHero />
            <WorkspaceStatusStrip />
          </div>
        ) : (
          <>
            <WorkspaceStatusStrip />
            <ConversationViewport />
          </>
        )}
      </div>
      <ComposerDock />
    </main>
  );
}
