import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore } from "../i18n";
import { RecoveryObservation } from "./RecoveryObservation";
import { readNativeRecoveryStatus } from "../runtime/native-recovery-status";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const value = (projectId = "A", runId = "run") => ({ schemaVersion: 1, projectId, runId, observedAt: 1000, scanState: "complete", scanComplete: true, projectEffectCount: 2, projectLegacyCount: 1, nativeWriterFenceInstalled: false, observationOnly: true, recoveryEligibility: "unverified" });
function element(projectId = "A", runId = "run") { return <I18nProvider store={createLocaleStore({ initialLocale: "en", storage: null })}><RecoveryObservation projectId={projectId} runId={runId} /></I18nProvider>; }
it("shows project retained counts and no-fence unverified status using only the read command", async () => {
  const invoke = vi.fn(async () => value()); vi.stubGlobal("__TAURI_INTERNALS__", { invoke }); render(element());
  expect(await screen.findByText(/external effects 2, legacy uncertainties 1/)).toBeTruthy();
  expect(screen.getByText("A complete writer fence is not installed.")).toBeTruthy();
  expect(screen.getByText(/Recovery eligibility is unverified/)).toBeTruthy();
  expect(invoke.mock.calls).toHaveLength(1);
  expect(invoke).toHaveBeenCalledWith("read_native_recovery_status", { input: { schemaVersion: 1, projectId: "A", runId: "run" } });
});
it("shows failure without any recovery grant", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockRejectedValue(Error("unavailable")) }); render(element());
  expect(await screen.findByText("Host observation is unavailable.")).toBeTruthy();
  expect(screen.getByText(/Recovery eligibility is unverified/)).toBeTruthy();
});
it.each([["B", "run"], ["A", "other"]])("ignores late result after identity change to %s %s", async (projectId, runId) => {
  let complete!: (v: unknown) => void;
  const invoke = vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue({ ...value(projectId, runId), projectEffectCount: 0 });
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke }); const view = render(element());
  expect(screen.getByText("Reading host observation…")).toBeTruthy();
  view.rerender(element(projectId, runId)); await screen.findByText(/external effects 0/);
  await act(async () => { complete(value()); });
  expect(screen.queryByText(/external effects 2/)).toBeNull();
});
it.each([{ scanState: "ready" }, { scanState: "pending" }, { projectId: "other" }, { runId: "other" }, { recoveryEligibility: "ready" }, { observationOnly: false }, { scanComplete: "true" }, { projectEffectCount: -1 }, { observedAt: 9_000_000_000_000_000 }])("rejects malformed or mismatched response %j", async patch => {
  await expect(readNativeRecoveryStatus("A", "run", vi.fn().mockResolvedValue({ ...value(), ...patch }))).rejects.toThrow("recovery_status_invalid");
});
it("incomplete scan and installed fence still remain unverified", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue({ ...value(), scanState: "unavailable", scanComplete: false, nativeWriterFenceInstalled: true }) }); render(element());
  expect(await screen.findByText("The host has not provided a complete scan result.")).toBeTruthy();
  expect(screen.getByText(/Recovery eligibility is unverified/)).toBeTruthy();
});
