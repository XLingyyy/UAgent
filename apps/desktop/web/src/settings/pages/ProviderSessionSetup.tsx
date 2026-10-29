import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {useI18n} from "../../i18n";
import {safeProviderSession,type SafeProviderSession} from "../../runtime/safe-provider-session";
import {supportsProviderModel} from "../../provider/runtime-availability";
import type {ProviderConfig} from "../../types/provider";
import {useComposerActions,useProviderActions} from "../../stores/ui-store";

export function ProviderSessionSetup({provider,controller=safeProviderSession}:{provider:ProviderConfig;controller?:SafeProviderSession}){
 const {t}=useI18n();const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 const {setComposerModel}=useComposerActions();const {saveProvider}=useProviderActions();const password=useRef<HTMLInputElement>(null);
 const [authorized,setAuthorized]=useState(false),[hasInput,setHasInput]=useState(false),[error,setError]=useState(false);
 const model=provider.models.find(m=>m.id===provider.defaultModel)??provider.models[0];
 const supported=supportsProviderModel(provider,model?.id);
 useEffect(()=>{const field=password.current;return()=>{if(field)field.value="";};},[provider.providerId]);
 function clear(){controller.close("cleared");if(password.current)password.current.value="";setHasInput(false);setAuthorized(false);setError(false);}
 function open(){let key=password.current?.value??"";if(password.current)password.current.value="";setHasInput(false);
  try{if(!supported||!authorized)throw Error("not_authorized");if(provider.networkMode!=="live")saveProvider({...provider,networkMode:"live"});setComposerModel(JSON.stringify([provider.providerId,model!.id]));controller.enable();controller.openAccount(key);setError(false);}catch{controller.close("setup_failed");setError(true);}finally{key="";setAuthorized(false);}}
 return <section className="ua-settings-section ua-product-session" aria-labelledby="provider-session-heading">
  <div className="ua-settings-section__header"><h3 id="provider-session-heading" className="ua-settings-section__title">{t("product.connection")}</h3><p className="ua-settings-section__description">{supported?t("product.connectionHelp"):t("product.unsupportedHelp")}</p></div>
  <div className="ua-settings-section__body">
   <p className="ua-session-state" role="status">{!supported?t("product.unsupported"):state.ready?t("product.sessionReady"):t("product.sessionClosed")}</p>
   {supported&&<><label className="ua-session-key">{t("product.apiKey")}<input ref={password} type="password" autoComplete="off" spellCheck={false} maxLength={512} aria-label={t("product.apiKey")} className="ua-settings-page__input" onChange={()=>{controller.close();setHasInput(Boolean(password.current?.value));setError(false);}}/></label>
   <label className="ua-checkline"><input type="checkbox" checked={authorized} aria-label={t("product.authorizeLabel")} onChange={e=>{controller.close();setAuthorized(e.target.checked);}}/>{t("product.authorize")}</label>
   <div className="ua-session-actions"><button type="button" className="ua-session-open" disabled={!authorized||!hasInput||!state.canConfigure} onClick={open}>{t("product.openSession")}</button><button type="button" onClick={clear}>{t("product.clearSession")}</button></div>
   <p className="ua-settings-page__action-note">{t("product.credentialHelp")}</p>
   {error&&<p role="alert">{t("product.setupError")}</p>}</>}
  </div>
 </section>;
}
