import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore } from "../i18n";
import { UEApprovedBuildAction } from "./UEApprovedBuildAction";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";
const preview = { projectId: "root:abc", preparedId: "a".repeat(32), preview: { fingerprint: "b".repeat(64) } } as UEBuildPreviewReceipt;
const run = "c".repeat(32);
const receipt = () => ({ schemaVersion: 1, projectId: preview.projectId, preparedId: preview.preparedId, runId: run, persisted: true, hostSettled: true,
  result: { owner: { runId: run, stepId: "build", fingerprint: preview.preview.fingerprint }, status: "succeeded", reason: "exited", pid: 1,
    exitCode: 0, durationMs: 1, treeStopped: true, stdout: "synthetic output", stderr: "", outputTruncated: false, outputComplete: true, effects: "possible" } });
afterEach(cleanup);
function mount(invoke: ReturnType<typeof vi.fn>) {
  const active = vi.fn(), consumed = vi.fn();
  const element = <I18nProvider store={createLocaleStore({ initialLocale: "en", storage: null })}>
    <UEApprovedBuildAction preview={preview} invoke={invoke as never} onActiveChange={active} onConsumed={consumed}/>
  </I18nProvider>;
  return { ...render(element), active, consumed, element };
}
it("requests only the bound preview identity once and reports a verified native receipt", async () => {
  const invoke = vi.fn(async () => receipt()); const h = mount(invoke);
  const button = screen.getByRole("button", { name: "Request native approval and build once" });
  fireEvent.click(button); fireEvent.click(button);
  await screen.findByText(/Build succeeded and the native receipt was saved/);
  expect(invoke.mock.calls).toEqual([["approve_and_run_ue_build", { input: { projectId: preview.projectId, preparedId: preview.preparedId, fingerprint: preview.preview.fingerprint } }]]);
  expect(h.active.mock.calls).toEqual([[true], [false]]); expect(h.consumed).toHaveBeenCalledTimes(1);
});
it("cancel uses the same project/preview and waits for real completion", async () => {
  let resolve: (value: unknown) => void = () => undefined;
  const invoke = vi.fn((command: string) => command === "cancel_approved_ue_build" ? Promise.resolve(true) : new Promise(done => { resolve = done; }));
  mount(invoke); fireEvent.click(screen.getByRole("button", { name: "Request native approval and build once" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel this build" }));
  await screen.findByText(/Cancellation requested/); expect(screen.queryByText(/Build succeeded and/)).toBeNull();
  expect(invoke.mock.calls[1]).toEqual(["cancel_approved_ue_build", { input: { projectId: preview.projectId, preparedId: preview.preparedId } }]);
  resolve({ ...receipt(), result: { ...receipt().result, status: "cancelled", exitCode: null } });
  await screen.findByText(/Build did not succeed or needs review/);
});
it("unmount requests native cancellation and never consumes a late result", async () => {
  let resolve: (value: unknown) => void = () => undefined;
  const invoke = vi.fn((command: string) => command === "cancel_approved_ue_build" ? Promise.resolve(true) : new Promise(done => { resolve = done; }));
  const h = mount(invoke); fireEvent.click(screen.getByRole("button", { name: "Request native approval and build once" }));
  h.unmount(); expect(invoke.mock.calls[1][0]).toBe("cancel_approved_ue_build"); resolve(receipt());
  await Promise.resolve(); expect(h.active.mock.calls).toEqual([[true]]);
});
it.each(["wrong-owner", "unsaved", "unsettled", "incomplete"])("does not claim success for %s", async mode => {
  const r = receipt(); if (mode === "wrong-owner") r.result.owner.fingerprint = "d".repeat(64);
  if (mode === "unsaved") r.persisted = false; if (mode === "unsettled") r.hostSettled = false;
  if (mode === "incomplete") r.result.outputComplete = false;
  mount(vi.fn(async () => r)); fireEvent.click(screen.getByRole("button", { name: "Request native approval and build once" }));
  await waitFor(() => expect(screen.queryByText(/Waiting for native approval/)).toBeNull());
  expect(screen.queryByText(/Build succeeded and the native receipt was saved/)).toBeNull();
});
it("a declined native approval consumes the attempt without automatic retry", async () => {
  const invoke = vi.fn(async () => { throw Error("ue_build_declined"); }); mount(invoke);
  const button = screen.getByRole("button", { name: "Request native approval and build once" }); fireEvent.click(button);
  await screen.findByRole("alert"); fireEvent.click(button); expect(invoke).toHaveBeenCalledTimes(1);
});

it.each(["round_limit","repeated_output","unconfirmed"])("repair chain displays terminal %s without another repair entry",async status=>{
 const r={...receipt(),repairAvailable:false,repairSessionId:null,repairCycle:{chainId:run,rebuilds:0,maxRebuilds:3,previousRunId:null,status},result:{...receipt().result,status:"failed",exitCode:6}};
 // A round-limit claim at the initial build is invalid; it must not expose repair either.
 mount(vi.fn(async()=>r));fireEvent.click(screen.getByRole("button",{name:"Request native approval and build once"}));
 await waitFor(()=>expect(screen.queryByText(/Waiting for native approval/)).toBeNull());expect(screen.queryByText("Request access to selected files")).toBeNull();expect(screen.queryByText(/Build verified; repair chain complete/)).toBeNull();
 if(status==="round_limit")expect(screen.getByRole("alert")).toBeTruthy();else expect(screen.getByLabelText("Repair chain progress")).toBeTruthy();
});
