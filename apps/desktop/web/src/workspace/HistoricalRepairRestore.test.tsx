import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {HistoricalRepairRestore} from "./HistoricalRepairRestore";
afterEach(cleanup);
const value={selection:{projectId:"p",runId:"r",preparedId:"prepared"},sessionId:"session",preview:{nativePlanDigest:"a".repeat(64),preview:{binding:{projectId:"p",hostSessionId:"session"},files:[{path:"Source/A.cpp",before:"changed",after:"original"}]}}};
function mount(invoke:any){return render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><HistoricalRepairRestore projectId="p" runId="r" backupSha256={"b".repeat(64)} invoke={invoke}/></I18nProvider>);}
it("reviews a fresh native reverse diff and consumes one explicit restore attempt",async()=>{
 const invoke=vi.fn(async(command:string)=>command==="prepare_historical_ue_restore"?value:{persisted:true,hostSettled:true,restoration:true,receipt:{binding:value.preview.preview.binding,status:"applied",effects:[{path:"Source/A.cpp",status:"applied"}]}});mount(invoke);
 fireEvent.click(screen.getByText("Check recovery eligibility and prepare diff"));const apply=await screen.findByText("Request native approval and restore once");expect((apply as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText("I reviewed every restoration diff"));fireEvent.click(apply);await screen.findByText("Source/A.cpp: applied");expect(invoke.mock.calls.filter(([c])=>c==="approve_and_apply_ue_build_repair")).toHaveLength(1);expect((apply as HTMLButtonElement).disabled).toBe(true);
});
it("does not offer writes when native process proof is unavailable",async()=>{const invoke=vi.fn().mockRejectedValue(new Error("original alive"));mount(invoke);fireEvent.click(screen.getByText("Check recovery eligibility and prepare diff"));await screen.findByRole("alert");expect(screen.queryByText("Request native approval and restore once")).toBeNull();expect(invoke).toHaveBeenCalledTimes(1);});
it("releases a late prepared session after navigation without applying",async()=>{let resolve!:(v:unknown)=>void;const invoke=vi.fn((command:string)=>command==="prepare_historical_ue_restore"?new Promise(r=>{resolve=r;}):Promise.resolve(true));const view=mount(invoke);fireEvent.click(screen.getByText("Check recovery eligibility and prepare diff"));view.unmount();resolve(value);await waitFor(()=>expect(invoke).toHaveBeenCalledWith("release_ue_build_repair",{input:{selection:value.selection,sessionId:"session"}}));expect(invoke.mock.calls.some(([c])=>c==="approve_and_apply_ue_build_repair")).toBe(false);});
