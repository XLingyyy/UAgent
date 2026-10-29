import {useI18n} from "../../i18n";
import {useEffect,useState,useSyncExternalStore} from "react";
import {localWorkspaceStore} from "../../runtime/local-workspace-store";
import {SettingsPageLayout} from "../SettingsPageLayout";
import {archivedChatsPageData} from "../settings-page-data";
export function ArchivedChatsSettings(){
  const {text: uiText,t} = useI18n();
 const state=useSyncExternalStore(localWorkspaceStore.subscribe,localWorkspaceStore.getSnapshot,localWorkspaceStore.getSnapshot);
 const [filter,setFilter]=useState("");const [archivedOnly,setArchivedOnly]=useState(false);const [selected,setSelected]=useState<string|null>(null);
 useEffect(()=>{void localWorkspaceStore.load();},[]);
 const chats=state.record?.workspace.chats??[];const visible=chats.filter(c=>(!archivedOnly||c.archived)&&`${c.title} ${c.projectLabel}`.toLowerCase().includes(filter.toLowerCase()));const chat=chats.find(c=>c.id===selected);
 return <SettingsPageLayout page={archivedChatsPageData}>
  <p>{uiText("Saved local text copies only. Opening a conversation does not resume execution or restore approval.")}</p>
  <input aria-label={uiText("Search saved conversations")} value={filter} onChange={e=>setFilter(e.target.value)}/>
  <label><input type="checkbox" checked={archivedOnly} onChange={e=>setArchivedOnly(e.target.checked)}/>{uiText("Archived only")}</label>
  <button type="button" disabled={state.busy} onClick={()=>void localWorkspaceStore.load()}>{uiText("Reload history")}</button>
  {visible.map(c=><div key={c.id}><button type="button" onClick={()=>setSelected(c.id)}>{c.title} · {c.projectLabel}</button><button type="button" disabled={state.busy||!!state.error} onClick={()=>void localWorkspaceStore.archive(c.id,!c.archived).catch(()=>undefined)}>{c.archived?uiText("Restore from archive"):uiText("Archive")}</button></div>)}
  {chat&&<article aria-label={uiText("Saved conversation")}>{chat.messages.map((m,i)=><section key={i}><h4>{m.role === "user" ? uiText("You") : m.role === "assistant" ? uiText("Assistant") : uiText("Tool")}</h4><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{m.text}</p></section>)}</article>}
  <p role="status">{state.error?uiText(state.error):t("history.count",{count:visible.length})}</p>
 </SettingsPageLayout>;
}
