import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "../i18n";
import { useProjectStore } from "../stores/ui-store";
import {
  nativeUESemanticRead, UESemanticReadInspectionError, type NativeUESemanticRead,
  type UESemanticReadAvailability, type UESemanticReadInspectionErrorKind,
} from "../runtime/native-ue-semantic-read";

const copy = {
  "zh-CN": {
    launch: "UE 语义读取", title: "UE 语义读取接入检查", close: "关闭", project: "当前项目", inspect: "检查接入条件", inspecting: "正在检查项目…",
    blocked: "此通用入口未发出查询 · 未返回资产数据",
    explanation: "普通工程的受管只读启动和蓝图查询已接入 UE Editor 面板。这里保留旧的根目录检查，不会连接 UE；下方旧检查项不代表新启动流程的运行验收。",
    needProject: "请先在项目设置中选择并信任一个本机项目。", unavailable: "当前环境没有连接原生接入检查接口。",
    rootCurrent: "检查时项目根目录句柄有效", checkedAt: "检查时间", observation: "这是一次条件检查，不是资产读取结果，也不会建立读取授权。",
    prerequisites: "真实只读查询仍需完成", notIntegrated: "未接入", notChecked: "未检查",
    labels: {
      owned_editor_connection: "绑定当前编辑器进程和项目的原生连接",
      native_semantic_read_grant: "明确的资产读取范围与有效授权",
      exact_v2_negotiation: "v2 插件版本、能力和完整 schema 核对",
      request_bound_result_provenance: "结果与原始请求的校验及本机来源记录",
    },
    boundary: "后续只读查询也必须禁止自动加载、编译或保存 Blueprint。冷资产加载需要独立的明确授权；已有 v1 或 Lab 许可不能代替此读取边界。",
    errors: {
      unavailable: "原生接入检查暂不可用，请确认此版本已接入对应接口。", trust: "项目的原生信任已失效，请从项目设置重新确认。",
      busy: "已有条件检查正在进行，请稍后重试。", invalid_response: "返回内容与禁用的读取边界不一致，已停止显示。",
    },
  },
  en: {
    launch: "UE semantic reads", title: "UE semantic read integration", close: "Close", project: "Current project", inspect: "Check prerequisites", inspecting: "Checking project…",
    blocked: "Generic semantic query entry disabled · No query sent · No asset data returned",
    explanation: "Managed read-only startup and Blueprint queries are available in the UE Editor panel. This legacy root inspector does not connect to UE; its prerequisite list is not an acceptance report for the new startup flow.",
    needProject: "Select and trust a local project in project settings first.", unavailable: "The native integration inspection interface is unavailable in this environment.",
    rootCurrent: "The project-root handle was current when checked", checkedAt: "Checked at", observation: "This is a prerequisite observation, not an asset read result. It establishes no read authority.",
    prerequisites: "Still required for a real read-only query", notIntegrated: "Not integrated", notChecked: "Not checked",
    labels: {
      owned_editor_connection: "Native connection bound to the current editor process and project",
      native_semantic_read_grant: "An explicit asset read scope and current authorization",
      exact_v2_negotiation: "Exact v2 plugin version, capabilities and complete schemas",
      request_bound_result_provenance: "Validation against the original request and local result provenance",
    },
    boundary: "Future read-only queries must not automatically load, compile or save Blueprints. Loading cold assets requires distinct explicit authority. Existing v1 or Lab permissions cannot supply this read boundary.",
    errors: {
      unavailable: "Native inspection is unavailable. Check that this version includes its native integration.", trust: "The native project lease is no longer current. Confirm the project in settings again.",
      busy: "Another inspection is in progress. Try again shortly.", invalid_response: "The response does not match the disabled read boundary and has been discarded.",
    },
  },
};
const styles = {
  launcher: { position: "fixed", left: 18, bottom: 154, width: 180, zIndex: 100, padding: 9, border: "1px solid var(--ua-border-strong)", borderRadius: 6, background: "var(--ua-bg-elevated)", color: "var(--ua-text-secondary)", cursor: "pointer" },
  dialog: { width: "min(720px, calc(100vw - 32px))", maxHeight: "calc(100dvh - 48px)", padding: 0, border: "1px solid var(--ua-border-strong)", borderRadius: 10, color: "var(--ua-text-primary)", background: "var(--ua-bg-surface)", overflow: "auto" },
  body: { padding: 24, display: "grid", gap: 16, color: "var(--ua-text-primary)", background: "var(--ua-bg-surface)" },
  muted: { margin: 0, color: "var(--ua-text-secondary)", lineHeight: 1.6, fontSize: 13 },
  button: { padding: "8px 12px", border: "1px solid var(--ua-border-strong)", borderRadius: 5, color: "var(--ua-text-primary)", background: "var(--ua-bg-elevated)", font: "inherit", cursor: "pointer" },
  header: { display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between" },
} satisfies Record<string, CSSProperties>;

function BoundaryInspector({ client, titleId, onClose }: { client: NativeUESemanticRead; titleId: string; onClose?: () => void }) {
  const { locale } = useI18n(), words = copy[locale];
  const project = useProjectStore(s => s.registeredProjects.find(p => p.id === s.activeProjectId) ?? null);
  const source = useProjectStore(s => s.nativeSource);
  const key = `${project?.id ?? ""}:${project?.trustState ?? ""}:${project?.updatedAt ?? ""}:${source}`;
  const ready = Boolean(project?.trustState === "trusted" && source === "native" && client.available());
  const [busy, setBusy] = useState(false), [error, setError] = useState<UESemanticReadInspectionErrorKind | null>(null);
  const [observation, setObservation] = useState<{ context: string; data: UESemanticReadAvailability } | null>(null);
  const generation = useRef(0), statusId = useId();
  useEffect(() => {
    setBusy(false); setError(null); setObservation(null);
    return () => { generation.current++; };
  }, [key, client]);
  async function inspect() {
    if (!ready || busy || !project) return;
    const request = ++generation.current;
    setBusy(true); setError(null); setObservation(null);
    try {
      const data = await client.inspect(project.id);
      if (request === generation.current) setObservation({ context: key, data });
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof UESemanticReadInspectionError ? failure.kind : "unavailable");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  const current = observation?.context === key && ready ? observation.data : null;
  return <section style={styles.body} aria-labelledby={titleId} aria-describedby={statusId} aria-busy={busy}>
    <div style={styles.header}><h2 id={titleId} style={{ margin: 0, fontSize: 19 }}>{words.title}</h2>
      {onClose && <button type="button" style={styles.button} onClick={onClose}>{words.close}</button>}</div>
    <p style={styles.muted}>{words.project}: <strong>{project?.name ?? "—"}</strong>{project && <> · {project.displayRoot}</>}</p>
    <p id={statusId} style={{ ...styles.muted, color: "var(--ua-warning)" }}>{words.blocked}</p>
    <p style={styles.muted}>{words.explanation}</p>
    {!project || project.trustState !== "trusted" || source !== "native" ? <p role="status" style={styles.muted}>{words.needProject}</p> :
      !client.available() ? <p role="status" style={styles.muted}>{words.unavailable}</p> : null}
    <div><button type="button" style={styles.button} disabled={!ready || busy} onClick={() => void inspect()}>{busy ? words.inspecting : words.inspect}</button></div>
    <div aria-live="polite">
      {error && <p role="alert" style={{ ...styles.muted, color: "var(--ua-warning)" }}>{words.errors[error]}</p>}
      {current && <><p style={styles.muted}>{words.rootCurrent}</p><p style={styles.muted}>{words.checkedAt}: {new Date(current.observedAtMs).toLocaleString(locale)}</p></>}
    </div>
    {current && <>
      <h3 style={{ margin: 0, fontSize: 14 }}>{words.prerequisites}</h3>
      <ul style={{ display: "grid", gap: 12, paddingLeft: 20, margin: 0 }}>
        {current.prerequisites.map(item => <li key={item.id} style={styles.muted}>{words.labels[item.id]} · <strong>{item.status === "not_integrated" ? words.notIntegrated : words.notChecked}</strong></li>)}
      </ul>
      <p style={styles.muted}>{words.observation}</p>
    </>}
    <p style={styles.muted}>{words.boundary}</p>
  </section>;
}

/** Mount inside UIProvider. inline=true embeds the inspection in project settings.
 * This is an explicit blocked integration surface, with no query/asset-load action. */
export function UESemanticReadPanel({ client = nativeUESemanticRead, inline = false }: { client?: NativeUESemanticRead; inline?: boolean }) {
  const { locale } = useI18n(), [open, setOpen] = useState(false), titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node || inline) return;
    if (!node.open) node.showModal();
    return () => { if (node.open) node.close(); };
  }, [open, inline]);
  if (inline) return <BoundaryInspector client={client} titleId={titleId}/>;
  return <>
    <button type="button" style={styles.launcher} onClick={() => setOpen(true)} disabled={open}>{copy[locale].launch}</button>
    {open && <>
      <style>{".ua-semantic-read-inspection::backdrop{background:rgba(8,13,11,.8)}.ua-semantic-read-inspection button:focus-visible{outline:2px solid var(--ua-accent);outline-offset:2px}.ua-semantic-read-inspection button:disabled{opacity:.5;cursor:default}"}</style>
      <dialog ref={dialog} className="ua-semantic-read-inspection" style={styles.dialog} aria-labelledby={titleId}
        onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={event => { if (!event.currentTarget.open) setOpen(false); }}>
        <BoundaryInspector client={client} titleId={titleId} onClose={() => setOpen(false)}/>
      </dialog>
    </>}
  </>;
}
