import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore } from "../i18n";
import { RunHistoryPanel } from "./RunHistoryPanel";
import { createNativeRunHistory } from "../runtime/native-run-history";
afterEach(() => {cleanup();vi.unstubAllGlobals();});
it("separates saved state and observation; refresh reopens through read commands only", async () => {
 const descriptor={projectId:"A",projectLabel:"Synthetic project",projectRoot:"E:/synthetic-not-opened",sessionId:"session",sessionTitle:"Synthetic session",runId:"run",goal:"Saved task",status:"succeeded",updatedAt:3,hasUnresolvedEffects:false};
 const invoke=vi.fn(async (command:string) => {
  if(command==="list_native_run_history") return {schemaVersion:1,runs:[descriptor],offset:0,limit:30,hasMore:false};
  if(command==="snapshot_native_run_store") return {schemaVersion:1,descriptor,
   snapshot:{run:{projectId:"A",id:"run",sessionId:"session",goal:"Saved task",status:"succeeded",revision:1,createdAt:1,updatedAt:3},checkpoint:null,steps:[],toolCalls:[],changesets:[],artifacts:[],requiresFreshAuthorization:true,hasUnknownExternalEffects:false},
   coordinatorState:null,messages:[],events:[],completeness:{complete:true,loadedMessageCount:0,storedMessageCount:0,reason:null}};
  if(command==="read_native_recovery_status") return {schemaVersion:1,projectId:"A",runId:"run",observedAt:1000,scanState:"complete",scanComplete:true,projectEffectCount:2,projectLegacyCount:1,nativeWriterFenceInstalled:false,observationOnly:true,recoveryEligibility:"unverified"};
  throw Error("Unexpected command: "+command);
 });
 vi.stubGlobal("__TAURI_INTERNALS__",{invoke});
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><RunHistoryPanel history={createNativeRunHistory(invoke)} projectId="A" onContinue={vi.fn()} /></I18nProvider>);
 fireEvent.click(await screen.findByRole("button",{name:/Saved task/}));
 await screen.findByText(/external effects 2, legacy uncertainties 1/);
 expect(screen.getByRole("heading",{name:"Saved task state"})).toBeTruthy();
 expect(screen.getByRole("heading",{name:"Current host recovery observation"})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Refresh"}));
 fireEvent.click(await screen.findByRole("button",{name:/Saved task/}));
 await screen.findByText(/external effects 2, legacy uncertainties 1/);
 expect(invoke.mock.calls.filter(([c])=>c==="read_native_recovery_status")).toHaveLength(2);
 expect(invoke.mock.calls.every(([c])=>["list_native_run_history","snapshot_native_run_store","read_native_recovery_status"].includes(c))).toBe(true);
});
