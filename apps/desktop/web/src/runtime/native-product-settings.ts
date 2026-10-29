import type {ProviderConfig,ProviderVersion} from "../types/provider";
import type {Locale} from "../i18n/core";
import {defaultLocaleStore} from "../i18n/locale-store";
import {localNativeInvoke} from "./native-provider-budget";
import type {NativeInvoke} from "./project-native-adapter";

export interface ProductPreferences {theme:"dark"|"light";locale:Locale;activeProjectId:string|null;selectedProviderId:string|null;defaultProviderId:string|null}
export interface VersionedPreferences {revision:number;preferences:ProductPreferences}
export interface SavedProjectPreferences {projectId:string;revision:number;preferences:{providerId:string|null;modelId:string|null;reasoningEffort:"low"|"medium"|"high"|"xhigh"|null};requiresFreshProjectTrust:true}
export interface ProductProviderSnapshot {generation:string;revision:number;config:ProviderConfig;connectionVerified:false;requiresNewSession:true;transportSupported:boolean}
export interface ProductProject {id:string;root:string;label:string;createdAt:number}
export interface ProductSettingsSnapshot {preferences:VersionedPreferences;providers:ProductProviderSnapshot[];projects:ProductProject[];projectPreferences:SavedProjectPreferences[]}
const version=(p:ProductProviderSnapshot):ProviderVersion=>({providerId:p.config.providerId,generation:p.generation,revision:p.revision,exists:true});
export const safeProviderProjection=(p:ProviderConfig)=>({
 providerId:p.providerId,displayName:p.displayName,baseUrl:p.baseUrl,wireApi:p.wireApi,authMode:p.authMode,
 models:p.models.map(m=>({id:m.id,label:m.label,contextWindow:m.contextWindow,supportsReasoning:m.supportsReasoning,reasoningEfforts:m.reasoningEfforts??null,capabilityDeclarations:{text:m.capabilityDeclarations?.text??"unknown",tools:m.capabilityDeclarations?.tools??"unknown",streaming:m.capabilityDeclarations?.streaming??"unknown"},requestDefaults:{temperature:m.requestDefaults?.temperature??null,maxOutputTokens:m.requestDefaults?.maxOutputTokens??null}})),
 defaultModel:p.defaultModel??null,defaultReasoningEffort:p.defaultReasoningEffort??null,enabled:p.enabled,
});
export const restoredProvider=(p:ProviderConfig):ProviderConfig=>({...safeProviderProjection(p),defaultModel:p.defaultModel??undefined,defaultReasoningEffort:p.defaultReasoningEffort??undefined,models:p.models.map(m=>({...m,reasoningEfforts:m.reasoningEfforts??undefined})),networkMode:"disabled"});
export function createNativeProductSettings(invoke:NativeInvoke|null){
 let bootstrap:ProductSettingsSnapshot|null=null,preferences:VersionedPreferences|null=null,blocked=false;
 let state={error:null as "conflict"|"unavailable"|"invalid"|null,busy:false};
 let tail:Promise<unknown>=Promise.resolve();
 const listeners=new Set<()=>void>(),tokens=new Map<string,ProviderVersion>(),projectPrefs=new Map<string,SavedProjectPreferences>();
 const emit=()=>listeners.forEach(fn=>fn());
 function adopt(s:ProductSettingsSnapshot){
  if(!s||!Number.isSafeInteger(s.preferences?.revision)||!Array.isArray(s.providers)||!Array.isArray(s.projects)||!Array.isArray(s.projectPreferences))throw Error("invalid_native_settings");
  preferences=s.preferences;for(const p of s.providers)tokens.set(p.config.providerId,version(p));
  projectPrefs.clear();for(const p of s.projectPreferences)projectPrefs.set(p.projectId,p);
 }
 function enqueue<T>(action:()=>Promise<T>):Promise<T>{
  const work=tail.then(async()=>{if(blocked)throw Error("settings_reload_required");state={...state,busy:true};emit();try{const result=await action();state={error:null,busy:false};emit();return result;}catch(error){
   const kind=(error&&typeof error==="object"&&"kind" in error)?String(error.kind):"";
   const invalid=kind==="invalidSettings"||kind==="invalidInput"||kind==="policy"||kind==="endpointPolicy";
   if(!invalid)blocked=true;state={error:kind==="conflict"?"conflict":invalid?"invalid":"unavailable",busy:false};emit();throw Error(state.error??"unavailable");
  }});
  tail=work.catch(()=>undefined);return work;
 }
 const api={
  enabled:()=>invoke!==null&&bootstrap!==null,getBootstrap:()=>bootstrap,getStatus:()=>state,
  subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  async initialize(locale:Locale){
   if(!invoke)return;const s=await invoke<ProductSettingsSnapshot>("initialize_product_settings",{input:{legacyLocale:locale}});adopt(s);bootstrap=s;
  },
  providerVersions:()=>Object.fromEntries(tokens),
  async captureVersion(id:string){if(!invoke||!bootstrap)return undefined;const token=await invoke<ProviderVersion>("get_product_provider_version",{input:{providerId:id}});tokens.set(id,token);return {...token};},
  saveProvider(config:ProviderConfig,expected:ProviderVersion){
   return enqueue(async()=>{if(!invoke||!bootstrap)throw Error("settings_unavailable");
    const saved=await invoke<ProductProviderSnapshot>("save_product_provider",{input:{version:expected,config:safeProviderProjection(config)}});tokens.set(config.providerId,version(saved));adopt(await invoke<ProductSettingsSnapshot>("read_product_settings"));return saved;});
  },
  deleteProvider(expected:ProviderVersion){return enqueue(async()=>{if(!invoke)throw Error("settings_unavailable");const token=await invoke<ProviderVersion>("delete_product_provider",{input:{version:expected}});
   tokens.set(token.providerId,token);const fresh=await invoke<ProductSettingsSnapshot>("read_product_settings");adopt(fresh);return token;});},
  savePreferences(patch:Partial<ProductPreferences>){return enqueue(async()=>{if(!invoke||!preferences)throw Error("settings_unavailable");
   preferences=await invoke<VersionedPreferences>("save_product_preferences",{input:{expectedRevision:preferences.revision,preferences:{...preferences.preferences,...patch}}});return preferences;});},
  async registerProject(rootRef:string){if(!invoke||!bootstrap)return null;return await invoke<ProductProject>("register_product_project",{input:{rootRef}});},
  projectPreferences:(id:string)=>projectPrefs.get(id)??null,
  saveProjectPreferences(projectId:string,selection:SavedProjectPreferences["preferences"]){return enqueue(async()=>{if(!invoke)throw Error("settings_unavailable");
   const saved=await invoke<SavedProjectPreferences>("save_product_project_preferences",{input:{projectId,expectedRevision:projectPrefs.get(projectId)?.revision??0,preferences:selection}});projectPrefs.set(projectId,saved);return saved;});},
  whenIdle:async()=>{await tail;},
 };
 return api;
}
export const nativeProductSettings=createNativeProductSettings(localNativeInvoke());
export async function initializeNativeProductSettings(){
 const previous=defaultLocaleStore.getSnapshot();
 await nativeProductSettings.initialize(previous);
 const snapshot=nativeProductSettings.getBootstrap();
 if(snapshot){
  defaultLocaleStore.disablePersistence();
  defaultLocaleStore.setLocale(snapshot.preferences.preferences.locale);
  let locale=defaultLocaleStore.getSnapshot();
  defaultLocaleStore.subscribe(()=>{const next=defaultLocaleStore.getSnapshot();if(next!==locale){locale=next;void nativeProductSettings.savePreferences({locale:next}).catch(()=>undefined);}});
 }
}
