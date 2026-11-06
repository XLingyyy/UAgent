import {useEffect, useRef, useState} from "react";
import type {TaskRun} from "@uagent/shared";
import {localNativeInvoke} from "../runtime/native-provider-budget";
import {safeProviderSession} from "../runtime/safe-provider-session";
import {useI18n} from "../i18n";
import {useProjectStore, useSettingsActions} from "../stores/ui-store";
import "./NativeHistoryAccess.css";
import "./HostedTasksPanel.css";

interface TaskDescription {runId:string;projectId:string;goal:string;terminal:boolean}
interface Snapshot {revision:number;run:TaskRun;text:string;settled:boolean}
/** Unmounting this observer never cancels or reconstructs a native task. */
export function HostedTasksPanel() {
  const {locale}=useI18n(), zh=locale==="zh-CN", invoke=localNativeInvoke();
  const project=useProjectStore(s=>s.registeredProjects.find(p=>p.id===s.activeProjectId));
  const settings=useSettingsActions();
  const [open,setOpen]=useState(false), panel=useRef<HTMLDialogElement>(null);
  const [tasks,setTasks]=useState<TaskDescription[]>([]),[selected,setSelected]=useState<string|null>(null);
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[goal,setGoal]=useState(""),[prefix,setPrefix]=useState("Source");
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const generation=useRef(0);
  useEffect(()=>{const node=panel.current;if(!open||!node)return;node.showModal();return()=>{generation.current++;if(node.open)node.close();};},[open]);
  useEffect(()=>{
    if(!open||!invoke)return;
    let active=true;
    void invoke<TaskDescription[]>("list_hosted_tasks").then(value=>{if(active){setTasks(value);setSelected(previous=>previous??value.at(-1)?.runId??null);}})
      .catch(()=>{if(active)setError(zh?"无法读取后台任务。":"Background tasks are unavailable.");});
    return()=>{active=false;};
  },[open,zh]);
  useEffect(()=>{
    if(!open||!selected||!invoke){setSnapshot(null);return;}
    let active=true,timer:ReturnType<typeof setTimeout>|undefined;
    setSnapshot(null);
    const refresh=async()=>{
      try{
        const value=await invoke<Snapshot|null>("control_hosted_task",{input:{runId:selected,action:"snapshot"}});
        if(active){setSnapshot(value);if(value?.settled&&value.run.status!=="paused")return;}
      }catch{if(active)setError(zh?"任务状态暂不可用。请重新打开面板查看。":"Task status is unavailable. Reopen this panel to retry.");return;}
      if(active)timer=setTimeout(refresh,750);
    };
    void refresh();return()=>{active=false;if(timer)clearTimeout(timer);};
  },[open,selected,zh]);
  async function start(){
    if(!invoke||!project||busy)return;
    const profileId=safeProviderSession.getHostedProfileId();
    if(!profileId){setOpen(false);settings.openSettings("provider");return;}
    const current=++generation.current;setBusy(true);setError(null);
    try{
      const result=await invoke<{runId:string}>("start_hosted_task",{input:{profileId,projectId:project.id,conversationId:crypto.randomUUID(),
        goal,readPrefixes:[prefix.trim()],sharePrefixes:[prefix.trim()]}});
      if(current===generation.current){setTasks(await invoke<TaskDescription[]>("list_hosted_tasks"));setSelected(result.runId);}
    }catch{if(current===generation.current)setError(zh?"任务未启动。请检查项目已信任、临时 DeepSeek 会话已开启，并完成范围确认。":"Task did not start. Check project trust, temporary DeepSeek session and scope confirmation.");}
    finally{setBusy(false);}
  }
  async function control(action:"pause"|"resume"|"cancel"){
    if(!invoke||!selected||busy)return;setBusy(true);setError(null);
    try{await invoke("control_hosted_task",{input:{runId:selected,action}});
      setSnapshot(await invoke<Snapshot>("control_hosted_task",{input:{runId:selected,action:"snapshot"}}));
    }catch{setError(zh?"操作未确认。原授权到期后需要新建任务。":"Operation was not confirmed. Start a new task after its original authorization expires.");}
    finally{setBusy(false);}
  }
  if(!invoke)return null;
  const done=Boolean(snapshot?.settled&&snapshot.run.status!=="paused");
  return <><button type="button" className="ua-hosted-tasks-open" onClick={()=>setOpen(true)}>{zh?"后台文件调查":"Background file investigation"}</button>
    {open&&<dialog ref={panel} className="ua-history-drawer ua-hosted-tasks" aria-label={zh?"后台文件调查":"Background file investigation"}
      onCancel={e=>{e.preventDefault();setOpen(false);}} onClose={()=>setOpen(false)}>
      <nav className="ua-history-drawer__tabs"><strong>{zh?"后台文件调查":"Background file investigation"}</strong><button type="button" onClick={()=>setOpen(false)}>{zh?"关闭面板":"Close panel"}</button></nav>
      <div className="ua-history-drawer__content">
        <p>{zh?"只读检查指定路径中的文本文件。界面重载后任务继续；退出应用后停止，记录保存在运行历史中。":"Read text files within a selected path. Tasks survive view reloads; exiting the app stops them and retains their history."}</p>
        <p>{zh?"本次最多 4 次模型请求、8 次文件读取、2 分钟。请在目标中写明项目相对文件路径。":"Up to 4 model requests, 8 file reads and 2 minutes. Include project-relative filenames in your goal."}</p>
        <label>{zh?"读取并发送给 DeepSeek 的目录":"Directory to read and share with DeepSeek"}<input value={prefix} onChange={e=>setPrefix(e.target.value)} placeholder={zh?"留空表示整个项目":"Empty means the whole project"}/></label>
        <label>{zh?"调查目标":"Investigation goal"}<textarea value={goal} onChange={e=>setGoal(e.target.value)} maxLength={4096} rows={3}/></label>
        <button type="button" disabled={busy||!goal.trim()||project?.trustState!=="trusted"} onClick={()=>void start()}>{zh?"新建后台调查":"Start background investigation"}</button>
        <p>{project?.name??(zh?"请先选择并信任项目。":"Select and trust a project first.")}</p>
        {error&&<p role="alert">{error}</p>}
        <label>{zh?"当前应用中的任务":"Tasks in this app session"}<select value={selected??""} onChange={e=>{setSelected(e.target.value||null);setError(null);}}>
          <option value="">{zh?"选择任务":"Select a task"}</option>{tasks.map(task=><option key={task.runId} value={task.runId}>{task.goal}</option>)}
        </select></label>
        {snapshot&&<section aria-live="polite"><p>{snapshot.run.status} · {snapshot.run.modelRequests}/4 {zh?"模型请求":"model requests"} · {snapshot.run.toolCalls}/8 {zh?"文件读取":"file reads"}</p>
          <div className="ua-hosted-tasks__actions"><button disabled={busy||done||snapshot.run.status==="paused"} onClick={()=>void control("pause")}>{zh?"暂停":"Pause"}</button>
          <button disabled={busy||snapshot.run.status!=="paused"} onClick={()=>void control("resume")}>{zh?"继续":"Resume"}</button>
          <button disabled={busy||done} onClick={()=>void control("cancel")}>{zh?"取消任务":"Cancel task"}</button></div>
          {snapshot.run.stopReason&&<p>{snapshot.run.stopReason}</p>}<pre>{snapshot.text}</pre>
          <ul>{snapshot.run.steps.map(step=><li key={step.stepId}>{step.executor} · {step.status}{step.result?.truncated?(zh?"（结果已截断）":" (truncated)"):""}</li>)}</ul>
        </section>}
      </div>
    </dialog>}
  </>;
}
