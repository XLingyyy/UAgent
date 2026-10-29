import { nativeProductSettings, type ProductSettingsSnapshot } from "./native-product-settings";
import { localNativeInvoke } from "./native-provider-budget";
import { useSyncExternalStore, useState } from "react";
import { useI18n } from "../i18n";
import { getApplicationProfile } from "./application-profile";
import { safeProviderSession, RESPONSES_FIXTURE_CREDENTIAL } from "./safe-provider-session";
import { createSupportedProvider } from "../provider/runtime-availability";
import { DEEPSEEK_MODEL } from "@uagent/runtime";
import { useProviderActions, useComposerActions, useProjectActions } from "../stores/ui-store";
import "./OfflineDemoBanner.css";
export function OfflineDemoBanner() {
  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const { t } = useI18n(),
    session = useSyncExternalStore(
      safeProviderSession.subscribe,
      safeProviderSession.getSnapshot,
      safeProviderSession.getSnapshot,
    );
  const providers = useProviderActions(),
    composer = useComposerActions(),
    projects = useProjectActions();
  if (!getApplicationProfile().offlineDemo) return null;
  const prepareResponses = async (mode:"discussion"|"investigation"="investigation") => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await safeProviderSession.closeAsync("cleared");
      const invoke = localNativeInvoke();
      if (!invoke) throw Error("native_unavailable");
      const fixture = await invoke<{ rootRef: string; providerId: string; modelId: string }>(
        "prepare_native_responses_fixture",
      );
      const version = await nativeProductSettings.captureVersion(fixture.providerId);
      if (!version) throw Error("native_settings_unavailable");
      if (version.exists) {
        const fresh = await invoke<ProductSettingsSnapshot>("read_product_settings");
        const existing = fresh.providers.find(
          (p) => p.config.providerId === fixture.providerId,
        )?.config;
        if (
          !existing ||
          existing.wireApi !== "responses" ||
          existing.baseUrl !== "https://api.openai.com/v1" ||
          !existing.enabled ||
          existing.authMode !== "env_key" ||
          !existing.models.some((m) => m.id === fixture.modelId)
        )
          throw Error("fixture_config_changed");
        await providers.reviewExistingProvider(fixture.providerId);
      } else
        await providers.saveProvider(
          {
            providerId: fixture.providerId,
            displayName: "Responses local fixture",
            baseUrl: "https://api.openai.com/v1",
            wireApi: "responses",
            authMode: "env_key",
            networkMode: "fixture",
            enabled: true,
            models: [
              {
                id: fixture.modelId,
                label: "Responses local fixture",
                contextWindow: 128000,
                supportsReasoning: false,
              },
            ],
            defaultModel: fixture.modelId,
          },
          version,
        );
      if(mode==="investigation"){
        const projectId = await projects.addProjectRoot(fixture.rootRef);
        if (!projectId) throw Error("fixture_project_unavailable");
      }
      await composer.setComposerModel(JSON.stringify([fixture.providerId, fixture.modelId]));
      composer.setComposerTaskMode(mode);
      safeProviderSession.enable();
      if (
        !(await safeProviderSession.openResponses(
          fixture.providerId,
          fixture.modelId,
          RESPONSES_FIXTURE_CREDENTIAL,
        ))
      )
        throw Error("fixture_session_unavailable");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="ua-demo-banner" aria-label={t("demo.banner")}>
      <span>{t("demo.banner")}</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setError(false);
          if (session.ready) {
            await safeProviderSession.closeAsync("cleared").catch(() => setError(true));
            return;
          }
          try {
            const version = await nativeProductSettings.captureVersion("deepseek");
            await providers.saveProvider(
              { ...createSupportedProvider(), networkMode: "fixture" },
              version,
            );
            await composer.setComposerModel(JSON.stringify(["deepseek", DEEPSEEK_MODEL]));
            safeProviderSession.enable();
            safeProviderSession.openAccount("offline-demo-session-only");
          } catch {
            setError(true);
          }
        }}
      >
        {t(session.ready ? "demo.closeSession" : "demo.openSession")}
      </button>
      <button
        type="button"
        disabled={busy || session.pendingSetup}
        onClick={() => void prepareResponses()}
      >
        {t(busy ? "responses.opening" : "responses.prepareFixture")}
      </button>
      <button type="button" disabled={busy||session.pendingSetup} onClick={()=>void prepareResponses("discussion")}>{t("responses.prepareChatFixture")}</button>
      <span>
        {t(
          session.ready && session.fixture
            ? "responses.fixtureReady"
            : session.ready
              ? "demo.sessionReady"
              : "demo.sessionHelp",
        )}
      </span>
      <details>
        <summary>{t("common.details")}</summary>
        {t("responses.fixtureHelp")}
      </details>
      {error && <span role="alert">{t("responses.fixtureSetupFailed")}</span>}
    </aside>
  );
}
