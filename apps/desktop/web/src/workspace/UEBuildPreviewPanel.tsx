import { UEApprovedBuildAction } from "./UEApprovedBuildAction";
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { useProjectStore, useRuntimeStore } from "../stores/ui-store";
import {
  nativeUEBuildPreview, UEBuildPreviewError, validateUEBuildPreviewConfiguration,
  type NativeUEBuildPreview, type UEBuildPreviewConfiguration, type UEBuildPreviewErrorKind, type UEBuildPreviewReceipt,
} from "../runtime/native-ue-build-preview";

// Local copy keeps this independently owned slice out of the central language files.
const copy = {
  "zh-CN": {
  "title": "UE 构建预览",
  "close": "关闭",
  "project": "当前项目",
  "noProject": "请先在项目设置中选择并信任一个本地项目。",
  "unavailable": "当前环境没有可用的原生预览接口。",
  "taskBusy": "请等待当前任务结束后再准备预览。",
  "fixed": "固定目标：Win64 · Development · Editor · UBT；构建超时配置为 10 分钟。",
  "hint": "填写安装目录、项目相对路径和准确的 Editor 目标。这里只读取配置，不启动引擎或构建。",
  "engine": "引擎安装目录",
  "uproject": ".uproject 相对路径",
  "target": "Editor 目标名称",
  "dotnet": "引擎附带的 .NET 目录版本",
  "engineHint": "例如 G:/UnrealEngine/UE_5.8",
  "uprojectHint": "例如 MyGame.uproject",
  "targetHint": "例如 MyGameEditor",
  "dotnetHint": "使用实际目录版本，例如 10.0",
  "prepare": "准备命令预览",
  "preparing": "正在读取并准备…",
  "clear": "清除预览",
  "status": "仅预览 · 未执行 · 未验证",
  "expires": "预览到期时间",
  "fingerprint": "配置与输入文件 SHA-256",
  "version": "引擎版本",
  "program": "程序",
  "arguments": "参数顺序",
  "cwd": "工作目录",
  "source": "目标规则文件",
  "projectFile": "项目文件",
  "snapshot": "本快照包含项目文件、目标规则、引擎版本和固定入口，不包含全部源码。修改配置、切换项目或两分钟后请重新准备。",
  "pending": "自动执行尚未开放。预览不证明构建、PIE 或自动化验证通过。",
  "effects": "实际构建会生成产物并可能执行项目构建逻辑；本步骤没有执行这些操作。",
  "errors": {
    "unavailable": "原生预览暂不可用。",
    "busy": "另一个预览正在准备，请稍后重试。",
    "trust": "项目访问已失效，请在项目设置中重新确认。",
    "input": "请核对路径、EngineAssociation、Editor 目标和实际 .NET 目录版本。",
    "source": "无法稳定读取输入文件，文件可能缺失、被占用或已经改变。",
    "capacity": "预览数量已达上限，请关闭旧预览后重试。",
    "invalid_receipt": "预览结果与请求不匹配，已停止显示。",
    "expired": "预览已过期，请重新准备。"
  }
},
  en: {
    title: "UE build preview", close: "Close", project: "Current project", noProject: "Select and trust a local project in project settings first.",
    unavailable: "The native preview interface is unavailable in this environment.", taskBusy: "Wait for the current task to finish before preparing a build preview.",
    fixed: "Fixed target: Win64 · Development · Editor · UBT; the future build timeout is 10 minutes.",
    hint: "Enter the installed engine directory, project-relative file and exact Editor target. Preparation reads build metadata without starting the engine or a build.",
    engine: "Engine installation directory", uproject: ".uproject relative path", target: "Editor target name", dotnet: "Engine-bundled .NET directory version",
    engineHint: "For example G:/UnrealEngine/UE_5.8", uprojectHint: "For example MyGame.uproject", targetHint: "For example MyGameEditor", dotnetHint: "Use the exact on-disk directory version, for example 10.0",
    prepare: "Prepare command preview", preparing: "Reading and preparing…", clear: "Clear preview", status: "Preview only · Not executed · Not verified",
    expires: "Preview expires", fingerprint: "SHA-256 fingerprint of build configuration and input files", version: "Engine version", program: "Fixed program", arguments: "Arguments, in order",
    cwd: "Working directory", source: "Target rules file", projectFile: "Project file", snapshot: "This snapshot fingerprints the project file, Target rules, engine version and fixed entrypoints, not the entire source tree. Prepare again after editing configuration, switching projects or two minutes. The fingerprint is not an approval.",
    pending: "Prepare the preview, then request native approval for one build. No automatic repair, retry, PIE or automation run is enabled.",
    effects: "A future build may write build artifacts and run project build logic. Preparation has performed neither operation.",
    errors: {
      unavailable: "Native preview is unavailable. Check that this version includes its native integration.", busy: "Another preview is being prepared. Try again shortly.", trust: "The native project lease is no longer current. Confirm the project in settings again.",
      input: "Unsupported configuration. Check paths, EngineAssociation, the Editor target and exact .NET directory version.", source: "Required files could not be read consistently. They may be missing, oversized, busy or changed.",
      capacity: "The native preview limit has been reached. Clear an older preview or try again later.", invalid_receipt: "The preview response does not match the fixed configuration and has been discarded.", expired: "This preview expired. Prepare it again.",
    },
  },
};
const styles = {
  dialog: { width: "min(840px, calc(100vw - 32px))", maxHeight: "calc(100dvh - 48px)", padding: 0, border: "1px solid var(--ua-border-strong)", borderRadius: 10, color: "var(--ua-text-primary)", background: "var(--ua-bg-surface)", overflow: "auto" },
  form: { padding: 24, display: "grid", gap: 16, color: "var(--ua-text-primary)", background: "var(--ua-bg-surface)" },
  header: { display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 16 },
  field: { display: "grid", gap: 6, fontSize: 13 },
  input: { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "9px 10px", border: "1px solid var(--ua-border-strong)", borderRadius: 5, color: "var(--ua-text-primary)", background: "var(--ua-bg-input)", font: "inherit" },
  muted: { margin: 0, color: "var(--ua-text-secondary)", lineHeight: 1.6, fontSize: 13 },
  button: { padding: "8px 12px", border: "1px solid var(--ua-border-strong)", borderRadius: 5, color: "var(--ua-text-primary)", background: "var(--ua-bg-elevated)", font: "inherit", cursor: "pointer" },
  code: { fontFamily: "var(--ua-font-mono)", overflowWrap: "anywhere", whiteSpace: "pre-wrap", fontSize: 12 },
  details: { display: "grid", gap: 12, margin: 0 },
  term: { color: "var(--ua-text-secondary)", fontSize: 12, marginBottom: 4 },
  value: { margin: 0, overflowWrap: "anywhere", fontSize: 13 },
} satisfies Record<string, CSSProperties>;
const emptyDraft = () => ({ engineRoot: "", uprojectRelativePath: "", target: "", bundledDotnetVersion: "" });
type Draft = ReturnType<typeof emptyDraft>;

function PreviewForm({ client, titleId, onClose }: { client: NativeUEBuildPreview; titleId: string; onClose?: () => void }) {
  const { locale } = useI18n(), words = copy[locale];
  const [executing, setExecuting] = useState(false), [buildConsumed, setBuildConsumed] = useState(false);
  const project = useProjectStore(s => s.registeredProjects.find(p => p.id === s.activeProjectId) ?? null);
  const nativeSource = useProjectStore(s => s.nativeSource);
  const taskBusy = useRuntimeStore(s => {
    const task = s.activeTaskId ? s.tasksById[s.activeTaskId] : null;
    return Boolean(task && !["completed", "failed", "cancelled"].includes(task.state));
  });
  const [draft, setDraft] = useState<Draft>(emptyDraft), [busy, setBusy] = useState(false);
  const [observed, setObserved] = useState<UEBuildPreviewReceipt | null>(null);
  const [error, setError] = useState<UEBuildPreviewErrorKind | null>(null);
  const generation = useRef(0), held = useRef<UEBuildPreviewReceipt | null>(null), observedContext = useRef("");
  const projectKey = `${project?.id ?? ""}:${project?.trustState ?? ""}:${project?.updatedAt ?? ""}:${nativeSource}`;
  const ready = Boolean(project?.trustState === "trusted" && nativeSource === "native" && client.available() && !taskBusy);
  const configuration: UEBuildPreviewConfiguration = { projectId: project?.id ?? "", ...draft };
  const release = (receipt: UEBuildPreviewReceipt | null) => { if (receipt) void client.release(receipt).catch(() => undefined); };
  function invalidate() {
    generation.current++; setBuildConsumed(false); setExecuting(false);
    release(held.current); held.current = null; setObserved(null); setError(null);
  }
  useEffect(() => {
    setDraft(emptyDraft()); setObserved(null); setError(null); setBusy(false); setBuildConsumed(false); setExecuting(false);
    return () => {
      generation.current++;
      const previous = held.current; held.current = null;
      if (previous) void client.release(previous).catch(() => undefined);
    };
  }, [projectKey, client]);
  useEffect(() => {
    if (!taskBusy) return;
    generation.current++; setObserved(null); setBusy(false); setBuildConsumed(false); setExecuting(false);
    const previous = held.current; held.current = null;
    if (previous) void client.release(previous).catch(() => undefined);
  }, [taskBusy, client]);
  useEffect(() => {
    if (!observed || buildConsumed) return;
    const timer = window.setTimeout(() => {
      if (held.current?.preparedId !== observed.preparedId) return;
      generation.current++; held.current = null; setObserved(null); setError("expired");
      void client.release(observed).catch(() => undefined);
    }, Math.max(0, observed.expiresAtMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [observed, client, buildConsumed]);
  function edit(field: keyof Draft, value: string) {
    invalidate(); setDraft(previous => ({ ...previous, [field]: value }));
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy || !validateUEBuildPreviewConfiguration(configuration)) return;
    invalidate(); const request = generation.current;
    setBusy(true);
    try {
      const result = await client.prepare(configuration);
      if (request !== generation.current) { release(result); return; }
      held.current = result; observedContext.current = projectKey; setObserved(result);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof UEBuildPreviewError ? failure.kind : "unavailable");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  // Hide observations immediately on a selection change, before effects clean up.
  const current = observed && observed.projectId === project?.id && observedContext.current === projectKey && (buildConsumed || observed.expiresAtMs > Date.now()) && ready ? observed : null;
  const input = (field: keyof Draft, label: string, placeholder: string) => <label style={styles.field}>
    {label}<input style={styles.input} value={draft[field]} onChange={e => edit(field, e.target.value)}
      placeholder={placeholder} disabled={busy || executing || !ready} autoComplete="off" spellCheck={false} required maxLength={field === "engineRoot" ? 4096 : field === "uprojectRelativePath" ? 2048 : 128}/>
  </label>;
  return <form onSubmit={event => void prepare(event)} style={styles.form} aria-busy={busy}>
    <div style={styles.header}><h2 id={titleId} style={{ margin: 0, fontSize: 19 }}>{words.title}</h2>
      {onClose && <button type="button" style={styles.button} onClick={onClose}>{words.close}</button>}</div>
    <p style={styles.muted}>{words.project}: <strong>{project?.name ?? "—"}</strong>{project && <> · {project.displayRoot}</>}</p>
    <p style={styles.muted}>{words.fixed}</p><p style={styles.muted}>{words.hint}</p>
    {!project || project.trustState !== "trusted" || nativeSource !== "native" ? <p role="status" style={styles.muted}>{words.noProject}</p> :
      !client.available() ? <p role="status" style={styles.muted}>{words.unavailable}</p> : taskBusy ? <p role="status" style={styles.muted}>{words.taskBusy}</p> : null}
    <div style={styles.grid}>
      {input("engineRoot", words.engine, words.engineHint)}{input("uprojectRelativePath", words.uproject, words.uprojectHint)}
      {input("target", words.target, words.targetHint)}{input("bundledDotnetVersion", words.dotnet, words.dotnetHint)}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button type="submit" style={styles.button} disabled={!ready || busy || executing || !validateUEBuildPreviewConfiguration(configuration)}>{busy ? words.preparing : words.prepare}</button>
      {current && <button type="button" style={styles.button} disabled={executing} onClick={invalidate}>{words.clear}</button>}
    </div>
    <div aria-live="polite">{error && <p role="alert" style={{ ...styles.muted, color: "var(--ua-warning)" }}>{words.errors[error]}</p>}</div>
    {!buildConsumed && <p style={{ ...styles.muted, color: "var(--ua-warning)" }}>{words.status}</p>}
    {current && <section aria-label={words.status} style={{ display: "grid", gap: 16, borderTop: "1px solid var(--ua-border-default)", paddingTop: 16 }}>
      <p style={styles.muted}>{words.expires}: {new Date(current.expiresAtMs).toLocaleTimeString(locale)}</p>
      <dl style={styles.details}>
        {[[words.fingerprint, current.preview.fingerprint], [words.version, current.preview.engineVersion], [words.projectFile, current.preview.uproject],
          [words.source, current.preview.targetFile], [words.program, current.preview.program], [words.cwd, current.preview.cwd]].map(([term, value]) =>
          <div key={term}><dt style={styles.term}>{term}</dt><dd style={{ ...styles.value, ...styles.code }}>{value}</dd></div>)}
      </dl>
      <div><p style={styles.term}>{words.arguments}</p><ol style={{ ...styles.code, margin: 0, paddingLeft: 24 }}>
        {current.preview.arguments.map((arg, index) => <li key={index}>{arg}</li>)}
      </ol></div>
      <p style={styles.muted}>{words.snapshot}</p><p style={styles.muted}>{words.effects}</p>
      <UEApprovedBuildAction key={current.preparedId} preview={current} onActiveChange={setExecuting} onConsumed={() => setBuildConsumed(true)}/>
    </section>}
    {!current && <p style={styles.muted}>{words.pending}</p>}
  </form>;
}

/** Mount inside UIProvider in App. inline=true embeds the same form in settings.
 * This component grants no project trust. A separate explicit native approval starts one build. */
export function UEBuildPreviewPanel({ client = nativeUEBuildPreview, inline = false }: { client?: NativeUEBuildPreview; inline?: boolean }) {
  const { locale } = useI18n(), [open, setOpen] = useState(false), titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node || inline) return;
    if (!node.open) node.showModal();
    return () => { if (node.open) node.close(); };
  }, [open, inline]);
  if (inline) return <PreviewForm client={client} titleId={titleId}/>;
  return <>
    <button type="button" className="ua-build-preview-open" onClick={() => setOpen(true)} disabled={open}>{copy[locale].title}</button>
    {open && <>
      <style>{".ua-ue-preview-dialog::backdrop{background:rgba(8,13,11,.8)}.ua-ue-preview-dialog input:focus-visible,.ua-ue-preview-dialog button:focus-visible{outline:2px solid var(--ua-accent);outline-offset:2px}.ua-ue-preview-dialog button:disabled{opacity:.5;cursor:default}"}</style>
      <dialog ref={dialog} className="ua-ue-preview-dialog" style={styles.dialog} aria-labelledby={titleId}
        onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={event => { if (!event.currentTarget.open) setOpen(false); }}>
        <PreviewForm client={client} titleId={titleId} onClose={() => setOpen(false)}/>
      </dialog>
    </>}
  </>;
}
