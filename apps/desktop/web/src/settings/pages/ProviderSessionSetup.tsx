import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../../i18n";
import { safeProviderSession, type SafeProviderSession } from "../../runtime/safe-provider-session";
import {
  sessionMatchesProviderModel,
  responsesFixtureAvailable,
  supportsProviderModel,
} from "../../provider/runtime-availability";
import type { ProviderConfig } from "../../types/provider";
import { useComposerActions } from "../../stores/ui-store";

type SessionController = SafeProviderSession & {
  openResponses?: (providerId: string, modelId: string, credential: string) => Promise<unknown>;
};
export function ProviderSessionSetup({
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
