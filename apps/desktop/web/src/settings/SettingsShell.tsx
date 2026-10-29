import {useEffect,useRef} from "react";
import {useSettingsActions} from "../stores/ui-store";
import {useI18n} from "../i18n";
import { SettingsSidebar } from "./SettingsSidebar";
import { SettingsContent } from "./SettingsContent";
import "./SettingsShell.css";

export function SettingsShell() {
  const {text: uiText} = useI18n();
  const root=useRef<HTMLDivElement>(null);
  const {closeSettings}=useSettingsActions();
  useEffect(()=>{root.current?.querySelector<HTMLButtonElement>(".ua-settings-sidebar__back")?.focus();
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!event.defaultPrevented){event.preventDefault();closeSettings();}};
    document.addEventListener("keydown",key);return()=>document.removeEventListener("keydown",key);
  },[closeSettings]);
  return (
    <div ref={root} className="ua-settings-shell" aria-label={uiText("Settings")} data-settings-state="open">
      <SettingsSidebar />
      <SettingsContent />
    </div>
  );
}
