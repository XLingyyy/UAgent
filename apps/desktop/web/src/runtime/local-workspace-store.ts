import { redactString } from "@uagent/runtime";
import { localNativeInvoke } from "./native-provider-budget";
import type { NativeInvoke } from "./project-native-adapter";
export interface SavedChat { id:string;title:string;projectLabel:string;createdAt:number;archived:boolean;messages:{role:"user"|"assistant"|"tool";text:string}[] }
export interface WorkspaceConfig { schemaVersion:1;theme:"dark"|"light";projectRoots:string[];selectedProjectRoot:string|null;deepseekConfigured:boolean }
export interface SavedWorkspace extends WorkspaceConfig { chats:SavedChat[] }
export interface WorkspaceRecord { revision:number;workspace:SavedWorkspace }
export const emptyWorkspace=():SavedWorkspace=>({schemaVersion:1,theme:"dark",projectRoots:[],selectedProjectRoot:null,deepseekConfigured:false,chats:[]});
export const savedText=(value:string,limit=2000)=>redactString(value).replace(/\b(?:sk-|ghp_|github_pat_)[\w-]+/g,"[REDACTED]").slice(0,limit);
export function createLocalWorkspaceStore(getInvoke:()=>NativeInvoke|null=localNativeInvoke) {
  let state:{record:WorkspaceRecord|null;loaded:boolean;busy:boolean;error:string|null}={record:null,loaded:false,busy:false,error:null};
  const listeners=new Set<()=>void>();let loading:Promise<void>|null=null;
  const update=(patch:Partial<typeof state>)=>{state={...state,...patch};listeners.forEach(fn=>fn());};
  function validate(record:unknown):WorkspaceRecord|null {
    if(record===null)return null;
    const value=record as WorkspaceRecord;
    if(!Number.isSafeInteger(value?.revision)||value.revision<1||value.workspace?.schemaVersion!==1||!Array.isArray(value.workspace.chats)||!Array.isArray(value.workspace.projectRoots))throw Error("storage_version_invalid");
    return structuredClone(value);
  }
  const store={
    getSnapshot:()=>state,
    subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
    load():Promise<void>{
      if(loading)return loading;
      const invoke=getInvoke();if(!invoke){update({loaded:true,error:"Native local storage unavailable."});return Promise.resolve();}
      if(state.busy)return Promise.resolve();
      update({busy:true,error:null});
      loading=(async()=>{try{update({record:validate(await invoke("read_local_workspace")),loaded:true});}catch{update({error:"Local data could not be read. It was not reset.",loaded:true});}finally{loading=null;update({busy:false});}})();return loading;
    },
    async save(workspace:SavedWorkspace){
      const invoke=getInvoke();if(!invoke||!state.loaded||state.busy||state.error)throw Error("local_storage_not_ready");
      // Explicit schema projection: no arbitrary provider config, credential, event payload,
      // attachment, native token, trust state, or execution continuation can be serialized.
      const safe:SavedWorkspace={schemaVersion:1,theme:workspace.theme,projectRoots:[...workspace.projectRoots],selectedProjectRoot:workspace.selectedProjectRoot,deepseekConfigured:workspace.deepseekConfigured,
        chats:workspace.chats.map(chat=>({id:chat.id,title:savedText(chat.title,50),projectLabel:savedText(chat.projectLabel,50),createdAt:chat.createdAt,archived:chat.archived,messages:chat.messages.map(m=>({role:m.role,text:savedText(m.text)}))}))};
      update({busy:true,error:null});
      try{const next=validate(await invoke("save_local_workspace",{input:{expectedRevision:state.record?.revision??0,workspace:safe}}));if(!next||next.revision!==(state.record?.revision??0)+1)throw Error("invalid_save_ack");update({record:next});}
      catch{update({error:"Save failed or another window changed the data. Reload before retrying."});throw Error("local_storage_save_failed");}
      finally{update({busy:false});}
    },
    async archive(id:string,archived:boolean){const current=state.record?.workspace;if(!current)throw Error("no_saved_chat");await store.save({...current,chats:current.chats.map(c=>c.id===id?{...c,archived}:c)});},
  };return store;
}
export const localWorkspaceStore=createLocalWorkspaceStore();
