import {useEffect,useState} from "react";
import {useI18n} from "../../i18n";
import {useProviderActions,useProviderStore} from "../../stores/ui-store";
import {createSupportedProvider,supportsProviderModel} from "../../provider/runtime-availability";
import type {ProviderConfig,ProviderWireApi} from "../../types/provider";
import {SettingsPageLayout} from "../SettingsPageLayout";
import {providerPageData} from "../settings-page-data";
import {ProviderSessionSetup} from "./ProviderSessionSetup";
import "../pages/SettingsPages.css";

function validEndpoint(value:string){try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}}
const clone=(provider:ProviderConfig):ProviderConfig=>({...provider,models:provider.models.map(m=>({...m}))});
export function ProviderSettings(){
 const {t,text}=useI18n();const {providers,selectedProviderId,defaultProviderId}=useProviderStore(s=>s);
 const {setSelectedProvider,saveProvider,deleteProvider,setDefaultProvider}=useProviderActions();
 const selected=providers.find(p=>p.providerId===selectedProviderId)??null;
 const [draft,setDraft]=useState<ProviderConfig|null>(null),[editing,setEditing]=useState(false),[makeDefault,setMakeDefault]=useState(false),[error,setError]=useState(false);
 useEffect(()=>{if(!editing){setDraft(selected?clone(selected):null);setMakeDefault(selected?.providerId===defaultProviderId);}},[selected,defaultProviderId,editing]);
 function change(patch:Partial<ProviderConfig>){setDraft(v=>v?{...v,...patch}:v);setError(false);}
 function add(){const next=createSupportedProvider();next.providerId=crypto.randomUUID();next.displayName="";next.baseUrl="";next.models=[];next.defaultModel=undefined;setDraft(next);setMakeDefault(providers.length===0);setEditing(true);setError(false);}
 function save(){if(!draft)return;const clean={...draft,displayName:draft.displayName.trim(),baseUrl:draft.baseUrl.trim(),models:draft.models.map(m=>({...m,id:m.id.trim(),label:m.label.trim()||m.id.trim()}))};
  try{if(!clean.displayName||!validEndpoint(clean.baseUrl)||!clean.models.length||clean.models.some(m=>!m.id)||!clean.models.some(m=>m.id===clean.defaultModel))throw Error("invalid");saveProvider(clean);setDefaultProvider(makeDefault?clean.providerId:defaultProviderId===clean.providerId?null:defaultProviderId);setEditing(false);setError(false);}catch{setError(true);}}
 const currentModel=selected?.models.find(m=>m.id===selected.defaultModel)??selected?.models[0];
 return <SettingsPageLayout page={providerPageData}>
  <section className="ua-settings-section" aria-labelledby="providers-heading">
   <div className="ua-product-provider-header"><div><h3 id="providers-heading">{t("product.providers")}</h3><p>{t("product.providersHelp")}</p></div><button type="button" className="ua-btn ua-btn--primary" onClick={add}>{t("product.addProvider")}</button></div>
   <div className="ua-settings-page__provider-list">
    {providers.length===0&&<div className="ua-product-empty"><strong>{t("product.noProviders")}</strong><p>{t("product.noProvidersHelp")}</p></div>}
    {providers.map(p=><button key={p.providerId} type="button" className={`ua-settings-page__provider-card${p.providerId===selectedProviderId?" ua-settings-page__provider-card--active":""}`} disabled={editing} onClick={()=>setSelectedProvider(p.providerId)}><span className="ua-settings-page__provider-card-main"><strong>{p.displayName}</strong><small>{p.baseUrl}</small></span><span className="ua-settings-page__provider-card-badges">{defaultProviderId===p.providerId&&<span className="ua-settings-page__provider-card-badge">{text("Default")}</span>}<span>{!p.enabled?t("product.disabled"):supportsProviderModel(p,p.defaultModel)?t("product.runtimeSupported"):t("product.configurationOnly")}</span></span></button>)}
   </div>
  </section>
  {editing&&draft?<section className="ua-settings-section" aria-label={t("product.editProvider")}>
   <div className="ua-settings-section__header"><h3>{t("product.editProvider")}</h3></div><div className="ua-settings-page__provider-form">
    {!providers.some(p=>p.providerId===draft.providerId)&&<label className="ua-settings-page__field"><span>{t("product.providerTemplate")}</span><select className="ua-settings-page__select" aria-label={t("product.providerTemplate")} value={draft.providerId==="deepseek"?"deepseek":"custom"} onChange={e=>{if(e.target.value==="deepseek")setDraft(createSupportedProvider());else setDraft({...draft,providerId:crypto.randomUUID(),displayName:"",baseUrl:"",models:[],defaultModel:undefined});}}><option value="custom">{t("product.customConfiguration")}</option><option value="deepseek" disabled={providers.some(p=>p.providerId==="deepseek")}>{t("product.supportedPreset")}</option></select></label>}
    <div className="ua-settings-page__field-grid"><label className="ua-settings-page__field"><span>{text("Display name")}</span><input className="ua-settings-page__input" aria-label={text("Display name")} value={draft.displayName} onChange={e=>change({displayName:e.target.value})}/></label><label className="ua-settings-page__field"><span>{text("Base URL")}</span><input className="ua-settings-page__input" aria-label={text("Base URL")} value={draft.baseUrl} onChange={e=>change({baseUrl:e.target.value})}/></label><label className="ua-settings-page__field"><span>{text("Wire API")}</span><select className="ua-settings-page__select" aria-label={text("Wire API")} value={draft.wireApi} onChange={e=>change({wireApi:e.target.value as ProviderWireApi})}><option value="openai_compatible">OpenAI Compatible</option><option value="responses">Responses</option><option value="chat_completions">Chat Completions</option><option value="anthropic">Anthropic</option></select></label></div>
    <div className="ua-product-model-editor"><h4>{t("product.models")}</h4>{draft.models.map((m,i)=><div className="ua-product-model-row" key={i}><label><span>{t("product.modelId")}</span><input aria-label={t("product.modelIdAt",{index:i+1})} value={m.id} onChange={e=>{const models=draft.models.map((v,j)=>j===i?{...v,id:e.target.value}:v);change({models,defaultModel:draft.defaultModel===m.id?e.target.value:draft.defaultModel});}}/></label><label><span>{text("Display name")}</span><input aria-label={t("product.modelNameAt",{index:i+1})} value={m.label} onChange={e=>change({models:draft.models.map((v,j)=>i===j?{...v,label:e.target.value}:v)})}/></label><button type="button" aria-label={t("product.removeModelAt",{index:i+1})} onClick={()=>{const models=draft.models.filter((_,j)=>i!==j);change({models,defaultModel:draft.defaultModel===m.id?models[0]?.id:draft.defaultModel});}}>{text("Remove")}</button></div>)}<button type="button" className="ua-btn" onClick={()=>change({models:[...draft.models,{id:"",label:"",contextWindow:0,supportsReasoning:false}]})}>{t("product.addModel")}</button></div>
    <label className="ua-settings-page__field"><span>{text("Default model")}</span><select className="ua-settings-page__select" aria-label={text("Default model")} value={draft.defaultModel??""} onChange={e=>change({defaultModel:e.target.value})}><option value="" disabled>{t("product.selectModel")}</option>{draft.models.map((m,i)=><option key={i} value={m.id}>{m.label||m.id}</option>)}</select></label>
    <label className="ua-checkline"><input type="checkbox" checked={draft.enabled} onChange={e=>change({enabled:e.target.checked,networkMode:e.target.checked?"live":"disabled"})}/>{t("product.enableConfiguration")}</label><label className="ua-checkline"><input type="checkbox" checked={makeDefault} onChange={e=>setMakeDefault(e.target.checked)}/>{text("Use as default provider")}</label>
    <p className="ua-settings-page__action-note">{t("product.saveHelp")}</p><div className="ua-session-actions"><button type="button" className="ua-session-open" onClick={save}>{text("Save provider")}</button><button type="button" onClick={()=>{setEditing(false);setError(false);}}>{text("Cancel")}</button></div>{error&&<p role="alert">{t("product.configError")}</p>}
   </div></section>:selected&&<>
   <section className="ua-settings-section"><div className="ua-product-provider-header"><div><h3>{selected.displayName}</h3><p>{currentModel?.label??t("product.selectModel")} {currentModel&&<code>{currentModel.id}</code>}</p></div><div className="ua-session-actions"><button type="button" onClick={()=>{setDraft(clone(selected));setEditing(true);}}>{text("Edit provider")}</button><button type="button" onClick={()=>{deleteProvider(selected.providerId);setError(false);}}>{text("Delete provider")}</button></div></div><dl className="ua-outbound-identifiers"><div><dt>{text("Endpoint")}</dt><dd>{selected.baseUrl}</dd></div><div><dt>{text("Wire API")}</dt><dd>{selected.wireApi}</dd></div></dl><p>{t("product.configuredModels",{models:selected.models.map(m=>m.label).join(" / ")})}</p></section>
   <ProviderSessionSetup key={selected.providerId} provider={selected}/>
  </>}
 </SettingsPageLayout>;
}
