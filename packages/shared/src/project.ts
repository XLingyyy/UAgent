export type ProjectRootRef = string;

export type ProjectTrustState = "untrusted" | "trusted" | "rejected";

export type ProjectIndexStatus =
  | "not_indexed"
  | "validating"
  | "validated"
  | "scanning"
  | "ready"
  | "failed"
  | "cancelled";

export interface ProjectEngineInfo {
  label: string;
  association: string | null;
  source: "uproject" | "fixture" | "unknown";
}

export interface ProjectProfile {
  id: string;
  name: string;
  rootRef: ProjectRootRef;
  displayRoot: string;
  trustState: ProjectTrustState;
  indexStatus: ProjectIndexStatus;
  engine: ProjectEngineInfo;
  createdAt: number;
  updatedAt: number;
}

export type ProjectIndexNodeType = "directory" | "file";

export type IndexLimitReason =
  | "none"
  | "depth_cap"
  | "node_cap"
  | "file_size_cap"
  | "ignored"
  | "binary"
  | "root_escape"
  | "symlink_escape";

export interface ProjectDirectoryEntry {
  id: string;
  displayName: string;
  nodeType: "directory";
  rootRelativePath: string;
  displayPath: string;
  childrenCount: number;
  isIgnored: boolean;
  limitReason: IndexLimitReason;
}

export interface ProjectFileEntry {
  id: string;
  displayName: string;
  nodeType: "file";
  rootRelativePath: string;
  displayPath: string;
  extension: string;
  byteSize: number;
  isIgnored: boolean;
  limitReason: IndexLimitReason;
}

export type AssetIndexType =
  | "map"
  | "blueprint"
  | "material"
  | "config"
  | "source"
  | "project"
  | "binary_asset"
  | "unknown";

export interface AssetIndexEntry {
  id: string;
  displayName: string;
  rootRelativePath: string;
  displayPath: string;
  assetType: AssetIndexType;
  extension: string;
  source: "project_index" | "fixture";
  indexedAt: number;
  tags: string[];
  previewStatus: "allowed" | "blocked" | "truncated";
}

export interface IndexScanSummary {
  projectId: string;
  scannedAt: number;
  status: ProjectIndexStatus;
  directoryCount: number;
  fileCount: number;
  assetCount: number;
  ignoredCount: number;
  limitReasons: IndexLimitReason[];
  warnings: string[];
  redactedRoot: string;
}

export interface ProjectIndexSnapshot {
  id: string;
  projectId: string;
  rootRef: ProjectRootRef;
  status: ProjectIndexStatus;
  directories: ProjectDirectoryEntry[];
  files: ProjectFileEntry[];
  assets: AssetIndexEntry[];
  summary: IndexScanSummary;
}

export interface ProjectRootValidationResult {
  ok: boolean;
  reason:
    | "valid"
    | "empty_path"
    | "relative_path"
    | "dangerous_root"
    | "network_path"
    | "missing_uproject"
    | "unsupported_root";
  displayRoot: string;
  projectName: string | null;
  engine: ProjectEngineInfo;
}

export interface ProjectPathPolicyOptions {
  ignoredDirs?: string[];
  maxPreviewBytes?: number;
  textExtensions?: string[];
}

export type NativeRootKind = "local" | "fixture";

export interface NativeRootTrustRecord {
  rootId: string;
  rootRef: string;
  displayRoot: string;
  kind: NativeRootKind;
  trustedAt: number;
}

export interface ReadOnlyFilesystemPolicy {
  allowedRoots: string[];
  ignoredDirs: string[];
  maxDepth: number;
  maxNodes: number;
  maxFiles: number;
  maxPreviewBytes: number;
  previewAllowlist: string[];
  binaryDetectBytes: number;
  redactionLevel: "full" | "partial" | "none";
}

export function createDefaultReadOnlyFsPolicy(): ReadOnlyFilesystemPolicy {
  return {
    allowedRoots: [],
    ignoredDirs: [...DEFAULT_PROJECT_IGNORES, "Build"],
    maxDepth: 10,
    maxNodes: 5000,
    maxFiles: 2000,
    maxPreviewBytes: 1024 * 1024,
    previewAllowlist: [...DEFAULT_TEXT_EXTENSIONS],
    binaryDetectBytes: 2048,
    redactionLevel: "full",
  };
}

export type PathErrorCode =
  | "empty_path"
  | "dangerous_root"
  | "network_path"
  | "relative_path"
  | "outside_root"
  | "symlink_escape"
  | "permission_denied"
  | "too_large"
  | "missing_uproject"
  | "unsupported_root";

export interface ScanProgressEvent {
  projectId: string;
  rootRef: string;
  visitedNodes: number;
  indexedFiles: number;
  ignoredCount: number;
  elapsedMs: number;
  status: "in_progress" | "completed" | "cancelled" | "failed";
}

export const DEFAULT_PROJECT_IGNORES = [
  ".git",
  "Intermediate",
  "Saved",
  "DerivedDataCache",
  "Binaries",
  "node_modules",
  ".vs",
] as const;

const DEFAULT_TEXT_EXTENSIONS = [
  ".uproject",
  ".ini",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".json",
  ".txt",
  ".md",
] as const;

export function normalizeProjectPath(path: string): string {
  const raw = path.trim().replace(/\\/g, "/");
  if (raw.startsWith("fixture://")) return raw.replace(/\/+$/g, "");
  const trimmed = raw.replace(/\/+/g, "/");
  if (!trimmed) return "";

  const driveMatch = trimmed.match(/^([A-Za-z]:)(\/.*)?$/);
  const prefix = driveMatch ? `${driveMatch[1]}/` : trimmed.startsWith("/") ? "/" : "";
  const body = driveMatch ? (driveMatch[2] ?? "/").slice(1) : trimmed.replace(/^\/+/, "");
  const segments: string[] = [];
  for (const segment of body.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = `${prefix}${segments.join("/")}`;
  return normalized.replace(/\/+$/g, "") || prefix || ".";
}

export function isInsideProjectRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeProjectPath(root);
  const normalizedCandidate = normalizeProjectPath(candidate);
  if (!normalizedRoot || !normalizedCandidate) return false;
  if (normalizedRoot.startsWith("fixture://")) {
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
  }
  const rootWithSlash = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(rootWithSlash);
}

export function shouldIgnoreProjectPath(
  rootRelativePath: string,
  options: ProjectPathPolicyOptions = {},
): boolean {
  const ignoredDirs = options.ignoredDirs ?? [...DEFAULT_PROJECT_IGNORES];
  const parts = normalizeProjectPath(rootRelativePath).split("/");
  return parts.some((part) => ignoredDirs.some((ignored) => ignored.toLowerCase() === part.toLowerCase()));
}

export function isTextPreviewAllowed(
  rootRelativePath: string,
  byteSize: number,
  options: ProjectPathPolicyOptions = {},
): boolean {
  const maxPreviewBytes = options.maxPreviewBytes ?? 1024 * 1024;
  if (byteSize > maxPreviewBytes) return false;
  const textExtensions = options.textExtensions ?? [...DEFAULT_TEXT_EXTENSIONS];
  const lowerPath = rootRelativePath.toLowerCase();
  return textExtensions.some((extension) => lowerPath.endsWith(extension));
}

export function redactPathForUi(path: string): string {
  const normalized = normalizeProjectPath(path);
  if (normalized.startsWith("fixture://")) {
    return normalized.replace("fixture://", "[fixture-root]/");
  }
  return normalized
    .replace(/^[A-Za-z]:\/Users\/[^/]+/i, "[user-home]")
    .replace(/^\/Users\/[^/]+/i, "[user-home]")
    .replace(/^\/home\/[^/]+/i, "[user-home]");
}
