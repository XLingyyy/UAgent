import {useI18n} from "../i18n";
import type { Mvp15RuntimeState } from "../runtime/runtime-store";
import { safeDisplay } from "./safe-display";
import "./AssetLifecycleEvidence.css";

export function hasAssetLifecycle(state: Mvp15RuntimeState | undefined): state is Mvp15RuntimeState {
  return Boolean(state && (state.sourceAssetPath || state.activeChangeSet || state.latestDryRun || state.latestExecution || state.lastError));
}

export function AssetLifecycleEvidence({ state, title }: { state: Mvp15RuntimeState; title: string }) {
  const {text: uiText,t} = useI18n();
  const rows: [string, unknown][] = [
    ["Mode", state.executionMode], ["Gate", state.gate.mode],
    ["Companion", state.companion.status], ["Source asset", state.sourceAssetPath],
    ["Binding", state.activeChangeSet?.externalBindingStatus ?? "not bound"],
    ["Native registration", state.activeChangeSet?.nativeApprovalRegistrationStatus ?? "not registered"],
    ["Change set", state.activeChangeSet?.state ?? "not created"],
    ["Approval", state.activeChangeSet?.approval?.status ?? "not requested"],
    ["Rollback", state.activeChangeSet ? `${state.activeChangeSet.rollbackPlan.actions.filter((action) => action.status === "completed").length}/${state.activeChangeSet.rollbackPlan.actions.length} ${uiText("Actions completed")}` : "not recorded"],
    ["Dry run", state.latestDryRun?.status], ["Execution", state.latestExecution?.status],
    ["Verification", state.latestVerification?.status],
    ["Final restore", `${state.finalVerification.status}; ${uiText("Restored")}: ${state.finalVerification.restored}`],
    ["Replay", state.replayInspection.status],
    ["Replay side effects", state.replayInspection.status === "idle" ? "not measured" : state.replayInspection.sideEffectDelta.join(" / ")],
    ["Blocker", state.lastError ?? "none recorded"],
  ];
  return <section className="ua-asset-evidence" aria-label={t("tools.panelLabel",{title})}>
    <h3>{title}{uiText(": asset lifecycle")}</h3>
    <p>{uiText("Recorded state for the current project. Approval, execution, verification and rollback remain separate actions.")}</p>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{uiText(label)}</dt><dd>{safeDisplay(value)}</dd></div>)}</dl>
  </section>;
}
