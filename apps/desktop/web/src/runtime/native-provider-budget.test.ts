import {describe,expect,it,vi} from "vitest";
import {createNativeProviderBudget} from "./native-provider-budget";
const state={campaign:"uagent-flash-validation-20261026",limitMicros:10_000_000,reservedMicros:2000,requests:1,inputTokens:0,outputTokens:0,uncertainRequests:1};
describe("native budget bridge",()=>{
 it("reads without implicitly initializing and binds usage to native reservation id",async()=>{
  const id="1234567890abcdef1234567890abcdef";
  const invoke=vi.fn(async(command:string)=>command==="read_provider_budget"?state:command==="reserve_provider_budget"?id:null);
  const {store}=createNativeProviderBudget(invoke);expect(await store.read()).toEqual(state);const reservation=await store.reserve(10);await store.recordUsage({inputTokens:2,outputTokens:3,totalTokens:5},reservation as string);
  expect(invoke.mock.calls.some(call=>call[0]==="initialize_provider_budget")).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("record_provider_usage",{input:{reservationId:id,inputTokens:2,outputTokens:3}});
 });
 it("does not reset a corrupt or missing ledger",async()=>{
  const invoke=vi.fn(async()=>({...state,limitMicros:20_000_000}));const {store}=createNativeProviderBudget(invoke);await expect(store.read()).rejects.toThrow("invalid");expect(invoke).toHaveBeenCalledTimes(1);
 });
 it("refuses usage with no reservation and accepts no arbitrary path arguments",async()=>{
  const invoke=vi.fn(async()=>state);const bridge=createNativeProviderBudget(invoke);await expect(bridge.store.recordUsage({inputTokens:1,outputTokens:2,totalTokens:3})).rejects.toThrow("required");expect(invoke).not.toHaveBeenCalled();await bridge.initialize();expect(invoke).toHaveBeenCalledWith("initialize_provider_budget");
 });
});
