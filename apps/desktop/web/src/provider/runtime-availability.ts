import type {ProviderConfig} from "../types/provider";
import {DEEPSEEK_MODEL} from "@uagent/runtime";

/** Match the transport actually shipped in this build. Configuration is not connectivity. */
export function supportsProviderModel(provider:ProviderConfig|undefined|null,modelId:string|undefined):boolean {
  if(!provider||!provider.enabled||provider.providerId!=="deepseek"||modelId!==DEEPSEEK_MODEL||provider.authMode!=="env_key"||!["openai_compatible","chat_completions"].includes(provider.wireApi))return false;
  return ["https://api.deepseek.com","https://api.deepseek.com/"].includes(provider.baseUrl);
}
export function createSupportedProvider():ProviderConfig {
  return {providerId:"deepseek",displayName:"DeepSeek",baseUrl:"https://api.deepseek.com",wireApi:"openai_compatible",authMode:"env_key",networkMode:"live",enabled:true,models:[{id:DEEPSEEK_MODEL,label:"DeepSeek Flash",contextWindow:1000000,supportsReasoning:false}],defaultModel:DEEPSEEK_MODEL};
}
