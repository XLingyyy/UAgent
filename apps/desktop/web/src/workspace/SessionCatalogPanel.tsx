import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { createNativeSessionCatalog, type NativeCatalogSession, type NativeSessionCatalogPort, type NativeSessionContinuation, type NativeSessionPage, type NativeSessionRecord } from "../runtime/native-session-catalog";
import type { NativeHistorySearchSelection } from "../runtime/native-run-history-search";
import { RunHistorySearch } from "./RunHistorySearch";
import "./SessionCatalogPanel.css";

const copy = {
  "zh-CN": {
    viewMessages: "查看消息", savedMessages: "已保存消息", readingMessages: "正在读取消息…", emptyMessages: "此会话没有已保存消息。", readCancelled: "已取消读取。", readHint: "仅查看已保存正文，不会发送请求或继续任务。", role: "角色", origin: "来源", messageNumber: "消息序号", systemRole: "系统", userRole: "用户", assistantRole: "助手", toolRole: "工具",
    "conflict": "会话已被其他操作修改。详情已刷新，请核对后再编辑。",
    "interrupted": "读取已因取消或执行时限停止，请重试。",
    "title": "会话管理",
    "close": "返回",
    "project": "当前项目",
    "choose": "选择项目后，可管理已保存的会话。",
    "include": "包括已归档会话",
    "filter": "筛选本页名称",
    "refresh": "刷新",
    "search": "搜索项目消息",
    "loading": "正在读取会话…",
    "empty": "没有匹配的会话。",
    "select": "选择会话以查看详情。",
    "previous": "上一页",
    "next": "下一页",
    "page": "页",
    "native": "原生会话",
    "historical": "历史文本副本",
    "archived": "已归档",
    "active": "未归档",
    "parent": "父会话",
    "created": "创建时间",
    "count": "消息数",
    "ordinal": "最后消息序号",
    "rename": "重命名",
    "archive": "归档",
    "unarchive": "取消归档",
    "branch": "从消息前缀创建分支",
    "newTitle": "会话名称",
    "through": "复制到消息序号（含）",
    "prefixHint": "0 表示空分支。保留完整正文和来源，最多 512 条、合计 1 MiB、单条 256 KiB；超限时请选择较小前缀。",
    "save": "保存",
    "create": "创建分支",
    "cancel": "取消",
    "pending": "正在处理…",
    "updated": "会话已保存。",
    "branched": "分支已创建，选择它可准备新任务。",
    "cancelled": "已取消等待。已提交的修改仍可能保存，完成后将刷新记录。",
    "readOnly": "历史文本副本保持只读。可先创建原生分支，再重命名、归档或续接。",
    "fresh": "续接会准备新任务，发送前仍需重新检查项目、来源和授权。",
    "share": "将完整的已保存消息作为新任务上下文",
    "continue": "准备续接会话",
    "continued": "已进入新任务准备，请核对后再发送。",
    "archivedHint": "取消归档后才能准备续接。",
    "unavailable": "会话操作暂不可用，请重试。",
    "capacity": "所选消息超出读取上限，未返回截断正文或部分分支。",
    "missing": "此项目中找不到该会话，请刷新。",
    "duplicate": "分支标识已存在，请刷新核对，避免重复创建。",
    "invalid": "名称或序号无效，或返回的记录未通过核对。",
    "busy": "本地存储忙，请稍后重试。",
    "titleFallback": "未命名会话",
    "preparing": "正在准备续接…",
    "cancelledLoad": "取消等待",
    "local": "这里管理本应用保存的会话记录。"
},
  en: {
    viewMessages: "View messages", savedMessages: "Saved messages", readingMessages: "Reading messages…", emptyMessages: "This session has no saved messages.", readCancelled: "Message reading cancelled.", readHint: "View saved text only. This does not send requests or continue a task.", role: "Role", origin: "Origin", messageNumber: "Message ordinal", systemRole: "System", userRole: "User", assistantRole: "Assistant", toolRole: "Tool",
    conflict: "This session field changed in another operation. Details were refreshed; review them before editing again.", interrupted: "The local query stopped because of cancellation or its execution budget. Refresh and retry.",
    title: "Sessions", close: "Back", project: "Current project", choose: "Select a project to manage its saved sessions.", include: "Include archived sessions", filter: "Filter names on this page", refresh: "Refresh", search: "Search project messages", loading: "Reading sessions…", empty: "No matching sessions.", select: "Select a session to view its details.", previous: "Previous", next: "Next", page: "Page", native: "Native session", historical: "Historical text copy", archived: "Archived", active: "Active", parent: "Parent session", created: "Created", count: "Messages", ordinal: "Last message ordinal", rename: "Rename", archive: "Archive", unarchive: "Unarchive", branch: "Branch a message prefix", newTitle: "Session name", through: "Copy through message ordinal (inclusive)", prefixHint: "0 creates an empty branch. Complete text and origins are preserved, up to 512 messages, 1 MiB total and 256 KiB per message. Choose a smaller prefix if it exceeds the budget.", save: "Save", create: "Create branch", cancel: "Cancel", pending: "Working…", updated: "Session saved.", branched: "Branch created. Select it to prepare a new task.", cancelled: "Returned to the catalog. A submitted local operation may still save; the catalog will refresh when it finishes.", readOnly: "Historical text copies remain unchanged. Create a native branch before renaming, archiving or continuing.", fresh: "Continue prepares a new task. Project, sources, outbound scope and any required authority are checked again before sending.", share: "Use the complete saved messages as context for the new task", continue: "Prepare continuation", continued: "Sent to new-task preparation. Review it before sending.", archivedHint: "Unarchive this session before continuing.", unavailable: "The session operation is unavailable. Refresh and retry.", capacity: "The selected prefix exceeds its byte or message budget. No truncated text or partial branch was returned.", missing: "This session is absent from this project. Refresh the catalog.", duplicate: "This branch ID already exists. Refresh to check the result before trying another branch.", invalid: "The name or ordinal is invalid, or a returned local record failed verification.", busy: "Local storage is busy. Try again shortly.", titleFallback: "Untitled session", preparing: "Preparing continuation…", cancelledLoad: "Cancel waiting", local: "These actions affect this application's saved session records.",
  },
} as const;
type Action = { kind: "rename" | "branch"; session: NativeCatalogSession; title: string; through: string; newSessionId: string };
type Operation = { kind: string; token: number; projectId: string; requestId: string; port: NativeSessionCatalogPort };
export interface SessionCatalogPanelProps {
  /** Persisted archive project ID, which may differ from a currently trusted root identity. */
  projectId: string | null;
  catalog?: NativeSessionCatalogPort;
  onClose?: () => void;
  onOpenArchive?: (selection: NativeHistorySearchSelection) => void;
  /** Must check isCurrent after its own awaits, revalidate sources and prepare a NEW task. Never auto-send. */
  onContinue: (request: NativeSessionContinuation, isCurrent: () => boolean) => void | Promise<void>;
  continuationDisabled?: boolean;
}
export function SessionCatalogPanel({ projectId, catalog, onClose, onOpenArchive, onContinue, continuationDisabled = false }: SessionCatalogPanelProps) {
  const { locale } = useI18n(), text = copy[locale];
  const port = useMemo(() => catalog ?? createNativeSessionCatalog(), [catalog]);
  const [includeArchived, setIncludeArchived] = useState(false), [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<NativeSessionPage | null>(null), [listBusy, setListBusy] = useState(false), [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<NativeCatalogSession | null>(null), [action, setAction] = useState<Action | null>(null), [filter, setFilter] = useState("");
  const [titleQuery,setTitleQuery]=useState("");
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [viewed, setViewed] = useState<{ record: NativeSessionRecord; scope: Operation } | null>(null);
  const [shareContext, setShareContext] = useState(false), [searching, setSearching] = useState(false);
  const mounted = useRef(true), sequence = useRef(0), listSequence = useRef(0), operation = useRef<Operation | null>(null);
  const context = useRef({ projectId, port });
  context.current = { projectId, port };
  const isScope = (scope: Operation) => mounted.current && context.current.projectId === scope.projectId && context.current.port === scope.port;
  const isCurrent = (scope: Operation) => isScope(scope) && sequence.current === scope.token;
  function requestCancellation(scope: Pick<Operation, "projectId" | "requestId" | "port"> | null) {
    if (scope) void scope.port.cancel({ projectId: scope.projectId, requestId: scope.requestId }).catch(() => undefined);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; listSequence.current++; requestCancellation(operation.current); }; }, []);
  useEffect(() => {
    if (operation.current && (operation.current.projectId !== projectId || operation.current.port !== port)) requestCancellation(operation.current);
    if (operation.current?.kind === "read") { operation.current = null; setPending(null); }
    sequence.current++;
    setViewed(null); setSelected(null); setAction(null); setError(null); setNotice(null); setShareContext(false); setSearching(false); setOffset(0);
  }, [projectId, port, includeArchived]);
  useEffect(()=>{setFilter("");setTitleQuery("");},[projectId,port]);
  useEffect(() => {
    const token = ++listSequence.current, project = projectId;
    setPage(null); setListError(false); setListBusy(Boolean(project));
    if (!project) return;
    let active = true;
    const requestId = "request-" + crypto.randomUUID();
    void port.list({ projectId: project, requestId, includeArchived, offset, limit: 30, ...(titleQuery ? {titleQuery} : {}) }).then(result => {
      if (active && mounted.current && listSequence.current === token && context.current.projectId === project && context.current.port === port) {
        setPage(result);
        // A refreshed catalog is authoritative for this page. Never retain writable stale
        // details if a session moved off the page or was filtered out by archiving.
        setSelected(previous => previous?.projectId === project ? result.sessions.find(value => value.id === previous.id) ?? null : null);
        setAction(previous => previous && result.sessions.some(value => value.id === previous.session.id) ? previous : null);
        setShareContext(false);
      }
    }, () => {
      if (active && mounted.current && listSequence.current === token && context.current.projectId === project && context.current.port === port) { setListError(true); setSelected(null); setAction(null); }
    }).finally(() => {
      if (active && mounted.current && listSequence.current === token) setListBusy(false);
    });
    return () => { active = false; requestCancellation({ projectId: project, requestId, port }); };
  }, [port, projectId, includeArchived, offset, refresh, titleQuery]);
  const currentSelection = !listBusy && selected?.projectId === projectId ? selected : null;
  const currentAction = action?.session.projectId === projectId ? action : null;
  const visiblePage = page?.projectId === projectId && page.includeArchived === includeArchived && page.offset === offset && (page.titleQuery ?? "") === titleQuery ? page : null;
  function describeError(value: unknown): string {
    const kind = value && typeof value === "object" && "kind" in value ? String(value.kind) : value instanceof Error ? value.message : "";
    if (kind === "branchCapacity" || kind === "catalogCapacity") return text.capacity;
    if (kind === "notFound" || kind === "notFoundOrReadOnly") return text.missing;
    if (kind === "readOnlyHistory") return text.readOnly;
    if (kind === "alreadyExists" || kind === "constraint") return text.duplicate;
    if (kind === "busy") return text.busy;
    if (kind === "conflict") return text.conflict;
    if (["catalogCancelled", "catalogDeadline", "catalogBudget"].includes(kind)) return text.interrupted;
    if (kind === "invalid" || kind === "native_session_catalog_invalid_record") return text.invalid;
    return text.unavailable;
  }
  function invalidate() { sequence.current++; setViewed(null); setAction(null); setShareContext(false); setError(null); }
  function cancel() {
    const reading = operation.current?.kind === "read";
    requestCancellation(operation.current); invalidate();
    setNotice(operation.current ? (reading ? text.readCancelled : text.cancelled) : null);
    if (reading) { operation.current = null; setPending(null); }
  }
  function close() { requestCancellation(operation.current); invalidate(); listSequence.current++; onClose?.(); }
  function select(value: NativeCatalogSession) { if (operation.current) return; invalidate(); setNotice(null); setSelected(value); }
  function begin(kind: Action["kind"]) {
    if (!currentSelection || operation.current) return;
    invalidate(); setNotice(null);
    // One stable ID per draft. A failed/uncertain submission retries the SAME ID.
    setAction({ kind, session: { ...currentSelection }, title: currentSelection.title, through: String(currentSelection.lastOrdinal), newSessionId: "session-" + crypto.randomUUID() });
  }
  async function run(kind: string, request: (scope: Operation) => Promise<void>) {
    if (!projectId || operation.current) return;
    const scope: Operation = { kind, token: ++sequence.current, projectId, requestId: "request-" + crypto.randomUUID(), port };
    operation.current = scope; setPending(kind); setError(null); setNotice(null);
    try { await request(scope); }
    catch (reason) {
      if (isCurrent(scope)) {
        setError(describeError(reason));
        if (reason && typeof reason === "object" && "kind" in reason && reason.kind === "conflict") setAction(null);
      }
    }
    finally {
      if (operation.current === scope) { operation.current = null; if (mounted.current) setPending(null); }
      if (kind !== "read" && isScope(scope)) setRefresh(value => value + 1);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft = currentAction;
    if (!draft || operation.current) return;
    const captured = { ...draft, session: { ...draft.session } };
    await run(captured.kind, async scope => {
      const result = captured.kind === "rename"
        ? await port.update({ projectId: captured.session.projectId, requestId: scope.requestId, sessionId: captured.session.id, patch: { kind: "rename", title: captured.title, expectedTitle: captured.session.title } })
        : await port.branch({ projectId: captured.session.projectId, requestId: scope.requestId, sessionId: captured.session.id, title: captured.title, throughOrdinal: Number(captured.through), newSessionId: captured.newSessionId });
      if (!isCurrent(scope)) return;
      setSelected(result.session); setAction(null); setShareContext(false); setOffset(0);
      setNotice(captured.kind === "branch" ? text.branched : text.updated);
    });
  }
  async function toggleArchive() {
    const saved = currentSelection && { ...currentSelection };
    if (!saved || saved.origin !== "native") return;
    await run("archive", async scope => {
      const result = await port.update({ projectId: saved.projectId, requestId: scope.requestId, sessionId: saved.id, patch: { kind: "setArchived", archived: !saved.archived, expectedArchived: saved.archived } });
      if (isCurrent(scope)) { setSelected(result.session); setNotice(text.updated); }
    });
  }
  async function viewMessages() {
    const saved = currentSelection && { ...currentSelection };
    if (!saved || operation.current) return;
    invalidate();
    await run("read", async scope => {
      const record = await port.read({ projectId: saved.projectId, requestId: scope.requestId, sessionId: saved.id, throughOrdinal: saved.lastOrdinal });
      if (!isCurrent(scope)) return;
      if (record.projectId !== saved.projectId || record.requestId !== scope.requestId || record.session.projectId !== saved.projectId || record.session.id !== saved.id || record.throughOrdinal !== saved.lastOrdinal) throw new Error("native_session_catalog_invalid_record");
      setViewed({ record, scope });
    });
  }
  const visibleMessages = viewed && isCurrent(viewed.scope) && viewed.record.session.id === currentSelection?.id ? viewed.record.messages : null;
  const roleNames = { system: text.systemRole, user: text.userRole, assistant: text.assistantRole, tool: text.toolRole };
  async function continueSession() {
    const saved = currentSelection && { ...currentSelection }, share = shareContext;
    if (!saved || saved.origin !== "native" || saved.archived || continuationDisabled) return;
    await run("continue", async scope => {
      const record = share ? await port.read({ projectId: saved.projectId, requestId: scope.requestId, sessionId: saved.id, throughOrdinal: saved.lastOrdinal }) : null;
      if (!isCurrent(scope)) return;
      if (record && (record.session.archived || record.session.origin !== "native")) throw new Error("native_session_catalog_invalid_record");
      await onContinue({ session: record?.session ?? saved, shareContext: share, messages: record?.messages ?? [], requiresFreshAuthorization: true }, () => isCurrent(scope));
      if (isCurrent(scope)) setNotice(text.continued);
    });
  }
  const date = (value: number) => Number.isNaN(new Date(value).valueOf()) ? String(value) : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  if (searching && projectId) return <RunHistorySearch key={projectId} projectId={projectId} onOpenArchive={onOpenArchive} onClose={() => { invalidate(); setSearching(false); }} />;
  return <section className="ua-session-catalog" aria-label={text.title}>
    <header className="ua-session-catalog__header"><h2>{text.title}</h2>{onClose && <button type="button" onClick={close}>{text.close}</button>}</header>
    <p className="ua-session-catalog__hint">{text.local}</p>
    {!projectId ? <p>{text.choose}</p> : <>
      <div className="ua-session-catalog__controls">
        <label><input type="checkbox" checked={includeArchived} disabled={Boolean(pending)} onChange={event => setIncludeArchived(event.target.checked)} />{text.include}</label>
        <button type="button" disabled={listBusy || Boolean(pending)} onClick={() => { invalidate(); setRefresh(value => value + 1); }}>{text.refresh}</button>
        <button type="button" disabled={Boolean(pending)} onClick={() => { invalidate(); setSearching(true); }}>{text.search}</button>
      </div>
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
      {pending && <p role="status">{pending === "continue" ? text.preparing : pending === "read" ? text.readingMessages : text.pending} <button type="button" onClick={cancel}>{text.cancelledLoad}</button></p>}
      <div className="ua-session-catalog__layout">
        <nav className="ua-session-catalog__list" aria-label={text.title} aria-busy={listBusy}>
          <form onSubmit={event=>{event.preventDefault();invalidate();setSelected(null);setOffset(0);setTitleQuery(filter.trim());setRefresh(v=>v+1);}}>
            <label>{locale==="zh-CN"?"搜索本项目全部会话名称":"Search all session names in this project"}<input maxLength={256} value={filter} onChange={event=>setFilter(event.target.value)} disabled={Boolean(pending)}/></label>
            <button type="submit" disabled={Boolean(pending)}>{locale==="zh-CN"?"搜索名称":"Search names"}</button>
            <button type="button" disabled={Boolean(pending)||(!titleQuery&&!filter)} onClick={()=>{invalidate();setSelected(null);setFilter("");setTitleQuery("");setOffset(0);}}>{locale==="zh-CN"?"清除搜索":"Clear search"}</button>
          </form>
          <p>{locale==="zh-CN"?"按名称中的原样文本匹配，英文字母不区分大小写；分页显示匹配结果。":"Matches literal text in names, ignoring ASCII letter case. Pages contain matching sessions only."}</p>
          {listBusy && <p role="status">{text.loading}</p>}{listError && <p role="alert">{text.unavailable}</p>}
          {visiblePage && !visiblePage.sessions.length && <p>{text.empty}</p>}
          {visiblePage?.sessions.map(value => <button type="button" className="ua-session-catalog__entry" key={value.id} aria-pressed={currentSelection?.id === value.id} disabled={Boolean(pending)} onClick={() => select(value)}>
            <strong>{value.title || text.titleFallback}</strong><span>{value.origin === "native" ? text.native : text.historical} · {value.archived ? text.archived : text.active}</span><span>{text.count}: {value.messageCount}</span>
          </button>)}
          <div className="ua-session-catalog__pagination">
            <button type="button" disabled={!offset || listBusy || Boolean(pending)} onClick={() => { invalidate(); setOffset(value => Math.max(0, value - 30)); }}>{text.previous}</button>
            <span>{text.page} {Math.floor(offset / 30) + 1}</span>
            <button type="button" disabled={!visiblePage?.hasMore || listBusy || Boolean(pending)} onClick={() => { invalidate(); setOffset(value => value + 30); }}>{text.next}</button>
          </div>
        </nav>
        <div className="ua-session-catalog__detail">
          {!currentSelection ? <p>{text.select}</p> : <>
            <h3>{currentSelection.title || text.titleFallback}</h3>
            <dl><dt>{text.project}</dt><dd>{currentSelection.projectId}</dd><dt>ID</dt><dd>{currentSelection.id}</dd><dt>{text.created}</dt><dd>{date(currentSelection.createdAt)}</dd><dt>{text.count}</dt><dd>{currentSelection.messageCount}</dd><dt>{text.ordinal}</dt><dd>{currentSelection.lastOrdinal}</dd>{currentSelection.parentId && <><dt>{text.parent}</dt><dd>{currentSelection.parentId}</dd></>}</dl>
            {currentSelection.origin === "historicalTextCopy" && <p className="ua-session-catalog__hint">{text.readOnly}</p>}
            <div className="ua-session-catalog__actions">
              <button type="button" disabled={Boolean(pending) || currentSelection.origin !== "native"} onClick={() => begin("rename")}>{text.rename}</button>
              <button type="button" disabled={Boolean(pending) || currentSelection.origin !== "native"} onClick={() => void toggleArchive()}>{currentSelection.archived ? text.unarchive : text.archive}</button>
              <button type="button" disabled={Boolean(pending)} onClick={() => begin("branch")}>{text.branch}</button>
            </div>
            <section className="ua-session-catalog__messages" aria-label={text.savedMessages}>
              <button type="button" disabled={Boolean(pending)} onClick={() => void viewMessages()}>{text.viewMessages}</button>
              <p className="ua-session-catalog__hint">{text.readHint}</p>
              {visibleMessages && (visibleMessages.length === 0 ? <p role="status">{text.emptyMessages}</p> :
                <ol>{visibleMessages.map(message => <li key={message.id}>
                  <dl><dt>{text.messageNumber}</dt><dd>{message.ordinal}</dd><dt>{text.role}</dt><dd>{roleNames[message.role]}</dd><dt>{text.origin}</dt><dd>{message.origin === "native" ? text.native : text.historical}</dd></dl>
                  <pre className="ua-session-catalog__message-body">{message.body}</pre>
                </li>)}</ol>)}
            </section>
            {currentAction && <form onSubmit={event => void submit(event)} className="ua-session-catalog__form" aria-label={currentAction.kind === "rename" ? text.rename : text.branch}>
              <label>{text.newTitle}<input value={currentAction.title} required maxLength={1024} disabled={Boolean(pending)} onChange={event => setAction(value => value && { ...value, title: event.target.value })} /></label>
              {currentAction.kind === "branch" && <><label>{text.through}<input type="number" min={0} max={currentAction.session.lastOrdinal} step={1} required value={currentAction.through} disabled={Boolean(pending)} onChange={event => setAction(value => value && { ...value, through: event.target.value })} /></label><p className="ua-session-catalog__hint">{text.prefixHint}</p></>}
              <div className="ua-session-catalog__actions"><button type="submit" disabled={Boolean(pending)}>{pending ? text.pending : currentAction.kind === "rename" ? text.save : text.create}</button><button type="button" onClick={cancel}>{text.cancel}</button></div>
            </form>}
            <footer className="ua-session-catalog__continue"><p>{text.fresh}</p>{currentSelection.archived && <p>{text.archivedHint}</p>}
              <label><input type="checkbox" checked={shareContext} disabled={Boolean(pending) || currentSelection.origin !== "native" || currentSelection.archived} onChange={event => setShareContext(event.target.checked)} />{text.share}</label>
              <button type="button" disabled={Boolean(pending) || continuationDisabled || currentSelection.origin !== "native" || currentSelection.archived || Boolean(currentAction)} onClick={() => void continueSession()}>{text.continue}</button>
            </footer>
          </>}
        </div>
      </div>
    </>}
  </section>;
}
