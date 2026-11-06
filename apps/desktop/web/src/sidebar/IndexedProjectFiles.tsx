import { useMemo, useState } from "react";
import type { ProjectIndexSnapshot } from "@uagent/shared";
import { useI18n } from "../i18n";

/** Searches only an existing index. A click delegates to the existing native read policy. */
export function IndexedProjectFiles({snapshot,onPreview,selectedPath}:{snapshot:ProjectIndexSnapshot;onPreview?:(path:string)=>void;selectedPath:string|null}) {
  const {locale}=useI18n(),zh=locale==="zh-CN";
  const [query,setQuery]=useState(""),[extension,setExtension]=useState(""),[page,setPage]=useState(0);
  const extensions=useMemo(()=>[...new Set(snapshot.files.map(f=>f.extension.toLowerCase()))].filter(Boolean).sort(),[snapshot]);
  const files=useMemo(()=>snapshot.files.filter(f=>!f.isIgnored&&(!extension||f.extension.toLowerCase()===extension)&&f.rootRelativePath.toLowerCase().includes(query.trim().toLowerCase())),[snapshot,query,extension]);
  const last=Math.max(0,Math.ceil(files.length/30)-1),current=Math.min(page,last);
  return <section aria-label={zh?"索引文件浏览":"Indexed project files"}>
    <h3>{zh?"源码与项目文件":"Source and project files"}</h3>
    <p>{zh?"搜索现有索引中的相对路径，点选后按当前原生读取策略预览。索引可能已过期；搜索不读取文件内容，也不发送给模型。":"Search relative paths in the existing index; select a file for a native policy-checked preview. The index may be stale. Searching reads no file contents and sends nothing to a model."}</p>
    <label>{zh?"搜索文件路径":"Search file paths"}<input value={query} maxLength={1024} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
    <label>{zh?"文件扩展名":"File extension"}<select value={extension} onChange={e=>{setExtension(e.target.value);setPage(0);}}><option value="">{zh?"全部":"All"}</option>{extensions.map(e=><option key={e}>{e}</option>)}</select></label>
    <p role="status">{zh?`匹配 ${files.length} 个文件，第 ${current+1}/${last+1} 页`:`${files.length} matching files; page ${current+1} of ${last+1}`}</p>
    <ul style={{listStyle:"none",padding:0,maxHeight:320,overflow:"auto"}}>{files.slice(current*30,(current+1)*30).map(f=><li key={f.rootRelativePath}><button type="button" className="ua-project-card__btn" style={{overflowWrap:"anywhere",textAlign:"left"}} disabled={!onPreview} aria-pressed={selectedPath===f.rootRelativePath} onClick={()=>onPreview?.(f.rootRelativePath)}>{f.rootRelativePath}</button></li>)}</ul>
    {!files.length&&<p>{zh?"没有匹配的索引文件。可调整筛选或使用上方扫描按钮更新索引。":"No indexed files match. Adjust the filters or refresh the index with Scan project above."}</p>}
    <button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>{zh?"上一页文件":"Previous files"}</button>
    <button type="button" disabled={current===last} onClick={()=>setPage(current+1)}>{zh?"下一页文件":"Next files"}</button>
  </section>;
}
