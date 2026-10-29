import {useI18n} from "../i18n";
import { useSyncExternalStore } from "react";
import { safeProviderSession } from "../runtime/safe-provider-session";
import { useSettingsActions, useComposerActions, useProjectStore, useComposerStore, useProviderStore } from "../stores/ui-store";
import type { WorkspaceHeroSummary } from "./workspace-data";
import "./WelcomeHero.css";

export interface WelcomeHeroProps { hero?: WorkspaceHeroSummary }
export function WelcomeHero({hero}: WelcomeHeroProps) {
  const {text: uiText,t} = useI18n();
  const {openSettings} = useSettingsActions();
  const {setComposerInput} = useComposerActions();
  const project = useProjectStore(state => state.activeProjectId);
  const modelSelection=useComposerStore(s=>s.selectedModelId);
  const providers=useProviderStore(s=>s.providers);
  const model=providers.flatMap(p=>p.models.map(m=>({selection:JSON.stringify([p.providerId,m.id]),label:`${p.displayName} / ${m.label}`}))).find(m=>m.selection===modelSelection);
  const session = useSyncExternalStore(safeProviderSession.subscribe, safeProviderSession.getSnapshot, safeProviderSession.getSnapshot);
  return <section className="ua-welcome-hero" aria-labelledby="ua-welcome-hero-title">
    <div className="ua-welcome-hero__copy">
      <span className="ua-eyebrow"><span className="ua-brand-mark" aria-hidden>{uiText("u")}</span> {uiText("YOUR UNREAL WORKSPACE")}</span>
      <h1 className="ua-welcome-hero__title" id="ua-welcome-hero-title">{hero?.projectName ? t("onboarding.projectTitle",{project:hero.projectName}) : uiText("From an idea to the next step.")}</h1>
      <p className="ua-welcome-hero__description">{uiText("Ask a question, inspect a project, or plan a change. You stay in control of execution.")}</p>
    </div>
    <div className="ua-start-path" aria-label={uiText("Getting started")}>
      <button type="button" className={`ua-start-path__step${session.ready ? " is-ready" : ""}`} onClick={()=>openSettings("provider")}>
        <span className="ua-start-path__number">01</span><span><strong>{model?t("productUi.selectedModel",{model:model.label}):t("productUi.noModel")}</strong><small>{t("productUi.manage")}</small></span><span aria-hidden>↗</span>
      </button>
      <button type="button" className={`ua-start-path__step${project ? " is-ready" : ""}`} onClick={()=>openSettings("config")}>
        <span className="ua-start-path__number">{project ? "✓" : "02"}</span><span><strong>{uiText("Choose a project")}</strong><small>{project ? uiText("Local context selected") : uiText("Optional for a simple question")}</small></span><span aria-hidden>↗</span>
      </button>
    </div>
    <div className="ua-starter-prompts" aria-label={uiText("Example tasks")}>
      <span>{uiText("Try a small task")}</span>
      <button type="button" onClick={()=>{setComposerInput(uiText("Explain a synthetic cube. Do not execute tools.")); document.querySelector<HTMLTextAreaElement>(".ua-composer__textarea")?.focus();}}>{uiText("Explain a concept")}{" "}<span aria-hidden>↗</span></button>
      <button type="button" onClick={()=>{setComposerInput(uiText("Review the selected project context and propose a plan. Do not execute tools.")); document.querySelector<HTMLTextAreaElement>(".ua-composer__textarea")?.focus();}}>{uiText("Plan a project change")}{" "}<span aria-hidden>↗</span></button>
    </div>
  </section>;
}
