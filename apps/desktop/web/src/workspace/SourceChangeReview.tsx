import { useMemo } from "react";
import { useI18n } from "../i18n";
/** One exact replacement region, linear in source size. Multiple edits may include unchanged middle lines. */
export function sourceReplacementBlock(before:string,after:string){
 const split=(text:string)=>text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)??[];
 const oldLines=split(before),newLines=split(after);let prefix=0,suffix=0;
 while(prefix<oldLines.length&&prefix<newLines.length&&oldLines[prefix]===newLines[prefix])prefix++;
 while(suffix<oldLines.length-prefix&&suffix<newLines.length-prefix&&oldLines[oldLines.length-1-suffix]===newLines[newLines.length-1-suffix])suffix++;
 return {prefix,suffix,removed:oldLines.slice(prefix,oldLines.length-suffix),added:newLines.slice(prefix,newLines.length-suffix),identical:before===after};
}
function display(lines:string[],first:number,marker:string,noEnding:string){
 return lines.map((line,index)=>{
  const ending=line.endsWith("\r\n")?"CRLF":line.endsWith("\n")?"LF":line.endsWith("\r")?"CR":noEnding;
  const content=line.replace(/(?:\r\n|\r|\n)$/u,"");
  return `${marker} ${first+index} | ${content} ⟦${ending}⟧`;
 }).join("\n");
}
export function SourceChangeReview({before,after}:{before:string;after:string}){
 const {locale}=useI18n(),zh=locale==="zh-CN";const block=useMemo(()=>sourceReplacementBlock(before,after),[before,after]);
 const removed=zh?"替换前的行":"Lines being replaced",added=zh?"替换后的行":"Replacement lines";
 return <section aria-label={zh?"源码差异定位":"Source change location"}>
  <h4>{zh?"源码差异定位":"Source change location"}</h4>
  {block.identical?<p>{zh?"内容完全相同。":"Contents are identical."}</p>:<>
   <p>{zh?`共同前缀 ${block.prefix} 行，共同后缀 ${block.suffix} 行；中间替换块：${block.removed.length} 行 → ${block.added.length} 行。`:`Unchanged prefix: ${block.prefix} lines; suffix: ${block.suffix} lines. Replacement block: ${block.removed.length} → ${block.added.length} lines.`}</p>
   <p>{zh?"下方显示原/新行号及行尾标记。多处编辑会合并为一个替换块，可能包含未改的中间行；完整前后内容仍需审阅。":"Original/new line numbers and line endings are shown below. Separate edits share one replacement block, which can include unchanged middle lines. Review the complete before and after content as well."}</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
    <section aria-label={removed}><h5>{removed}</h5><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",borderInlineStart:"3px solid #b75c5c",paddingInlineStart:8}}>{block.removed.length?display(block.removed,block.prefix+1,"−",zh?"无行尾换行":"no line ending"):(zh?"无（插入）":"None (insertion)")}</pre></section>
    <section aria-label={added}><h5>{added}</h5><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",borderInlineStart:"3px solid #4f9973",paddingInlineStart:8}}>{block.added.length?display(block.added,block.prefix+1,"+",zh?"无行尾换行":"no line ending"):(zh?"无（删除）":"None (deletion)")}</pre></section>
   </div>
  </>}
 </section>;
}
