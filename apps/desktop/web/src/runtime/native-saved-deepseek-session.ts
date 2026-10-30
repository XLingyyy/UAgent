import type { NativeInvoke } from "./project-native-adapter";
import type { ProviderVersion } from "../types/provider";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-flash";
const MAX_REQUEST_BYTES = 32_768, MAX_TEXT_BYTES = 131_072;
const MAX_BYTES = 1_048_576, MAX_CHUNKS = 4096, MAX_CHUNK_BYTES = 65_536;
type DispatchStatus = "notDispatched" | "mayHaveBeenSent" | "sent";
interface Context { projectId: string | null; conversationId: string; revision?: string | number }
interface ProfileReceipt {
  profileId: string; providerId: string; modelId: string; endpoint: string;
  expiresAt: number; fixture: boolean; vaultVersion: string;
}
interface PreparedReceipt { requestId: string; endpoint: string; modelId: string; bodySha256: string }
interface Head { status: number; contentType: string }
interface PollReceipt {
  cursor: number; nextCursor: number; chunks: number[][]; head: Head | null;
  done: boolean; error: string | null; dispatchStatus: DispatchStatus;
}
interface Pending {
  id: string; cursor: number; ordinal: number; started: boolean; status: DispatchStatus;
  cleanup: Promise<void> | null; stop: AbortController; detach: () => void; abort: () => void;
}
export interface SavedDeepSeekProfileOptions {
  invoke: NativeInvoke; providerId: string; modelId: string; expectedVaultVersion: string;
  expectedProviderVersion: Readonly<ProviderVersion>;
  getContext: () => Context; isCurrent: () => boolean; signal?: AbortSignal; now?: () => number;
}
function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    Array.from(value).every(character => { const code=character.charCodeAt(0); return code>32 && (code<127 || code>159); });
}
const status = (value: unknown): value is DispatchStatus =>
  value === "notDispatched" || value === "mayHaveBeenSent" || value === "sent";
function failure(dispatchStatus: DispatchStatus = "notDispatched", revocationUnconfirmed = false) {
  return Object.assign(new Error(revocationUnconfirmed ? "native_saved_deepseek_revocation_unconfirmed" : "native_saved_deepseek_unavailable"),
    {dispatchStatus, revocationUnconfirmed});
}
function cancelled(dispatchStatus: DispatchStatus = "notDispatched") {
  return Object.assign(new DOMException("Saved DeepSeek request cancelled.", "AbortError"), {dispatchStatus});
}
function pause(signal: AbortSignal, milliseconds=25): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(cancelled());};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},milliseconds);
    signal.addEventListener("abort",abort,{once:true});
  });
}
async function sha256(body: string) {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}
function terminalUnsent(value: unknown, cursor: number): boolean {
  const v=value as PollReceipt|null;
  return Boolean(v && v.done === true && v.dispatchStatus === "notDispatched" &&
    v.cursor === cursor && v.nextCursor === cursor && v.head === null &&
    typeof v.error === "string" && v.error.length>0 && Array.isArray(v.chunks) && v.chunks.length === 0);
}

/** Native-owned saved credential transport. No key, header inspection or global fetch. */
export async function createSavedDeepSeekProfile(options: SavedDeepSeekProfileOptions) {
  const invoke=options.invoke,providerId=options.providerId,modelId=options.modelId,
    expectedVaultVersion=options.expectedVaultVersion,getContext=options.getContext,isCurrent=options.isCurrent,
    openingSignal=options.signal,now=options.now??Date.now;
  const version=options.expectedProviderVersion;
  if (!id(providerId) || modelId!==MODEL || !id(expectedVaultVersion) || openingSignal?.aborted || !version ||
      version.providerId!==providerId || version.exists!==true || !id(version.generation) ||
      !Number.isSafeInteger(version.revision) || version.revision<0) throw failure();
  const expectedProviderVersion=Object.freeze({providerId,generation:version.generation,revision:version.revision,exists:true});
  async function call<T>(command: string,input: unknown): Promise<T> {
    try { return await invoke<T>(command,{input}); } catch { throw failure(); }
  }
  const profile=await call<ProfileReceipt>("open_saved_deepseek_profile",{providerId,modelId,expectedVaultVersion,expectedProviderVersion});
  let current=false;
  try { current=isCurrent(); } catch { /* Callback failures remain static. */ }
  if (!profile || !id(profile.profileId) || profile.providerId!==providerId || profile.modelId!==modelId ||
      profile.endpoint!==ENDPOINT || profile.vaultVersion!==expectedVaultVersion ||
      typeof profile.fixture!=="boolean" || !Number.isSafeInteger(profile.expiresAt) ||
      profile.expiresAt<=now() || profile.expiresAt-now()>3_600_000 || openingSignal?.aborted || !current) {
    if (profile && id(profile.profileId)) {
      try { await call("close_saved_deepseek_profile",{profileId:profile.profileId}); }
      catch { throw failure("notDispatched",true); }
    }
    throw failure();
  }
  let closed=false,busy=false,cleanupUnconfirmed=false,closeConfirmed=false,ordinal=0;
  let active:Pending|null=null,lastDispatchStatus:DispatchStatus="notDispatched";
  let closing:Promise<void>|null=null,closeAcknowledgement:Promise<void>|null=null;
  const expiry=setTimeout(()=>{void close();},Math.max(0,profile.expiresAt-now()));
  function tag(error: unknown, dispatchStatus: DispatchStatus) {
    const result=error instanceof DOMException && error.name==="AbortError" ? cancelled(dispatchStatus) : failure(dispatchStatus);
    return result;
  }
  function check(scope?: Context,signal?:AbortSignal,deadline=profile.expiresAt) {
    let valid=false;
    try {
      const currentContext=scope?getContext():null;
      valid=isCurrent() && (!scope || (currentContext?.projectId===scope.projectId && currentContext?.conversationId===scope.conversationId && currentContext?.revision===scope.revision));
    } catch { /* A callback cannot expose native data or authorize a dispatch. */ }
    if (closed || cleanupUnconfirmed || now()>=profile.expiresAt || now()>=deadline || signal?.aborted || !valid)
      throw cancelled(lastDispatchStatus);
  }
  function remember(request:Pending,next:DispatchStatus,proof=false) {
    if (request.status==="sent" && next!=="sent") return;
    if (request.started && next==="notDispatched" && !proof) return;
    request.status=next;
    if (request.ordinal===ordinal) lastDispatchStatus=next;
  }
  async function cleanup(request:Pending,cancel:boolean) {
    if (request.cleanup) return request.cleanup;
    request.detach();
    request.cleanup=(async()=>{
      if (cancel) {
        const result=await call<{dispatchStatus:DispatchStatus;done:boolean}>("cancel_saved_deepseek_request",{requestId:request.id}).catch(()=>null);
        if (result && status(result.dispatchStatus) && typeof result.done==="boolean")
          remember(request,result.dispatchStatus,result.done===true && result.dispatchStatus==="notDispatched");
        const final=await call<PollReceipt>("poll_saved_deepseek_request",{requestId:request.id,cursor:request.cursor}).catch(()=>null);
        if (final && status(final.dispatchStatus)) remember(request,final.dispatchStatus,terminalUnsent(final,request.cursor));
      }
      try { await call("release_saved_deepseek_request",{requestId:request.id}); }
      catch { if (!closeConfirmed) cleanupUnconfirmed=true; }
      if (active===request) {active=null;busy=false;}
    })();
    return request.cleanup;
  }
  function close():Promise<void> {
    if (closing) return closing;
    closed=true;clearTimeout(expiry);
    active?.abort();
    closeAcknowledgement=call("close_saved_deepseek_profile",{profileId:profile.profileId}).then(()=>{
      closeConfirmed=true;cleanupUnconfirmed=false;
    },()=>{cleanupUnconfirmed=true;throw failure(lastDispatchStatus,true);});
    closing=closeAcknowledgement.catch(()=>undefined);
    return closing;
  }
  async function validateText(text:string):Promise<void> {
    check();
    if (typeof text!=="string" || new TextEncoder().encode(text).length>MAX_TEXT_BYTES) throw failure(lastDispatchStatus);
    await call("validate_saved_deepseek_text",{profileId:profile.profileId,text});
    check();
  }
  const fetcher:typeof fetch=async(input,init)=>{
    const signal=init?.signal??(input instanceof Request?input.signal:undefined),
      url=typeof input==="string"?input:input instanceof URL?input.href:input instanceof Request?input.url:"",
      body=init?.body;
    try { check(undefined,signal??undefined); } catch { throw cancelled("notDispatched"); }
    if (busy || url!==ENDPOINT || init?.method!=="POST" || init.redirect!=="error" || typeof body!=="string" ||
        !body || new TextEncoder().encode(body).length>MAX_REQUEST_BYTES) throw failure("notDispatched");
    let scope:Context;
    try { const captured=getContext();scope={projectId:captured.projectId,conversationId:captured.conversationId,...(captured.revision===undefined?{}:{revision:captured.revision})}; }
    catch { throw failure(lastDispatchStatus); }
    if ((scope.projectId!==null&&!id(scope.projectId)) || !id(scope.conversationId)) throw failure(lastDispatchStatus);
    check(scope,signal??undefined);
    const deadline=Math.min(profile.expiresAt,now()+120_000);
    busy=true;ordinal++;
    let request:Pending|null=null,completed=false,streamController:ReadableStreamDefaultController<Uint8Array>|null=null;
    let head:Head|null=null,bytes=0;
    const decoder=new TextDecoder("utf-8",{fatal:true});
    const stop=new AbortController();
    const abort=()=>{
      stop.abort();
      if (!completed) {
        completed=true;
        streamController?.error(cancelled(request?.status??"notDispatched"));
        if(request)void cleanup(request,true);
      }
    };
    signal?.addEventListener("abort",abort,{once:true});
    const detach=()=>signal?.removeEventListener("abort",abort);
    async function finish(cancel:boolean) {
      detach();
      if (request) await cleanup(request,cancel);
      else busy=false;
    }
    async function poll() {
      check(scope,signal??undefined,deadline);
      if (stop.signal.aborted) throw cancelled(lastDispatchStatus);
      const result=await call<PollReceipt>("poll_saved_deepseek_request",{requestId:request!.id,cursor:request!.cursor});
      check(scope,signal??undefined,deadline);
      if (stop.signal.aborted) throw cancelled(lastDispatchStatus);
      if (!result || result.cursor!==request!.cursor || !Array.isArray(result.chunks) ||
          !Number.isSafeInteger(result.nextCursor) || result.nextCursor!==result.cursor+result.chunks.length ||
          result.nextCursor>MAX_CHUNKS || typeof result.done!=="boolean" ||
          (result.error!==null&&typeof result.error!=="string") || (result.head!==null&&(!result.head||typeof result.head!=="object")) || !status(result.dispatchStatus)) throw failure(lastDispatchStatus);
      remember(request!,result.dispatchStatus,terminalUnsent(result,request!.cursor));
      if (result.head) {
        const h=result.head;
        if (!Number.isInteger(h.status) || (h.status!==200 && (h.status<400||h.status>599)) ||
            !["text/event-stream","application/json"].includes(h.contentType) ||
            (head&&(head.status!==h.status||head.contentType!==h.contentType))) throw failure(lastDispatchStatus);
        head={status:h.status,contentType:h.contentType};
      }
      if (result.dispatchStatus==="notDispatched"&&(result.done||result.head||result.chunks.length) && !terminalUnsent(result,request!.cursor)) throw failure(lastDispatchStatus);
      if (head && head.status>=400) {
        if (head.contentType!=="application/json" || result.chunks.length ||
            (result.error!==null&&result.error!=="native_transport_failed")) throw failure(lastDispatchStatus);
        return {chunks:[] as Uint8Array[],done:result.done,httpError:result.done};
      }
      if (result.error!==null || (result.dispatchStatus==="notDispatched"&&(result.done||result.head||result.chunks.length)))
        throw failure(lastDispatchStatus);
      if (head && head.contentType!=="text/event-stream") throw failure(lastDispatchStatus);
      const chunks=result.chunks.map(chunk=>{
        if (!Array.isArray(chunk) || chunk.length>MAX_CHUNK_BYTES || chunk.some(byte=>!Number.isInteger(byte)||byte<0||byte>255)) throw failure(lastDispatchStatus);
        bytes+=chunk.length;if(bytes>MAX_BYTES)throw failure(lastDispatchStatus);
        const data=new Uint8Array(chunk);decoder.decode(data,{stream:true});return data;
      });
      if ((!head&&chunks.length)||(result.done&&!head))throw failure(lastDispatchStatus);
      request!.cursor=result.nextCursor;
      if(result.done)decoder.decode();
      return {chunks,done:result.done,httpError:false};
    }
    try {
      const digest=await sha256(body);check(scope,signal??undefined,deadline);
      if(stop.signal.aborted)throw cancelled(lastDispatchStatus);
      const prepared=await call<PreparedReceipt>("prepare_saved_deepseek_request",{
        profileId:profile.profileId,projectId:scope.projectId,conversationId:scope.conversationId,body,
      });
      if (prepared&&id(prepared.requestId)) {
        request={id:prepared.requestId,cursor:0,ordinal,started:false,status:"notDispatched",cleanup:null,stop,detach,abort};
        active=request;lastDispatchStatus="notDispatched";
      }
      if (!request || prepared.endpoint!==ENDPOINT || prepared.modelId!==modelId || prepared.bodySha256!==digest) throw failure(lastDispatchStatus);
      check(scope,signal??undefined,deadline);if(stop.signal.aborted)throw cancelled(lastDispatchStatus);
      await call("approve_saved_deepseek_request",{requestId:request.id});
      check(scope,signal??undefined,deadline);if(stop.signal.aborted)throw cancelled(lastDispatchStatus);
      request.started=true;remember(request,"mayHaveBeenSent");
      await call("dispatch_saved_deepseek_request",{requestId:request.id});
      check(scope,signal??undefined,deadline);if(stop.signal.aborted)throw cancelled(lastDispatchStatus);
      let batch=await poll();
      while (!head || ((head as Head).status>=400&&!batch.done)) {await pause(stop.signal);batch=await poll();}
      const responseHead=head as Head;
      if(batch.httpError){completed=true;await finish(false);return new Response(null,{status:responseHead.status,headers:{"Content-Type":"application/json"}});}
      const responseBody=new ReadableStream<Uint8Array>({
        start(controller) {
          streamController=controller;
          void(async()=>{
            try {
              while(true){
                check(scope,signal??undefined,deadline);
                if(completed||stop.signal.aborted)return;
                for(const chunk of batch.chunks)controller.enqueue(chunk);
                if(batch.done){completed=true;await finish(false);controller.close();return;}
                await pause(stop.signal);batch=await poll();
              }
            } catch(error) {
              if(!completed){completed=true;controller.error(tag(error,request?.status??"notDispatched"));}
              await finish(true);
            }
          })();
        },
        async cancel(){completed=true;stop.abort();await finish(true);},
      });
      return new Response(responseBody,{status:responseHead.status,headers:{"Content-Type":"text/event-stream"}});
    } catch(error) {
      completed=true;await finish(true);throw tag(error,request?.status??"notDispatched");
    } finally { if(!request)detach(); }
  };
  return {
    getSnapshot:()=>Object.freeze({ready:!closed&&!cleanupUnconfirmed&&now()<profile.expiresAt,
      providerId,modelId,endpoint:ENDPOINT,expiresAt:profile.expiresAt,fixture:profile.fixture,
      vaultVersion:profile.vaultVersion,connectionVerified:false as const,lastDispatchStatus,cleanupUnconfirmed}),
    fetcher,validateText,close,
    closeAcknowledged():Promise<void>{void close();return closeAcknowledgement!;},
  };
}
