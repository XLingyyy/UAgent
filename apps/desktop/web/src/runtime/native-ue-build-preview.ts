import { localNativeInvoke } from "./native-provider-budget";
import type { NativeInvoke } from "./project-native-adapter";

/** Fixed Editor configuration data. Project IDs only look up an existing native lease. */
export interface UEBuildPreviewConfiguration {
  projectId: string;
  engineRoot: string;
  uprojectRelativePath: string;
  target: string;
  bundledDotnetVersion: string;
}
export interface UEBuildPreviewProfile extends UEBuildPreviewConfiguration {
  schemaVersion: 1;
  profileId: "desktop-fixed-editor-preview-v1";
  platform: "Win64";
  configuration: "Development";
  method: "ubt";
  timeoutMs: 600000;
}
export interface UEBuildCommandPreview {
  readonly profile: Readonly<UEBuildPreviewProfile>;
  readonly fingerprint: string;
  readonly engineVersion: string;
  readonly projectRoot: string;
  readonly uproject: string;
  readonly targetFile: string;
  readonly program: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: 600000;
  readonly expectedMutation: "build_artifacts_and_project_build_logic";
  readonly verification: "not_started";
}
/** An observation for local review. It cannot be submitted to an execution command. */
export interface UEBuildPreviewReceipt {
  readonly schemaVersion: 1;
  readonly preparedId: string;
  readonly projectId: string;
  readonly preparedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: "preview_only";
  readonly executionEnabled: false;
  readonly verification: "not_started";
  readonly preview: Readonly<UEBuildCommandPreview>;
}
export type UEBuildPreviewErrorKind = "unavailable" | "busy" | "trust" | "input" | "source" | "capacity" | "invalid_receipt" | "expired";
export class UEBuildPreviewError extends Error {
  constructor(readonly kind: UEBuildPreviewErrorKind) { super(`ue_build_preview_${kind}`); this.name = "UEBuildPreviewError"; }
}
const fail = (kind: UEBuildPreviewErrorKind): never => { throw new UEBuildPreviewError(kind); };
const projectId = (value: unknown): value is string => typeof value === "string" && /^root:[a-f0-9]{1,64}$/.test(value);
const preparedId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const text = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const localPath = (value: unknown): value is string => text(value) && /^[A-Za-z]:[\\/][^\\/]/.test(value);
const normalizedPath = (value: string) => value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return fail("invalid_receipt");
  return value as Record<string, unknown>;
}
/** Local shape feedback only. Native code independently resolves and checks the live root. */
export function validateUEBuildPreviewConfiguration(value: UEBuildPreviewConfiguration): boolean {
  if (!value || !projectId(value.projectId) || !localPath(value.engineRoot) ||
      /["%!&|<>^:*?~]/.test(value.engineRoot.slice(3)) ||
      value.engineRoot.replace(/\\/g, "/").slice(3).split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)) ||
      !text(value.uprojectRelativePath, 2048) || /[:"%!&|<>^*?~]/.test(value.uprojectRelativePath) ||
      !value.uprojectRelativePath.endsWith(".uproject") ||
      value.uprojectRelativePath.replace(/\\/g, "/").split("/").some(part => !part || part === "." || part === "..") ||
      typeof value.target !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.target) || !value.target.endsWith("Editor") ||
      typeof value.bundledDotnetVersion !== "string" || value.bundledDotnetVersion.length > 64 || !/^\d+(?:\.\d+){1,3}$/.test(value.bundledDotnetVersion)) return false;
  return true;
}
function receipt(raw: unknown, requested: UEBuildPreviewConfiguration): UEBuildPreviewReceipt {
  const r = record(raw, ["schemaVersion", "preparedId", "projectId", "preparedAtMs", "expiresAtMs", "status", "executionEnabled", "verification", "preview"]);
  if (r.schemaVersion !== 1 || !preparedId(r.preparedId) || r.projectId !== requested.projectId ||
      !Number.isSafeInteger(r.preparedAtMs) || (r.preparedAtMs as number) < 0 || !Number.isSafeInteger(r.expiresAtMs) ||
      (r.expiresAtMs as number) - (r.preparedAtMs as number) !== 120000 || r.status !== "preview_only" || r.executionEnabled !== false || r.verification !== "not_started") return fail("invalid_receipt");
  const p = record(r.preview, ["profile", "fingerprint", "engineVersion", "projectRoot", "uproject", "targetFile", "program", "arguments", "cwd", "timeoutMs", "expectedMutation", "verification"]);
  const f = record(p.profile, ["schemaVersion", "profileId", "projectId", "engineRoot", "uprojectRelativePath", "target", "platform", "configuration", "method", "bundledDotnetVersion", "timeoutMs"]);
  if (f.schemaVersion !== 1 || f.profileId !== "desktop-fixed-editor-preview-v1" || f.projectId !== requested.projectId ||
      !localPath(f.engineRoot) || normalizedPath(f.engineRoot) !== normalizedPath(requested.engineRoot) ||
      f.uprojectRelativePath !== requested.uprojectRelativePath.replace(/\\/g, "/") || f.target !== requested.target ||
      f.platform !== "Win64" || f.configuration !== "Development" || f.method !== "ubt" ||
      f.bundledDotnetVersion !== requested.bundledDotnetVersion || f.timeoutMs !== 600000 ||
      typeof p.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(p.fingerprint) ||
      typeof p.engineVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(p.engineVersion) ||
      !localPath(p.projectRoot) || !localPath(p.uproject) || !localPath(p.targetFile) || !localPath(p.program) || !localPath(p.cwd) ||
      !Array.isArray(p.arguments) || !p.arguments.every(arg => text(arg)) || p.arguments.length !== 7 ||
      p.timeoutMs !== 600000 || p.expectedMutation !== "build_artifacts_and_project_build_logic" || p.verification !== "not_started") return fail("invalid_receipt");
  const parent = requested.uprojectRelativePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const targetRelative = `${parent ? `${parent}/` : ""}Source/${requested.target}.Target.cs`;
  if (normalizedPath(p.uproject) !== normalizedPath(`${p.projectRoot}/${requested.uprojectRelativePath}`) ||
      normalizedPath(p.targetFile) !== normalizedPath(`${p.projectRoot}/${targetRelative}`) ||
      normalizedPath(p.program) !== normalizedPath(`${f.engineRoot}/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe`) ||
      normalizedPath(p.cwd) !== normalizedPath(`${f.engineRoot}/Engine/Source`) ||
      p.arguments.some((arg, index) => arg !== [requested.target, "Win64", "Development", `-Project=${p.uproject}`, "-WaitMutex", "-NoHotReloadFromIDE", "-UTF8Output"][index])) return fail("invalid_receipt");
  const profile: UEBuildPreviewProfile = {
    ...requested, engineRoot: f.engineRoot, uprojectRelativePath: f.uprojectRelativePath as string,
    schemaVersion: 1, profileId: "desktop-fixed-editor-preview-v1", platform: "Win64", configuration: "Development", method: "ubt", timeoutMs: 600000,
  };
  return Object.freeze({
    schemaVersion: 1, preparedId: r.preparedId, projectId: requested.projectId,
    preparedAtMs: r.preparedAtMs as number, expiresAtMs: r.expiresAtMs as number,
    status: "preview_only", executionEnabled: false, verification: "not_started",
    preview: Object.freeze({ profile: Object.freeze(profile), fingerprint: p.fingerprint, engineVersion: p.engineVersion,
      projectRoot: p.projectRoot, uproject: p.uproject, targetFile: p.targetFile, program: p.program,
      arguments: Object.freeze([...p.arguments] as string[]), cwd: p.cwd, timeoutMs: 600000,
      expectedMutation: "build_artifacts_and_project_build_logic", verification: "not_started" }),
  });
}
function safeError(error: unknown): UEBuildPreviewError {
  if (error instanceof UEBuildPreviewError) return error;
  const code = typeof error === "string" && /^[a-z0-9_]{1,128}$/.test(error) ? error : "";
  const kind: UEBuildPreviewErrorKind = code === "ue_preview_busy" ? "busy" :
    code === "ue_preview_capacity" ? "capacity" :
    /trust|root_changed/.test(code) ? "trust" :
    /invalid|unsupported|association|schema|identifier|dotnet_version_required/.test(code) ? "input" :
    /source|binding|engine_unavailable|required_path|not_found|unreadable|busy_or_unavailable/.test(code) ? "source" : "unavailable";
  return new UEBuildPreviewError(kind);
}
export function createNativeUEBuildPreview(invoke: NativeInvoke | null, now: () => number = Date.now) {
  return {
    available: () => invoke !== null,
    async prepare(configuration: UEBuildPreviewConfiguration): Promise<UEBuildPreviewReceipt> {
      if (!validateUEBuildPreviewConfiguration(configuration)) return fail("input");
      if (!invoke) return fail("unavailable");
      // Explicit projection: never forward root paths/identities, caller-supplied
      // argv, timeouts, permissions or a frontend-constructed Prepared object.
      const input: UEBuildPreviewConfiguration = {
        projectId: configuration.projectId, engineRoot: configuration.engineRoot,
        uprojectRelativePath: configuration.uprojectRelativePath, target: configuration.target,
        bundledDotnetVersion: configuration.bundledDotnetVersion,
      };
      try {
        const result = receipt(await invoke("prepare_ue_build_preview", { input }), input);
        if (result.expiresAtMs <= now()) {
          await invoke("release_ue_build_preview", { input: { projectId: result.projectId, preparedId: result.preparedId } }).catch(() => undefined);
          return fail("expired");
        }
        return result;
      } catch (error) { throw safeError(error); }
    },
    async release(observation: Pick<UEBuildPreviewReceipt, "projectId" | "preparedId">): Promise<boolean> {
      if (!projectId(observation.projectId) || !preparedId(observation.preparedId)) return fail("input");
      if (!invoke) return fail("unavailable");
      try {
        const raw = record(await invoke("release_ue_build_preview", { input: { projectId: observation.projectId, preparedId: observation.preparedId } }), ["released"]);
        if (typeof raw.released !== "boolean") return fail("invalid_receipt");
        return raw.released;
      } catch (error) { throw safeError(error); }
    },
  };
}
export type NativeUEBuildPreview = ReturnType<typeof createNativeUEBuildPreview>;
export const nativeUEBuildPreview = createNativeUEBuildPreview(localNativeInvoke());
