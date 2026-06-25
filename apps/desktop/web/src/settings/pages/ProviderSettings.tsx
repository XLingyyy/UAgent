import { useEffect, useMemo, useState } from "react";
import { useUI } from "../../app/providers";
import {
  createModelsForWireApi,
  createProviderDraft,
  getReasoningEffortsForModel,
  PROVIDER_AUTH_MODE_OPTIONS,
  PROVIDER_WIRE_API_OPTIONS,
} from "../../provider/provider-data";
import type {
  ProviderAuthMode,
  ProviderConfig,
  ProviderReasoningEffort,
  ProviderWireApi,
} from "../../types/provider";
import { SettingsPageLayout } from "../SettingsPageLayout";
import { providerPageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

type ProviderEditorMode = "view" | "edit" | "create";

interface ProviderDraft extends ProviderConfig {
  isDefault: boolean;
}

function createDraft(provider: ProviderConfig, defaultProviderId: string | null): ProviderDraft {
  return {
    ...provider,
    models: provider.models.map((model) => ({
      ...model,
      reasoningEfforts: model.reasoningEfforts ? [...model.reasoningEfforts] : undefined,
    })),
    isDefault: provider.providerId === defaultProviderId,
  };
}

function cloneDraft(draft: ProviderDraft): ProviderConfig {
  return {
    ...draft,
    models: draft.models.map((model) => ({
      ...model,
      reasoningEfforts: model.reasoningEfforts ? [...model.reasoningEfforts] : undefined,
    })),
  };
}

export function ProviderSettings() {
  const { state, setSelectedProvider, saveProvider, deleteProvider, setDefaultProvider } = useUI();
  const { providers, selectedProviderId, defaultProviderId } = state.provider;
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
      envKey: authMode === "none" ? "" : current.envKey || "PROVIDER_KEY",
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

  return (
    <SettingsPageLayout page={providerPageData}>
      <section className="ua-settings-section" aria-labelledby="section-provider-list">
        <div className="ua-settings-section__header">
          <h3 id="section-provider-list" className="ua-settings-section__title">
            Connected providers
          </h3>
          <p className="ua-settings-section__description">
            Providers available for local model selection.
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
            Provider detail
          </h3>
          <p className="ua-settings-section__description">
            Edit local-only provider values and choose defaults for new conversations.
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
                  <span className="ua-settings-page__field-label">Environment key</span>
                  <input
                    className="ua-settings-page__input"
                    type="text"
                    value={draft.envKey ?? ""}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        envKey: event.target.value,
                      }))
                    }
                    disabled={!isEditing || draft.authMode === "none"}
                    aria-label="Environment key"
                  />
                </label>

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
            Provider actions
          </h3>
          <p className="ua-settings-section__description">
            Save mock/local changes without testing a real connection.
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
              className="ua-settings-page__action-btn"
              disabled
              aria-disabled="true"
            >
              Test connection
            </button>
          </div>
          <div className="ua-settings-page__action-note">
            Local-only mock. No network request is sent.
          </div>
        </div>
      </section>

      <div className="ua-settings-page__note">
        Provider values live in memory only. No provider connection is tested. Inline key storage
        stays unavailable in MVP0.
      </div>
    </SettingsPageLayout>
  );
}
