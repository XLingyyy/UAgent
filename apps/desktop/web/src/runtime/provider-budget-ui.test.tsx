import {localizeText,getLocale} from "../i18n";
const uiText=(source:string)=>localizeText(getLocale(),source);
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {DEEPSEEK_CAMPAIGN} from "@uagent/runtime";
import {ProviderBudgetPanel} from "../settings/pages/ProviderBudgetPanel";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const record={campaign:DEEPSEEK_CAMPAIGN,limitMicros:10000000,reservedMicros:3000000,requests:2,uncertainRequests:1,inputTokens:10,outputTokens:20};
describe("cumulative native budget UI",()=>{
 it("reads retained balance without automatically initializing or reserving",async()=>{const invoke=vi.fn(async()=>record);vi.stubGlobal("__TAURI_INTERNALS__",{invoke});render(<ProviderBudgetPanel/>);expect(await screen.findByText(uiText("CNY 7.000000"))).toBeTruthy();expect(invoke.mock.calls).toHaveLength(1);expect(invoke).toHaveBeenCalledWith("read_provider_budget");});
 it("initializes only on explicit click and reopens the existing amount",async()=>{const invoke=vi.fn(async()=>record);vi.stubGlobal("__TAURI_INTERNALS__",{invoke});render(<ProviderBudgetPanel/>);await screen.findByText(uiText("CNY 7.000000"));fireEvent.click(screen.getByText(uiText("Initialize or reopen fixed budget")));await waitFor(()=>expect(invoke).toHaveBeenCalledWith("initialize_provider_budget"));expect(screen.queryByText(uiText("CNY 10.000000"))).toBeNull();});
 it("shows unavailable or corrupt native storage without inventing a fresh balance",async()=>{vi.stubGlobal("__TAURI_INTERNALS__",{invoke:vi.fn(async()=>{throw Error("corrupt");})});render(<ProviderBudgetPanel/>);expect(await screen.findByRole("alert")).toBeTruthy();expect(screen.queryByText(uiText("CNY 10.000000"))).toBeNull();});
});
