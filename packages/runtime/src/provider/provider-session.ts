import {createResponsesSession} from "./responses/session.js";
import {
  createResponsesRuntimeSession,
  type ResponsesRuntimeSessionOptions,
} from "./responses/runtime-session.js";
/** Explicit wire contract selection. Unsupported protocols never fall back to another model/API. */
export function createProviderRuntimeSession(options: Omit<ResponsesRuntimeSessionOptions,"wireApi"> & {wireApi:"responses"|"anthropic"}) {
  if(options.wireApi==="anthropic") {
    const owner={...options.owner},current=options.isCurrent,context=options.getProjectContext;
    if(owner.providerId!==options.providerId||owner.modelId!==options.modelId||typeof current!=="function"||typeof context!=="function")throw Error("anthropic_owner_invalid");
    return createResponsesSession({...options,protocol:"anthropic",disableNativeReplay:true,getProjectContext:()=>{
      if(!current())throw Error("anthropic_owner_revoked");
      const value=context();
      if(!current()||value.projectId!==owner.projectId||value.epoch!==owner.projectEpoch)throw Error("anthropic_owner_changed");
      return value;
    }});
  }
  if (options.wireApi !== "responses") throw new Error("unsupported_runtime_provider_protocol");
  return createResponsesRuntimeSession({...options,wireApi:"responses"});
}
export type { ResponsesRuntimeSessionOptions };
