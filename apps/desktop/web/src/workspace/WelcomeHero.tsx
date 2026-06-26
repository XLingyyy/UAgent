import { workspaceHero, type WorkspaceHeroSummary } from "./workspace-data";
import "./WelcomeHero.css";

export interface WelcomeHeroProps {
  hero?: WorkspaceHeroSummary;
}

export function WelcomeHero({ hero = workspaceHero }: WelcomeHeroProps) {
  return (
    <section className="ua-welcome-hero" aria-labelledby="ua-welcome-hero-title">
      <div className="ua-welcome-hero__copy">
        <h2 className="ua-welcome-hero__title" id="ua-welcome-hero-title">
          What should UAgent do in {hero.projectName}?
        </h2>
        <p className="ua-welcome-hero__description">
          Plan, inspect, or modify your Unreal project with local context.
        </p>
      </div>
      <div className="ua-welcome-hero__meta" aria-label="Workspace context">
        <span className="ua-welcome-hero__chip">{hero.capability}</span>
        <span className="ua-welcome-hero__chip">{hero.previewStatus}</span>
        <span className="ua-welcome-hero__chip ua-welcome-hero__chip--warning">
          {hero.ueStatus}
        </span>
      </div>
    </section>
  );
}
