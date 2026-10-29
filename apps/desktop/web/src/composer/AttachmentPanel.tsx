import {useI18n} from "../i18n";
import {useState,useSyncExternalStore} from "react";
import {attachmentStore} from "../runtime/attachment-store";
export function AttachmentPanel(){
  const {text: uiText,t} = useI18n();
 const state=useSyncExternalStore(attachmentStore.subscribe,attachmentStore.getSnapshot,attachmentStore.getSnapshot);const [error,setError]=useState("");
 return <section aria-label={uiText("Selected local context")}><p>{uiText("Choose text files up to 16 KiB each, four files / 24 KiB total. Review redacted text, then select what to include in a model request. Nothing is uploaded here or saved to history.")}</p>
 <label>{uiText("Local text file")}<input type="file" aria-label={uiText("Local text attachment")} disabled={!state.projectId} accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.cpp,.h,.ini" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void attachmentStore.addFile(file).then(()=>setError("")).catch(()=>setError("File not added: check project, text type and size limits. The context may have changed."));}}/></label>
 {!state.projectId&&<p>{uiText("Select a project first.")}</p>}
 {state.items.map(item=><article key={item.id}><h4>{item.name}</h4><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:180,overflow:"auto"}} aria-label={t("attachments.preview",{name:item.name})}>{item.content}</pre><label><input type="checkbox" checked={item.selected} onChange={e=>attachmentStore.select(item.id,e.target.checked)}/>{t("attachments.include",{name:item.name})}</label><button type="button" onClick={()=>attachmentStore.remove(item.id)}>{t("attachments.remove",{name:item.name})}</button></article>)}
 {error&&<p role="alert">{uiText(error)}</p>}<p>{uiText("Review for confidential text missed by automatic redaction. The final exact outbound body requires separate confirmation. Images and binary UE assets are not supported; asset references can be selected from Asset Search.")}</p></section>;
}
