import { useState } from "react";
import { UEBuildDiagnosticParser, type UEBuildDiagnosticSummary } from "@uagent/runtime";
import { useI18n } from "../i18n";
import { UEBuildPreviewPanel } from "../workspace/UEBuildPreviewPanel";
import type { NativeUEBuildPreview } from "../runtime/native-ue-build-preview";

/** Local diagnostic preparation only: pasted text cannot create a build result or file authority. */
export function BuildRepairWorkflow({ client }: { client?: NativeUEBuildPreview }) {
  const { locale } = useI18n(), zh = locale === "zh-CN";
  const [log, setLog] = useState("");
  const [report, setReport] = useState<UEBuildDiagnosticSummary | null>(null);
  const [preview, setPreview] = useState(false);
  return <section aria-label={zh ? "构建修复准备" : "Build repair preparation"}>
    <p>{zh ? "可用：整理日志、批准一次构建；本次原生构建确认失败后，可选择一个现有源码文件，审阅完整前后内容，分别批准写入和重建。不调用模型，不自动重试。" : "Available: inspect logs and approve one build. After a confirmed native build failure, select one existing source file, review its complete before and after content, then separately approve the edit and rebuild. No model call or automatic retry."}</p>
    <label>{zh ? "粘贴构建日志" : "Paste build log"}<textarea value={log} maxLength={262144} rows={5} style={{ width: "100%" }} onChange={event => { setLog(event.target.value); setReport(null); }}/></label>
    <p>{zh ? "仅分析当前输入，最多 262144 个字符；不会上传日志，也不会把日志中的路径当成文件访问权限。" : "Analyzes the current input only, up to 262144 characters. Logs stay local; paths in logs grant no file access."}</p>
    <button type="button" className="ua-composer__mode-btn" disabled={!log.trim()} onClick={() => {
      const parser = new UEBuildDiagnosticParser(); parser.push(log); setReport(parser.finish());
    }}>{zh ? "整理诊断" : "Analyze diagnostics"}</button>
    {report && <section aria-label={zh ? "诊断报告" : "Diagnostic report"} aria-live="polite">
      <p>{zh ? `识别到 ${report.errorCount} 类错误、${report.warningCount} 类警告。` : `Recognized ${report.errorCount} error groups and ${report.warningCount} warning groups.`}</p>
      <p>{zh ? "来源：用户粘贴的日志；构建未由本任务执行，结果未验证。没有识别到错误也不代表构建成功。" : "Source: user-pasted log. This task did not execute a build; the outcome is unverified. No recognized errors does not establish a successful build."}</p>
      {report.truncated && <p role="status">{zh ? "诊断内容已截断，报告不完整。" : "Diagnostics were truncated; this report is incomplete."}</p>}
      {report.diagnostics.length === 0 ? <p>{zh ? "未识别到受支持格式的诊断，请检查日志内容。" : "No supported diagnostic lines were recognized. Check the supplied log."}</p> : <ul>{report.diagnostics.map(issue => <li key={issue.id}>
        <strong>{issue.stage} · {issue.severity} {issue.code ?? ""}</strong> {issue.location && <span>{issue.location.displayPath}:{issue.location.line ?? "?"} </span>}
        <span>{issue.message}</span> <span>×{issue.occurrences}</span>
      </li>)}</ul>}
    </section>}
    <p>{zh ? "下一步：检查明确的 Editor 目标及命令。本步骤不执行命令，也不修改项目。" : "Next: inspect the exact Editor target and command. Preparing the preview does not execute a build; a separate native confirmation approves one execution."}</p>
    <button type="button" className="ua-composer__mode-btn" onClick={() => setPreview(value => !value)}>{preview ? (zh ? "关闭目标预览" : "Close target preview") : (zh ? "准备目标命令" : "Prepare target command")}</button>
    {preview && <UEBuildPreviewPanel inline client={client}/>}
  </section>;
}
