import {useSyncExternalStore} from "react";
import {useI18n} from "../i18n";
import {nativeProductSettings} from "./native-product-settings";
export function NativeSettingsNotice(){
 const {t}=useI18n();const status=useSyncExternalStore(nativeProductSettings.subscribe,nativeProductSettings.getStatus,nativeProductSettings.getStatus);
 if(!status.error)return null;
 return <aside role="alert" style={{flexShrink:0,padding:"10px 20px",borderBottom:"1px solid var(--ua-border)",display:"flex",gap:16,alignItems:"center"}}><span>{t(`nativeSettings.${status.error}`)}</span><button type="button" onClick={()=>window.location.reload()}>{t("nativeSettings.reload")}</button></aside>;
}
