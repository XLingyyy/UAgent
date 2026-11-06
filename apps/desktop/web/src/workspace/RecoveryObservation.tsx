import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { readNativeRecoveryStatus, type RecoveryObservation as Observation } from "../runtime/native-recovery-status";
export function RecoveryObservation({ projectId, runId }: { projectId: string; runId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ projectId: string; runId: string; value: Observation | null; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    setState(null);
    void readNativeRecoveryStatus(projectId, runId).then(
      value => { if (active) setState({ projectId, runId, value, failed: false }); },
      () => { if (active) setState({ projectId, runId, value: null, failed: true }); },
    );
    return () => { active = false; };
  }, [projectId, runId]);
  const current = state?.projectId === projectId && state.runId === runId ? state : null;
  const value = current?.value;
  return <section aria-label={t("historyRun.recoveryTitle")}>
    <h3>{t("historyRun.recoveryTitle")}</h3>
    <p>{t("historyRun.recoveryObservationOnly")}</p>
    {!current ? <p role="status">{t("historyRun.recoveryLoading")}</p> : current.failed ?
      <p role="status">{t("historyRun.recoveryUnavailable")}</p> : value && <>
        <p>{t(`historyRun.recoveryPhase.${value.scanState}`)}</p>
        <p>{t("historyRun.recoveryCounts", { effects: value.projectEffectCount, legacy: value.projectLegacyCount })}</p>
        <p>{t(value.nativeWriterFenceInstalled ? "historyRun.recoveryFencePresent" : "historyRun.recoveryFenceAbsent")}</p>
        <p>{t("historyRun.recoveryObservedAt", { time: new Date(value.observedAt).toISOString() })}</p>
      </>}
    <p>{t("historyRun.recoveryUnverified")}</p>
  </section>;
}
