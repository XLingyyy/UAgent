import { version as frontendPackageVersion } from "../../../package.json";
import type { RuntimeStatus, TaskEventLevel, TaskEventType, TaskState } from "@uagent/shared";
import type { Locale } from "../i18n/core";
import { getApplicationProfile } from "./application-profile";
import { ACCEPTANCE_ENABLED, FIXTURES_ENABLED } from "./build-capabilities";

/** No arbitrary strings, credentials, paths, message bodies or event payloads enter this schema. */
export const DIAGNOSTIC_EXPORT_LIMITS = Object.freeze({
  maxBytes: 16_384,
  maxTextCharacters: 128,
  maxTaskRecords: 256,
  maxActiveTaskEvents: 512,
  maxCapabilityEntries: 8,
  maxErrorCategories: 12,
});

/** Structural projection: the collector cannot read task drafts, titles, errors or event content. */
export interface DiagnosticRuntimeSource {
  readonly status: RuntimeStatus;
  readonly activeTaskId: string | null;
  readonly tasksById: Readonly<Record<string, { readonly state: TaskState }>>;
  readonly eventsByTaskId: Readonly<Record<string, readonly {
    readonly type: TaskEventType;
    readonly level?: TaskEventLevel;
  }[]>>;
}

/** Supply only an already observed native snapshot. Export never creates an owner or probes a job. */
export interface DiagnosticHostSource {
  readonly connected: boolean;
  readonly monitorActive: boolean;
  readonly recoveryCatalogInstalled: boolean;
  readonly modelConcurrency: number;
  readonly pendingExecutions: number;
  readonly unknownExecutions: number;
}

const taskStates = ["draft", "submitted", "planning", "executing", "awaiting_approval", "observing",
  "reviewing", "completed", "failed", "cancelled"] as const;
const runtimeStates = ["offline", "starting", "ready", "running", "waiting_for_approval", "completed", "error"] as const;
const errorCodes = ["task_failed", "provider_request_failed", "agent_step_failed", "mcp_connection_failed",
  "project_index_failed", "sandbox_failed", "sandbox_timed_out", "terminal_failed", "screenshot_failed",
  "watcher_error", "diagnostic_failed", "other_error"] as const;
type ErrorCode = (typeof errorCodes)[number];

interface DiagnosticEnvironment {
  readonly source: "renderer_reported_categories";
  readonly operatingSystemFamily: "android" | "ios" | "windows" | "macos" | "linux" | "unknown";
  readonly rendererFamily: "edge_chromium" | "chromium" | "firefox" | "webkit" | "unknown";
  readonly nativeBridgePresent: boolean;
  readonly frontendBuildMode: "production" | "development";
  readonly secureContext: boolean | null;
}
interface DiagnosticProfile {
  readonly source: "application_profile_module" | "unavailable";
  readonly isolated: boolean | null;
  readonly offlineDemo: boolean | null;
}
interface DiagnosticRuntimeStatistics {
  readonly source: "current_renderer_memory";
  readonly status: RuntimeStatus | "unknown";
  readonly activeTaskPresent: boolean;
  readonly activeTaskState: TaskState | "unknown" | null;
  readonly tasks: {
    readonly sampledRecords: number;
    readonly scanLimited: boolean;
    readonly selection: "store_enumeration_prefix";
    readonly byState: readonly { readonly state: TaskState; readonly count: number }[];
    readonly unknownStateRecords: number;
  };
  readonly activeTaskEvents: {
    readonly sampledRecords: number;
    readonly scanLimited: boolean;
    readonly selection: "most_recent_active_task_events";
    readonly classifiedErrorEvents: number;
    readonly errorsByCategory: readonly { readonly code: ErrorCode; readonly count: number }[];
  };
}
interface DiagnosticHostStatistics {
  readonly source: "caller_supplied_status_snapshot";
  readonly freshness: "not_rechecked_by_export";
  readonly connected: boolean | null;
  readonly monitorActive: boolean | null;
  readonly recoveryCatalogInstalled: boolean | null;
  readonly modelConcurrency: number | null;
  readonly pendingExecutions: number | null;
  readonly unknownExecutions: number | null;
}
interface DiagnosticCapability {
  readonly id: "local_json_download" | "native_ipc_bridge" | "native_history" | "runtime_host_queue" |
    "ue_build_execution" | "signed_install_and_update" | "automatic_diagnostic_upload" | "full_log_and_sensitive_content_export";
  readonly status: "available" | "unavailable" | "detected" | "not_checked" | "not_observed" | "snapshot_supplied" | "unsupported";
  readonly evidence: "renderer_api_presence_only" | "bridge_presence_only" | "no_probe_performed" |
    "local_export_has_no_upload_action" | "fixed_allowlist_only";
}
/** Complete JSON allowlist. Extend intentionally; never add a generic payload/log/error property. */
export interface DiagnosticSnapshot {
  readonly schemaVersion: 1;
  readonly format: "uagent.local-diagnostics.v1";
  readonly generatedAtUtc: string;
  readonly locale: Locale;
  readonly identity: {
    readonly product: "UAgent";
    readonly frontendPackageVersion: string | null;
    readonly versionSource: "unknown" | "bundled_desktop_package_metadata";
    readonly frontendBuildCommit: string | null;
    readonly buildCommitSource: "unknown" | "frontend_build_environment";
    readonly runningNativeVersion: null;
    readonly runningNativeIdentity: "not_observed";
    readonly executableHash: null;
    readonly sourceTreeDirty: "unknown";
  };
  readonly environment: DiagnosticEnvironment;
  readonly profile: DiagnosticProfile;
  readonly buildFlags: { readonly fixturesEnabled: boolean; readonly acceptanceUiEnabled: boolean };
  readonly capabilities: readonly DiagnosticCapability[];
  readonly runtime: DiagnosticRuntimeStatistics | null;
  readonly nativeHost: DiagnosticHostStatistics | null;
  readonly scope: {
    readonly historyAndExternalEffectsVerified: false;
    readonly connectivityVerified: false;
    readonly runtimeStatisticsAreSampled: true;
    readonly runtimeObservationIsNativeProof: false;
    readonly errorCountsAreEventCountsNotIncidentCounts: true;
    readonly zeroCountMeansNotObservedInSample: true;
  };
  readonly privacy: {
    readonly apiKeysIncluded: false;
    readonly systemCredentialsIncluded: false;
    readonly conversationContentIncluded: false;
    readonly userFileContentsIncluded: false;
    readonly projectPathsIncluded: false;
    readonly personalIdentifiersIncluded: false;
    readonly rawUserAgentIncluded: false;
    readonly logsIncluded: false;
    readonly rawErrorMessagesIncluded: false;
    readonly automaticUpload: false;
  };
  readonly limits: typeof DIAGNOSTIC_EXPORT_LIMITS;
}

export interface DiagnosticExportPreview {
  readonly json: string;
  readonly byteLength: number;
  readonly createdAtUtc: string;
  readonly filename: string;
}
export type DiagnosticExportErrorCode = "snapshot_unavailable" | "size_limit" | "download_unavailable" | "invalid_preview";
export class DiagnosticExportError extends Error {
  constructor(readonly code: DiagnosticExportErrorCode) {
    super("diagnostic_export_" + code);
    this.name = "DiagnosticExportError";
  }
}
const previews = new WeakSet<DiagnosticExportPreview>();

function validCount(value: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}
function validBoolean(value: boolean): boolean | null {
  return typeof value === "boolean" ? value : null;
}
function taskState(value: TaskState): (typeof taskStates)[number] | "unknown" {
  return taskStates.find(state => state === value) ?? "unknown";
}
function errorCategory(type: TaskEventType, level: TaskEventLevel | undefined): ErrorCode | null {
  // Return local constants rather than copying a caller-provided event type or error message.
  switch (type) {
    case "task_failed": return "task_failed";
    case "provider_request_failed": return "provider_request_failed";
    case "agent_step_failed": return "agent_step_failed";
    case "mcp_connection_failed": return "mcp_connection_failed";
    case "project_index_failed": return "project_index_failed";
    case "sandbox_failed": return "sandbox_failed";
    case "sandbox_timed_out": return "sandbox_timed_out";
    case "terminal_failed": return "terminal_failed";
    case "screenshot_failed": return "screenshot_failed";
    case "watcher_error": return "watcher_error";
    case "diagnostic_failed": return "diagnostic_failed";
    default: return level === "error" ? "other_error" : null;
  }
}

function runtimeSummary(runtime: DiagnosticRuntimeSource | null): DiagnosticRuntimeStatistics | null {
  if (!runtime) return null;
  const tasks: Record<(typeof taskStates)[number] | "unknown", number> = {
    draft: 0, submitted: 0, planning: 0, executing: 0, awaiting_approval: 0, observing: 0,
    reviewing: 0, completed: 0, failed: 0, cancelled: 0, unknown: 0,
  };
  let sampledTasks = 0, taskScanLimited = false;
  for (const key in runtime.tasksById) {
    if (!Object.hasOwn(runtime.tasksById, key)) continue;
    if (sampledTasks === DIAGNOSTIC_EXPORT_LIMITS.maxTaskRecords) { taskScanLimited = true; break; }
    const task = runtime.tasksById[key];
    tasks[task ? taskState(task.state) : "unknown"]++;
    sampledTasks++;
  }
  const active = runtime.activeTaskId;
  const activeTask = active !== null && Object.hasOwn(runtime.tasksById, active) ? runtime.tasksById[active] : null;
  const events = active !== null && Object.hasOwn(runtime.eventsByTaskId, active) ? runtime.eventsByTaskId[active] : null;
  const eventCount = Array.isArray(events) ? events.length : 0;
  // Most recent events of the active task only. No full-log walk, payload parsing or message reads.
  const start = Math.max(0, eventCount - DIAGNOSTIC_EXPORT_LIMITS.maxActiveTaskEvents);
  const errors: Record<ErrorCode, number> = {
    task_failed: 0, provider_request_failed: 0, agent_step_failed: 0, mcp_connection_failed: 0,
    project_index_failed: 0, sandbox_failed: 0, sandbox_timed_out: 0, terminal_failed: 0,
    screenshot_failed: 0, watcher_error: 0, diagnostic_failed: 0, other_error: 0,
  };
  let sampledEvents = 0, errorEvents = 0;
  for (let index = start; index < eventCount; index++) {
    const event = events?.[index];
    sampledEvents++;
    if (!event) continue;
    const category = errorCategory(event.type, event.level);
    if (category) { errors[category]++; errorEvents++; }
  }
  return {
    source: "current_renderer_memory" as const,
    status: runtimeStates.find(state => state === runtime.status) ?? "unknown",
    activeTaskPresent: active !== null,
    activeTaskState: activeTask ? taskState(activeTask.state) : null,
    tasks: {
      sampledRecords: sampledTasks,
      scanLimited: taskScanLimited,
      selection: "store_enumeration_prefix" as const,
      byState: taskStates.map(state => ({ state, count: tasks[state] })),
      unknownStateRecords: tasks.unknown,
    },
    activeTaskEvents: {
      sampledRecords: sampledEvents,
      scanLimited: start > 0,
      selection: "most_recent_active_task_events" as const,
      classifiedErrorEvents: errorEvents,
      // Entries are fixed codes; zero means not observed in this sample, not no failures in history.
      errorsByCategory: errorCodes.map(code => ({ code, count: errors[code] })),
    },
  };
}

function hostSummary(host: DiagnosticHostSource | null): DiagnosticHostStatistics | null {
  if (!host) return null;
  // Never serialize the source object: native identity, root, ticket, job and resource keys are omitted.
  return {
    source: "caller_supplied_status_snapshot" as const,
    freshness: "not_rechecked_by_export" as const,
    connected: validBoolean(host.connected),
    monitorActive: validBoolean(host.monitorActive),
    recoveryCatalogInstalled: validBoolean(host.recoveryCatalogInstalled),
    modelConcurrency: validCount(host.modelConcurrency, 256),
    pendingExecutions: validCount(host.pendingExecutions, 256),
    unknownExecutions: validCount(host.unknownExecutions, 256),
  };
}

export function diagnosticDownloadAvailable(): boolean {
  return typeof document !== "undefined" && typeof Blob === "function" &&
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function" &&
    typeof URL.revokeObjectURL === "function" && "download" in document.createElement("a");
}
function environmentSummary(): DiagnosticEnvironment {
  const bridge = (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  // The raw user agent is used locally for fixed categories and is never retained in the report.
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 512);
  const os = /Android/i.test(agent) ? "android" : /iPhone|iPad|iPod/i.test(agent) ? "ios" :
    /Windows/i.test(agent) ? "windows" : /Macintosh|Mac OS X/i.test(agent) ? "macos" : /Linux/i.test(agent) ? "linux" : "unknown";
  const engine = /Edg\//.test(agent) ? "edge_chromium" : /Chrome\//.test(agent) ? "chromium" :
    /Firefox\//.test(agent) ? "firefox" : /AppleWebKit\//.test(agent) ? "webkit" : "unknown";
  return {
    source: "renderer_reported_categories" as const,
    operatingSystemFamily: os,
    rendererFamily: engine,
    nativeBridgePresent: typeof bridge?.invoke === "function",
    frontendBuildMode: import.meta.env.PROD ? "production" : "development",
    secureContext: typeof globalThis.isSecureContext === "boolean" ? globalThis.isSecureContext : null,
  };
}
function profileSummary(): DiagnosticProfile {
  try {
    const profile = getApplicationProfile();
    return { source: "application_profile_module" as const,
      isolated: validBoolean(profile.isolated), offlineDemo: validBoolean(profile.offlineDemo) };
  } catch {
    return { source: "unavailable" as const, isolated: null, offlineDemo: null };
  }
}

/** Build and freeze the exact JSON shown in the UI. This function makes no native or network requests. */
export function createDiagnosticExport(
  runtime: DiagnosticRuntimeSource | null,
  locale: Locale,
  host: DiagnosticHostSource | null = null,
): DiagnosticExportPreview {
  try {
    const createdAtUtc = new Date().toISOString();
    const environment = environmentSummary();
    const rawCommit: unknown = import.meta.env.VITE_UAGENT_BUILD_COMMIT;
    const commit = typeof rawCommit === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(rawCommit) ? rawCommit.toLowerCase() : null;
    const version = typeof frontendPackageVersion === "string" && frontendPackageVersion.length <= 48 &&
      /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:alpha|beta|rc)\.\d{1,4})?$/.test(frontendPackageVersion) ? frontendPackageVersion : null;
    const snapshot: DiagnosticSnapshot = {
      schemaVersion: 1,
      format: "uagent.local-diagnostics.v1",
      generatedAtUtc: createdAtUtc,
      locale: locale === "zh-CN" ? "zh-CN" : "en",
      identity: {
        product: "UAgent",
        frontendPackageVersion: version,
        versionSource: version === null ? "unknown" : "bundled_desktop_package_metadata",
        frontendBuildCommit: commit,
        buildCommitSource: commit === null ? "unknown" : "frontend_build_environment",
        runningNativeVersion: null,
        runningNativeIdentity: "not_observed",
        executableHash: null,
        sourceTreeDirty: "unknown",
      },
      environment,
      profile: profileSummary(),
      buildFlags: { fixturesEnabled: FIXTURES_ENABLED, acceptanceUiEnabled: ACCEPTANCE_ENABLED },
      capabilities: [
        { id: "local_json_download", status: diagnosticDownloadAvailable() ? "available" : "unavailable", evidence: "renderer_api_presence_only" },
        { id: "native_ipc_bridge", status: environment.nativeBridgePresent ? "detected" : "unavailable", evidence: "bridge_presence_only" },
        { id: "native_history", status: "not_checked", evidence: "no_probe_performed" },
        { id: "runtime_host_queue", status: host === null ? "not_observed" : "snapshot_supplied", evidence: "no_probe_performed" },
        { id: "ue_build_execution", status: "not_checked", evidence: "no_probe_performed" },
        { id: "signed_install_and_update", status: "not_checked", evidence: "no_probe_performed" },
        { id: "automatic_diagnostic_upload", status: "unsupported", evidence: "local_export_has_no_upload_action" },
        { id: "full_log_and_sensitive_content_export", status: "unsupported", evidence: "fixed_allowlist_only" },
      ],
      runtime: runtimeSummary(runtime),
      nativeHost: hostSummary(host),
      scope: {
        historyAndExternalEffectsVerified: false,
        connectivityVerified: false,
        runtimeStatisticsAreSampled: true,
        runtimeObservationIsNativeProof: false,
        errorCountsAreEventCountsNotIncidentCounts: true,
        zeroCountMeansNotObservedInSample: true,
      },
      privacy: {
        apiKeysIncluded: false, systemCredentialsIncluded: false, conversationContentIncluded: false,
        userFileContentsIncluded: false, projectPathsIncluded: false, personalIdentifiersIncluded: false,
        rawUserAgentIncluded: false, logsIncluded: false, rawErrorMessagesIncluded: false,
        automaticUpload: false,
      },
      limits: {
        maxBytes: DIAGNOSTIC_EXPORT_LIMITS.maxBytes,
        maxTextCharacters: DIAGNOSTIC_EXPORT_LIMITS.maxTextCharacters,
        maxTaskRecords: DIAGNOSTIC_EXPORT_LIMITS.maxTaskRecords,
        maxActiveTaskEvents: DIAGNOSTIC_EXPORT_LIMITS.maxActiveTaskEvents,
        maxCapabilityEntries: DIAGNOSTIC_EXPORT_LIMITS.maxCapabilityEntries,
        maxErrorCategories: DIAGNOSTIC_EXPORT_LIMITS.maxErrorCategories,
      },
    };
    // Serialize only this locally constructed object. Never stringify a store, event, error or input.
    const json = JSON.stringify(snapshot, null, 2) + "\n";
    const byteLength = new TextEncoder().encode(json).byteLength;
    if (byteLength > DIAGNOSTIC_EXPORT_LIMITS.maxBytes) throw new DiagnosticExportError("size_limit");
    const preview = Object.freeze({ json, byteLength, createdAtUtc,
      filename: "UAgent-diagnostics-" + createdAtUtc.replace(/[:.]/g, "-") + ".json" });
    previews.add(preview);
    return preview;
  } catch (failure) {
    if (failure instanceof DiagnosticExportError) throw failure;
    // Do not retain or display any source exception message.
    throw new DiagnosticExportError("snapshot_unavailable");
  }
}

/** Call only from a user click. Returns an idempotent release for panel close/unmount. */
export function requestDiagnosticDownload(preview: DiagnosticExportPreview): () => void {
  if (!previews.has(preview)) throw new DiagnosticExportError("invalid_preview");
  if (!diagnosticDownloadAvailable() || !document.body) throw new DiagnosticExportError("download_unavailable");
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (url !== null) { URL.revokeObjectURL(url); url = null; }
  };
  try {
    url = URL.createObjectURL(new Blob([preview.json], { type: "application/json;charset=utf-8" }));
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = preview.filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    timer = setTimeout(release, 30_000);
    return release;
  } catch {
    release();
    throw new DiagnosticExportError("download_unavailable");
  } finally {
    anchor?.remove();
  }
}
