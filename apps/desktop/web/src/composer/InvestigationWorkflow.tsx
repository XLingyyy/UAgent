import {SceneBatchWorkflow} from "./SceneBatchWorkflow";
import {BlueprintTemplateWorkflow} from "./BlueprintTemplateWorkflow";
import { BuildRepairWorkflow } from "./BuildRepairWorkflow";
import { useState } from "react";
import type { TaskDraft } from "@uagent/shared";
import { normalizeRunPath } from "@uagent/runtime";
import { useI18n } from "../i18n";

export type InvestigationWorkflowDraft = Pick<TaskDraft, "input" | "taskMode">;
/** A task description only. The existing scope and outbound reviews still authorize every run. */
export function investigationWorkflowDraft(question: string, prefix: string, chinese: boolean): InvestigationWorkflowDraft {
  const goal = question.trim(), path = prefix.trim();
  if (!goal || goal.length > 2000) throw Error("invalid_workflow_question");
  normalizeRunPath(path, true);
  if (path.length > 256) throw Error("invalid_workflow_prefix");
  const input = chinese
    ? `内置工作流：工程调查（只读）
调查问题：${goal}
关注目录：${path || "项目根目录"}（仅为检索偏好，以本次确认的读取范围为准）。
步骤：先检索索引，再读取相关文件，依据实际工具结果回答。不得执行命令、修改文件或操作 UE。
结果报告：结论；证据文件路径及来源；已读取与未验证的范围；未解决问题。区分事实和推断，注明截断、失败与未找到结果，不得宣称未执行的验证已通过。`
    : `Built-in workflow: Project investigation (read only)
Question: ${goal}
Focus directory: ${path || "project root"} (search preference only; the approved read scope governs access).
Steps: search the index, read relevant files, and answer from actual tool results. Do not execute commands, modify files, or operate UE.
Result report: conclusion; evidence paths and sources; inspected and unverified scope; unresolved questions. Separate facts from inference and disclose truncation, failures and no matches. Never claim unperformed validation passed.`;
  return { input, taskMode: "investigation" };
}

export function InvestigationWorkflow({ disabled, hasDraft, onApply, embedded = false }: {
  embedded?: boolean; disabled: boolean; hasDraft: boolean; onApply: (draft: InvestigationWorkflowDraft) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh-CN";
  const [template, setTemplate] = useState("investigation");
  const [question, setQuestion] = useState("");
  const [prefix, setPrefix] = useState("Source");
  const [error, setError] = useState(false);
  const supported = template === "investigation";
  return <details className="ua-workflow" open={embedded || undefined}>
    <summary hidden={embedded}>{zh ? "内置工作流" : "Built-in workflows"}</summary>
    <fieldset disabled={disabled} className="ua-workflow__fields">
      <label>{zh ? "工作流模板" : "Workflow template"} <select value={template} onChange={e => { setTemplate(e.target.value); setError(false); }}>
        <option value="investigation">{zh ? "工程调查 · 只读" : "Project investigation · Read only"}</option>
        <option value="build">{zh ? "构建修复 · 日志与命令准备" : "Build repair · Logs and command preparation"}</option>
        <option value="blueprint">{zh ? "交互 Blueprint · 尚未开放" : "Interactive Blueprint · Unavailable"}</option>
        <option value="scene">{zh ? "场景批次 · 尚未开放" : "Scene batch · Unavailable"}</option>
      </select></label>
      {supported ? <>
        <p>{zh ? "检索已建立的项目索引、读取相关文本，并在任务中给出带来源的调查报告。需要已信任且索引就绪的项目及受支持的模型会话；发送时仍需确认读取范围和每次外发内容。" : "Search an existing project index, read related text, and produce a sourced report in the task. Requires a trusted, indexed project and a supported model session; read scope and each outbound request still require confirmation."}</p>
        <label>{zh ? "调查问题" : "Investigation question"}<input value={question} maxLength={2000} onChange={e => { setQuestion(e.target.value); setError(false); }}/></label>
        <label>{zh ? "关注目录（相对路径，可留空）" : "Focus directory (relative, optional)"}<input value={prefix} maxLength={256} onChange={e => { setPrefix(e.target.value); setError(false); }}/></label>
        <p>{zh ? "关注目录不会授予读取权限。结果报告包含结论、证据、未验证范围与待解决问题。" : "The focus directory grants no read permission. The report includes conclusions, evidence, unverified scope and open questions."}</p>
        <button type="button" className="ua-composer__mode-btn" disabled={!question.trim()} onClick={() => {
          try { const draft = investigationWorkflowDraft(question, prefix, zh); onApply(draft); setError(false); }
          catch { setError(true); }
        }}>{hasDraft ? (zh ? "用模板替换当前草稿" : "Replace draft with template") : (zh ? "准备调查任务" : "Prepare investigation task")}</button>
        {error && <p role="alert">{zh ? "请填写问题，并使用项目内相对目录（如 Source），不要使用绝对路径或 ..。" : "Enter a question and a project-relative directory such as Source, without absolute paths or .. segments."}</p>}
      </> : template === "build" ? <BuildRepairWorkflow/> : template === "blueprint" ? <BlueprintTemplateWorkflow/> : <SceneBatchWorkflow/>}
    </fieldset>
  </details>;
}
