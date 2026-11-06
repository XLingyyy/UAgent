import {collaborationRoleLabel} from "../../composer/CollaborationMemberFields";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./InvestigationScopeReview.css";
import { useI18n } from "../../i18n";
import {
  investigationScopeGate,
  type createInvestigationScopeGate,
} from "../../runtime/investigation-scope-gate";
import { useComposerStore, useProjectStore } from "../../stores/ui-store";
export function InvestigationScopeReview({
  gate = investigationScopeGate,
}: {
  gate?: ReturnType<typeof createInvestigationScopeGate>;
}) {
  const { t,locale } = useI18n(),
    pending = useSyncExternalStore(gate.subscribe, gate.getPending, gate.getPending);
  const project = useProjectStore((s) => s.activeProjectId),
    input = useComposerStore((s) => s.input),
    model = useComposerStore((s) => s.selectedModelId);
  const [prefixes, setPrefixes] = useState("Source, Config"),
    [whole, setWhole] = useState(false),
    [share, setShare] = useState(false),
    [limit, setLimit] = useState(3),
    [error, setError] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    gate.invalidate();
    return () => gate.invalidate();
  }, [gate, project, input, model]);
  useEffect(() => {
    if (!pending) return;
    setPrefixes("Source, Config");
    setWhole(false);
    setShare(false);
    setLimit(pending.proposal.collaboration?6:3);
    setError(false);
    const previous = document.activeElement as HTMLElement | null,
      node = panel.current,
      app = document.querySelector<HTMLElement>(".ua-app"),
      wasInert = app?.hasAttribute("inert");
    app?.setAttribute("inert", "");
    node?.querySelector<HTMLElement>("input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        gate.invalidate();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          node?.querySelectorAll<HTMLElement>("input,button") ?? [],
        ).filter((control) => !control.hasAttribute("disabled"));
        const first = controls[0],
          last = controls.at(-1);
        if (
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    node?.addEventListener("keydown", key);
    return () => {
      node?.removeEventListener("keydown", key);
      if (!wasInert) app?.removeAttribute("inert");
      if (previous?.isConnected) previous.focus();
    };
  }, [pending?.id, gate]);
  if (!pending) return null;
  const p = pending.proposal;
  return (
    <section
      ref={panel}
      className="ua-outbound-review ua-investigation-review"
      role="dialog"
      aria-modal="true"
      aria-label={t("run.scopeTitle")}
    >
      <h2>{t("run.scopeTitle")}</h2>
      <p>{t("run.scopeHint")}</p>
      {p.collaboration&&<p>{locale==="zh-CN"?`协作调查：所配置成员按所选职责独立读取，再由汇总角色合并。共用所选范围，最多 ${limit} 次工具调用、${Math.min(31,limit+(Object.keys(p.collaborationMembers??{investigator:null,reviewer:null}).length+(p.collaboration==="dynamic_delegation"?2:1)))} 次模型请求；不创建后台任务或写入权限。`:`Collaborative investigation: configured members independently investigate their assigned specialties, followed by synthesis. Shared scope, at most ${limit} tool calls and ${Math.min(31,limit+(Object.keys(p.collaborationMembers??{investigator:null,reviewer:null}).length+(p.collaboration==="dynamic_delegation"?2:1)))} model requests; no background jobs or write permission.`}</p>}
      {p.collaboration&&<p>{locale==="zh-CN"?"支持并发的会话中调查与复核并行运行，外发审批逐条排队；其他会话仍串行。成员分配总预算，各自保留报告额度，并为最后汇总保留一次请求。工具额度均分，余数按成员顺序分配；额度不足时会要求报告现有证据，不能宣称未完成的调查已完成。":"Investigation and review run concurrently on supported sessions, with queued outbound approvals; other sessions remain sequential. The total budget is partitioned with reserved report requests and one final synthesis request. Tool allowances are partitioned evenly, with remaining calls assigned in member order. Agents must report evidence and limitations when their allowance is reached."}</p>}
      {p.collaboration==="dynamic_delegation"&&<p>{locale==="zh-CN"?"已选择主 Agent 动态分工：主模型先分配每名成员的子任务，成员随后并行执行，主模型最后汇总。分工不扩展权限，每次外发仍须确认；成员需使用独立会话或支持并发的共享会话；不支持并发的主会话最多供一名成员复用。":"Dynamic delegation: the lead model assigns a subtask for each configured member, members execute in parallel, and the lead model synthesizes. Assignments grant no additional authority; each outbound request still requires approval. Members need independent sessions or a shared session that supports parallel requests. At most one member may reuse a serial main session."}</p>}
      {(p.providerId==="codex"||Object.values(p.collaborationMembers??{}).some(m=>m.model?.providerId==="codex"))&&<p>{locale==="zh-CN"?"Codex 主 Agent 和调查成员可在批准范围内使用 UAgent 只读工具，主 Agent 负责分工与汇总。每次原生 Codex turn 占一次请求额度，内部调用次数及 Token 用量未知。每次发送单独确认，每份工具结果按原文确认后回传。不自动注入项目记忆。":"The Codex lead and investigation members can use UAgent read-only tools within the approved scope; the lead delegates and synthesizes findings. Each native Codex turn counts as one request; internal call counts and token usage are unknown. Each send needs confirmation, and every exact tool result needs separate confirmation before returning to Codex. Project memory is not injected automatically."}</p>}
      {p.collaborationMembers&&<ul aria-label={locale==="zh-CN"?"已选协作成员":"Selected collaboration members"}>
        {Object.keys(p.collaborationMembers!).map((id,index)=><li key={id}>{index+1}. {collaborationRoleLabel(p.collaborationMembers![id].role,locale)} ({p.collaborationMembers![id].model?.providerId??p.providerId} / {p.collaborationMembers![id].model?.modelId??p.modelId}) — {p.collaborationMembers![id].focus || (locale==="zh-CN"?"按任务目标调查":"Follow the task goal")}</li>)}
      </ul>}
      <dl className="ua-outbound-identifiers">
        <div>
          <dt>{p.projectName}</dt>
          <dd>{p.modelId}</dd>
        </div>
        <div>
          <dt>{t("run.goal")}</dt>
          <dd>{p.goal}</dd>
        </div>
      </dl>
      <p>
        <code>{p.endpoint}</code>
      </p>
      <label className="ua-scope-field">
        {t("run.prefixes")}
        <input
          type="text"
          value={prefixes}
          disabled={whole}
          onChange={(event) => setPrefixes(event.target.value)}
          aria-describedby="run-prefix-hint"
        />
      </label>
      <p id="run-prefix-hint">{t("run.prefixHint")}</p>
      <label className="ua-scope-option">
        <input
          type="checkbox"
          checked={whole}
          onChange={(event) => setWhole(event.target.checked)}
        />
        {t("run.wholeProject")}
      </label>
      <label className="ua-scope-option">
        <input
          type="checkbox"
          checked={share}
          onChange={(event) => setShare(event.target.checked)}
        />
        {t("run.shareResults")}
      </label>
      <p>{t("run.noShare")}</p>
      <label className="ua-scope-field">
        {t("run.callLimit")}
        <input
          type="number"
          min={p.collaboration?Object.keys(p.collaborationMembers??{investigator:null,reviewer:null}).length:1}
          max={30}
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
        />
      </label>
      <p>{t("run.stopLimits")}</p>
      {error && <p role="alert">{t("run.invalidScope")}</p>}
      <button
        className="ua-btn ua-btn--primary"
        type="button"
        onClick={() =>
          setError(
            !gate.approve(pending.id, {
              prefixes: whole
                ? [""]
                : prefixes
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
              shareResults: share,
              maxToolCalls: limit,
            }),
          )
        }
      >
        {t("run.approveScope")}
      </button>
      <button className="ua-btn" type="button" onClick={() => gate.invalidate()}>
        {t("common.cancel")}
      </button>
    </section>
  );
}
