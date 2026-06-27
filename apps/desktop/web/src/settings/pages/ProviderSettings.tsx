import { useEffect, useMemo, useState } from "react";
import {
  createModelsForWireApi,
  createProviderDraft,
  getReasoningEffortsForModel,
  PROVIDER_AUTH_MODE_OPTIONS,
  PROVIDER_WIRE_API_OPTIONS,
} from "../../provider/provider-data";
import { useProviderActions, useProviderStore } from "../../stores/ui-store";
import type {
  ProviderAuthMode,
  ProviderConfig,
  ProviderNetworkMode,
  ProviderReasoningEffort,
  ProviderWireApi,
} from "../../types/provider";
import { SettingsPageLayout } from "../SettingsPageLayout";
import { providerPageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

type ProviderEditorMode = "view" | "edit" | "create";

interface ProviderDraft extends ProviderConfig {
  isDefault: boolean;
  networkMode: ProviderNetworkMode;
}

function createDraft(provider: ProviderConfig, defaultProviderId: string | null): ProviderDraft {
  return {
    ...provider,
    networkMode: provider.networkMode ?? "disabled",
    models: provider.models.map((model) => ({
      ...model,
      reasoningEfforts: model.reasoningEfforts ? [...model.reasoningEfforts] : undefined,
    })),
    isDefault: provider.providerId === defaultProviderId,
  };
}

function cloneDraft(draft: ProviderDraft): ProviderConfig {
  return {
    providerId: draft.providerId,
    displayName: draft.displayName,
    baseUrl: draft.baseUrl,
    wireApi: draft.wireApi,
    authMode: draft.authMode,
    networkMode: draft.networkMode,
    secretRef: draft.secretRef,
    models: draft.models.map((model) => ({
      ...model,
      reasoningEfforts: model.reasoningEfforts ? [...model.reasoningEfforts] : undefined,
    })),
    defaultModel: draft.defaultModel,
    defaultReasoningEffort: draft.defaultReasoningEffort,
    enabled: draft.enabled,
  };
}

function isRawSecretLike(value: string): boolean {
  return /^(sk-|sk_|xoxb-|ghp_|gho_|AIza|anthropic-|claude-)/i.test(value.trim());
}

export function ProviderSettings() {
  const { providers, selectedProviderId, defaultProviderId, testStatus } = useProviderStore((state) => state);
  const { setSelectedProvider, saveProvider, deleteProvider, setDefaultProvider, setProviderTestStatus } =
    useProviderActions();
  const selectedProvider =
    providers.find((provider) => provider.providerId === selectedProviderId) ?? null;
  const [editorMode, setEditorMode] = useState<ProviderEditorMode>("view");
  const [draft, setDraft] = useState<ProviderDraft | null>(() =>
    selectedProvider ? createDraft(selectedProvider, defaultProviderId) : null,
  );

  useEffect(() => {
    if (editorMode === "view") {
      setDraft(selectedProvider ? createDraft(selectedProvider, defaultProviderId) : null);
    }
  }, [defaultProviderId, editorMode, selectedProvider]);

  const isEditing = editorMode !== "view";
  const reasoningOptions = useMemo(
    () => (draft ? getReasoningEffortsForModel(draft.models, draft.defaultModel) : []),
    [draft],
  );
  const selectedModel =
    draft?.models.find((model) => model.id === draft.defaultModel) ?? draft?.models[0] ?? null;

  function handleProviderSelect(providerId: string) {
    setSelectedProvider(providerId);
    setEditorMode("view");
  }

  function handleAddProvider() {
    const nextDraft = createProviderDraft(providers.length + 1);
    setSelectedProvider(null);
    setDraft({
      ...nextDraft,
      networkMode: "disabled",
      isDefault: providers.length === 0,
    });
    setEditorMode("create");
  }

  function handleEditProvider() {
    if (!selectedProvider) {
      return;
    }
    setDraft(createDraft(selectedProvider, defaultProviderId));
    setEditorMode("edit");
  }

  function handleDeleteProvider() {
    if (!selectedProvider) {
      return;
    }
    deleteProvider(selectedProvider.providerId);
    setEditorMode("view");
  }

  function updateDraft(updater: (current: ProviderDraft) => ProviderDraft) {
    setDraft((current) => (current ? updater(current) : current));
  }

  function handleWireApiChange(wireApi: ProviderWireApi) {
    updateDraft((current) => {
      const models = createModelsForWireApi(wireApi);
      const defaultModel =
        models.find((model) => model.id === current.defaultModel)?.id ?? models[0]?.id;
      const nextReasoningOptions = getReasoningEffortsForModel(models, defaultModel);
      return {
        ...current,
        wireApi,
        models,
        defaultModel,
        defaultReasoningEffort:
          nextReasoningOptions.find((option) => option === current.defaultReasoningEffort) ??
          nextReasoningOptions[0] ??
          "medium",
      };
    });
  }

  function handleDefaultModelChange(modelId: string) {
    updateDraft((current) => {
      const nextReasoningOptions = getReasoningEffortsForModel(current.models, modelId);
      return {
        ...current,
        defaultModel: modelId,
        defaultReasoningEffort:
          nextReasoningOptions.find((option) => option === current.defaultReasoningEffort) ??
          nextReasoningOptions[0] ??
          "medium",
      };
    });
  }

  function handleAuthModeChange(authMode: ProviderAuthMode) {
    updateDraft((current) => ({
      ...current,
      authMode,
      secretRef: authMode === "none" ? "" : current.secretRef || "PROVIDER_KEY",
    }));
  }

  function handleSaveProvider() {
    if (!draft) {
      return;
    }
    const nextProvider = cloneDraft(draft);
    saveProvider(nextProvider);
    setDefaultProvider(
      draft.isDefault
        ? nextProvider.providerId
        : defaultProviderId === nextProvider.providerId
          ? null
          : defaultProviderId,
    );
    setEditorMode("view");
  }

  function handleTestConnection() {
    if (!draft || draft.networkMode === "disabled" || !draft.enabled) {
      setProviderTestStatus("failure");
      return;
    }
    setProviderTestStatus("success");
  }

  return (
    <SettingsPageLayout page={providerPageData}>
      <div
        className="ua-settings-page__provider-status-strip"
        aria-label="Provider page safeguards"
      >
        <span className="ua-settings-page__provider-status-pill">Secret-safe</span>
        <span className="ua-settings-page__provider-status-pill">Fixture first</span>
        <span className="ua-settings-page__provider-status-pill">Live opt-in</span>
      </div>

      <section className="ua-settings-section" aria-labelledby="section-provider-list">
        <div className="ua-settings-section__header">
          <h3 id="section-provider-list" className="ua-settings-section__title">
            Available providers
          </h3>
          <p className="ua-settings-section__description">
            Local mock provider entries available for model selection.
          </p>
        </div>
        <div className="ua-settings-section__body">
          <div className="ua-settings-page__provider-list">
            {providers.map((provider) => {
              const isActive = provider.providerId === selectedProviderId;
              return (
                <button
                  key={provider.providerId}
                  type="button"
                  className={`ua-settings-page__provider-card${isActive ? " ua-settings-page__provider-card--active" : ""}`}
                  onClick={() => handleProviderSelect(provider.providerId)}
                >
                  <span className="ua-settings-page__provider-card-main">
                    <span className="ua-settings-page__provider-card-title">
                      {provider.displayName}
                    </span>
                    <span className="ua-settings-page__provider-card-meta">
                      {provider.wireApi}
                      <span className="ua-settings-page__provider-card-sep" aria-hidden="true">
                        &middot;
                      </span>
                      {provider.baseUrl}
                    </span>
                  </span>
                  <span className="ua-settings-page__provider-card-badges">
                    {defaultProviderId === provider.providerId && (
                      <span className="ua-settings-page__provider-card-badge">Default</span>
                    )}
                    <span
                      className={`ua-settings-page__provider-card-badge${provider.enabled ? "" : " ua-settings-page__provider-card-badge--muted"}`}
                    >
                      {provider.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="ua-settings-section" aria-labelledby="section-provider-detail">
        <div className="ua-settings-section__header">
          <h3 id="section-provider-detail" className="ua-settings-section__title">
            Selected provider detail
          </h3>
          <p className="ua-settings-section__description">
            Configure provider connection with secret-safe settings. Network mode controls transport behavior.
          </p>
        </div>
        <div className="ua-settings-section__body">
          {draft ? (
            <div className="ua-settings-page__provider-form">
              <div className="ua-settings-page__field-grid">
                <label className="ua-settings-page__field">
                  <span className="ua-settings-page__field-label">Display name</span>
                  <input
                    className="ua-settings-page__input"
                    type="text"
                    value={draft.displayName}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    disabled={!isEditing}
                    aria-label="Display name"
                  />
                </label>

                <label className="ua-settings-page__field ua-settings-page__field--full">
                  <span className="ua-settings-page__field-label">Base URL</span>
                  <input
                    className="ua-settings-page__input"
                    type="text"
                    value={draft.baseUrl}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    disabled={!isEditing}
                    aria-label="Base URL"
                  />
                </label>

                <label className="ua-settings-page__field">
                  <span className="ua-settings-page__field-label">Wire API</span>
                  <select
                    className="ua-settings-page__select"
                    value={draft.wireApi}
                    onChange={(event) => handleWireApiChange(event.target.value as ProviderWireApi)}
                    disabled={!isEditing}
                    aria-label="Wire API"
                  >
                    {PROVIDER_WIRE_API_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="ua-settings-page__field">
                  <span className="ua-settings-page__field-label">Authentication</span>
                  <select
                    className="ua-settings-page__select"
                    value={draft.authMode}
                    onChange={(event) =>
                      handleAuthModeChange(event.target.value as ProviderAuthMode)
                    }
                    disabled={!isEditing}
                    aria-label="Authentication"
                  >
                    {PROVIDER_AUTH_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="ua-settings-page__field">
                  <span className="ua-settings-page__field-label">Secret ref</span>
                  <input
                    className="ua-settings-page__input"
                    type="text"
                    value={draft.secretRef ?? ""}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        secretRef: isRawSecretLike(event.target.value)
                          ? current.secretRef
                          : event.target.value,
                      }))
                    }
                    disabled={!isEditing || draft.authMode === "none"}
                    aria-label="Secret ref"
                    placeholder="Secret reference name"
                  />
                </label>
              </div>

              <div className="ua-settings-page__field-grid">
                <label className="ua-settings-page__field">
                  <span className="ua-settings-page__field-label">Network mode</span>
                  <select
                    className="ua-settings-page__select"
                    value={draft.networkMode ?? "disabled"}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        networkMode: event.target.value as ProviderNetworkMode,
                      }))
                    }
                    disabled={!isEditing}
                    aria-label="Network mode"
                  >
                    <option value="disabled">Disabled</option>
                    <option value="fixture">Fixture</option>
                    <option value="live">Live (opt-in)</option>
                  </select>
                </label>
              </div>

              <div className="ua-settings-page__checkbox-row">
                <label className="ua-settings-page__checkbox">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        enabled: event.target.checked,
                      }))
                    }
                    disabled={!isEditing}
                    aria-label="Provider enabled"
                  />
                  <span>Provider enabled</span>
                </label>
              </div>
              <div className="ua-settings-page__provider-help-text">
                {draft.networkMode === "live"
                  ? "Secret reference name is stored only as a reference. Raw secret values are rejected."
                  : draft.networkMode === "fixture"
                    ? "Fixture mode uses deterministic responses. No network request is sent."
                    : "Disabled mode blocks all provider requests."}
              </div>
            </div>
          ) : (
            <div className="ua-settings-page__provider-empty">
              <span className="ua-settings-page__provider-empty-text">
                Select a provider or create a new local configuration.
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="ua-settings-section" aria-labelledby="section-model-defaults">
        <div className="ua-settings-section__header">
          <h3 id="section-model-defaults" className="ua-settings-section__title">
            Model defaults
          </h3>
          <p className="ua-settings-section__description">
            Choose the default model and reasoning values reflected by the composer.
          </p>
        </div>
        <div className="ua-settings-section__body">
          {draft ? (
            <div className="ua-settings-page__provider-defaults">
              <div className="ua-settings-page__checkbox-row">
                <label className="ua-settings-page__checkbox">
                  <input
                    type="checkbox"
                    checked={draft.isDefault}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        isDefault: event.target.checked,
                      }))
                    }
                    disabled={!isEditing}
                    aria-label="Use as default provider"
                  />
                  <span>Use as default provider</span>
                </label>
              </div>

              <div className="ua-settings-page__field-grid">
                <label className="ua-settings-page__field">
                  <span className="ua-settings-page__field-label">Default model</span>
                  <select
                    className="ua-settings-page__select"
                    value={draft.defaultModel ?? ""}
                    onChange={(event) => handleDefaultModelChange(event.target.value)}
                    disabled={!isEditing}
                    aria-label="Default model"
                  >
                    {draft.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="ua-settings-page__field">
                  <span className="ua-settings-page__field-label">Reasoning effort</span>
                  <select
                    className="ua-settings-page__select"
                    value={draft.defaultReasoningEffort ?? "medium"}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        defaultReasoningEffort: event.target.value as ProviderReasoningEffort,
                      }))
                    }
                    disabled={!isEditing || reasoningOptions.length === 0}
                    aria-label="Reasoning effort"
                  >
                    {reasoningOptions.length > 0 ? (
                      reasoningOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))
                    ) : (
                      <option value="medium">Unavailable for this model</option>
                    )}
                  </select>
                </label>
              </div>

              <div className="ua-settings-page__provider-subsection">
                <div className="ua-settings-page__subheading">Model catalog</div>
                <div className="ua-settings-page__provider-model-list">
                  {draft.models.map((model) => (
                    <div key={model.id} className="ua-settings-page__provider-model-item">
                      <span className="ua-settings-page__provider-model-title">{model.label}</span>
                      <span className="ua-settings-page__provider-model-meta">
                        {model.contextWindow.toLocaleString()} context
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ua-settings-page__provider-subsection">
                <div className="ua-settings-page__subheading">Current selection summary</div>
                <div className="ua-settings-page__provider-summary">
                  <span className="ua-settings-page__provider-summary-item">
                    <span className="ua-settings-page__provider-summary-label">Model</span>
                    <span className="ua-settings-page__provider-summary-value">
                      {selectedModel?.label ?? "Not configured"}
                    </span>
                  </span>
                  <span className="ua-settings-page__provider-summary-item">
                    <span className="ua-settings-page__provider-summary-label">Context</span>
                    <span className="ua-settings-page__provider-summary-value">
                      {selectedModel
                        ? `${selectedModel.contextWindow.toLocaleString()} tokens`
                        : "N/A"}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="ua-settings-page__provider-empty">
              <span className="ua-settings-page__provider-empty-text">
                Select a provider or create a new local configuration.
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="ua-settings-section" aria-labelledby="section-provider-actions">
        <div className="ua-settings-section__header">
          <h3 id="section-provider-actions" className="ua-settings-section__title">
            Local-only actions
          </h3>
          <p className="ua-settings-section__description">
            Test connection uses fixture mode by default. Live mode requires explicit opt-in.
          </p>
        </div>
        <div className="ua-settings-section__body">
          <div className="ua-settings-page__provider-actions">
            <button
              type="button"
              className="ua-settings-page__action-btn"
              onClick={handleAddProvider}
            >
              Add provider
            </button>
            <button
              type="button"
              className="ua-settings-page__action-btn"
              onClick={handleEditProvider}
              disabled={!selectedProvider || isEditing}
            >
              Edit provider
            </button>
            <button
              type="button"
              className="ua-settings-page__action-btn"
              onClick={handleDeleteProvider}
              disabled={!selectedProvider}
            >
              Delete provider
            </button>
            <button
              type="button"
              className="ua-settings-page__action-btn ua-settings-page__action-btn--primary"
              onClick={handleSaveProvider}
              disabled={!draft || !isEditing}
            >
              Save provider
            </button>
            <button
              type="button"
              className="ua-settings-page__action-btn ua-settings-page__action-btn--primary"
              onClick={handleTestConnection}
              disabled={!draft}
            >
              Test connection (fixture)
            </button>
          </div>
          {testStatus !== "idle" && (
            <div
              className="ua-settings-page__action-note"
              role="status"
              aria-label="Provider test connection status"
            >
              {testStatus === "success"
                ? "Fixture connection passed. No live network request was sent."
                : "Provider is disabled; fixture connection was not run."}
            </div>
          )}
          <div className="ua-settings-page__action-note">
            Network mode controls whether requests use fixture data or live transport.
          </div>
        </div>
      </section>

      <div className="ua-settings-page__note">
        Provider config is secret-safe: no raw API keys stored. Network mode controls transport behavior. Default: disabled/fixture.
      </div>
    </SettingsPageLayout>
  );
}
