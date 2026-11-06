import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { RunSourceRef, TaskRunScope } from "@uagent/shared";
import type { ProjectMemory, ProjectMemoryContent, ProjectMemorySelectionPlan, ProjectMemoryStorePort, RunContextSources } from "@uagent/runtime";
import { useI18n } from "../i18n";
import { createNativeProjectMemory, recheckProjectMemory } from "../runtime/native-project-memory";
import "./ProjectMemoryPanel.css";

const words = {
  "zh-CN": {
    title:"项目记忆",choose:"选择项目后可查看和保存记忆。",hint:"记忆保存在当前项目的原生档案中。新增或编辑后需要确认；事实需要可核验来源。私有条目不发送。停用保留原始记录。",
    body:"记忆正文",kind:"类型",fact:"事实",decision:"决策",todo:"待办",paths:"来源路径（每行一个项目相对路径，最多 8 个）",share:"出站范围路径（每行一个；空白表示整个项目）",visibility:"可见范围",private:"私有",project:"允许在当前项目任务中按授权选择",priority:"优先级",normal:"普通",constraint:"关键约束",save:"保存为待确认",confirm:"用户确认",retire:"停用",edit:"编辑",cancel:"取消编辑",refresh:"重新读取",next:"下一页",first:"第一页",busy:"正在读取或保存…",error:"操作未确认成功。请重新读取原生记录后再操作；修订冲突不会覆盖新内容。",empty:"本页没有记忆。",pending:"待确认",valid:"已确认",stale:"来源已失效",retired:"已停用",saved:"已写入原生记录",revision:"修订",source:"来源",origin:"录入来源",user:"用户",model:"模型推测",session:"原会话",check:"核对来源",noScope:"来源核对与发送需使用当前任务的新授权。",explain:"最近一次请求的记忆选择",used:"采用",omitted:"省略",noPlan:"实际任务尚未提供选择记录。",truncated:"目录超过单次扫描上限，后续条目本次未选。",close:"关闭",sourceMissing:"事实需要来源路径与当前可用的原生来源检查。",unknown:"保存可能已完成；先重新读取，不要重复创建。",bytes:"上下文消息 UTF-8 字节",
    reasons:{not_relevant:"与当前任务不匹配",other_project:"属于其他项目",private:"私有",scope:"超出当前读取或出站范围",pending:"待确认",stale:"来源已变化或不可用",retired:"已停用",unconfirmed:"没有用户确认",missing_source:"缺少事实来源",budget:"请求预算不足",duplicate:"重复条目"},
  },
  en:{
    title:"Project memory",choose:"Select a project to read and save memory.",hint:"Memory is saved in this project's native archive. New and edited entries need confirmation; facts need verifiable sources. Private entries are never sent. Retiring preserves records.",
    body:"Memory text",kind:"Kind",fact:"Fact",decision:"Decision",todo:"To-do",paths:"Source paths (one project-relative path per line, up to 8)",share:"Outbound paths (one per line; blank means the whole project)",visibility:"Visibility",private:"Private",project:"Eligible for scoped tasks in this project",priority:"Priority",normal:"Normal",constraint:"Key constraint",save:"Save as pending",confirm:"Confirm as user",retire:"Retire",edit:"Edit",cancel:"Cancel edit",refresh:"Reload",next:"Next page",first:"First page",busy:"Reading or saving…",error:"The operation was not confirmed. Reload native records before retrying; revision conflicts never overwrite newer content.",empty:"No memory on this page.",pending:"Pending",valid:"Confirmed",stale:"Source is stale",retired:"Retired",saved:"Saved in native records",revision:"Revision",source:"Sources",origin:"Origin",user:"User",model:"Model inference",session:"Original session",check:"Recheck sources",noScope:"Source checks and sending require a current task's fresh scope.",explain:"Memory selection for the latest request",used:"Used",omitted:"Omitted",noPlan:"No selection from an actual task was supplied yet.",truncated:"Catalog scan limit reached; later entries were not considered.",close:"Close",sourceMissing:"Facts require source paths and native source inspection.",unknown:"The save may have completed. Reload before creating again.",bytes:"UTF-8 context-message bytes",
    reasons:{not_relevant:"No match for the current task",other_project:"Other project",private:"Private",scope:"Outside current read or outbound scope",pending:"Pending",stale:"Source changed or unavailable",retired:"Retired",unconfirmed:"No user confirmation",missing_source:"Missing fact source",budget:"Request byte budget",duplicate:"Duplicate"},
  },
} as const;
export interface ProjectMemoryPanelProps {
  projectId: string | null;
  port?: ProjectMemoryStorePort;
  captureSources?: (projectId:string,paths:string[],signal:AbortSignal)=>Promise<RunSourceRef[]>;
  /** Live task scope only, never hydrated from the archive. */
  scope?: TaskRunScope | null;
  sources?: RunContextSources;
  /** Change on root/index/source-generation updates to rerun visible source checks. */
  sourceEpoch?: string | number | null;
  selection?: ProjectMemorySelectionPlan | null;
  onClose?:()=>void;
}
const newContent = (): ProjectMemoryContent => ({kind:"decision",body:"",sourceRefs:[],sharePaths:[""],priority:"normal",visibility:"private",origin:{kind:"user",sessionId:null,messageId:null},readAt:Date.now()});
export function ProjectMemoryPanel({projectId,port:injected,captureSources,scope,sources,sourceEpoch,selection,onClose}:ProjectMemoryPanelProps){
  const {locale}=useI18n(), t=words[locale], port=useMemo(()=>injected??createNativeProjectMemory(),[injected]);
  const [items,setItems]=useState<ProjectMemory[]>([]),[after,setAfter]=useState<string|null>(null),[next,setNext]=useState<string|null>(null);
  const [draft,setDraft]=useState(newContent),[paths,setPaths]=useState(""),[sharePaths,setSharePaths]=useState("");
  const [editing,setEditing]=useState<ProjectMemory|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false);
  const [stale,setStale]=useState<Set<string>>(new Set());
  const generation=useRef(0), pending=useRef(false), controller=useRef<AbortController|null>(null);
  const live=useRef({projectId,port}); live.current={projectId,port};
  const viewOwner=useRef({projectId,port});
  const viewCurrent=viewOwner.current.projectId===projectId&&viewOwner.current.port===port;
  const ownsView=()=>viewOwner.current.projectId===projectId&&viewOwner.current.port===port&&live.current.projectId===projectId&&live.current.port===port;
  const createId=useRef<string|null>(null);
  const current=(token:number,project:string)=>generation.current===token&&live.current.projectId===project&&live.current.port===port;
  function resetDraft(){setDraft(newContent());setPaths("");setSharePaths("");setEditing(null);createId.current=null;}
  async function load(cursor:string|null){
    if(!projectId||pending.current||!ownsView())return;
    const project=projectId,token=++generation.current,abort=new AbortController();
    controller.current?.abort();controller.current=abort;pending.current=true;setBusy(true);setError(null);setSaved(false);
    try{
      const page=await port.list({projectId:project,afterId:cursor,limit:30},abort.signal);
      if(page.projectId!==project)throw Error("project_memory_context_changed");
      if(current(token,project)){setItems(page.memories);setAfter(cursor);setNext(page.nextAfterId);setStale(new Set());}
    }catch{if(current(token,project))setError(t.error);}
    finally{if(current(token,project)){pending.current=false;setBusy(false);}}
  }
  useEffect(()=>{
    generation.current++;controller.current?.abort();pending.current=false;
    viewOwner.current={projectId,port};
    setItems([]);setAfter(null);setNext(null);setStale(new Set());setError(null);setBusy(false);setSaved(false);resetDraft();
    void load(null);
    return()=>{generation.current++;controller.current?.abort();pending.current=false;};
  },[projectId,port]);
  useEffect(()=>{
    if(!projectId||!ownsView()||!items.length||(!captureSources&&(!sources||scope?.projectId!==projectId)))return;
    const token=generation.current,project=projectId,abort=new AbortController();
    void (async()=>{
      const invalid=new Set<string>();
      for(const item of items){
        if(item.validity==="valid"&&item.sourceRefs.length&&!await sourceCurrent(item,abort.signal))invalid.add(item.id);
      }
      if(!abort.signal.aborted&&current(token,project))setStale(invalid);
    })().catch(()=>{if(!abort.signal.aborted&&current(token,project))setError(t.error);});
    return()=>abort.abort();
  },[items,projectId,scope,sources,sourceEpoch,captureSources]);
  async function mutate(work:(signal:AbortSignal)=>Promise<ProjectMemory>){
    if(!projectId||pending.current||!ownsView())return;
    const project=projectId,token=++generation.current,abort=new AbortController();
    controller.current?.abort();controller.current=abort;pending.current=true;setBusy(true);setError(null);setSaved(false);
    try{
      const record=await work(abort.signal);
      if(record.projectId!==project)throw Error("project_memory_context_changed");
      if(current(token,project)){
        setItems(previous=>[record,...previous.filter(item=>item.id!==record.id)]);
        setSaved(true);resetDraft();
      }
    }catch(cause){if(current(token,project))setError(cause instanceof Error&&cause.message==="project_memory_write_outcome_unknown"?t.unknown:t.error);}
    finally{if(current(token,project)){pending.current=false;setBusy(false);}}
  }
  function save(event:FormEvent){
    event.preventDefault();if(!projectId||pending.current||!ownsView())return;
    if(editing&&editing.projectId!==projectId){setError(t.error);return;}
    const project=projectId,sourcePaths=paths.split(/\r?\n/).map(path=>path.trim()).filter(Boolean);
    if(draft.kind==="fact"&&(!sourcePaths.length||!captureSources)){setError(t.sourceMissing);return;}
    if(!createId.current&&!editing){
      if(!globalThis.crypto?.randomUUID){setError(t.error);return;}
      createId.current="memory:"+globalThis.crypto.randomUUID();
    }
    const id=editing?.id??createId.current!;
    void mutate(async signal=>{
      const refs=sourcePaths.length?(await captureSources?.(project,sourcePaths,signal)): [];
      if(signal.aborted||!ownsView())throw Error("project_memory_context_changed");
      if(!refs)throw Error("project_memory_sources_unavailable");
      const content:ProjectMemoryContent={...draft,origin:editing?.origin??draft.origin,sourceRefs:refs,sharePaths:sharePaths.trim()?sharePaths.split(/\r?\n/).map(path=>path.trim()).filter(Boolean):[""],readAt:Date.now()};
      if(editing)return port.update({projectId:project,id,expectedRevision:editing.revision,mutation:{type:"replace",content}},signal);
      return port.create({projectId:project,id,content},signal);
    });
  }
  function edit(item:ProjectMemory){
    if(!ownsView()||item.projectId!==projectId||pending.current)return;
    setEditing(item);setDraft({kind:item.kind,body:item.body,sourceRefs:item.sourceRefs,sharePaths:item.sharePaths,priority:item.priority,visibility:item.visibility,origin:item.origin,readAt:item.readAt});setPaths(item.sourceRefs.map(source=>source.path).join("\n"));setSharePaths(item.sharePaths.join("\n"));setSaved(false);setError(null);
  }
  async function sourceCurrent(item:ProjectMemory,signal:AbortSignal):Promise<boolean>{
    // Metadata freshness is independent of a particular task's outbound permission.
    if(captureSources){
      try{
        const refs=await captureSources(item.projectId,item.sourceRefs.map(source=>source.path),signal);
        return item.sourceRefs.every(source=>source.kind==="file_preview"&&refs.some(ref=>ref.projectId===source.projectId&&ref.path===source.path&&ref.version===source.version&&ref.freshness===source.freshness));
      }catch(error){
        if(error instanceof Error&&error.message==="project_memory_source_missing")return false;
        throw error;
      }
    }
    if(sources&&scope?.projectId===item.projectId)return recheckProjectMemory(item,scope,sources,signal);
    return false;
  }
  async function confirm(item:ProjectMemory,signal:AbortSignal){
    if(!ownsView()||item.projectId!==projectId)throw Error("project_memory_context_changed");
    if(item.sourceRefs.length&&!await sourceCurrent(item,signal))throw Error("project_memory_stale");
    if(signal.aborted||!ownsView())throw Error("project_memory_context_changed");
    return port.update({projectId:item.projectId,id:item.id,expectedRevision:item.revision,mutation:{type:"confirm"}},signal);
  }
  const plan=selection?.projectId===projectId?selection:null;
  return <section className="ua-project-memory" aria-label={t.title}>
    <header><h2>{t.title}</h2>{onClose&&<button type="button" onClick={onClose}>{t.close}</button>}</header>
    <p className="ua-project-memory__hint">{t.hint}</p>
    {!projectId?<p>{t.choose}</p>:!viewCurrent?<p role="status">{t.busy}</p>:<>
      <div className="ua-project-memory__actions"><button type="button" disabled={busy} onClick={()=>void load(after)}>{t.refresh}</button><button type="button" disabled={busy||after===null} onClick={()=>void load(null)}>{t.first}</button><button type="button" disabled={busy||next===null} onClick={()=>void load(next)}>{t.next}</button></div>
      {busy&&<p role="status">{t.busy}</p>}{saved&&<p role="status">{t.saved}</p>}{error&&<p role="alert" className="ua-project-memory__error">{error}</p>}
      <form onSubmit={save} aria-label={t.save}>
        <label>{t.kind}<select disabled={busy} value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as ProjectMemoryContent["kind"]})}>{(["fact","decision","todo"] as const).map(kind=><option key={kind} value={kind}>{t[kind]}</option>)}</select></label>
        <label>{t.body}<textarea disabled={busy} value={draft.body} maxLength={8192} onChange={e=>setDraft({...draft,body:e.target.value})}/></label>
        <label>{t.paths}<textarea disabled={busy} value={paths} onChange={e=>setPaths(e.target.value)}/></label>
        <label>{t.share}<textarea disabled={busy} value={sharePaths} onChange={e=>setSharePaths(e.target.value)}/></label>
        <label>{t.visibility}<select disabled={busy} value={draft.visibility} onChange={e=>setDraft({...draft,visibility:e.target.value as ProjectMemoryContent["visibility"]})}><option value="private">{t.private}</option><option value="project">{t.project}</option></select></label>
        <label>{t.priority}<select disabled={busy} value={draft.priority} onChange={e=>setDraft({...draft,priority:e.target.value as ProjectMemoryContent["priority"]})}><option value="normal">{t.normal}</option><option value="constraint">{t.constraint}</option></select></label>
        <div className="ua-project-memory__actions"><button type="submit" disabled={busy||!draft.body.trim()||new TextEncoder().encode(draft.body).length>8192}>{t.save}</button>{editing&&<button type="button" disabled={busy} onClick={resetDraft}>{t.cancel}</button>}</div>
      </form>
      {!items.length&&!busy&&<p>{t.empty}</p>}
      <ul className="ua-project-memory__list">{items.filter(item=>item.projectId===projectId).map(item=><li key={item.id}>
        <strong>{t[item.kind]} · {t[stale.has(item.id)?"stale":item.validity]}</strong><p className="ua-project-memory__body">{item.body}</p>
        <p className="ua-project-memory__hint">{t.revision}: {item.revision} · {t.origin}: {t[item.origin.kind]} {item.origin.sessionId??""} {item.origin.messageId??""}</p>
        {item.sourceRefs.map((ref,index)=><p key={index} className="ua-project-memory__hint">{t.source}: {ref.path} · {ref.version} · {ref.freshness??""}</p>)}
        {item.validity!=="retired"&&<div className="ua-project-memory__actions">
          <button type="button" disabled={busy} onClick={()=>edit(item)}>{t.edit}</button>
          <button type="button" disabled={busy||stale.has(item.id)||(item.kind==="fact"&&!item.sourceRefs.length)||(item.sourceRefs.length>0&&!captureSources&&(!scope||scope.projectId!==projectId||!sources))} onClick={()=>void mutate(signal=>confirm(item,signal))}>{t.confirm}</button>
          <button type="button" disabled={busy} onClick={()=>void mutate(signal=>port.update({projectId:item.projectId,id:item.id,expectedRevision:item.revision,mutation:{type:"retire"}},signal))}>{t.retire}</button>
        </div>}
      </li>)}</ul>
      <aside aria-label={t.explain}><h3>{t.explain}</h3>{!plan?<p>{t.noPlan}</p>:<>
        <p>{t.bytes}: {plan.usedBytes} / {plan.maxBytes}</p>{plan.catalogTruncated&&<p>{t.truncated}</p>}
        <ul>{plan.used.map(item=><li key={"used:"+item.id}>{t.used}: {item.id} · {t.revision} {item.revision}</li>)}{plan.omitted.map((item,index)=><li key={"omitted:"+index}>{t.omitted}: {item.id} · {t.reasons[item.reason]}</li>)}</ul>
      </>}</aside>
    </>}
  </section>;
}
