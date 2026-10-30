import { useEffect, useId, useRef, useState } from "react";
import {responsesFailureHint,OPENAI_MODEL_DOCS} from "../runtime/responses-failure-hints";
import { useI18n } from "../i18n";
import { runStopReasonKey } from "../i18n/run-messages";
import { ProviderProposalPanel } from "./ProviderProposalPanel";
import { ConversationMessage } from "./ConversationMessage";
import { ConversationMarkdown } from "./ConversationMarkdown";
import type { WorkspaceMessage } from "./workspace-data";
import { mapTaskEventToWorkspaceMessage, runDetailEvents } from "../runtime/event-view-models";
import { assistantText, conversationTasks, conversationKey, completedConversationHistory } from "../runtime/conversation-context";
import { useRuntimeStore, useThreadStore, useThreadActions, useProjectStore, useComposerStore } from "../stores/ui-store";
import "./ConversationViewport.css";

export interface ConversationViewportProps { messages?: WorkspaceMessage[] }
export function ConversationViewport({ messages = [] }: ConversationViewportProps) {
  const { t, locale } = useI18n();
  const active = useThreadStore(s => s.activeThreadId), project = useProjectStore(s => s.activeProjectId), runtime = useRuntimeStore(s => s);
  const { setActiveThread } = useThreadActions();
  const tasks = conversationTasks(runtime.tasksById, active, project);
  const list = useRef<HTMLDivElement>(null), follow = useRef(true), detailTrigger = useRef<HTMLButtonElement | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailsId = useId();
  const detailList = useRef<HTMLDivElement>(null);
  useEffect(() => { if (detailList.current) detailList.current.scrollTop = 0; }, [detailTaskId]);
  const selectedModel = useComposerStore(s => s.selectedModelId);
  const contextTurns = completedConversationHistory(tasks.filter(task => JSON.stringify([task.draft.providerId, task.draft.modelId]) === selectedModel), runtime.eventsByTaskId).length / 2;
  const key = tasks.length ? conversationKey(tasks[0]) : active;
  const selectedTask = tasks.find(task => task.id === detailTaskId);
  const selectedEvents = selectedTask ? runtime.eventsByTaskId[selectedTask.id] ?? [] : [];
  const shownEvents = runDetailEvents(selectedEvents);
  const completion = selectedEvents.filter(e => e.type === "provider_request_completed").at(-1);
  const payload = completion?.payload as { usage?: { inputTokens: number; outputTokens: number } } | undefined;
  const usage = payload?.usage;
  const knownUsage = usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0;
  useEffect(() => { follow.current = true; setDetailTaskId(null); }, [key]);
  useEffect(() => {
    if (!detailTaskId && follow.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [runtime.eventsByTaskId, tasks.length, key, detailTaskId]);
  const closeDetails = () => {
    setDetailTaskId(null);
    detailTrigger.current?.focus({ preventScroll: true });
  };
  return <section className="ua-conversation-viewport ua-chat" aria-label={t("chat.conversation")}>
    <header className="ua-chat-header"><strong>{t("chat.conversation")}</strong><button type="button" onClick={() => setActiveThread(null)}>{t("chat.new")}</button></header>
    <div ref={list} className="ua-conversation-viewport__list ua-chat-list" onScroll={() => {
      const node = list.current;
      if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90;
    }}>
      {tasks.map(task => {
        const events = runtime.eventsByTaskId[task.id] ?? [], answer = assistantText(events);
        const pending = !["completed", "failed", "cancelled"].includes(task.state), failed = task.state === "failed", cancelled = task.state === "cancelled";
        const lastFailure = events.filter(event=>event.type==="provider_request_failed").at(-1);
        const failureHint = lastFailure ? responsesFailureHint(lastFailure.body??"",locale) : null;
        const pauseEvent = events.filter(event => event.type === "approval_required").at(-1);
        const pauseReason = (pauseEvent?.payload as { run?: { stopReason?: string } } | undefined)?.run?.stopReason;
        const paused = pending && task.state === "awaiting_approval" && Boolean(pauseReason);
        return <div className="ua-chat-turn" key={task.id} data-task-id={task.id}>
          <article className="ua-chat-message ua-chat-message--user" aria-label={t("chat.user")}><span className="ua-chat-role">{t("chat.user")}</span><p>{task.draft.input}</p></article>
          <article className="ua-chat-message ua-chat-message--assistant" aria-label={t("chat.assistant")} aria-busy={pending && !paused} data-streaming={pending && !paused}>
            <span className="ua-chat-role">{t("chat.assistant")}</span>
            {answer ? <ConversationMarkdown text={answer} /> : pending && !paused ? <p className="ua-chat-pending" role="status">{t("chat.replying")}</p> : null}
            {paused && <p className="ua-chat-issue" role="status">{t(runStopReasonKey(pauseReason!))}</p>}
            {(failed || cancelled) && <p className="ua-chat-issue" role="status">{cancelled?t("chat.stopped"):failureHint?.summary??t("chat.failed")}{!cancelled&&failureHint?.modelDocs&&<> <a href={OPENAI_MODEL_DOCS} target="_blank" rel="noreferrer">{t("responses.modelDocs")}</a></>}</p>}
          </article>
          <button className="ua-chat-details-button" type="button" aria-expanded={detailTaskId === task.id} aria-controls={detailsId}
            onClick={event => {
              follow.current = false;
              detailTrigger.current = event.currentTarget;
              setDetailTaskId(previous => previous === task.id ? null : task.id);
            }}>{t("chat.details")}</button>
        </div>;
      })}
      {!tasks.length && messages.map(message => <ConversationMessage key={message.id} message={message} />)}
      <ProviderProposalPanel />
      <details className="ua-chat-context"><summary>{t("chat.contextCount", { count: contextTurns })}</summary><p>{t("chat.contextHelp")}</p><p>{t("chat.historySharing")}</p></details>
    </div>
    {selectedTask && <section className="ua-run-details" id={detailsId} role="region" aria-label={t("chat.runDetails")} data-task-id={selectedTask.id}>
      <header className="ua-run-details__header">
        <div><strong>{t("chat.runDetails")}</strong><p>{t(`chat.state.${selectedTask.state}`)} / {knownUsage ? t("chat.usageCounts", { input: usage.inputTokens, output: usage.outputTokens }) : t("chat.usageUnknown")}</p></div>
        <button type="button" onClick={closeDetails} aria-label={t("chat.closeDetails")}>{t("common.close")}</button>
      </header>
      <div ref={detailList} className="ua-run-details__events" aria-label={t("chat.runEvents")} tabIndex={0}>
        {shownEvents.map(event => <ConversationMessage key={event.id} message={mapTaskEventToWorkspaceMessage(event)} />)}
      </div>
    </section>}
  </section>;
}
