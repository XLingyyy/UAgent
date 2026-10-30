import { nativeProviderCredentials, ProviderCredentialError, SAVED_CREDENTIAL_MASK, validSavedCredentialInput, type NativeProviderCredentials, type SavedProviderCredential } from "../../runtime/native-provider-credentials";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../../i18n";
import { safeProviderSession, type SafeProviderSession } from "../../runtime/safe-provider-session";
import {
  sessionMatchesProviderModel,
  responsesFixtureAvailable,
  supportsProviderModel,
} from "../../provider/runtime-availability";
import type { ProviderConfig, ProviderVersion } from "../../types/provider";
import { useComposerActions } from "../../stores/ui-store";

type SessionController = SafeProviderSession & {
  openResponses?: (providerId: string, modelId: string, credential: string) => Promise<unknown>;
};
type SavedSessionController = SessionController & {
  openSaved?: (providerId: string, modelId: string) => Promise<unknown>;
};
type ProviderSessionProps = {
  provider: ProviderConfig;
  controller?: SavedSessionController;
  credentials?: NativeProviderCredentials;
  providerVersion?: Readonly<ProviderVersion>;
};
/** Explicit old injected controllers retain their memory-only unit-test surface.
 * The real application always uses native storage and never falls back on error. */
export function ProviderSessionSetup(props: ProviderSessionProps) {
  if (props.controller && props.controller !== safeProviderSession && !props.credentials)
    return <MemoryProviderSessionSetup provider={props.provider} controller={props.controller} />;
  return <SavedProviderSessionSetup provider={props.provider}
    controller={props.controller ?? safeProviderSession}
    credentials={props.credentials ?? nativeProviderCredentials} providerVersion={props.providerVersion} />;
}

function SavedProviderSessionSetup({ provider, controller, credentials, providerVersion }: {
  provider: ProviderConfig; controller: SavedSessionController; credentials: NativeProviderCredentials; providerVersion?: Readonly<ProviderVersion>;
}) {
  const { t } = useI18n();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { setComposerModel } = useComposerActions();
  const model = provider.models.find(item => item.id === provider.defaultModel) ?? provider.models[0];
  const supported = supportsProviderModel(provider, model?.id);
  const ready = sessionMatchesProviderModel(state, provider, model?.id);
  const password = useRef<HTMLInputElement>(null), generation = useRef(0);
  const [saved, setSaved] = useState<SavedProviderCredential | null>(null);
  const [replacing, setReplacing] = useState(false), [hasInput, setHasInput] = useState(false);
  const [operation, setOperation] = useState<"loading" | "saving" | "removing" | "opening" | "cleaning" | null>("loading");
  const [error, setError] = useState<"unavailable" | "invalid" | "changed" | "saveFailed" | "removeFailed" | "openFailed" | "cleanupPending" | "cleanupFailed" | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  function matchesDisplayedProvider(value: SavedProviderCredential): boolean {
    const expectedWire = provider.wireApi === "responses" ? "responses" : "chat_completions";
    const expectedEndpoint = expectedWire === "responses" ? "https://api.openai.com/v1/responses" : "https://api.deepseek.com/chat/completions";
    const version = value.providerVersion;
    return value.wireApi === expectedWire && value.endpoint === expectedEndpoint && version.exists &&
      (!providerVersion || (version.providerId === providerVersion.providerId && version.generation === providerVersion.generation &&
        version.revision === providerVersion.revision && version.exists === providerVersion.exists));
  }
  const busy = operation !== null;
  const recovery = saved?.recovery ?? null;
  const cleanupPending = Boolean(saved?.cleanupPending);
  const recoveryRecord = Boolean(recovery && saved?.version);
  const recoverable = recoveryRecord && !cleanupPending;
  const recoveryChoice = recoveryRecord && !replacing;
  const recoveryKey = recovery === "missing" ? "vault.recoveryMissing" : recovery === "corrupt" ? "vault.recoveryCorrupt" : "vault.recoveryUnavailable";
  async function load() {
    const current = ++generation.current;
    setOperation("loading"); setError(null); setSaved(null); setReplacing(false); setHasInput(false);
    if (password.current) password.current.value = "";
    try {
      if (!supported) { setReloadRequired(false); return; }
      if (!credentials.available()) throw new ProviderCredentialError("unavailable");
      const result = await credentials.get(provider.providerId);
      if (current !== generation.current) return;
      if (!matchesDisplayedProvider(result)) throw new ProviderCredentialError("conflict");
      setSaved(result); setReloadRequired(!result.providerVersion.exists);
      if (result.cleanupPending) setError("cleanupPending");
      else if (!result.providerVersion.exists) setError("changed");
    } catch (reason) {
      if (current === generation.current) { setError(reason instanceof ProviderCredentialError && reason.kind === "conflict" ? "changed" : "unavailable"); setReloadRequired(true); }
    } finally {
      if (current === generation.current) setOperation(null);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      if (password.current) password.current.value = "";
    };
    // The exact native config is captured by the receipt and checked on every mutation.
  }, [credentials, controller, provider.providerId, provider.baseUrl, provider.wireApi, provider.enabled, provider.authMode, supported, model?.id, providerVersion?.providerId, providerVersion?.generation, providerVersion?.revision, providerVersion?.exists]);
  async function useSaved(current = generation.current, selected = saved) {
    if (!model || !controller.openSaved || !supported || !selected?.saved || selected.cleanupPending || selected.recovery || !matchesDisplayedProvider(selected)) throw new Error("saved_session_unavailable");
    await setComposerModel(JSON.stringify([provider.providerId, model.id]));
    if (current !== generation.current) return;
    controller.enable();
    if (await controller.openSaved(provider.providerId, model.id) === false) throw new Error("saved_session_not_opened");
  }
  async function readAfterUnconfirmedMutation(current: number) {
    try {
      const result = await credentials.get(provider.providerId);
      if (current !== generation.current) return;
      if (!matchesDisplayedProvider(result)) { setSaved(null); setError("changed"); return; }
      setSaved(result); setReplacing(false);
      if (result.cleanupPending) setError("cleanupPending");
    } catch { if (current === generation.current) setSaved(null); }
  }
  async function saveKey() {
    if (busy || !saved || reloadRequired || cleanupPending || (saved.recovery && !replacing)) return;
    let key = password.current?.value ?? "";
    if (password.current) password.current.value = "";
    setHasInput(false); setError(null);
    if (!validSavedCredentialInput(key)) { key = ""; setError("invalid"); return; }
    const current = generation.current;
    setOperation("saving");
    let persisted = false, mutationStarted = false;
    try {
      await controller.closeAsync("revoked");
      if (current !== generation.current) return;
      mutationStarted = true;
      const result = await credentials.save(provider.providerId, saved, key);
      key = "";
      if (current !== generation.current) return;
      if (!matchesDisplayedProvider(result)) throw new ProviderCredentialError("conflict");
      if (!result.saved) throw new Error("saved_receipt_missing");
      setSaved(result); setReplacing(false); persisted = true;
      if (result.cleanupPending) { setError("cleanupPending"); return; }
      setOperation("opening");
      await useSaved(current, result);
    } catch (reason) {
      if (current === generation.current) {
        if (persisted) setError("openFailed");
        else {
          setError(reason instanceof ProviderCredentialError && reason.kind === "cleanup_pending" ? "cleanupPending" : reason instanceof ProviderCredentialError && reason.kind === "conflict" ? "changed" : "saveFailed");
          setReloadRequired(true);
          if (mutationStarted) await readAfterUnconfirmedMutation(current);
        }
      }
    } finally {
      key = "";
      if (current === generation.current) setOperation(null);
    }
  }
  async function removeKey() {
    if (busy || !saved || (!saved.saved && !recoverable) || reloadRequired || cleanupPending) return;
    const current = generation.current;
    let mutationStarted = false;
    setOperation("removing"); setError(null);
    if (password.current) password.current.value = "";
    setHasInput(false);
    try {
      await controller.closeAsync("revoked");
      if (current !== generation.current) return;
      mutationStarted = true;
      const result = await credentials.remove(provider.providerId, saved);
      if (current !== generation.current) return;
      if (!matchesDisplayedProvider(result)) throw new ProviderCredentialError("conflict");
      if (result.saved) throw new Error("deleted_receipt_missing");
      setSaved(result); setReplacing(false);
    } catch (reason) {
      if (current === generation.current) {
        setError(reason instanceof ProviderCredentialError && reason.kind === "cleanup_pending" ? "cleanupPending" : reason instanceof ProviderCredentialError && reason.kind === "conflict" ? "changed" : "removeFailed");
        setReloadRequired(true);
        if (mutationStarted) await readAfterUnconfirmedMutation(current);
      }
    } finally { if (current === generation.current) setOperation(null); }
  }
  async function cleanupKey() {
    if (busy || !saved?.cleanupPending || !saved.version || !matchesDisplayedProvider(saved)) return;
    const current = generation.current;
    let mutationStarted = false;
    setOperation("cleaning"); setError(null); setReplacing(false); setHasInput(false);
    if (password.current) password.current.value = "";
    try {
      await controller.closeAsync("revoked");
      if (current !== generation.current) return;
      mutationStarted = true;
      const result = await credentials.cleanup(provider.providerId, saved);
      if (current !== generation.current) return;
      if (!matchesDisplayedProvider(result)) throw new ProviderCredentialError("conflict");
      setSaved(result);
    } catch (reason) {
      if (current === generation.current) {
        const knownPending = reason instanceof ProviderCredentialError && reason.kind === "cleanup_pending";
        setError(knownPending ? "cleanupPending" : reason instanceof ProviderCredentialError && reason.kind === "conflict" ? "changed" : "cleanupFailed");
        if (!knownPending) setReloadRequired(true);
        if (mutationStarted) await readAfterUnconfirmedMutation(current);
      }
    } finally { if (current === generation.current) setOperation(null); }
  }
  return <section className="ua-settings-section ua-product-session" aria-labelledby="provider-session-heading">
    <div className="ua-settings-section__header">
      <h3 id="provider-session-heading" className="ua-settings-section__title">{t("vault.heading")}</h3>
      <p className="ua-settings-section__description">{t(supported ? "vault.help" : "product.unsupportedHelp")}</p>
    </div>
    <div className="ua-settings-section__body">
      {model && <p>{t("product.selectedModel", {model: model.label})} · <code>{provider.wireApi}</code></p>}
      <p className="ua-session-state" role="status">{operation === "loading" ? t("vault.loading") :
        operation === "saving" ? t("vault.saving") : operation === "removing" ? t("vault.removing") :
        operation === "cleaning" ? t("vault.cleaning") : operation === "opening" ? t("responses.opening") : !supported ? t("product.unsupported") :
        !saved ? t("vault.statusUnknown") : recovery ? t(recoveryKey) : saved.cleanupPending ? t(saved.saved ? "vault.savedCleanupPending" : "vault.disabled") : saved.saved ? ready ? t("product.sessionReady") : t("vault.saved") : t("vault.notSaved")}</p>
      {supported && <>
        {saved?.saved && !replacing ? <label className="ua-session-key">
          {t("vault.savedKey")}<input key="saved-mask" type="password" className="ua-settings-page__input"
            aria-label={t("vault.savedKey")} value={SAVED_CREDENTIAL_MASK} readOnly autoComplete="off" />
        </label> : recoveryChoice ? <p role="note">{t("vault.recoveryHelp")}</p> : <label className="ua-session-key">
          {t("vault.title")}<input key="credential-entry" ref={password} type="password" defaultValue="" className="ua-settings-page__input"
            aria-label={t("vault.title")} autoComplete="off" spellCheck={false}
            disabled={busy || !saved || reloadRequired || cleanupPending} onChange={() => { setHasInput(Boolean(password.current?.value)); if (!reloadRequired) setError(null); }} />
        </label>}
        <div className="ua-session-actions">
          {!recoveryChoice && (!saved?.saved || replacing) && <button type="button" className="ua-session-open"
            disabled={busy || !hasInput || !saved || reloadRequired || cleanupPending} onClick={() => void saveKey()}>{t("vault.save")}</button>}
          {(saved?.saved || recoveryRecord) && !replacing && <button type="button" disabled={busy || reloadRequired || cleanupPending}
            onClick={() => { setReplacing(true); setHasInput(false); setError(null); }}>{t("vault.replace")}</button>}
          {(saved?.saved || recoveryRecord) && replacing && <button type="button" disabled={busy}
            onClick={() => { if (password.current) password.current.value = ""; setReplacing(false); setHasInput(false); setError(null); }}>{t("vault.cancelReplace")}</button>}
          {(saved?.saved || recoveryRecord) && <button type="button" disabled={busy || reloadRequired || cleanupPending} onClick={() => void removeKey()}>{t(recovery ? "vault.removeUnavailable" : "vault.remove")}</button>}
          {saved?.saved && !cleanupPending && !ready && !replacing && <button type="button" disabled={busy || reloadRequired}
            onClick={async () => { const current=generation.current; setOperation("opening"); setError(null); try { await useSaved(current); } catch { if(current===generation.current)setError("openFailed"); } finally { if(current===generation.current)setOperation(null); } }}>{t("vault.useSaved")}</button>}
          {ready && <button type="button" disabled={busy} onClick={async () => { try { await controller.closeAsync("cleared"); } catch { setError("openFailed"); } }}>{t("vault.closeSession")}</button>}
          {cleanupPending && <button type="button" disabled={busy || !saved?.version} onClick={() => void cleanupKey()}>{t("vault.retryCleanup")}</button>}
          {(reloadRequired || recoveryRecord || cleanupPending) && <button type="button" disabled={busy} onClick={() => void load()}>{t("vault.refresh")}</button>}
        </div>
        {cleanupPending && <p role="note" className="ua-settings-page__action-note">{t("vault.cleanupRequired")}</p>}
        <p className="ua-settings-page__action-note">{t("vault.reuseHelp")}</p>
        <p className="ua-settings-page__action-note">{t("vault.bindingHelp")}</p>
        <p className="ua-settings-page__action-note">{t("vault.discussionOnly")}</p>
        {!recoveryChoice && (!saved?.saved || replacing) && <><p className="ua-settings-page__action-note">{t("vault.saveConsent")}</p><p className="ua-settings-page__action-note">{t("vault.inputHelp")}</p></>}
        {error && <p role="alert">{t(("vault." + error) as "vault.unavailable" | "vault.invalid" | "vault.changed" | "vault.saveFailed" | "vault.removeFailed" | "vault.openFailed" | "vault.cleanupPending" | "vault.cleanupFailed")}</p>}
      </>}
    </div>
  </section>;
}

function MemoryProviderSessionSetup({
  provider,
  controller = safeProviderSession,
}: {
  provider: ProviderConfig;
  controller?: SessionController;
}) {
  const { t, locale } = useI18n();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const { setComposerModel } = useComposerActions();
  const password = useRef<HTMLInputElement>(null);
  const [authorized, setAuthorized] = useState(false),
    [hasInput, setHasInput] = useState(false),
    [error, setError] = useState(false),
    [pending, setPending] = useState(false);
  const attempt = useRef(0),
    opening = useRef(false),
    pendingGeneration = useRef<number | undefined>(undefined);
  const model = provider.models.find((m) => m.id === provider.defaultModel) ?? provider.models[0];
  const responses = provider.wireApi === "responses",
    fixture = responses && responsesFixtureAvailable(),
    supported = supportsProviderModel(provider, model?.id);
  const ready = sessionMatchesProviderModel(state, provider, model?.id);
  useEffect(() => {
    setAuthorized(false);
    setHasInput(false);
    setError(false);
    setPending(false);
    const field = password.current;
    if (field) field.value = "";
    return () => {
      attempt.current++;
      if (field) field.value = "";
      if (opening.current) {
        opening.current = false;
        if (
          pendingGeneration.current !== undefined &&
          controller.getSessionGeneration?.() === pendingGeneration.current
        )
          controller.close("setup_cancelled");
        pendingGeneration.current = undefined;
      }
    };
  }, [controller, provider.providerId, provider.baseUrl, provider.wireApi, model?.id]);
  function clear() {
    attempt.current++;
    opening.current = false;
    pendingGeneration.current = undefined;
    controller.close("cleared");
    if (password.current) password.current.value = "";
    setHasInput(false);
    setAuthorized(false);
    setError(false);
    setPending(false);
  }
  async function open() {
    if (opening.current) return;
    let key = password.current?.value ?? "";
    if (password.current) password.current.value = "";
    setHasInput(false);
    const version = ++attempt.current;
    opening.current = true;
    setPending(true);
    setError(false);
    try {
      if (!supported || !authorized || !model || !state.canConfigure) throw Error("not_authorized");
      await setComposerModel(JSON.stringify([provider.providerId, model.id]));
      if (version !== attempt.current) return;
      controller.enable();
      if (responses) {
        if (!controller.openResponses) throw Error("protocol_unavailable");
        const operation = controller.openResponses(provider.providerId, model.id, key);
        pendingGeneration.current = controller.getSessionGeneration?.();
        key = "";
        if ((await operation) === false) throw Error("session_not_opened");
      } else {
        controller.openAccount(key);
        key = "";
      }
    } catch {
      if (version === attempt.current) {
        // Responses owns its native cleanup. A superseded async attempt must
        // never close a newer provider session opened elsewhere.
        if (!responses) controller.close("setup_failed");
        setError(true);
      }
    } finally {
      key = "";
      if (version === attempt.current) {
        opening.current = false;
        pendingGeneration.current = undefined;
        setPending(false);
        setAuthorized(false);
      }
    }
  }
  return (
    <section
      className="ua-settings-section ua-product-session"
      aria-labelledby="provider-session-heading"
    >
      <div className="ua-settings-section__header">
        <h3 id="provider-session-heading" className="ua-settings-section__title">
          {t("product.connection")}
        </h3>
        <p className="ua-settings-section__description">
          {responses
            ? supported
              ? fixture ? t("demo.sessionHelp") : (locale === "zh-CN"
                ? "支持 OpenAI 官方 Responses 服务。开启会话只保存临时凭证；点击发送才会联网，连接状态尚未验证。"
                : "Supports the official OpenAI Responses service. Opening holds a temporary credential; only Send makes a request. Connectivity is unverified.")
              : t("responses.nativeUnavailable")
            : supported
              ? t("product.connectionHelp")
              : t("product.unsupportedHelp")}
        </p>
      </div>
      <div className="ua-settings-section__body">
        {model && (
          <p>
            {t("product.selectedModel", { model: model.label })} · <code>{provider.wireApi}</code>
          </p>
        )}
        {fixture && supported && <p role="note">{t("demo.banner")}</p>}
        <p className="ua-session-state" role="status">
          {pending
            ? t("responses.opening")
            : !supported
              ? t("product.unsupported")
              : ready
                ? t(fixture ? "demo.sessionReady" : "product.sessionReady")
                : t("product.sessionClosed")}
        </p>
        {supported && (
          <>
            <label className="ua-session-key">
              {t(fixture ? "responses.fixtureCredential" : "product.apiKey")}
              <input
                ref={password}
                type="password"
                placeholder={fixture ? "offline-responses-fixture-only" : undefined}
                autoComplete="off"
                spellCheck={false}
                maxLength={16384}
                disabled={pending}
                aria-label={t(fixture ? "responses.fixtureCredential" : "product.apiKey")}
                className="ua-settings-page__input"
                onChange={() => {
                  controller.close();
                  setHasInput(Boolean(password.current?.value));
                  setError(false);
                }}
              />
            </label>
            <label className="ua-checkline">
              <input
                type="checkbox"
                checked={authorized}
                disabled={pending}
                aria-label={t("product.authorizeLabel")}
                onChange={(e) => {
                  controller.close();
                  setAuthorized(e.target.checked);
                }}
              />
              {t("product.authorize")}
            </label>
            <div className="ua-session-actions">
              <button
                type="button"
                className="ua-session-open"
                disabled={
                  !authorized || !hasInput || !state.canConfigure || pending || state.pendingSetup
                }
                onClick={() => void open()}
              >
                {pending
                  ? t("responses.opening")
                  : t(fixture ? "demo.openSession" : "product.openSession")}
              </button>
              <button type="button" onClick={clear}>
                {t(fixture ? "demo.closeSession" : "product.clearSession")}
              </button>
            </div>
            <p className="ua-settings-page__action-note">
              {t(fixture ? "demo.sessionHelp" : "product.credentialHelp")}
            </p>
            {error && <p role="alert">{t("product.setupError")}</p>}
          </>
        )}
      </div>
    </section>
  );
}
