import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { NativeRunArchive } from "../runtime/native-run-history";
import { reviewNativeHistory, type NativeHistoryReviewDocument } from "./review-native-history";
import "./OperationReview.css";

const messages = {
  "zh-CN": {
    title: "历史操作审阅", hint: "此页只读。工具状态来自保存时的记录，当前外部效果未经核对；历史记录不恢复项目权限或执行许可。",
    project: "项目", session: "会话", run: "Run", revision: "档案修订", review: "审阅标识", tool: "工具调用", step: "步骤", args: "已保存参数", result: "已保存结果",
    empty: "此档案未记录工具调用。", incomplete: "档案不完整或工具与步骤记录不一致，仅展示已加载记录。", unresolved: "历史记录包含未决状态，需由当前原生所有者另行核对。",
    noResult: "没有保存结果。", more: "显示更多工具记录", clipped: "正文显示已截断", full: "展开完整正文", less: "收起正文", invalid: "档案身份不一致，无法展示审阅。",
    recorded: "保存时状态", prepared: "已准备", inFlight: "进行中", succeeded: "成功", failed: "失败", unknown: "未知", skipped: "已跳过",
  },
  en: {
    title: "Archived operation review", hint: "Read only. Tool statuses describe saved records. Current external effects are unverified; history restores no project authority or execution permission.",
    project: "Project", session: "Session", run: "Run", revision: "Archive revision", review: "Review identity", tool: "Tool call", step: "Step", args: "Saved arguments", result: "Saved result",
    empty: "No tool calls were saved in this archive.", incomplete: "The archive is incomplete or its tool and step records disagree. Only loaded records are shown.", unresolved: "Unresolved historical states require separate checks by the current native owner.",
    noResult: "No result was saved.", more: "Show more tool records", clipped: "Displayed text is truncated", full: "Show complete text", less: "Collapse text", invalid: "Archive identities disagree. Review is unavailable.",
    recorded: "Recorded status", prepared: "Prepared", inFlight: "In flight", succeeded: "Succeeded", failed: "Failed", unknown: "Unknown", skipped: "Skipped",
  },
} as const;
function SavedText({ value, label }: { value: string; label: string }) {
  const { locale } = useI18n(), text = messages[locale];
  const [expanded, setExpanded] = useState(false), clipped = value.length > 12000;
  return <div>
    <pre tabIndex={0} aria-label={label} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "32rem", overflow: "auto" }}>{expanded ? value : value.slice(0, 12000)}</pre>
    {clipped && <>{!expanded && <p>{text.clipped}</p>}<button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>{expanded ? text.less : text.full}</button></>}
  </div>;
}
function ReviewBody({ document }: { document: NativeHistoryReviewDocument }) {
  const { locale } = useI18n(), text = messages[locale];
  const [visible, setVisible] = useState(30);
  return <section className="ua-operation-review" aria-label={text.title} data-review-id={document.reviewId} data-review-revision={document.revision}>
    <header className="ua-operation-review__header"><h3>{text.title}</h3></header>
    <p>{document.title}</p><p>{text.hint}</p>
    <dl style={{ overflowWrap: "anywhere" }}>
      <dt>{text.project}</dt><dd>{document.identity.projectId}</dd>
      <dt>{text.session}</dt><dd>{document.identity.sessionId}</dd>
      <dt>{text.run}</dt><dd>{document.identity.runId}</dd>
      <dt>{text.revision}</dt><dd>{document.revision}</dd>
      <dt>{text.review}</dt><dd><code>{document.reviewId}</code></dd>
    </dl>
    {!document.complete && <p role="status">{text.incomplete}</p>}
    {document.hasUnresolvedHistory && <p role="status">{text.unresolved}</p>}
    {!document.tools.length && <p>{text.empty}</p>}
    <ul className="ua-operation-review__list">
      {document.tools.slice(0, visible).map((tool, index) => <li className="ua-operation-review__item" key={tool.id + ":" + index}>
        <details><summary style={{ overflowWrap: "anywhere" }}>{tool.toolName} · {text.recorded}: {text[tool.recordedStatus]}</summary>
          <div className="ua-operation-review__details">
            <p>{text.tool}: {tool.id}</p><p>{text.step}: {tool.stepId}</p>
            <SavedText key={document.revision + ":args:" + index} value={tool.argumentsText} label={text.args} />
            {tool.resultText === null ? <p>{text.noResult}</p> : <SavedText key={document.revision + ":result:" + index} value={tool.resultText} label={text.result} />}
          </div>
        </details>
      </li>)}
    </ul>
    {visible < document.tools.length && <button type="button" onClick={() => setVisible((current) => current + 30)}>{text.more} ({document.tools.length - visible})</button>}
  </section>;
}
/** Accept only a validated native archive. There are deliberately no action/approval props. */
export function NativeOperationReview({ archive }: { archive: NativeRunArchive }) {
  const { locale } = useI18n();
  const document = useMemo(() => {
    try { return reviewNativeHistory(archive); } catch { return null; }
  }, [archive]);
  return document ? <ReviewBody key={JSON.stringify([document.reviewId, document.revision])} document={document} /> : <p role="alert">{messages[locale].invalid}</p>;
}
