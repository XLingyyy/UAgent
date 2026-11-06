import { useMemo, useState } from "react";
import { assessUEBuildRepair } from "@uagent/runtime";
import { useI18n } from "../i18n";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";

const copy = {
  "zh-CN": {
    title: "本次构建诊断", inspect: "分析本次构建结果", errors: "错误", warnings: "警告",
    incomplete: "输出不完整或已截断，不能据此进入修复。", noErrors: "未识别到结构化错误，请查看原始构建日志。",
    unsettled: "进程结束或结果落账尚未确认，不能进入修复。", other: "本次结果不满足失败构建的修复条件。",
    eligible: "已定位失败构建中的错误。", pending: "当前可查看诊断；差异审阅、逐次批准修改及再次批准构建尚未接通。未修改文件。",
    project: "项目", engine: "引擎", external: "外部", none: "没有结构化诊断。",
  },
  en: {
    title: "This build's diagnostics", inspect: "Analyze this build result", errors: "errors", warnings: "warnings",
    incomplete: "Output is incomplete or truncated; it cannot authorize a repair cycle.", noErrors: "No structured errors were recognized. Inspect the original build log.",
    unsettled: "Process settlement or receipt persistence is unconfirmed; repair cannot proceed.", other: "This result does not meet failed-build repair conditions.",
    eligible: "Errors from the failed build have been identified.", pending: "Diagnostics are available. Diff review, individual write approval and separately approved rebuilding are not connected yet. No files were changed.",
    project: "Project", engine: "Engine", external: "External", none: "No structured diagnostics.",
  },
};
/** Reads the original validated native result only. Log paths are display text, never read/write scope. */
export function UEBuildFailureDiagnosis({ result, preview, persisted, hostSettled, repairAvailable = false }: {
  result: Parameters<typeof assessUEBuildRepair>[0]; preview: UEBuildPreviewReceipt;
  persisted: boolean; hostSettled: boolean; repairAvailable?: boolean;
}) {
  const { locale } = useI18n(), words = copy[locale];
  const [opened, setOpened] = useState(false);
  const assessment = useMemo(() => opened ? assessUEBuildRepair(result, {
    projectRoot: preview.preview.projectRoot, engineRoot: preview.preview.profile?.engineRoot,
    diagnosticCwd: preview.preview.cwd,
  }) : null, [opened, result, preview]);
  if (result.status === "succeeded" && result.exitCode === 0 && result.treeStopped && result.outputComplete && persisted && hostSettled) return null;
  const reason = !persisted || !hostSettled || assessment?.reason === "termination_unconfirmed" ? words.unsettled
    : assessment?.reason === "incomplete_diagnostics" ? words.incomplete
      : assessment?.reason === "no_parsed_errors" ? words.noErrors
        : assessment?.eligible ? words.eligible : words.other;
  return <section aria-label={words.title}>
    <button type="button" onClick={() => setOpened(true)} disabled={opened}>{words.inspect}</button>
    {assessment && <>
      <p role="status">{reason}</p>
      <p>{assessment.summary.errorCount} {words.errors} · {assessment.summary.warningCount} {words.warnings}</p>
      {assessment.summary.truncated && <p>{words.incomplete}</p>}
      <p>{repairAvailable ? (locale === "zh-CN" ? "可在下方开始源码批次修复；修改和重建分别批准。" : "Source batch repair is available below. Editing and rebuilding need separate approval.") : words.pending}</p>
      {assessment.summary.diagnostics.length === 0 ? <p>{words.none}</p> : <ol>
        {assessment.summary.diagnostics.map(issue => <li key={issue.id}>
          <strong>{issue.stage.toUpperCase()} · {issue.severity} {issue.code ?? ""}</strong>
          {issue.location && <p>{words[issue.location.scope]}: <code>{issue.location.projectRelativePath ?? issue.location.displayPath}</code>
            {issue.location.line !== undefined && `:${issue.location.line}`}{issue.location.column !== undefined && `:${issue.location.column}`}</p>}
          <p style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{issue.message}</p>
          {issue.occurrences > 1 && <span>×{issue.occurrences}</span>}
        </li>)}
      </ol>}
    </>}
  </section>;
}
