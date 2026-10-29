import type {NativeInvoke} from "./project-native-adapter";
export function createNativePolicyFetcher(invoke:NativeInvoke|null,fetcher:typeof fetch=globalThis.fetch):typeof fetch{
 return async(input,init)=>{
  if(!invoke)throw Error("native_endpoint_policy_unavailable");
  const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  const parsed=new URL(url);
  const result=await invoke<{canonicalBaseUrl:string;transportSupported:boolean}>("check_native_provider_endpoint",{input:{wireApi:"chat_completions",baseUrl:parsed.origin}});
  if(!result.transportSupported||url!==result.canonicalBaseUrl.replace(/\/$/,"")+"/chat/completions")throw Error("native_endpoint_policy_rejected");
  if(init?.signal?.aborted||(input instanceof Request&&input.signal.aborted))throw new DOMException("Request cancelled","AbortError");
  return fetcher(input,init);
 };
}
