import { RepairRecoveryInspection } from "./RepairRecoveryInspection";
import { SourceChangeReview } from "./SourceChangeReview";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { NativeRunArchive,NativeRunHistoryPort } from "../runtime/native-run-history";
const names={"native-build-result":["原始构建回执","Original build receipt"],nativeRepairBefore:["修复前备份与计划","Repair before-backup and plan"],nativeRepairResult:["源码修改结果","Source edit result"]} as const;
export function RunArtifactViewer({archive,load,inspect}:{archive:NativeRunArchive;load:NativeRunHistoryPort["artifact"];inspect?:NativeRunHistoryPort["inspectRepair"]}){
 const {locale}=useI18n(),zh=locale==="zh-CN";
 const [selected,setSelected]=useState(""),[content,setContent]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const generation=useRef(0);
 useEffect(()=>{generation.current++;setContent(null);setSelected("");setBusy(false);setError(false);return()=>{generation.current++;};},[archive,load]);
 const refs=archive.snapshot.artifacts.flatMap(v=>{
  if(!v||typeof v!=="object"||Array.isArray(v))return [];
  const a=v as Record<string,unknown>;
  return typeof a.id==="string"&&Object.hasOwn(names,a.id)&&a.mediaType==="application/json"&&typeof a.sha256==="string"&&/^[a-f0-9]{64}$/.test(a.sha256)?[{id:a.id as keyof typeof names,sha256:a.sha256}]:[];
 });
 if(!refs.length)return null;
 async function open(id:string,sha256:string){if(!load)return;const epoch=++generation.current;setSelected(id);setContent(null);setError(false);setBusy(true);
  try{const text=await load(archive.descriptor.projectId,archive.descriptor.runId,id,sha256);if(generation.current===epoch)setContent(text);}catch{if(generation.current===epoch)setError(true);}finally{if(generation.current===epoch)setBusy(false);}}
 let sourceFiles:{path:string;before:string;after:string}[]=[];
 if(content&&selected==="nativeRepairBefore"){
  try{const data=JSON.parse(content);const files=data?.preview?.preview?.files;if(Array.isArray(files))sourceFiles=files.filter(f=>f&&typeof f.path==="string"&&typeof f.before==="string"&&typeof f.after==="string").slice(0,8);}catch{/* raw archived text remains available */}
 }
 return <section aria-label={zh?"保存的构建与修复记录":"Saved build and repair records"}>
  <h3>{zh?"保存的构建与修复记录":"Saved build and repair records"}</h3>
  <p>{zh?"只读查看本次运行保存的内容；不表示当前源码状态，不会恢复文件或重新执行。":"Read-only records from this run. They do not establish current source state, restore files or execute anything."}</p>
  {refs.map(a=><div key={a.id}><button type="button" disabled={!load} onClick={()=>void open(a.id,a.sha256)}>{names[a.id][zh?0:1]}</button><code style={{overflowWrap:"anywhere"}}>{a.sha256}</code></div>)}
  {refs.filter(a=>a.id==="nativeRepairBefore").map(a=><RepairRecoveryInspection key={a.sha256} projectId={archive.descriptor.projectId} runId={archive.descriptor.runId} backupSha256={a.sha256} inspect={inspect}/>)}
  {busy&&<p role="status">{zh?"正在读取保存记录…":"Reading saved record…"}</p>}
  {error&&<p role="alert">{zh?"无法完整读取或校验记录。可能缺失、已改变或超过显示大小限制；未展示截断内容。":"Could not read and verify the complete record. It may be missing, changed or exceed the display limit. No truncated content is shown."}</p>}
  {content!==null&&<>
    <button type="button" onClick={()=>{generation.current++;setContent(null);setSelected("");setBusy(false);}}>{zh?"收起记录":"Close record"}</button>
    {sourceFiles.map((f,i)=><section key={i}><h4>{f.path}</h4><SourceChangeReview before={f.before} after={f.after}/><p>{zh?"保存的修改前内容":"Saved before content"}</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{f.before}</pre><details><summary>{zh?"当时计划写入的内容（不是当前文件）":"Planned replacement at that time (not the current file)"}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{f.after}</pre></details></section>)}
    <details open={!sourceFiles.length}><summary>{zh?"完整原始 JSON 记录":"Complete original JSON record"}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{content}</pre></details>
  </>}
 </section>;
}
