import {codexLeadSession} from "../runtime/codex-member-session";
import {CodexModelFields} from "./CodexModelFields";
export function CodexLeadField({enabled,onChange,projectId,input,disabled,locale}:{enabled:boolean;onChange:(enabled:boolean)=>void;projectId:string|null;input:string;disabled:boolean;locale:string}){
 const zh=locale==="zh-CN";
 return <fieldset className="ua-agent-lead" disabled={disabled}><legend>{zh?"主 Agent 与最终汇总":"Lead agent and synthesis"}</legend>
 <label>{zh?"主 Agent 连接":"Lead connection"}<select value={enabled?"codex":"deepseek"} onChange={e=>{codexLeadSession.close();onChange(e.target.value==="codex");}}><option value="deepseek">DeepSeek</option><option value="codex">Codex / Official ChatGPT login</option></select></label>
 {enabled&&<><CodexModelFields session={codexLeadSession} slot="lead" label="Lead" projectId={projectId} input={input} disabled={disabled} zh={zh}/>
 <details className="ua-agent-notes"><summary>{zh?"调查权限与预算说明":"Read scope and budget"}</summary><p>{zh?"Codex 负责分工和最终汇总。沿用主模型的成员使用各自独立 Codex 线程，也可选择 DeepSeek 成员执行只读调查。每次发送单独批准；Codex 主 Agent 在规划和汇总时、调查成员在执行时均可使用批准范围内的文件列表、搜索和文本读取，结果逐次批准回传；不自动注入项目记忆，内部用量未知。":"Codex delegates and synthesizes. Members inheriting the lead use independent Codex threads; DeepSeek members can perform read-only investigation. Approve each send separately. Codex lead planning/synthesis and investigation members can list, find and read text in the approved scope; approve each result before sending. No automatic project-memory injection; internal usage is unknown."}</p>
 <p>{zh?"共享工具额度先为每个成员保留一次读取；余量足够时再为汇总查证预留一次。额度不足时，主 Agent 基于现有证据完成并说明缺口。":"The shared tool budget reserves one read per member and, when sufficient, one verification read for synthesis. With no spare budget, the lead uses existing evidence and states gaps."}</p>
</details></>}
 </fieldset>;
}
