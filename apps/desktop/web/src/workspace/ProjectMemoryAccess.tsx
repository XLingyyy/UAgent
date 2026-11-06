import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useProjectMemoryServices, useProjectStore } from "../stores/ui-store";
import { ProjectMemoryPanel } from "./ProjectMemoryPanel";
import "./ProjectMemoryAccess.css";

export function ProjectMemoryAccess(){
  const {locale}=useI18n(), [open,setOpen]=useState(false), dialog=useRef<HTMLDialogElement>(null), title=useId();
  const services=useProjectMemoryServices();
  const project=useProjectStore(state=>state.registeredProjects.find(item=>item.id===state.activeProjectId)??null);
  const index=useProjectStore(state=>state.activeProjectIndex);
  const nativeSource=useProjectStore(state=>state.nativeSource);
  // UI invalidation only; this nonce is never a native grant or stored source stamp.
  const sourceEpoch=useMemo(()=>crypto.randomUUID(),[project,index,nativeSource]);
  useEffect(()=>{const node=dialog.current;if(!open||!node)return;if(!node.open)node.showModal();return()=>{if(node.open)node.close();};},[open]);
  const label=locale==="zh-CN"?"项目记忆":"Project memory";
  return <><button type="button" className="ua-memory-open" onClick={()=>setOpen(true)} disabled={open}>{label}</button>
    {open&&<dialog ref={dialog} className="ua-memory-dialog" aria-labelledby={title}
      onCancel={event=>{event.preventDefault();setOpen(false);}} onClose={()=>setOpen(false)}>
      <header className="ua-memory-dialog__header"><h2 id={title}>{label}</h2><button type="button" onClick={()=>setOpen(false)}>{locale==="zh-CN"?"关闭":"Close"}</button></header>
      <p className="ua-memory-dialog__hint">{locale==="zh-CN"?"本地记忆默认私有，可查看、确认和修订。当前 Codex 和 DeepSeek 路径未接入项目记忆外发；普通聊天和调查不会自动加入这些记忆。此前的 Responses 记忆外发路径已归档。":"Local memory is private by default and can be reviewed, confirmed and revised. The current Codex and DeepSeek routes do not support sending project memory; ordinary chat and investigations do not automatically include it. The earlier Responses memory-sharing route is archived."}</p>
      <ProjectMemoryPanel projectId={project?.id??null} port={services.port} captureSources={services.captureSources}
        sources={services.sources} sourceEpoch={sourceEpoch} selection={services.selection&&project&&services.selection.projectId===project.id?services.selection.plan:null}/>
    </dialog>}
  </>;
}
