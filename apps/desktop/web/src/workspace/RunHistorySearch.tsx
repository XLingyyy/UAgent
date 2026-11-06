import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { NativeOperationReview } from "../operation-review/NativeOperationReview";
import {
  createNativeRunHistorySearch,
  type NativeHistorySearchHit,
  type NativeHistorySearchPage,
  type NativeHistorySearchSelection,
  type NativeRunHistorySearchPort,
} from "../runtime/native-run-history-search";
import "./RunHistoryPanel.css";

const PAGE_SIZE = 30;
const messages = {
  "zh-CN": {
    title: "搜索本地历史", query: "搜索已保存消息", search: "搜索", hint: "按当前项目搜索保存的消息正文（含消息封装文本），每页最多 30 条；按字面匹配，ASCII 字母忽略大小写。",
    choose: "选择一个已有项目后可搜索其本地历史。", loading: "正在读取本地记录…", error: "历史搜索不可用，请重新搜索。", openError: "档案已变化、消息未加载或身份不匹配，请重新搜索。",
    empty: "未找到匹配消息。", open: "核验并打开档案", noArchive: "该消息没有可核验的 Run 档案。", previous: "上一页", next: "下一页", page: "页", session: "会话", message: "消息", run: "Run", clipped: "仅显示匹配附近的片段。", select: "选择搜索结果以核验档案。", matched: "已核验的目标消息", close: "关闭", role: "角色",
  },
  en: {
    title: "Search local history", query: "Search saved messages", search: "Search", hint: "Search saved message bodies (including their message envelopes) in this project, up to 30 results per page. Matching is literal and case insensitive for ASCII letters.",
    choose: "Select an existing project to search its local history.", loading: "Reading local records…", error: "History search is unavailable. Search again.", openError: "The archive changed, the message was not loaded, or identities disagree. Search again.",
    empty: "No matching messages.", open: "Verify and open archive", noArchive: "This message has no verifiable Run archive.", previous: "Previous", next: "Next", page: "Page", session: "Session", message: "Message", run: "Run", clipped: "Only a snippet near the match is shown.", select: "Select a search result to verify its archive.", matched: "Verified matching message", close: "Close", role: "Role",
  },
} as const;
export interface RunHistorySearchProps {
  /** The actual persisted project identity, including chat:project:... for chat archives. */
  projectId: string | null;
  search?: NativeRunHistorySearchPort;
  /** Retain local view state while details are shown; pending work is invalidated. */
  active?: boolean;
  /** Navigation only. Receives the verified archive plus its precise message/run identity. */
  onOpenArchive?: (selection: NativeHistorySearchSelection) => void;
  onClose?: () => void;
}
export function RunHistorySearch({ projectId, search, active = true, onOpenArchive, onClose }: RunHistorySearchProps) {
  const { locale } = useI18n(), text = messages[locale];
  const port = useMemo(() => search ?? createNativeRunHistorySearch(), [search]);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<NativeHistorySearchPage | null>(null);
  const [selection, setSelection] = useState<NativeHistorySearchSelection | null>(null);
  const [busy, setBusy] = useState(false), [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<"search" | "open" | null>(null);
  const generation = useRef(0), mounted = useRef(true);
  const context = useRef({ projectId, port, active });
  context.current = { projectId, port, active };
  const onOpen = useRef(onOpenArchive);
  onOpen.current = onOpenArchive;
  const messageElement = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);
  useEffect(() => {
    generation.current++;
    setDraft(""); setPage(null); setSelection(null); setBusy(false); setOpening(null); setError(null);
  }, [projectId, port]);
  useEffect(() => {
    if (!active) { generation.current++; setBusy(false); setOpening(null); }
  }, [active]);
  useEffect(() => { if (active) messageElement.current?.focus(); }, [selection, active]);
  const current = (token: number, project: string) => mounted.current && context.current.active && generation.current === token && context.current.projectId === project && context.current.port === port;
  function clearResults() {
    generation.current++;
    setPage(null); setSelection(null); setBusy(false); setOpening(null); setError(null);
  }
  async function load(query: string, offset: number) {
    if (!projectId) return;
    const project = projectId, token = ++generation.current;
    setBusy(true); setError(null); setOpening(null); setPage(null); setSelection(null);
    try {
      const result = await port.search({ projectId: project, query, offset, limit: PAGE_SIZE });
      if (current(token, project)) setPage(result);
    } catch {
      if (current(token, project)) setError("search");
    } finally {
      if (current(token, project)) setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.trim() && !busy) void load(draft, 0);
  }
  async function open(hit: NativeHistorySearchHit) {
    if (!projectId || hit.projectId !== projectId || !hit.archiveCandidate) return;
    const project = projectId, token = ++generation.current;
    setSelection(null); setOpening(JSON.stringify([hit.sessionId, hit.messageId])); setError(null);
    try {
      const result = await port.open(hit);
      if (current(token, project)) { setSelection(result); onOpen.current?.(result); }
    } catch {
      if (current(token, project)) setError("open");
    } finally {
      if (current(token, project)) setOpening(null);
    }
  }
  const visiblePage = page?.projectId === projectId ? page : null;
  const visibleSelection = selection?.identity.projectId === projectId ? selection : null;
  const selectedIndex = visibleSelection ? visibleSelection.archive.messages.findIndex((message) => message.id === visibleSelection.messageId) : -1;
  const matched = visibleSelection && selectedIndex >= 0 ? visibleSelection.archive.providerMessages[selectedIndex]?.content ?? visibleSelection.archive.messages[selectedIndex].body : null;
  return <section className="ua-run-history" aria-label={text.title}>
    <header className="ua-run-history__header"><h2>{text.title}</h2>{onClose && <button type="button" onClick={onClose}>{text.close}</button>}</header>
    <p className="ua-run-history__hint">{text.hint}</p>
    {!projectId && <p role="status">{text.choose}</p>}
    <form className="ua-run-history__controls" role="search" onSubmit={submit}>
      <label style={{ flex: 1, minWidth: 0 }}>{text.query}<input type="search" value={draft} maxLength={1024} disabled={!projectId} onChange={(event) => { setDraft(event.target.value); clearResults(); }} style={{ width: "100%", boxSizing: "border-box", font: "inherit", color: "inherit", background: "var(--ua-surface, #202735)", padding: "8px", border: "1px solid var(--ua-border, #3a4556)" }} /></label>
      <button type="submit" disabled={!projectId || !draft.trim() || Array.from(draft).length > 512 || new TextEncoder().encode(draft).length > 2048 || busy}>{text.search}</button>
    </form>
    <div className="ua-run-history__layout">
      <nav className="ua-run-history__catalog" aria-label={text.title} aria-busy={busy}>
        {busy && <p role="status">{text.loading}</p>}
        {error === "search" && <p role="alert">{text.error}</p>}
        {visiblePage && !visiblePage.messages.length && <p role="status">{text.empty}</p>}
        {visiblePage?.messages.map((hit) => {
          const key = JSON.stringify([hit.sessionId, hit.messageId]);
          return <article key={key} className="ua-run-history__message">
            <p>{text.session}: {hit.sessionId}</p><p>{text.message}: {hit.messageId}</p><p>{text.role}: {hit.role}</p>
            <p style={{ whiteSpace: "pre-wrap" }}>{hit.preview}</p>
            {hit.previewTruncated && <p className="ua-run-history__hint">{text.clipped}</p>}
            {hit.archiveCandidate ? <><p>{text.run}: {hit.archiveCandidate.runId}</p><button type="button" aria-pressed={visibleSelection?.identity.sessionId === hit.sessionId && visibleSelection?.messageId === hit.messageId} aria-busy={opening === key} disabled={busy || opening !== null} onClick={() => void open(hit)}>{opening === key ? text.loading : text.open}</button></> : <p className="ua-run-history__hint">{text.noArchive}</p>}
          </article>;
        })}
        {visiblePage && <div className="ua-run-history__pagination">
          <button type="button" disabled={visiblePage.offset === 0 || busy || opening !== null} onClick={() => void load(visiblePage.query, Math.max(0, visiblePage.offset - PAGE_SIZE))}>{text.previous}</button>
          <span>{text.page} {Math.floor(visiblePage.offset / PAGE_SIZE) + 1}</span>
          <button type="button" disabled={!visiblePage.hasMore || visiblePage.offset + PAGE_SIZE > 1_000_000 || busy || opening !== null} onClick={() => void load(visiblePage.query, visiblePage.offset + PAGE_SIZE)}>{text.next}</button>
        </div>}
      </nav>
      <div className="ua-run-history__record" aria-busy={opening !== null}>
        {error === "open" && <p role="alert">{text.openError}</p>}
        {opening !== null ? <p role="status">{text.loading}</p> : visibleSelection ? <>
          <article ref={messageElement} tabIndex={-1} className="ua-run-history__message" aria-label={text.matched}>
            <h3>{text.matched}</h3><p>{text.message}: {visibleSelection.messageId}</p><pre>{matched}</pre>
          </article>
          <NativeOperationReview archive={visibleSelection.archive} />
        </> : <p>{text.select}</p>}
      </div>
    </div>
  </section>;
}
