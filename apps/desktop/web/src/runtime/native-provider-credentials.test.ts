// @vitest-environment node
import {describe,it,expect,vi} from "vitest";
import {createNativeProviderCredentials,SAVED_CREDENTIAL_MASK} from "./native-provider-credentials";
import type {NativeInvoke} from "./project-native-adapter";
const providerVersion={providerId:"deepseek",generation:"generation-a",revision:1,exists:true};
const missing=()=>({saved:false,version:null,mask:null,providerVersion:{...providerVersion}});
const saved=()=>({saved:true,version:"synthetic-vault-version-a",mask:"native mask is never retained",providerVersion:{...providerVersion}});
describe("native credential metadata client",()=>{
 it("only projects receipt metadata and uses a fixed public mask",async()=>{
  const invoke=vi.fn(async()=>({...saved(),extraSecret:"must-not-be-retained"}));
  const client=createNativeProviderCredentials(invoke as NativeInvoke);
  const result=await client.get("deepseek");
  expect(result).toEqual({...saved(),mask:SAVED_CREDENTIAL_MASK});
  expect(Object.keys(result)).toEqual(["saved","version","mask","providerVersion"]);
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.providerVersion)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("must-not-be-retained");
 });
 it("binds save to the captured provider and credential versions",async()=>{
  const invoke=vi.fn(async()=>saved()),changed=vi.fn();
  const client=createNativeProviderCredentials(invoke as NativeInvoke);client.subscribe(changed);
  const result=await client.save("deepseek",missing(),"synthetic-new-key-only");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("save_provider_credential",{input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:null,credential:"synthetic-new-key-only"}});
  expect(result.mask).toBe(SAVED_CREDENTIAL_MASK);
  expect(changed).toHaveBeenCalledWith("deepseek");expect(changed.mock.calls[0]).toHaveLength(1);
 });
 it("rejects invalid key boundaries without invoking native",async()=>{
  const invoke=vi.fn(async()=>saved()),client=createNativeProviderCredentials(invoke as NativeInvoke);
  for(const key of ["short","********",SAVED_CREDENTIAL_MASK,"a".repeat(2049),"with spaces here","unicode-\u5bc6\u94a5","line\nbreak-123"])
   await expect(client.save("deepseek",missing(),key)).rejects.toMatchObject({kind:"invalid"});
  expect(invoke).not.toHaveBeenCalled();
 });
 it("does not automatically retry conflicts or leak native diagnostics",async()=>{
  const key="synthetic-secret-never-in-error";
  const invoke=vi.fn(async()=>{throw {kind:"credential_conflict",detail:key};});
  const client=createNativeProviderCredentials(invoke as NativeInvoke);
  try { await client.save("deepseek",saved(),key);throw Error("Expected failure"); }
  catch(error){expect(error).toMatchObject({kind:"conflict",message:"provider_credential_conflict"});expect(String(error)).not.toContain(key);}
  expect(invoke).toHaveBeenCalledTimes(1);
 });
 it("does not confirm a save receipt which says no key was saved",async()=>{
  const invoke=vi.fn(async()=>missing()),notify=vi.fn();
  const client=createNativeProviderCredentials(invoke as NativeInvoke);client.subscribe(notify);
  await expect(client.save("deepseek",missing(),"synthetic-valid-key")).rejects.toMatchObject({kind:"invalid"});
  expect(notify).not.toHaveBeenCalled();
 });
 it("does not confirm deletion when the receipt still contains a key",async()=>{
  const invoke=vi.fn(async()=>saved()),client=createNativeProviderCredentials(invoke as NativeInvoke);
  await expect(client.remove("deepseek",saved())).rejects.toMatchObject({kind:"invalid"});
 });
 it("deletes only a captured saved version and emits no key",async()=>{
  const invoke=vi.fn(async()=>missing()),client=createNativeProviderCredentials(invoke as NativeInvoke);
  await expect(client.remove("deepseek",saved())).resolves.toMatchObject({saved:false,version:null,mask:null});
  expect(invoke).toHaveBeenCalledWith("delete_provider_credential",{input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"synthetic-vault-version-a"}});
  await expect(client.remove("deepseek",missing())).rejects.toMatchObject({kind:"invalid"});
  expect(invoke).toHaveBeenCalledTimes(1);
 });
 it("rejects mismatched provider receipts and non-integral revisions",async()=>{
  for(const value of [{...saved(),providerVersion:{...providerVersion,providerId:"other"}},{...saved(),providerVersion:{...providerVersion,revision:NaN}}]){
   const client=createNativeProviderCredentials(vi.fn(async()=>value) as NativeInvoke);
   await expect(client.get("deepseek")).rejects.toMatchObject({kind:"invalid"});
  }
 });
 it("missing native stays unavailable and never uses web storage",async()=>{
  const client=createNativeProviderCredentials(null);
  expect(client.available()).toBe(false);
  await expect(client.get("deepseek")).rejects.toMatchObject({kind:"unavailable"});
 });
 it("keeps cleanup pending disabled and distinguishes it from full deletion",async()=>{
  const pending={...missing(),cleanupPending:true};
  const client=createNativeProviderCredentials(vi.fn(async()=>pending) as NativeInvoke);
  await expect(client.get("deepseek")).resolves.toMatchObject({saved:false,version:null,cleanupPending:true});
  await expect(client.remove("deepseek",saved())).rejects.toMatchObject({kind:"cleanup_pending"});
 });
 it("preserves a deleted tombstone version as the next explicit save CAS token",async()=>{
  const tombstone={...missing(),version:"synthetic-deleted-version"};
  const invoke=vi.fn(async(command:string)=>command==="get_saved_provider_credential"?tombstone:saved());
  const client=createNativeProviderCredentials(invoke as NativeInvoke),captured=await client.get("deepseek");
  expect(captured).toMatchObject({saved:false,version:"synthetic-deleted-version",mask:null});
  await client.save("deepseek",captured,"synthetic-new-valid-key");
  expect(invoke).toHaveBeenLastCalledWith("save_provider_credential",{input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"synthetic-deleted-version",credential:"synthetic-new-valid-key"}});
 });
 it("uses only a paired native protocol and official endpoint route",async()=>{
  const client=createNativeProviderCredentials(vi.fn(async()=>({...saved(),wireApi:"responses",endpoint:"https://api.openai.com/v1/responses"})) as NativeInvoke);
  await expect(client.get("deepseek")).resolves.toMatchObject({wireApi:"responses",endpoint:"https://api.openai.com/v1/responses"});
  for(const extra of [{wireApi:"responses"},{wireApi:"responses",endpoint:"https://example.invalid/responses"},{wireApi:"chat_completions",endpoint:"https://api.openai.com/v1/responses"}]){
   const rejected=createNativeProviderCredentials(vi.fn(async()=>({...saved(),...extra})) as NativeInvoke);
   await expect(rejected.get("deepseek")).rejects.toMatchObject({kind:"invalid"});
  }
 });
 it.each(["missing","corrupt","unavailable"] as const)("preserves disabled %s recovery metadata without treating it as a usable key",async recovery=>{
  const value={...missing(),version:"healthy-metadata-token",recovery};
  const invoke=vi.fn(async()=>value),client=createNativeProviderCredentials(invoke as NativeInvoke);
  const result=await client.get("deepseek");
  expect(result).toMatchObject({saved:false,version:"healthy-metadata-token",mask:null,recovery});
  expect(invoke).toHaveBeenCalledTimes(1);expect(Object.isFrozen(result)).toBe(true);
 });
 it("rejects usable-key and malformed recovery combinations",async()=>{
  for(const value of [{...saved(),recovery:"missing"},{...missing(),recovery:"missing"},{...missing(),version:"token",recovery:"unknown"},{...missing(),version:"token",recovery:"corrupt",cleanupPending:true},{...missing(),version:"token",recovery:"missing",mask:SAVED_CREDENTIAL_MASK}]){
   const client=createNativeProviderCredentials(vi.fn(async()=>value) as NativeInvoke);
   await expect(client.get("deepseek")).rejects.toMatchObject({kind:"invalid"});
  }
 });
 it.each(["missing","corrupt","unavailable"] as const)("removes %s recovery only with its captured metadata token",async recovery=>{
  const invoke=vi.fn(async()=>({...missing(),version:"disabled-tombstone"})),client=createNativeProviderCredentials(invoke as NativeInvoke);
  const expected={...missing(),version:"active-metadata-token",recovery};
  await expect(client.remove("deepseek",expected)).resolves.toMatchObject({saved:false,version:"disabled-tombstone"});
  expect(invoke).toHaveBeenCalledWith("delete_provider_credential",{input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"active-metadata-token"}});
 });
 it("does not confirm removal while native still reports an active recovery record",async()=>{
  const invoke=vi.fn(async()=>({...missing(),version:"still-active-metadata-token",recovery:"missing"})),client=createNativeProviderCredentials(invoke as NativeInvoke);
  await expect(client.remove("deepseek",{...missing(),version:"old-active-token",recovery:"missing"})).rejects.toMatchObject({kind:"invalid"});
 });
 it("ordinary absent/tombstone records cannot be removed by the recovery route",async()=>{
  const invoke=vi.fn(async()=>missing()),client=createNativeProviderCredentials(invoke as NativeInvoke);
  await expect(client.remove("deepseek",{...missing(),version:"ordinary-tombstone"})).rejects.toMatchObject({kind:"invalid"});
  expect(invoke).not.toHaveBeenCalled();
 });
 it("explicit recovery replacement uses the old token once and never refreshes or retries a conflict",async()=>{
  const invoke=vi.fn(async()=>{throw {kind:"credential_conflict",detail:"private diagnostic"};}),client=createNativeProviderCredentials(invoke as NativeInvoke);
  await expect(client.save("deepseek",{...missing(),version:"old-active-token",recovery:"missing"},"synthetic-replacement-key")).rejects.toMatchObject({kind:"conflict"});
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("save_provider_credential",{input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"old-active-token",credential:"synthetic-replacement-key"}});
 });
 it("observer failure cannot turn a confirmed native save into a failure",async()=>{
  const client=createNativeProviderCredentials(vi.fn(async()=>saved()) as NativeInvoke);
  client.subscribe(()=>{throw Error("Synthetic observer");});
  await expect(client.save("deepseek",missing(),"synthetic-valid-key")).resolves.toMatchObject({saved:true});
 });
});
