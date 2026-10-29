import { DEEPSEEK_BUDGET_MICROS, DEEPSEEK_CAMPAIGN, type DeepSeekBudgetRecord, type DeepSeekBudgetStore } from "@uagent/runtime";
import type { NativeInvoke } from "./project-native-adapter";

function record(value: unknown): DeepSeekBudgetRecord {
  const v=value as DeepSeekBudgetRecord;
  if(!v || v.campaign!==DEEPSEEK_CAMPAIGN || v.limitMicros!==DEEPSEEK_BUDGET_MICROS ||
    ![v.reservedMicros,v.requests,v.inputTokens,v.outputTokens,v.uncertainRequests].every(n=>Number.isSafeInteger(n)&&n>=0) ||
    v.reservedMicros>v.limitMicros || v.requests>100 || v.uncertainRequests>v.requests) throw Error("native_budget_invalid");
  return {campaign:v.campaign,limitMicros:v.limitMicros,reservedMicros:v.reservedMicros,requests:v.requests,inputTokens:v.inputTokens,outputTokens:v.outputTokens,uncertainRequests:v.uncertainRequests};
}
export function createNativeProviderBudget(invoke: (command:string,payload?:unknown)=>Promise<unknown>) {
  const store: DeepSeekBudgetStore = {
    durable:true,
    async read(){ return record(await invoke("read_provider_budget")); },
    async reserve(maximumMicros){
      const id=await invoke("reserve_provider_budget",{input:{maximumMicros}});
      if(typeof id!=="string" || !/^[a-f0-9]{32}$/.test(id)) throw Error("native_reservation_invalid");
      return id;
    },
    async recordUsage(usage,reservationId){
      if(!reservationId || !/^[a-f0-9]{32}$/.test(reservationId) || usage.totalTokens!==usage.inputTokens+usage.outputTokens) throw Error("native_reservation_required");
      await invoke("record_provider_usage",{input:{reservationId,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens}});
    },
  };
  return {store, async initialize(){return record(await invoke("initialize_provider_budget"));}};
}
export function localNativeInvoke(): NativeInvoke | null {
  const host=globalThis as typeof globalThis & {__TAURI_INTERNALS__?:{invoke?:NativeInvoke}};
  const invoke=host.__TAURI_INTERNALS__?.invoke;
  return typeof invoke==="function" ? invoke.bind(host.__TAURI_INTERNALS__) : null;
}
