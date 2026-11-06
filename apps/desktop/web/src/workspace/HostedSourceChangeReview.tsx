import {useEffect, useState} from "react";
import {localNativeInvoke} from "../runtime/native-provider-budget";
import {SourceChangeReview} from "./SourceChangeReview";
interface Preview {nativePlanDigest:string;preview:{files:{path:string;before:string;after:string}[]}}
interface Receipt {receipt?:{status:string;effects:{path:string;status:string}[]};historyRunId?:string;persisted?:boolean;hostSettled?:boolean;buildValidated?:boolean;error?:string}
interface State {preview:Preview|null;receipt:Receipt|null}
export function HostedSourceChangeReview({runId,zh}:{runId:string;zh:boolean}) {
  const invoke=localNativeInvoke();
  const [state,setState]=useState<State|null>(null),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  useEffect(()=>{let current=true;setState(null);setReviewed(false);setError(false);
    void invoke?.<State>("hosted_source_change",{input:{runId}}).then(value=>{if(current)setState(value);}).catch(()=>{if(current)setError(true);});
    return()=>{current=false;};
  },[runId]);
  async function apply(){
    if(!invoke||!state?.preview||!reviewed||busy)return;
    setBusy(true);setError(false);
    try {const receipt=await invoke<Receipt>("approve_hosted_source_change",{input:{runId,digest:state.preview.nativePlanDigest}});setState({preview:null,receipt});}
    catch {setError(true);try{setState(await invoke<State>("hosted_source_change",{input:{runId}}));}catch{setState(null);}}
    finally{setBusy(false);setReviewed(false);}
  }
  const receipt=state?.receipt, applied=receipt?.persisted===true&&receipt.hostSettled===true&&receipt.receipt?.status==="applied";
  if(!state?.preview&&!receipt&&!error)return null;
  return <section aria-label={zh?"源码修改提案":"Source change proposal"}>
    <h3>{zh?"源码修改提案":"Source change proposal"}</h3>
    {state?.preview&&<>
      <p>{zh?"提案尚未写入。审阅以下差异，再请求一次原生写入批准；文件发生变化时会拒绝写入。":"This proposal has not been applied. Review the diff, then request native approval for one write. Changed source files prevent applying it."}</p>
      {state.preview.preview.files.map(file=><section key={file.path}><h4>{file.path}</h4><SourceChangeReview before={file.before} after={file.after}/>
        <details><summary>{zh?"查看完整修改前后内容":"View complete before and after content"}</summary>
          <h5>{zh?"修改前":"Before"}</h5><pre>{file.before}</pre><h5>{zh?"修改后":"After"}</h5><pre>{file.after}</pre>
        </details></section>)}
      <label className="ua-hosted-tasks__check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>{zh?"已审阅以上源码差异":"I reviewed these source changes"}</label>
      <button disabled={!reviewed||busy} onClick={()=>void apply()}>{zh?"批准后写入一次":"Request approval to apply once"}</button>
    </>}
    {busy&&<p role="status">{zh?"等待原生批准与写入结果…":"Waiting for native approval and write result…"}</p>}
    {receipt&&<>
      <p role="status">{applied?(zh?"源码已写入，备份与回执已保存。构建和运行验证尚未执行。":"Source changes applied; backup and receipt saved. Build and runtime validation have not run."):(zh?"本次操作未确认全部写入。请查看逐文件结果和历史记录。":"The operation did not confirm all writes. Check the file results and history.")}</p>
      <ul>{receipt.receipt?.effects.map(effect=><li key={effect.path}>{effect.path}: {effect.status}</li>)}</ul>
      {receipt.historyRunId&&<p>{zh?"写入历史":"Write history"}: <code>{receipt.historyRunId}</code></p>}
      {receipt.error&&<p role="alert">{receipt.error}</p>}
    </>}
    {error&&<p role="alert">{zh?"未能确认本次操作。提案过期、项目变化或批准取消后，请重新调查；不要假定文件已经恢复。":"This operation was not confirmed. Investigate again after expiry, project changes or declined approval; do not assume source files were restored."}</p>}
  </section>;
}
