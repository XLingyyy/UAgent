import type { ProviderVersion } from "../types/provider";
import type { NativeInvoke } from "./project-native-adapter";
import { localNativeInvoke } from "./native-provider-budget";

export const SAVED_CREDENTIAL_MASK = "••••••••";
export interface SavedProviderCredential {
  readonly saved: boolean;
  readonly version: string | null;
  readonly mask: string | null;
  readonly providerVersion: Readonly<ProviderVersion>;
  readonly cleanupPending?: boolean;
  readonly wireApi?: "chat_completions" | "responses";
  readonly endpoint?: string;
}
export type ProviderCredentialErrorKind = "invalid" | "conflict" | "unavailable" | "cleanup_pending";
export class ProviderCredentialError extends Error {
  readonly kind: ProviderCredentialErrorKind;
  constructor(kind: ProviderCredentialErrorKind) {
    super("provider_credential_" + kind);
    this.name = "ProviderCredentialError";
    this.kind = kind;
  }
}
const invalid = () => new ProviderCredentialError("invalid");
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && Array.from(value).every(character => { const code=character.charCodeAt(0); return code>=32 && code!==127; });
export function validSavedCredentialInput(value: string): boolean {
  return value.length >= 8 && value.length <= 2048 && /^[\x21-\x7e]+$/.test(value) && !/^\*+$/.test(value);
}
function receipt(value: unknown, providerId: string): SavedProviderCredential {
  const v = value as Partial<SavedProviderCredential> | null;
  const p = v?.providerVersion;
  if (!v || typeof v.saved !== "boolean" || !p || p.providerId !== providerId ||
      !Number.isSafeInteger(p.revision) || p.revision < 0 || typeof p.exists !== "boolean" ||
      (p.generation !== null && !validId(p.generation)) ||
      (v.saved ? !validId(v.version) : v.version !== null && !validId(v.version)) ||
      (v.saved ? typeof v.mask !== "string" : v.mask !== null) ||
      (v.cleanupPending !== undefined && typeof v.cleanupPending !== "boolean") || (v.cleanupPending && v.saved)) throw invalid();
  const routed = v.wireApi !== undefined || v.endpoint !== undefined;
  if (routed && !((v.wireApi === "chat_completions" && v.endpoint === "https://api.deepseek.com/chat/completions") ||
    (v.wireApi === "responses" && v.endpoint === "https://api.openai.com/v1/responses"))) throw invalid();
  // Never retain a native-provided display string: only the fixed public mask.
  return Object.freeze({
    saved: v.saved, version: v.version ?? null, mask: v.saved ? SAVED_CREDENTIAL_MASK : null,
    providerVersion: Object.freeze({ providerId, generation: p.generation, revision: p.revision, exists: p.exists }),
    ...(v.cleanupPending === undefined ? {} : {cleanupPending: v.cleanupPending}),
    ...(routed ? {wireApi: v.wireApi, endpoint: v.endpoint} : {}),
  });
}
function safeFailure(error: unknown): ProviderCredentialError {
  if (error instanceof ProviderCredentialError) return error;
  const code = typeof error === "string" ? error : error && typeof error === "object" && "kind" in error ? String(error.kind) : "";
  return new ProviderCredentialError(/cleanup[_-]?pending/i.test(code) ? "cleanup_pending" : /conflict|version|stale/i.test(code) ? "conflict" : "unavailable");
}
/** Writes only explicitly provided input. No operation returns or caches a key. */
export function createNativeProviderCredentials(invoke: NativeInvoke | null) {
  const listeners = new Set<(providerId: string) => void>();
  async function call(command: string, input: unknown, providerId: string) {
    if (!invoke) throw new ProviderCredentialError("unavailable");
    try { return receipt(await invoke(command, { input }), providerId); }
    catch (error) { throw safeFailure(error); }
  }
  function token(providerId: string, expected: SavedProviderCredential) {
    if (!validId(providerId) || expected.providerVersion.providerId !== providerId) throw invalid();
    return { ...expected.providerVersion };
  }
  return {
    available: () => invoke !== null,
    subscribe(listener: (providerId: string) => void) {
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    get(providerId: string) {
      if (!validId(providerId)) return Promise.reject(invalid());
      return call("get_saved_provider_credential", { providerId }, providerId);
    },
    async save(providerId: string, expected: SavedProviderCredential, credential: string) {
      const expectedProviderVersion = token(providerId, expected);
      if (!validSavedCredentialInput(credential)) throw invalid();
      try {
        const result = await call("save_provider_credential", {
          providerId, expectedProviderVersion, expectedCredentialVersion: expected.version, credential,
        }, providerId);
        if (!result.saved) throw invalid();
        for (const listener of listeners) { try { listener(providerId); } catch { /* Observers do not change the native receipt. */ } }
        return result;
      } finally { credential = ""; }
    },
    async remove(providerId: string, expected: SavedProviderCredential) {
      const expectedProviderVersion = token(providerId, expected);
      if (!expected.saved || !validId(expected.version)) throw invalid();
      const result = await call("delete_provider_credential", {
        providerId, expectedProviderVersion, expectedCredentialVersion: expected.version,
      }, providerId);
      if (result.saved) throw invalid();
      if (result.cleanupPending) throw new ProviderCredentialError("cleanup_pending");
      for (const listener of listeners) { try { listener(providerId); } catch { /* Observers do not change the native receipt. */ } }
      return result;
    },
  };
}
export type NativeProviderCredentials = ReturnType<typeof createNativeProviderCredentials>;
export const nativeProviderCredentials = createNativeProviderCredentials(localNativeInvoke());
