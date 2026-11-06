import "./CodexConversation.css";
import {CodexModelFields} from "../composer/CodexModelFields";
import {createCodexMemberSession} from "../runtime/codex-member-session";
import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from "react";
import {useI18n} from "../i18n";
import {localNativeInvoke} from "../runtime/native-provider-budget";
import type {NativeInvoke} from "../runtime/project-native-adapter";
type View={requestId:string;sessionId:string;threadId:string|null;turnId:string|null;status:string;text:string;persisted:boolean;error:string|null};
type Link={sessionId:string;threadId:string|null;state:string;memberId?:string|null;runId?:string|null};
export function CodexConversation({projectId,projectTrusted=true,onProjectSetup,invoke:provided}:{projectId:string|null;projectTrusted?:boolean;onProjectSetup?:()=>void;invoke?:NativeInvoke|null}){
 const invoke=useMemo(()=>provided===undefined?localNativeInvoke():provided,[provided]),{locale}=useI18n(),zh=locale==="zh-CN";
 const projectReady=Boolean(projectId&&projectTrusted);
 const configuration=useMemo(()=>createCodexMemberSession(()=>invoke),[invoke]);
 const selected=useSyncExternalStore(configuration.subscribe,configuration.getSnapshot,configuration.getSnapshot);
 const [prompt,setPrompt]=useState(""),[links,setLinks]=useState<Link[]>([]),[session,setSession]=useState(""),[view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),titleId=useId();
 useEffect(()=>{const node=dialog.current;if(!node)return;if(open&&!node.open)node.showModal();else if(!open&&node.open)node.close();},[open]);
 const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
 const generation=useRef(0),active=useRef<View|null>(null),sending=useRef(false);
 const cancel=(v:View|null)=>{if(v&&projectId&&invoke)void invoke("cancel_codex_turn",{input:{projectId,requestId:v.requestId}}).catch(()=>undefined);};
 async function refresh(){if(!invoke||!projectReady||!projectId)return;const g=generation.current;const list=await invoke("list_codex_sessions",{input:{projectId}}) as Link[];if(g===generation.current)setLinks(list);}
 useEffect(()=>{const g=++generation.current;setView(null);setLinks([]);setSession("");setBusy(false);sending.current=false;setError("");
 if(invoke&&projectReady&&projectId){void refresh().catch(()=>{if(g===generation.current)setError("codex_history_unavailable");});}
 return()=>{generation.current++;cancel(active.current);active.current=null;};},[projectId,projectTrusted,invoke]);
 async function start(){if(!invoke||!projectReady||!projectId||sending.current||busy||!configuration.current(projectId,selected.modelId))return;const g=generation.current;sending.current=true;setBusy(true);setError("");setView(null);
 try{const v=await invoke("start_codex_turn",{input:{projectId,sessionId:session||null,executable:selected.executable,model:selected.modelId,effort:selected.effort,prompt}}) as View;if(g!==generation.current){cancel(v);return;}active.current=v;setView(v);
 }catch(e){if(g===generation.current){setError(String(e));setBusy(false);sending.current=false;}}}
 useEffect(()=>{if(!busy||!view||!invoke||!projectId)return;let stopped=false;let timer:ReturnType<typeof setTimeout>;const g=generation.current;const requestId=view.requestId;
 async function poll(){try{const next=await invoke!("poll_codex_turn",{input:{projectId,requestId}}) as View;if(stopped||g!==generation.current)return;if(next.requestId!==requestId)throw Error("codex_reply_mismatch");setView(next);active.current=next;
 if(next.persisted||next.error){setBusy(false);sending.current=false;active.current=null;if(next.error)setError(next.error);if(next.persisted&&!next.error)setSession(next.sessionId);void refresh().catch(()=>undefined);return;}
 }catch(e){if(!stopped&&g===generation.current){setError(String(e));setBusy(false);sending.current=false;cancel(active.current);active.current=null;}return;}if(!stopped)timer=setTimeout(poll,250);}
 timer=setTimeout(poll,0);return()=>{stopped=true;clearTimeout(timer);};},[busy,view?.requestId,invoke,projectId]);
 return <div className="ua-codex-access">
 <button ref={trigger} type="button" className="ua-codex-access__trigger" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><span className="ua-codex-access__indicator" data-ready={selected.ready} aria-hidden />{zh?"Codex 官方会话":"Official Codex conversation"}<span aria-hidden>↗</span></button>
 <dialog ref={dialog} className="ua-codex-conversation" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close();}} onClose={()=>{if(!dialog.current?.open)setOpen(false);}}>
 <header className="ua-codex-conversation__header"><div><span>CODEX</span><h2 id={titleId}>{zh?"官方会话":"Official conversation"}</h2></div><button type="button" onClick={close} aria-label={zh?"关闭 Codex 会话面板":"Close Codex conversation panel"}>{zh?"关闭":"Close"} <span aria-hidden>×</span></button></header>
 <div className="ua-codex-conversation__body">
 <details className="ua-codex-conversation__help"><summary>{zh?"连接与发送说明":"Connection and sending details"}</summary>
 <p>{zh?"使用本机官方 Codex 的 ChatGPT 登录，不填写 API Key。首次使用请在官方 Codex 完成登录。每轮由原生窗口确认发送；不会自动附加工程源码。独立工作目录、只读沙箱，额外工具批准会被拒绝。模型额度由 Codex 管理。":"Uses the installed official Codex ChatGPT login, not an API key. Sign in through official Codex first. Every turn requires native confirmation. No project source is automatically attached. Uses a separate workspace, read-only sandbox; additional tool approvals are rejected. Codex manages account quota."}</p></details>
 {!invoke&&<p role="status">{zh?"\u8bf7\u5728 UAgent \u684c\u9762\u7a0b\u5e8f\u4e2d\u4f7f\u7528 Codex\u3002":"Open the UAgent desktop app to use Codex."}</p>}
 {!projectReady&&<div className="ua-codex-conversation__setup"><p role="status">{zh?"\u53ef\u5148\u8bfb\u53d6\u6a21\u578b\u5217\u8868\u548c\u7f16\u8f91\u6d88\u606f\u3002\u53d1\u9001\u524d\uff0c\u8bf7\u6dfb\u52a0\u6216\u9009\u62e9\u5de5\u7a0b\u5e76\u786e\u8ba4\u6388\u6743\uff0c\u7528\u4e8e\u5f52\u6863\u4f1a\u8bdd\uff1b\u4e0d\u4f1a\u81ea\u52a8\u53d1\u9001\u5de5\u7a0b\u6587\u4ef6\u3002":"You can load models and draft a message now. Before sending, add or select a project and confirm trust for conversation storage. Project files are not automatically sent."}</p>{onProjectSetup&&<button type="button" onClick={()=>{close();onProjectSetup?.();}}>{zh?"\u8bbe\u7f6e\u5de5\u7a0b":"Set up project"}</button>}</div>}
 <CodexModelFields session={configuration} slot="conversation" label="Conversation" projectId={projectReady?projectId:null} input="standalone conversation" disabled={busy||!invoke} zh={zh} invoke={invoke}/>
 <fieldset disabled={busy||!invoke}>
 <label>{zh?"继续已关联会话":"Linked conversation"}<select aria-label="Codex conversation" disabled={!projectReady} value={session} onChange={e=>setSession(e.target.value)}><option value="">{zh?"新会话":"New conversation"}</option>{links.map(l=><option key={l.sessionId} value={l.sessionId} disabled={l.state!=="idle"||Boolean(l.memberId)}>{l.sessionId} / {l.state}{l.memberId?` / ${l.memberId} / ${l.runId}`:""}</option>)}</select></label>
 <label>{zh?"本轮发送内容":"Text to send"}<textarea aria-label="Codex input" maxLength={32000} value={prompt} onChange={e=>setPrompt(e.target.value)}/></label><button disabled={!projectReady||!prompt.trim()||!selected.ready} onClick={()=>void start()}>{zh?"审阅并请求发送批准":"Review and request send approval"}</button></fieldset>
 {busy&&<button onClick={()=>cancel(active.current)} disabled={!active.current}>{zh?"取消本轮":"Cancel this turn"}</button>}
 {view&&<><p role="status">{view.status} / {view.persisted?(zh?"已存档":"Archived"):(zh?"尚未确认存档":"Archive unconfirmed")}</p><pre style={{whiteSpace:"pre-wrap"}}>{view.text}</pre><p>Codex thread: {view.threadId??"—"}</p></>}
 {error&&<p role="alert">{error} — {zh?"不会自动重发；结果不明的会话不能续发。":"No automatic resend. Uncertain conversations cannot be resumed."}</p>}
 </div></dialog></div>;
}
