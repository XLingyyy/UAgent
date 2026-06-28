import {
  createMvp8FixtureProjectRegistry,
  createMvp8ProjectIndexer,
  createMvp8SafeFilePreviewer,
} from "@uagent/runtime";
import {
  createDefaultReadOnlyFsPolicy,
  normalizeProjectPath,
  redactPathForUi,
  type ProjectIndexSnapshot,
  type ProjectProfile,
  type ProjectRootValidationResult,
  type ReadOnlyFilesystemPolicy,
  type SafeFilePreviewResult,
} from "@uagent/shared";

export type NativeInvoke = <T = unknown>(command: string, payload?: unknown) => Promise<T>;

export interface NativeProjectAdapterOptions {
  invoke?: NativeInvoke | null;
  now?: () => number;
}

export interface NativeProjectAdapter {
  listProjects(): ProjectProfile[];
  getProject(id: string): ProjectProfile | null;
  validateRoot(ref: string): Promise<ProjectRootValidationResult>;
  addProject(ref: string): Promise<ProjectProfile>;
  confirmTrust(id: string): Promise<ProjectProfile>;
  removeProject(id: string): void;
  updateIndexStatus(id: string, status: ProjectProfile["indexStatus"]): ProjectProfile | null;
  scanProject(id: string): Promise<{ snapshot: ProjectIndexSnapshot; events: string[] }>;
  cancelScan(id: string): Promise<{ snapshot: ProjectIndexSnapshot; events: string[] }>;
  getStableSnapshot(id: string): ProjectIndexSnapshot | null;
  previewFile(
    projectId: string,
    rootRef: string,
    rootRelativePath: string,
    byteLimit?: number,
    lineLimit?: number,
  ): Promise<SafeFilePreviewResult>;
  getCapabilityStatus(): { kind: string; mode: string; status: string }[];
  getPolicy(): ReadOnlyFilesystemPolicy;
  readonly source: "native" | "fixture";
}

type NativeValidationResult = ProjectRootValidationResult & {
  display_root?: string;
  project_name?: string | null;
  engine_label?: string;
  engine_association?: string | null;
  engine_source?: "uproject" | "fixture" | "unknown";
};

type NativeTrustResult = {
  rootId?: string;
  root_id?: string;
  displayRoot?: string;
  display_root?: string;
  trustState?: ProjectProfile["trustState"];
  trust_state?: ProjectProfile["trustState"];
};

type NativeScanResult = Partial<ProjectIndexSnapshot> & {
  directory_count?: number;
  file_count?: number;
  asset_count?: number;
  ignored_count?: number;
  scanned_at?: number;
  warnings?: string[];
};

type NativePreviewResult = Partial<SafeFilePreviewResult> & {
  original_bytes?: number;
  original_lines?: number;
  replaced_secrets?: number;
  replaced_paths?: number;
};

function hashPath(path: string): string {
  let hash = 0;
  const norm = normalizeProjectPath(path);
  for (let i = 0; i < norm.length; i++) {
    const char = norm.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `root:${Math.abs(hash).toString(16)}`;
}

function getGlobalInvoke(): NativeInvoke | null {
  const tauriInternals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } })
    .__TAURI_INTERNALS__;
  return tauriInternals?.invoke ?? null;
}

function normalizeValidation(raw: NativeValidationResult, ref: string): ProjectRootValidationResult {
  return {
    ok: Boolean(raw.ok),
    reason: raw.reason,
    displayRoot: raw.displayRoot ?? raw.display_root ?? redactPathForUi(ref),
    projectName: raw.projectName ?? raw.project_name ?? null,
    engine:
      raw.engine ?? {
        label: raw.engine_label ?? "Unknown",
        association: raw.engine_association ?? null,
        source: raw.engine_source ?? "unknown",
      },
  };
}

function projectFromValidation(
  rootRef: string,
  validation: ProjectRootValidationResult,
  now: number,
): ProjectProfile {
  const normalized = normalizeProjectPath(rootRef);
  const rootToken = hashPath(normalized);
  return {
    id: `native:${rootToken}`,
    name: validation.projectName ?? "Native Project",
    rootRef: rootToken,
    displayRoot: validation.displayRoot,
    trustState: "untrusted",
    indexStatus: "validated",
    engine: validation.engine,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeTrust(raw: NativeTrustResult, previous: ProjectProfile, now: number): ProjectProfile {
  return {
    ...previous,
    id: raw.rootId ?? raw.root_id ?? previous.id,
    displayRoot: raw.displayRoot ?? raw.display_root ?? previous.displayRoot,
    trustState: raw.trustState ?? raw.trust_state ?? "trusted",
    updatedAt: now,
  };
}

function emptySnapshot(project: ProjectProfile, raw: NativeScanResult, now: number): ProjectIndexSnapshot {
  const status = raw.status ?? "ready";
  const directories = raw.directories ?? [];
  const files = raw.files ?? [];
  const assets = raw.assets ?? [];

  if (status === "ready" && (!raw.summary || directories.length === 0 || files.length === 0 || assets.length === 0)) {
    throw new Error("Native scan did not return project index entries");
  }

  return {
    id: raw.id ?? `index:${project.id}:native`,
    projectId: raw.projectId ?? project.id,
    rootRef: project.rootRef,
    status,
    directories,
    files,
    assets,
    summary:
      raw.summary ?? {
        projectId: raw.projectId ?? project.id,
        scannedAt: raw.scanned_at ?? now,
        status,
        directoryCount: raw.directory_count ?? 0,
        fileCount: raw.file_count ?? 0,
        assetCount: raw.asset_count ?? 0,
        ignoredCount: raw.ignored_count ?? 0,
        limitReasons: [],
        warnings: raw.warnings ?? [],
        redactedRoot: project.displayRoot,
      },
  };
}

function normalizePreview(
  raw: NativePreviewResult,
  projectId: string,
  rootRelativePath: string,
  byteLimit: number,
  lineLimit: number,
  now: number,
): SafeFilePreviewResult {
  return {
    id: raw.id ?? `preview:${projectId}:${rootRelativePath}`,
    requestId: raw.requestId ?? `preview:${rootRelativePath}`,
    projectId: raw.projectId ?? projectId,
    rootRelativePath: raw.rootRelativePath ?? rootRelativePath,
    displayPath: raw.displayPath ?? `[project-root]/${rootRelativePath}`,
    status: raw.status ?? "blocked",
    reason: raw.reason ?? "native_preview",
    content: raw.content ?? "",
    truncation:
      raw.truncation ?? {
        truncated: false,
        byteLimit,
        lineLimit,
        originalBytes: raw.original_bytes ?? 0,
        originalLines: raw.original_lines ?? 0,
      },
    redaction:
      raw.redaction ?? {
        replacedSecrets: raw.replaced_secrets ?? 0,
        replacedPaths: raw.replaced_paths ?? 0,
        redacted: (raw.replaced_secrets ?? 0) + (raw.replaced_paths ?? 0) > 0,
      },
    createdAt: raw.createdAt ?? now,
  };
}

export function createNativeProjectAdapter(
  options: NativeProjectAdapterOptions = {},
): NativeProjectAdapter {
  const invoke = options.invoke ?? getGlobalInvoke();
  const now = options.now ?? (() => Date.now());
  const policy = createDefaultReadOnlyFsPolicy();

  if (invoke) {
    const projects = new Map<string, ProjectProfile>();
    const stableSnapshots = new Map<string, ProjectIndexSnapshot>();
    const rawPaths = new Map<string, string>();

    function resolveRawRoot(projectId: string, opaqueRef: string): string {
      return rawPaths.get(projectId) ?? rawPaths.get(opaqueRef) ?? opaqueRef;
    }

    return {
      source: "native",
      listProjects: () => Array.from(projects.values()),
      getProject: (id) => projects.get(id) ?? null,
      async validateRoot(ref) {
        const raw = await invoke<NativeValidationResult>("validate_native_project_root", {
          input: { rootRef: ref },
        });
        return normalizeValidation(raw, ref);
      },
      async addProject(ref) {
        const validation = await this.validateRoot(ref);
        if (!validation.ok) {
          throw new Error(`Invalid project root: ${validation.reason}`);
        }
        const project = projectFromValidation(ref, validation, now());
        const normalized = normalizeProjectPath(ref);
        rawPaths.set(project.id, normalized);
        rawPaths.set(project.rootRef, normalized);
        projects.set(project.id, project);
        return project;
      },
      async confirmTrust(id) {
        const project = projects.get(id);
        if (!project) throw new Error(`Unknown project: ${id}`);
        const rawRoot = resolveRawRoot(id, project.rootRef);
        const raw = await invoke<NativeTrustResult>("trust_native_project_root", {
          input: { rootRef: rawRoot },
        });
        const trusted = normalizeTrust(raw, project, now());
        projects.delete(id);
        if (rawPaths.has(id)) {
          const stored = rawPaths.get(id)!;
          rawPaths.delete(id);
          rawPaths.set(trusted.id, stored);
        }
        if (trusted.id !== project.rootRef && rawPaths.has(project.rootRef)) {
          const stored = rawPaths.get(project.rootRef)!;
          rawPaths.delete(project.rootRef);
          rawPaths.set(trusted.id, stored);
        }
        projects.set(trusted.id, trusted);
        return trusted;
      },
      removeProject(id) {
        const project = projects.get(id);
        if (project) {
          rawPaths.delete(id);
          rawPaths.delete(project.rootRef);
        }
        projects.delete(id);
        stableSnapshots.delete(id);
      },
      updateIndexStatus(id, status) {
        const project = projects.get(id);
        if (!project) return null;
        const next = { ...project, indexStatus: status, updatedAt: now() };
        projects.set(id, next);
        return next;
      },
      async scanProject(id) {
        const project = projects.get(id);
        if (!project) throw new Error(`Unknown project: ${id}`);
        const rawRoot = resolveRawRoot(id, project.rootRef);
        const raw = await invoke<NativeScanResult>("scan_native_project_index", {
          input: {
            projectId: project.id,
            rootRef: rawRoot,
            maxDepth: policy.maxDepth,
            maxNodes: policy.maxNodes,
            maxFiles: policy.maxFiles,
          },
        });
        const snapshot = emptySnapshot(project, raw, now());
        stableSnapshots.set(project.id, snapshot);
        this.updateIndexStatus(project.id, snapshot.status);
        return { snapshot, events: ["project_index_started", "project_index_completed"] };
      },
      async cancelScan(id) {
        const project = projects.get(id);
        if (!project) throw new Error(`Unknown project: ${id}`);
        await invoke("cancel_native_project_scan", { input: { scanId: id } });
        this.updateIndexStatus(id, "cancelled");
        const snapshot =
          stableSnapshots.get(id) ?? emptySnapshot({ ...project, indexStatus: "cancelled" }, { status: "cancelled" }, now());
        return { snapshot, events: ["project_index_cancelled"] };
      },
      getStableSnapshot(id) {
        return stableSnapshots.get(id) ?? null;
      },
      async previewFile(projectId, rootRef, rootRelativePath, byteLimit = 4096, lineLimit = 80) {
        const rawRoot = resolveRawRoot(projectId, rootRef);
        const raw = await invoke<NativePreviewResult>("preview_native_project_file", {
          input: { projectId, rootRef: rawRoot, rootRelativePath, byteLimit, lineLimit },
        });
        return normalizePreview(raw, projectId, rootRelativePath, byteLimit, lineLimit, now());
      },
      getCapabilityStatus: () => [
        { kind: "Files", mode: "native_read_only", status: "completed" },
        { kind: "Terminal", mode: "fixture", status: "blocked" },
        { kind: "Browser", mode: "disabled", status: "blocked" },
        { kind: "Screenshot", mode: "disabled", status: "blocked" },
        { kind: "Provider live", mode: "fixture", status: "blocked" },
      ],
      getPolicy: () => policy,
    };
  }

  const registry = createMvp8FixtureProjectRegistry();
  const indexer = createMvp8ProjectIndexer(registry);
  const previewer = createMvp8SafeFilePreviewer(registry);

  return {
    source: "fixture",
    listProjects: () => registry.listProjects(),
    getProject: (id) => registry.getProject(id),
    validateRoot: async (ref) => registry.validateRoot(ref),
    addProject: async (ref) => registry.addProject(ref),
    confirmTrust: async (id) => registry.confirmTrust(id),
    removeProject: (id) => registry.removeProject(id),
    updateIndexStatus: (id, status) => registry.updateIndexStatus(id, status),
    scanProject: async (id) => indexer.scanProject(id),
    cancelScan: async (id) => indexer.cancelScan(id),
    getStableSnapshot: (id) => indexer.getStableSnapshot(id),
    previewFile: async (projectId, rootRef, rootRelativePath, byteLimit = 4096, lineLimit = 80) =>
      previewer.previewFile({
        id: `pv:${rootRelativePath}`,
        projectId,
        rootRef,
        rootRelativePath,
        byteLimit,
        lineLimit,
      }),
    getCapabilityStatus: () => [
      { kind: "Files", mode: "native_read_only", status: "completed" },
      { kind: "Terminal", mode: "fixture", status: "blocked" },
      { kind: "Browser", mode: "disabled", status: "blocked" },
      { kind: "Screenshot", mode: "disabled", status: "blocked" },
      { kind: "Provider live", mode: "fixture", status: "blocked" },
    ],
    getPolicy: () => policy,
  };
}
