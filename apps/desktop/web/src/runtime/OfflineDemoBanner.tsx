import {nativeProductSettings} from "./native-product-settings";
import {useSyncExternalStore,useState} from "react";
import {useI18n} from "../i18n";
import {getApplicationProfile} from "./application-profile";
import {safeProviderSession} from "./safe-provider-session";
import {createSupportedProvider} from "../provider/runtime-availability";
import {DEEPSEEK_MODEL} from "@uagent/runtime";
import {useProviderActions,useComposerActions} from "../stores/ui-store";
import "./OfflineDemoBanner.css";
export function OfflineDemoBanner(){
 const [error,setError]=useState(false);
 const {t}=useI18n(),session=useSyncExternalStore(safeProviderSession.subscribe,safeProviderSession.getSnapshot,safeProviderSession.getSnapshot);
 const providers=useProviderActions(),composer=useComposerActions();
 if(!getApplicationProfile().offlineDemo)return null;
 return <aside className="ua-demo-banner" aria-label={t("demo.banner")}><span>{t("demo.banner")}</span><button type="button" onClick={async()=>{
  setError(false);
  if(session.ready){safeProviderSession.close("cleared");return;}
  try {const version=await nativeProductSettings.captureVersion("deepseek");
  await providers.saveProvider({...createSupportedProvider(),networkMode:"fixture"},version);composer.setComposerModel(JSON.stringify(["deepseek",DEEPSEEK_MODEL]));
  safeProviderSession.enable();safeProviderSession.openAccount("offline-demo-session-only");}catch{setError(true);}
 }}>{t(session.ready?"demo.closeSession":"demo.openSession")}</button><span>{t(session.ready?"demo.sessionReady":"demo.sessionHelp")}</span>{error&&<span role="alert">{t("nativeSettings.unavailable")}</span>}</aside>;
}
