import { FIXTURES_ENABLED } from "../runtime/build-capabilities";
import { workspaceHero, type WorkspaceHeroSummary } from "./workspace-data";
import "./WelcomeHero.css";

export interface WelcomeHeroProps {
  hero?: WorkspaceHeroSummary;
}

export function WelcomeHero({ hero = FIXTURES_ENABLED ? workspaceHero : { projectName: "", capability: "Plan and inspect", previewStatus: "Local workspace", ueStatus: "UE not connected", description: "Select a project to inspect its context. Execution requires separate approval." } }: WelcomeHeroProps) {
  return (
    <section className="ua-welcome-hero" aria-labelledby="ua-welcome-hero-title">
      <div className="ua-welcome-hero__copy">
        <h2 className="ua-welcome-hero__title" id="ua-welcome-hero-title">
          {hero.projectName ? `What should UAgent do in ${hero.projectName}?` : "What would you like to investigate?"}
        </h2>
        <p className="ua-welcome-hero__description">
          {hero.description}
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
