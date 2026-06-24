import "./Workspace.css";
import { ConversationViewport } from "./ConversationViewport";
import { WelcomeHero } from "./WelcomeHero";
import { WorkspaceStatusStrip } from "./WorkspaceStatusStrip";
import { ComposerDock } from "../composer/ComposerDock";

export function Workspace() {
  return (
    <main className="ua-workspace" aria-label="Workspace">
      <div className="ua-workspace__content">
        <WelcomeHero />
        <WorkspaceStatusStrip />
        <ConversationViewport />
      </div>
      <ComposerDock />
    </main>
  );
}
