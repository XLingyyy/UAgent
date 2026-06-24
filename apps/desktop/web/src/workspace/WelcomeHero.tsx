import { workspaceHero, type WorkspaceHeroSummary } from "./workspace-data";
import "./WelcomeHero.css";

export interface WelcomeHeroProps {
  hero?: WorkspaceHeroSummary;
}

export function WelcomeHero({ hero = workspaceHero }: WelcomeHeroProps) {
  return (
    <section className="ua-welcome-hero" aria-labelledby="ua-welcome-hero-title">
      <div className="ua-welcome-hero__copy">
        <span className="ua-welcome-hero__eyebrow">Unreal project context</span>
        <h2 className="ua-welcome-hero__title" id="ua-welcome-hero-title">
          {hero.projectName} workspace
        </h2>
        <p className="ua-welcome-hero__description">{hero.description}</p>
      </div>
      <dl className="ua-welcome-hero__facts" aria-label="Workspace capabilities">
        <div className="ua-welcome-hero__fact">
          <dt>Current capability</dt>
          <dd>{hero.capability}</dd>
        </div>
        <div className="ua-welcome-hero__fact">
          <dt>Preview state</dt>
          <dd>{hero.previewStatus}</dd>
        </div>
        <div className="ua-welcome-hero__fact">
          <dt>Connection</dt>
          <dd>{hero.ueStatus}</dd>
        </div>
      </dl>
    </section>
  );
}
