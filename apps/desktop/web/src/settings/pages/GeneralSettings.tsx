import {useI18n} from "../../i18n";
import {SettingsPageLayout} from "../SettingsPageLayout";
import {generalPageData} from "../settings-page-data";
import {useSettingsActions} from "../../stores/ui-store";
import "../pages/SettingsPages.css";
export function GeneralSettings(){
 const {locale,setLocale,t,text:uiText}=useI18n();
 const {setActiveSettingsPage}=useSettingsActions();
 return <SettingsPageLayout page={generalPageData}>
   <section className="ua-settings-section" aria-labelledby="ui-language-title">
     <h3 className="ua-settings-section__title" id="ui-language-title">{t("settings.language")}</h3>
     <p>{t("settings.language.description")}</p>
     <div className="ua-language-switch" role="group" aria-label={t("settings.language")}>
       <button type="button" lang="zh-CN" aria-pressed={locale==="zh-CN"} onClick={()=>setLocale("zh-CN")}>简体中文</button>
       <button type="button" lang="en" aria-pressed={locale==="en"} onClick={()=>setLocale("en")}>{uiText("English")}</button>
     </div>
     <p>{uiText("Language changes apply immediately and are saved on this device. Keys and approvals are never restored.")}</p>
   </section>
   <section className="ua-settings-section"><h3 className="ua-settings-section__title">{uiText("Your workspace defaults")}</h3>
     <div className="ua-default-row"><span>{uiText("Execution")}</span><strong>{uiText("Approval required")}</strong></div>
     <div className="ua-default-row"><span>{uiText("Model session")}</span><strong>{uiText("Memory only")}</strong></div>
     <div className="ua-default-row"><span>{uiText("Model budget")}</span><strong>{uiText("CNY 10 cumulative limit")}</strong></div>
     <p>{uiText("Changing language never changes authorization, sends a request or resets the budget.")}</p>
   </section>
   <section className="ua-settings-section"><h3 className="ua-settings-section__title">{uiText("Local configuration and history")}</h3>
     <p>{uiText("Save project selection and redacted conversation copies explicitly in Connections & safety.")}</p>
     <button type="button" onClick={()=>setActiveSettingsPage("config")}>{uiText("Manage local data")}</button>
   </section>
 </SettingsPageLayout>;
}
