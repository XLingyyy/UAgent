import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  archivedPartialAssistantReplies,
  canContinueNativeHistory,
  createNativeRunHistory,
  type NativeHistoryPage,
  type NativeHistoryRun,
  type NativeRunArchive,
  type NativeRunHistoryPort,
} from "../runtime/native-run-history";
import { ConversationMarkdown } from "./ConversationMarkdown";
import "./RunHistoryPanel.css";

export interface RunHistoryPanelProps {
  history?: NativeRunHistoryPort;
  projectId?: string | null;
  onClose?: () => void;
  /** Prepares a linked NEW task. The owner must revalidate project/sources and obtain fresh authority. */
  onContinue: (archive: NativeRunArchive, shareCompletedContext: boolean) => void | Promise<void>;
  continuationDisabled?: boolean;
}
const PAGE_SIZE = 30;
export function RunHistoryPanel({
  history,
  projectId,
  onClose,
  onContinue,
  continuationDisabled = false,
}: RunHistoryPanelProps) {
  const { t, locale } = useI18n();
  const port = useMemo(() => history ?? createNativeRunHistory(), [history]);
  const [currentOnly, setCurrentOnly] = useState(false),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<NativeHistoryPage | null>(null),
    [listBusy, setListBusy] = useState(false),
    [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<NativeHistoryRun | null>(null),
    [archive, setArchive] = useState<NativeRunArchive | null>(null),
    [archiveBusy, setArchiveBusy] = useState(false),
    [archiveError, setArchiveError] = useState(false);
  const [shareCompletedContext, setShareCompletedContext] = useState(false),
    [continuing, setContinuing] = useState(false),
    [continueError, setContinueError] = useState(false);
  const selectionGeneration = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionGeneration.current++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setListBusy(true);
    setListError(false);
    setPage(null);
    setArchive(null);
    setSelected(null);
    setArchiveBusy(false);
    setShareCompletedContext(false);
    setContinueError(false);
    selectionGeneration.current++;
    void port
      .list({ ...(currentOnly && projectId ? { projectId } : {}), offset, limit: PAGE_SIZE })
      .then(
        (result) => {
          if (active) setPage(result);
        },
        () => {
          if (active) setListError(true);
        },
      )
      .finally(() => {
        if (active) setListBusy(false);
      });
    return () => {
      active = false;
    };
  }, [port, currentOnly, projectId, offset, refresh]);
  async function select(run: NativeHistoryRun) {
    const generation = ++selectionGeneration.current;
    setSelected(run);
    setArchive(null);
    setArchiveBusy(true);
    setArchiveError(false);
    setShareCompletedContext(false);
    setContinueError(false);
    try {
      const result = await port.snapshot(run.projectId, run.runId);
      if (mounted.current && generation === selectionGeneration.current) setArchive(result);
    } catch {
      if (mounted.current && generation === selectionGeneration.current) setArchiveError(true);
    } finally {
      if (mounted.current && generation === selectionGeneration.current) setArchiveBusy(false);
    }
  }
  async function continueFromArchive() {
    if (!archive || !canContinueNativeHistory(archive) || continuationDisabled || continuing)
      return;
    setContinuing(true);
    setContinueError(false);
    try {
      await onContinue(archive, shareCompletedContext);
    } catch {
      if (mounted.current) setContinueError(true);
    } finally {
      if (mounted.current) setContinuing(false);
    }
  }
  const date = (value: number) =>
    Number.isNaN(new Date(value).valueOf())
      ? String(value)
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        );
  const partialAssistantReplies = archive ? archivedPartialAssistantReplies(archive) : [];
  const unresolved =
    archive &&
    (archive.descriptor.hasUnresolvedEffects ||
      archive.snapshot.hasUnknownExternalEffects ||
      archive.snapshot.steps.some(
        (step) => step.status === "inFlight" || step.status === "unknown",
      ) ||
      archive.snapshot.toolCalls.some(
        (call) => call.status === "inFlight" || call.status === "unknown",
      ));
  const dialogMessages =
    archive?.providerMessages.filter(
      (message) => (message.role === "user" || message.role === "assistant") && Boolean(message.content),
    ) ?? [];
  const systemMessages =
    archive?.providerMessages.filter(
      (message) => message.role === "system" || message.role === "developer",
    ) ?? [];
  const toolMessages =
    archive?.providerMessages.filter(
      (message) => message.role === "tool" || message.toolCalls?.length,
    ) ?? [];
  return (
    <section className="ua-run-history" aria-label={t("historyRun.title")}>
      <header className="ua-run-history__header">
        <h2>{t("historyRun.title")}</h2>
        {onClose && (
          <button type="button" onClick={onClose}>
            {t("historyRun.close")}
          </button>
        )}
      </header>
      <p className="ua-run-history__hint">{t("historyRun.localOnly")}</p>
      <div className="ua-run-history__controls">
        <label>
          {t("historyRun.filter")}{" "}
          <select
            aria-label={t("historyRun.filter")}
            value={currentOnly && projectId ? "current" : "all"}
            onChange={(event) => {
              setCurrentOnly(event.target.value === "current");
              setOffset(0);
            }}
            disabled={continuing}
          >
            <option value="all">{t("historyRun.allProjects")}</option>
            {projectId && <option value="current">{t("historyRun.currentProject")}</option>}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={listBusy || continuing}
        >
          {t("historyRun.refresh")}
        </button>
      </div>
      <div className="ua-run-history__layout">
        <nav className="ua-run-history__catalog" aria-label={t("historyRun.open")}>
          {listBusy && <p role="status">{t("historyRun.loading")}</p>}
          {listError && <p role="alert">{t("historyRun.unavailable")}</p>}
          {page && !page.runs.length && <p>{t("historyRun.empty")}</p>}
          {page?.runs.map((run) => (
            <button
              type="button"
              className="ua-run-history__entry"
              key={JSON.stringify([run.projectId, run.runId])}
              aria-pressed={selected?.projectId === run.projectId && selected?.runId === run.runId}
              disabled={continuing}
              onClick={() => void select(run)}
            >
              <strong>{run.goal}</strong>
              <span>{run.projectLabel}</span>
              <span>{t("historyRun.session", { title: run.sessionTitle })}</span>
              <span>{t(`historyRun.status.${run.status}`)}</span>
              <time
                dateTime={
                  Number.isNaN(new Date(run.updatedAt).valueOf())
                    ? undefined
                    : new Date(run.updatedAt).toISOString()
                }
              >
                {date(run.updatedAt)}
              </time>
            </button>
          ))}
          <div className="ua-run-history__pagination">
            <button
              type="button"
              disabled={!offset || listBusy || continuing}
              onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            >
              {t("historyRun.previous")}
            </button>
            <span>{t("historyRun.page", { page: Math.floor(offset / PAGE_SIZE) + 1 })}</span>
            <button
              type="button"
              disabled={!page?.hasMore || listBusy || continuing}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
            >
              {t("historyRun.next")}
            </button>
          </div>
        </nav>
        <div className="ua-run-history__record" aria-busy={archiveBusy}>
          {archiveBusy ? (
            <p role="status">{t("historyRun.loading")}</p>
          ) : archiveError ? (
            <p role="alert">{t("historyRun.unavailable")}</p>
          ) : !archive ? (
            <p>{t("historyRun.select")}</p>
          ) : (
            <>
              <header>
                <h3>{archive.descriptor.goal}</h3>
                <p>
                  {archive.descriptor.projectLabel} ·{" "}
                  {t(
                    ("historyRun.status." +
                      archive.descriptor
                        .status) as `historyRun.status.${NativeHistoryRun["status"]}`,
                  )}
                </p>
                <p>{t("historyRun.session", { title: archive.descriptor.sessionTitle })}</p>
                <p>{t("historyRun.run", { id: archive.descriptor.runId })}</p>
                <p>{t("historyRun.updated", { time: date(archive.snapshot.run.updatedAt) })}</p>
                {archive.coordinatorState?.taskMode!=="discussion"&&<p className="ua-run-history__root">
                  {t("historyRun.archivedRoot", { root: archive.descriptor.projectRoot })}
                </p>}
              </header>
              <p
                role="status"
                className={
                  archive.completeness.complete ? "ua-run-history__hint" : "ua-run-history__warning"
                }
              >
                {t(
                  archive.completeness.complete ? "historyRun.complete" : "historyRun.incomplete",
                  { count: archive.messages.length },
                )}
              </p>
              {!dialogMessages.length && <p>{t("historyRun.noMessages")}</p>}
              <div className="ua-run-history__conversation">
                {dialogMessages.map((message, index) => (
                  <article
                    className={`ua-run-history__message ua-run-history__message--${message.role}`}
                    key={index}
                    aria-label={t(
                      message.role === "user" ? "historyRun.user" : "historyRun.assistant",
                    )}
                  >
                    <strong>
                      {t(message.role === "user" ? "historyRun.user" : "historyRun.assistant")}
                    </strong>
                    <ConversationMarkdown text={message.content} />
                  </article>
                ))}
              </div>
              {partialAssistantReplies.map(reply => (
                <article key={reply.requestId} className="ua-run-history__message ua-run-history__message--assistant">
                  <p className="ua-run-history__warning">{t("historyRun.partialStream")}</p>
                  <ConversationMarkdown text={reply.text} />
                </article>
              ))}
              {(archive.snapshot.toolCalls.length > 0 || toolMessages.length > 0) && (
                <details>
                  <summary>{t("historyRun.toolRecords")}</summary>
                  <pre>
                    {JSON.stringify(
                      { toolCalls: archive.snapshot.toolCalls, messages: toolMessages },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
              {archive.coordinatorState?.contextPlan !== undefined && (
                <details>
                  <summary>{t("historyRun.contextPlan")}</summary>
                  <pre>{JSON.stringify(archive.coordinatorState.contextPlan, null, 2)}</pre>
                </details>
              )}
              {archive.events.length > 0 && (
                <details>
                  <summary>{t("historyRun.events")}</summary>
                  <pre>{JSON.stringify(archive.events.filter(event => event.kind !== "model_text_delta").map(event => {
                    const data = event.data as { payload?: Record<string, unknown> };
                    if (!event.kind.startsWith("model_") || !data?.payload) return event;
                    const payload = { ...data.payload };
                    delete payload.messages; delete payload.responseText; delete payload.text;
                    return { ...event, data: { ...data, payload } };
                  }), null, 2)}</pre>
                </details>
              )}
              {systemMessages.length > 0 && (
                <details>
                  <summary>{t("historyRun.systemRecords")}</summary>
                  {systemMessages.map((message, index) => (
                    <pre key={index}>{message.role + "\n" + message.content}</pre>
                  ))}
                </details>
              )}
              <footer className="ua-run-history__continue">
                <p>{t(archive.coordinatorState?.taskMode==="discussion"?"responses.freshChatAuthorization":"historyRun.freshAuthorization")}</p>
                {unresolved && <p role="alert">{t("historyRun.reconciliation")}</p>}
                {!archive.coordinatorState && <p>{t("historyRun.noCoordinator")}</p>}
                <label>
                  <input
                    type="checkbox"
                    checked={shareCompletedContext}
                    disabled={
                      !canContinueNativeHistory(archive) || continuing || continuationDisabled
                    }
                    onChange={(event) => setShareCompletedContext(event.target.checked)}
                  />
                  {t(archive.coordinatorState?.taskMode==="discussion"?"responses.shareArchivedText":"historyRun.shareCompleted")}
                </label>
                <button
                  type="button"
                  onClick={() => void continueFromArchive()}
                  disabled={
                    !canContinueNativeHistory(archive) || continuationDisabled || continuing
                  }
                >
                  {t(continuing ? "historyRun.preparing" : "historyRun.continue")}
                </button>
                {continueError && <p role="alert">{t("historyRun.continueFailed")}</p>}
              </footer>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
