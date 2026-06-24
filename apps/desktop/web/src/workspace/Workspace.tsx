import "./Workspace.css";
import { ConversationViewport } from "./ConversationViewport";
import { WelcomeHero } from "./WelcomeHero";
import { WorkspaceStatusStrip } from "./WorkspaceStatusStrip";
import { composerModes } from "./workspace-data";

export function Workspace() {
  return (
    <main className="ua-workspace" aria-label="Workspace">
      <div className="ua-workspace__content">
        <WelcomeHero />
        <WorkspaceStatusStrip />
        <ConversationViewport />
      </div>
      <section className="ua-workspace__dock" aria-label="Composer dock placeholder">
        <div className="ua-workspace__dock-main">
          <div className="ua-workspace__dock-copy">
            <span className="ua-workspace__dock-label">ComposerDock placeholder</span>
            <span className="ua-workspace__dock-subtitle">
              Static input skeleton for future local agent workflows.
            </span>
          </div>
          <div className="ua-workspace__dock-modes" aria-label="Mock composer modes">
            {composerModes.map((mode) => (
              <button className="ua-workspace__dock-mode" type="button" disabled key={mode}>
                {mode}
              </button>
            ))}
          </div>
          <div className="ua-workspace__dock-context">Context ring: Lyra_Prototype / Mock</div>
          <button
            className="ua-workspace__dock-send"
            type="button"
            aria-label="Send disabled"
            disabled
          >
            Send
          </button>
        </div>
      </section>
    </main>
  );
}
