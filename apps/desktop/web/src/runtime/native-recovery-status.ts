import type { NativeRunStoreInvoke } from "./native-run-store";
export interface RecoveryObservation {
  schemaVersion: 1; projectId: string; runId: string; observedAt: number;
  scanState: "complete" | "notScanned" | "pending" | "unavailable"; scanComplete: boolean; projectEffectCount: number; projectLegacyCount: number;
  nativeWriterFenceInstalled: boolean; observationOnly: true; recoveryEligibility: "unverified";
}
export async function readNativeRecoveryStatus(projectId: string, runId: string,
  invoke: NativeRunStoreInvoke | undefined = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeRunStoreInvoke } }).__TAURI_INTERNALS__?.invoke,
): Promise<RecoveryObservation> {
  const validId = (v: string) => v.length > 0 && new TextEncoder().encode(v).length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
  if (!invoke || !validId(projectId) || !validId(runId)) throw new Error("recovery_status_unavailable");
  const value: unknown = await invoke("read_native_recovery_status", { input: { schemaVersion: 1, projectId, runId } });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("recovery_status_invalid");
  const v = value as Record<string, unknown>;
  const integer = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (v.schemaVersion !== 1 || v.projectId !== projectId || v.runId !== runId ||
      !integer(v.observedAt) || (v.observedAt as number) > 8_640_000_000_000_000 || !integer(v.projectEffectCount) || !integer(v.projectLegacyCount) ||
      typeof v.scanComplete !== "boolean" || !["complete", "notScanned", "pending", "unavailable"].includes(v.scanState as string) || (v.scanState === "complete") !== v.scanComplete || typeof v.nativeWriterFenceInstalled !== "boolean" ||
      v.observationOnly !== true || v.recoveryEligibility !== "unverified") throw new Error("recovery_status_invalid");
  return { schemaVersion: 1, projectId, runId, observedAt: v.observedAt as number,
    scanState: v.scanState as RecoveryObservation["scanState"], scanComplete: v.scanComplete, projectEffectCount: v.projectEffectCount as number,
    projectLegacyCount: v.projectLegacyCount as number, nativeWriterFenceInstalled: v.nativeWriterFenceInstalled,
    observationOnly: true, recoveryEligibility: "unverified" };
}
