import "./Workspace.css";

/**
 * Central workspace region.
 *
 * Will host the WelcomeHero, ConversationViewport, and ComposerDock
 * in subsequent UI tasks. For now it renders a structural placeholder
 * with a reserved bottom dock area so the AppShell layout is testable.
 */
export function Workspace() {
  return (
    <main className="ua-workspace" aria-label="Workspace">
      <div className="ua-workspace__content">
        <div className="ua-workspace__hero">
          <h2 className="ua-workspace__hero-title">UAgent Workspace</h2>
          <p className="ua-workspace__hero-subtitle">AI Agent Host for Unreal Engine workflows</p>
        </div>
        <div className="ua-workspace__viewport">
          <span className="ua-workspace__placeholder">ConversationViewport placeholder</span>
        </div>
      </div>
      <div className="ua-workspace__dock">
        <span className="ua-workspace__placeholder">ComposerDock placeholder</span>
      </div>
    </main>
  );
}
