import {createComposerModelOptions} from "../composer/composer-data";
import {it,expect,vi} from "vitest";
import {createAnthropicProvider,createResponsesProvider,createSupportedProvider,supportsProviderModel,activeApiProvider} from "./runtime-availability";
import {createNativeResponsesProfile} from "../runtime/native-responses-session";
it("archived Claude cannot be selected or open native profile; no IPC",async()=>{
 const p=createAnthropicProvider();p.models=[{id:"claude-synthetic",label:"Synthetic",contextWindow:1000,supportsReasoning:false}];
 expect(supportsProviderModel(p,"claude-synthetic")).toBe(false);
 const invoke=vi.fn();await expect(createNativeResponsesProfile({wireApi:"anthropic",invoke} as never)).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();
});

it("Responses and arbitrary APIs are archived; DeepSeek remains selectable",async()=>{
 const p=createResponsesProvider();p.models=[{id:"gpt-synthetic",label:"Synthetic",contextWindow:1000,supportsReasoning:false}];
 expect(supportsProviderModel(p,"gpt-synthetic")).toBe(false);expect(createComposerModelOptions([p]).find(o=>o.modelId==="gpt-synthetic")?.enabled).toBe(false);expect(activeApiProvider({...createSupportedProvider(),providerId:"custom"})).toBe(false);
 const d=createSupportedProvider();expect(supportsProviderModel(d,d.defaultModel)).toBe(true);
 const invoke=vi.fn();await expect(createNativeResponsesProfile({wireApi:"responses",invoke} as never)).rejects.toThrow("provider_api_archived");expect(invoke).not.toHaveBeenCalled();
});
