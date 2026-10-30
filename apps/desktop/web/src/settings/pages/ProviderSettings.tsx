import {nativeProductSettings} from "../../runtime/native-product-settings";
import type {ProviderVersion} from "../../types/provider";
import {useEffect,useState} from "react";
import {useI18n} from "../../i18n";
import {useProviderActions,useProviderStore} from "../../stores/ui-store";
import {createSupportedProvider,createResponsesProvider,supportsProviderModel} from "../../provider/runtime-availability";
import type {ProviderConfig,ProviderWireApi} from "../../types/provider";
import { OPENAI_MODEL_DOCS } from "../../runtime/responses-failure-hints";
import {SettingsPageLayout} from "../SettingsPageLayout";
import {providerPageData} from "../settings-page-data";
import {ProviderSessionSetup} from "./ProviderSessionSetup";
import "../pages/SettingsPages.css";

function validEndpoint(value:string){try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}}
const clone=(provider:ProviderConfig):ProviderConfig=>({...provider,models:provider.models.map(m=>({...m}))});
export function ProviderSettings(){
 const {t,text,locale}=useI18n();const {providers,selectedProviderId,defaultProviderId,providerVersions}=useProviderStore(s=>s);
 const {setSelectedProvider,saveProvider,deleteProvider,setDefaultProvider,reviewExistingProvider}=useProviderActions();
 const [busy,setBusy]=useState(false);
 const [capturedVersion,setCapturedVersion]=useState<ProviderVersion|undefined>();
 const [creationConflict,setCreationConflict]=useState<"loaded"|"unavailable"|null>(null);
 const contextLabel=locale==="zh-CN"?"上下文长度（token）":"Context window (tokens)";
 const selected=providers.find(p=>p.providerId===selectedProviderId)??null;
 const [draft,setDraft]=useState<ProviderConfig|null>(null),[editing,setEditing]=useState(false),[makeDefault,setMakeDefault]=useState(false),[error,setError]=useState(false);
 useEffect(()=>{if(!editing){setDraft(selected?clone(selected):null);setMakeDefault(selected?.providerId===defaultProviderId);}},[selected,defaultProviderId,editing]);
 function change(patch:Partial<ProviderConfig>){setDraft(v=>v?{...v,...patch}:v);setError(false);}
 async function beginCreate(next:ProviderConfig){
  if(busy)return;setBusy(true);setError(false);setCreationConflict(null);
  try{
   const token=await nativeProductSettings.captureVersion(next.providerId);
   if(token?.exists){
    // The token belongs to an unseen existing record, so it cannot authorize this template.
    setCapturedVersion(undefined);setDraft(null);setEditing(false);setCreationConflict("unavailable");
    await reviewExistingProvider(next.providerId);setCreationConflict("loaded");return;
   }
   setCapturedVersion(token);setDraft(next);setMakeDefault(providers.length===0);setEditing(true);
  }catch{setError(true);}finally{setBusy(false);}
 }
 async function add(){const next=createSupportedProvider();next.providerId=crypto.randomUUID();next.displayName="";next.baseUrl="";next.models=[];next.defaultModel=undefined;await beginCreate(next);}
 async function save(){if(!draft||busy)return;setBusy(true);const clean={...draft,displayName:draft.displayName.trim(),baseUrl:draft.baseUrl.trim(),models:draft.models.map(m=>({...m,id:m.id.trim(),label:m.label.trim()||m.id.trim()}))};
  try{if(!clean.displayName||!validEndpoint(clean.baseUrl)||!clean.models.length||clean.models.some(m=>!m.id||!Number.isSafeInteger(m.contextWindow)||m.contextWindow<1||m.contextWindow>100000000)||!clean.models.some(m=>m.id===clean.defaultModel))throw Error("invalid");await saveProvider(clean,capturedVersion);await setDefaultProvider(makeDefault?clean.providerId:defaultProviderId===clean.providerId?null:defaultProviderId);setEditing(false);setError(false);}catch{setError(true);}finally{setBusy(false);}}
 const currentModel=selected?.models.find(m=>m.id===selected.defaultModel)??selected?.models[0];
 return <SettingsPageLayout page={providerPageData}>
  {creationConflict&&<p role="alert">{locale==="zh-CN"?(creationConflict==="loaded"?"该服务商已由另一个窗口创建。已显示当前配置；请点击“编辑服务商”后再修改。":"该服务商已存在，暂时无法读取当前配置。请重新加载后查看。"):(creationConflict==="loaded"?"This provider already exists. Its current configuration is shown. Choose Edit provider to make changes.":"This provider already exists, but its current configuration could not be read. Reload to review it.")}</p>}
  {error&&!editing&&!creationConflict&&<p role="alert">{t("product.configError")}</p>}
  <section className="ua-settings-section" aria-labelledby="providers-heading">
   <div className="ua-product-provider-header"><div><h3 id="providers-heading">{t("product.providers")}</h3><p>{t("product.providersHelp")}</p></div><button type="button" className="ua-btn ua-btn--primary" disabled={busy} onClick={()=>void add()}>{t("product.addProvider")}</button></div>
   <div className="ua-settings-page__provider-list">
    {providers.length===0&&<div className="ua-product-empty"><strong>{t("product.noProviders")}</strong><p>{t("product.noProvidersHelp")}</p></div>}
    {providers.map(p=><button key={p.providerId} type="button" className={`ua-settings-page__provider-card${p.providerId===selectedProviderId?" ua-settings-page__provider-card--active":""}`} disabled={editing||busy} onClick={()=>setSelectedProvider(p.providerId)}><span className="ua-settings-page__provider-card-main"><strong>{p.displayName}</strong><small>{p.baseUrl}</small></span><span className="ua-settings-page__provider-card-badges">{defaultProviderId===p.providerId&&<span className="ua-settings-page__provider-card-badge">{text("Default")}</span>}<span>{!p.enabled?t("product.disabled"):supportsProviderModel(p,p.defaultModel)?t("product.runtimeSupported"):t("product.configurationOnly")}</span></span></button>)}
   </div>
  </section>
  {editing&&draft?<section className="ua-settings-section" aria-label={t("product.editProvider")}>
   <div className="ua-settings-section__header"><h3>{t("product.editProvider")}</h3></div><fieldset className="ua-settings-page__provider-form" disabled={busy} style={{border:0,minWidth:0}}>
    {!providers.some(p=>p.providerId===draft.providerId)&&<label className="ua-settings-page__field"><span>{t("product.providerTemplate")}</span><select className="ua-settings-page__select" aria-label={t("product.providerTemplate")} value={draft.providerId==="deepseek"?"deepseek":draft.wireApi==="responses"&&draft.baseUrl==="https://api.openai.com/v1"?"responses":"custom"} onChange={e=>{const next=e.target.value==="deepseek"?createSupportedProvider():e.target.value==="responses"?createResponsesProvider():{...draft,providerId:crypto.randomUUID(),displayName:"",baseUrl:"",wireApi:"openai_compatible" as const,models:[],defaultModel:undefined};void beginCreate(next);}}><option value="custom">{t("product.customConfiguration")}</option><option value="responses">OpenAI · Responses</option><option value="deepseek" disabled={providers.some(p=>p.providerId==="deepseek")}>{t("product.supportedPreset")}</option></select></label>}
    <div className="ua-settings-page__field-grid"><label className="ua-settings-page__field"><span>{text("Display name")}</span><input className="ua-settings-page__input" aria-label={text("Display name")} value={draft.displayName} onChange={e=>change({displayName:e.target.value})}/></label><label className="ua-settings-page__field"><span>{text("Base URL")}</span><input className="ua-settings-page__input" aria-label={text("Base URL")} value={draft.baseUrl} onChange={e=>change({baseUrl:e.target.value})}/></label><label className="ua-settings-page__field"><span>{text("Wire API")}</span><select className="ua-settings-page__select" aria-label={text("Wire API")} value={draft.wireApi} onChange={e=>change({wireApi:e.target.value as ProviderWireApi})}><option value="openai_compatible">OpenAI Compatible</option><option value="responses">Responses</option><option value="chat_completions">Chat Completions</option><option value="anthropic">Anthropic</option></select></label></div>
    {draft.wireApi==="responses"&&<p className="ua-settings-page__action-note">{locale==="zh-CN"?"支持 OpenAI 官方地址 https://api.openai.com/v1。此版要求账号可用的精确模型快照 ID，别名可能不兼容。请在官方模型页的 Snapshots 中核对；不会自动获取或替换模型。当前仅开放普通对话。":"Supports the official OpenAI API root https://api.openai.com/v1. This version requires an exact model snapshot ID available to your account; aliases may be incompatible. Check Snapshots on the official model page. Models are never fetched or substituted automatically. Ordinary chat only."} <a href={OPENAI_MODEL_DOCS} target="_blank" rel="noreferrer">{t("responses.modelDocs")}</a></p>}
    <div className="ua-product-model-editor"><h4>{t("product.models")}</h4>{draft.models.map((m,i)=><div className={`ua-product-model-row${draft.wireApi==="responses"?" ua-product-model-row--responses":""}`} key={i}><label><span>{t("product.modelId")}</span><input aria-label={t("product.modelIdAt",{index:i+1})} value={m.id} onChange={e=>{const models=draft.models.map((v,j)=>j===i?{...v,id:e.target.value}:v);change({models,defaultModel:draft.defaultModel===m.id?e.target.value:draft.defaultModel});}}/></label><label><span>{text("Display name")}</span><input aria-label={t("product.modelNameAt",{index:i+1})} value={m.label} onChange={e=>change({models:draft.models.map((v,j)=>i===j?{...v,label:e.target.value}:v)})}/></label><label><span>{contextLabel}</span><input type="number" min={1} max={100000000} step={1} aria-label={contextLabel+" "+(i+1)} value={m.contextWindow||""} onChange={e=>change({models:draft.models.map((v,j)=>i===j?{...v,contextWindow:e.target.valueAsNumber}:v)})}/></label>{draft.wireApi==="responses"&&<label className="ua-product-model-reasoning"><span>{locale==="zh-CN"?"发送推理档位":"Send reasoning effort"}</span><input type="checkbox" aria-label={(locale==="zh-CN"?"发送推理档位 ":"Send reasoning effort ")+(i+1)} checked={m.supportsReasoning} onChange={e=>change({models:draft.models.map((v,j)=>i===j?{...v,supportsReasoning:e.target.checked,reasoningEfforts:e.target.checked?["low","medium","high","xhigh"]:undefined}:v)})}/></label>}<button type="button" aria-label={t("product.removeModelAt",{index:i+1})} onClick={()=>{const models=draft.models.filter((_,j)=>i!==j);change({models,defaultModel:draft.defaultModel===m.id?models[0]?.id:draft.defaultModel});}}>{text("Remove")}</button></div>)}<button type="button" className="ua-btn" onClick={()=>change({models:[...draft.models,{id:"",label:"",contextWindow:32768,supportsReasoning:false}]})}>{t("product.addModel")}</button></div>
    <p className="ua-settings-page__action-note">{locale==="zh-CN"?"上下文长度是可修改的配置值，并非已验证的模型能力。新模型先填入 32,768 token；请按服务商规格核对。":"Context window is an editable configuration value, not a verified model capability. New models start at 32,768 tokens; check the provider specification."}</p>
    {draft.wireApi==="responses"&&<p className="ua-settings-page__action-note">{locale==="zh-CN"?"仅在模型支持时启用推理档位；档位按服务商文档选择。未配置温度或输出上限时沿用服务端默认值。保存配置和开启会话均不代表连接验证通过。":"Enable reasoning effort only if the model supports it, and select an effort allowed by the provider. Unconfigured temperature and output limits use server defaults. Saving or opening a session does not verify connectivity."}</p>}
    <label className="ua-settings-page__field"><span>{text("Default model")}</span><select className="ua-settings-page__select" aria-label={text("Default model")} value={draft.defaultModel??""} onChange={e=>change({defaultModel:e.target.value})}><option value="" disabled>{t("product.selectModel")}</option>{draft.models.map((m,i)=><option key={i} value={m.id}>{m.label||m.id}</option>)}</select></label>
    <label className="ua-checkline"><input type="checkbox" checked={draft.enabled} onChange={e=>change({enabled:e.target.checked,networkMode:e.target.checked?"live":"disabled"})}/>{t("product.enableConfiguration")}</label><label className="ua-checkline"><input type="checkbox" checked={makeDefault} onChange={e=>setMakeDefault(e.target.checked)}/>{text("Use as default provider")}</label>
    <p className="ua-settings-page__action-note">{t("product.saveHelp")}</p><div className="ua-session-actions"><button type="button" className="ua-session-open" disabled={busy} onClick={()=>void save()}>{text("Save provider")}</button><button type="button" disabled={busy} onClick={()=>{setEditing(false);setError(false);}}>{text("Cancel")}</button></div>{error&&<p role="alert">{t("product.configError")}</p>}
   </fieldset></section>:selected&&<>
   <section className="ua-settings-section"><div className="ua-product-provider-header"><div><h3>{selected.displayName}</h3><p>{currentModel?.label??t("product.selectModel")} {currentModel&&<code>{currentModel.id}</code>}</p></div><div className="ua-session-actions"><button type="button" disabled={busy} onClick={()=>{setCapturedVersion(providerVersions?.[selected.providerId]);setDraft(clone(selected));setCreationConflict(null);setError(false);setEditing(true);}}>{text("Edit provider")}</button><button type="button" disabled={busy} onClick={async()=>{try{await deleteProvider(selected.providerId,providerVersions?.[selected.providerId]);setError(false);}catch{setError(true);}}}>{text("Delete provider")}</button></div></div><dl className="ua-outbound-identifiers"><div><dt>{text("Endpoint")}</dt><dd>{selected.baseUrl}</dd></div><div><dt>{text("Wire API")}</dt><dd>{selected.wireApi}</dd></div></dl><p>{t("product.configuredModels",{models:selected.models.map(m=>m.label).join(" / ")})}</p></section>
   <ProviderSessionSetup key={selected.providerId} provider={selected}/>
  </>}
 </SettingsPageLayout>;
}
