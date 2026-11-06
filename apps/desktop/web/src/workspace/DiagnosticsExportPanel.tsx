import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useRuntimeStore } from "../stores/ui-store";
import {
  createDiagnosticExport, DiagnosticExportError, DIAGNOSTIC_EXPORT_LIMITS,
  diagnosticDownloadAvailable, requestDiagnosticDownload,
  type DiagnosticExportErrorCode, type DiagnosticExportPreview, type DiagnosticHostSource,
} from "../runtime/diagnostic-export";
import "./DiagnosticsExportPanel.css";

// Independently owned bilingual copy: no central catalog or settings/store changes.
const copy = {
  "zh-CN": {
    title: "本地诊断导出", close: "关闭", open: "导出本地诊断", generate: "生成字段预览", refresh: "重新生成预览",
    download: "下载预览中的 JSON", clear: "清除预览", preview: "即将导出的全部字段", bytes: "字节", generated: "快照生成时间",
    intro: "先查看全部字段，再点击下载。文件只在本地生成，本面板没有上传或分享操作。",
    includes: "包含前端包版本、构建提交号（可用时）、运行环境类别、能力状态、有限的任务状态和固定错误类别计数。可选宿主数据只来自已经取得的原生快照。",
    excludes: "不读取或包含 API Key、系统凭据、聊天正文、用户文件内容、项目路径、完整日志或原始错误消息。没有额外收集开关。",
    limits: "最多读取 256 条内存任务状态及当前任务最近 512 条事件的类别；文件上限 16 KiB。计数只覆盖样本，不代表历史完整性。",
    identity: "前端包版本和提交号不是运行中 EXE 的身份校验。未观测的原生版本、安装更新、外部执行和连接能力会如实标为 unknown / not checked。",
    empty: "尚未生成诊断快照。生成预览不会发起网络请求或原生探测。",
    snapshot: "下载的是此处固定快照；刷新预览才会更新计数。事件计数不等于独立故障次数。",
    local: "分享与否由你决定；此面板不会自动发送文件。", requested: "已请求本地下载。是否保存成功请在浏览器或系统下载界面确认。",
    unavailable: "当前环境不支持本地 JSON 下载；仍可查看字段预览。",
    errors: {
      snapshot_unavailable: "诊断快照暂不可用，未导出数据。", size_limit: "诊断快照超过大小上限，已停止导出。",
      download_unavailable: "无法请求本地下载，请检查当前环境的下载支持。", invalid_preview: "预览已失效，请重新生成。",
    },
  },
  en: {
    title: "Local diagnostic export", close: "Close", open: "Export local diagnostics", generate: "Generate field preview", refresh: "Refresh preview",
    download: "Download previewed JSON", clear: "Clear preview", preview: "All fields to be exported", bytes: "bytes", generated: "Snapshot generated",
    intro: "Review every field before downloading. The file is generated locally; this panel has no upload or share action.",
    includes: "Includes the frontend package version, build commit when available, environment categories, capability status, bounded task states and fixed error category counts. Optional host data comes only from an already observed native snapshot.",
    excludes: "Does not read or include API keys, system credentials, chat bodies, user file contents, project paths, full logs or raw error messages. There is no option to collect extra content.",
    limits: "Reads at most 256 in-memory task states and categories from the active task's most recent 512 events; maximum file size is 16 KiB. Counts cover this sample, not complete history.",
    identity: "The frontend package version and commit do not verify the running EXE. Unobserved native version, installation, updates, external execution and connectivity remain unknown / not checked.",
    empty: "No diagnostic snapshot generated. Preview generation makes no network requests or native probes.",
    snapshot: "Download uses this fixed snapshot. Refresh to update counts. Event counts are not distinct incident counts.",
    local: "You decide whether to share the file. This panel never sends it automatically.", requested: "Local download requested. Confirm that the file was saved in your browser or system download interface.",
    unavailable: "This environment cannot download local JSON files. Field preview is still available.",
    errors: {
      snapshot_unavailable: "Diagnostic snapshot unavailable. No data was exported.", size_limit: "The diagnostic snapshot exceeded its size limit. Export stopped.",
      download_unavailable: "Local download could not be requested. Check download support in this environment.", invalid_preview: "This preview is no longer valid. Generate another one.",
    },
  },
};

export interface DiagnosticsExportPanelProps {
  /** Embed in existing settings/content layout instead of showing a dialog launcher. */
  inline?: boolean;
  /** Optional genuine, already observed native owner snapshot. No new connection is established. */
  hostSnapshot?: DiagnosticHostSource | null;
}

function ExportContent({ titleId, hostSnapshot, onClose }: {
  titleId: string;
  hostSnapshot: DiagnosticHostSource | null;
  onClose?: () => void;
}) {
  const { locale } = useI18n(), words = copy[locale];
  // Stable store snapshot; only the collector's narrow structural fields can be accessed or exported.
  const runtime = useRuntimeStore(state => state);
  const [preview, setPreview] = useState<DiagnosticExportPreview | null>(null);
  const [error, setError] = useState<DiagnosticExportErrorCode | null>(null);
  const [requested, setRequested] = useState(false);
  const releaseDownload = useRef<(() => void) | null>(null);
  useEffect(() => () => { releaseDownload.current?.(); }, []);
  const forget = () => {
    releaseDownload.current?.(); releaseDownload.current = null;
    setPreview(null); setError(null); setRequested(false);
  };
  const generate = () => {
    forget();
    try { setPreview(createDiagnosticExport(runtime, locale, hostSnapshot)); }
    catch (failure) { setError(failure instanceof DiagnosticExportError ? failure.code : "snapshot_unavailable"); }
  };
  const download = () => {
    if (!preview) return;
    releaseDownload.current?.(); releaseDownload.current = null;
    setError(null); setRequested(false);
    try { releaseDownload.current = requestDiagnosticDownload(preview); setRequested(true); }
    catch (failure) { setError(failure instanceof DiagnosticExportError ? failure.code : "download_unavailable"); }
  };
  return <section className="ua-diagnostic-export" aria-labelledby={titleId}>
    <div className="ua-diagnostic-export__heading">
      <h2 id={titleId}>{words.title}</h2>
      {onClose && <button type="button" onClick={onClose}>{words.close}</button>}
    </div>
    <p>{words.intro}</p>
    <ul className="ua-diagnostic-export__scope"><li>{words.includes}</li><li>{words.excludes}</li></ul>
    <p className="ua-diagnostic-export__note">{words.limits}</p>
    <p className="ua-diagnostic-export__note">{words.identity}</p>
    <div className="ua-diagnostic-export__actions">
      <button type="button" onClick={generate}>{preview ? words.refresh : words.generate}</button>
      {preview && <>
        <button type="button" onClick={download} disabled={!diagnosticDownloadAvailable()}>{words.download}</button>
        <button type="button" onClick={forget}>{words.clear}</button>
      </>}
    </div>
    <div aria-live="polite" className="ua-diagnostic-export__status">
      {error && <p role="alert">{words.errors[error]}</p>}
      {requested && <p role="status">{words.requested}</p>}
      {!diagnosticDownloadAvailable() && <p>{words.unavailable}</p>}
    </div>
    {preview ? <>
      <dl className="ua-diagnostic-export__metadata">
        <div><dt>{words.generated}</dt><dd><time dateTime={preview.createdAtUtc}>{preview.createdAtUtc}</time></dd></div>
        <div><dt>JSON</dt><dd>{preview.byteLength} / {DIAGNOSTIC_EXPORT_LIMITS.maxBytes} {words.bytes}</dd></div>
      </dl>
      <p className="ua-diagnostic-export__note">{words.snapshot}</p>
      <pre className="ua-diagnostic-export__preview" tabIndex={0} aria-label={words.preview}>{preview.json}</pre>
    </> : <p role="status" className="ua-diagnostic-export__note">{words.empty}</p>}
    <p className="ua-diagnostic-export__note">{words.local}</p>
  </section>;
}

/** Mount inside UIProvider. No export is generated until the user explicitly requests a preview. */
export function DiagnosticsExportPanel({ inline = false, hostSnapshot = null }: DiagnosticsExportPanelProps) {
  const { locale } = useI18n();
  const titleId = useId(), dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    if (!open || inline || !node) return;
    if (!node.open) node.showModal();
    return () => { if (node.open) node.close(); };
  }, [open, inline]);
  if (inline) return <ExportContent titleId={titleId} hostSnapshot={hostSnapshot}/>;
  return <>
    <button className="ua-diagnostic-export-launcher" type="button" onClick={() => setOpen(true)} disabled={open}>{copy[locale].open}</button>
    {open && <dialog ref={dialog} className="ua-diagnostic-export-dialog" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onClose={event => { if (!event.currentTarget.open) setOpen(false); }}>
      <ExportContent titleId={titleId} hostSnapshot={hostSnapshot} onClose={() => setOpen(false)}/>
    </dialog>}
  </>;
}
