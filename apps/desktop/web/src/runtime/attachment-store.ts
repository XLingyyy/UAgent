import {redactString} from "@uagent/runtime";
export interface SelectedAttachment {id:string;name:string;content:string;bytes:number;selected:boolean;kind:"text"|"asset"}
export function createAttachmentStore(){
 let state:{projectId:string|null;revision:number;items:SelectedAttachment[]}={projectId:null,revision:0,items:[]};let generation=0;
 const listeners=new Set<()=>void>();const emit=()=>{state={...state,revision:state.revision+1};listeners.forEach(fn=>fn());};
 const safe=(value:string)=>redactString(value).replace(/\b(?:sk-|ghp_|github_pat_)[\w-]+/g,"[REDACTED]");
 const add=(name:string,content:string,kind:SelectedAttachment["kind"])=>{const bytes=new TextEncoder().encode(content).length;if(state.items.length>=4||bytes>16384||state.items.reduce((n,i)=>n+i.bytes,0)+bytes>24576)throw Error("attachment_limit");const item={id:crypto.randomUUID(),name:safe(name).slice(0,120),content:safe(content),bytes,selected:false,kind};state={...state,items:[...state.items,item]};emit();};
 return{
  getSnapshot:()=>state,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  bind(projectId:string|null){if(projectId===state.projectId)return;generation++;state={...state,projectId,items:[]};emit();},
  clear(){generation++;state={...state,items:[]};emit();},
  async addFile(file:File){
   if(!state.projectId)throw Error("project_required");
   if(file.size>16384||file.size<1||! /\.(txt|md|json|csv|ts|tsx|js|jsx|cpp|h|ini)$/i.test(file.name)||/(^\.|credential|secret|password|private.?key)/i.test(file.name))throw Error("unsupported_file");
   const epoch=generation;const buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error("file_read_failed"));reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.readAsArrayBuffer(file);});
   if(epoch!==generation)throw Error("attachment_context_changed");
   if(buffer.byteLength>16384)throw Error("attachment_limit");const text=new TextDecoder("utf-8",{fatal:true}).decode(buffer);if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error("binary_file");add(file.name,text,"text");
  },
  addAsset(projectId:string,name:string,path:string,type:string){if(!projectId||projectId!==state.projectId||path.startsWith("/")||path.includes("..")||/[\r\n\0]/.test(path))throw Error("asset_context_invalid");add(name,JSON.stringify({assetReference:path,assetType:type}),"asset");},
  select(id:string,selected:boolean){state={...state,items:state.items.map(i=>i.id===id?{...i,selected}:i)};emit();},
  remove(id:string){state={...state,items:state.items.filter(i=>i.id!==id)};emit();},
  selected(projectId:string|null){return projectId===state.projectId?state.items.filter(i=>i.selected).map(i=>({name:i.name,content:i.content,kind:i.kind})):[];},
 };
}
export const attachmentStore=createAttachmentStore();
