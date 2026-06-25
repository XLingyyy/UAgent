import { useEffect, useState } from "react";
import { useUI } from "../app/providers";
import { ComingSoonGate } from "../components/ComingSoonGate";
import { ContextRing } from "./ContextRing";
import { ModelSelector } from "./ModelSelector";
import { PermissionSelector } from "./PermissionSelector";
import { ProjectSelector } from "./ProjectSelector";
import {
  composerMock,
  createComposerModelOptions,
  getDefaultModelSelection,
  reasoningOptions,
  type ComposerModelId,
  type ComposerPermission,
  type ComposerReasoningEffort,
} from "./composer-data";
import { MOCK_PROJECTS } from "../project/project-data";
import "./ComposerDock.css";

export function ComposerDock() {
  const { state, setActiveProject, openSettings } = useUI();
  const [input, setInput] = useState("");
  const [permission, setPermission] = useState<ComposerPermission>(composerMock.permission);
  const providerModelOptions = createComposerModelOptions(state.provider.providers);
  const defaultSelection = getDefaultModelSelection(
    state.provider.providers,
    state.provider.defaultProviderId,
  );
  const [selectedModelId, setSelectedModelId] = useState<ComposerModelId>(defaultSelection.modelId);
  const [reasoningEffort, setReasoningEffort] = useState<ComposerReasoningEffort>(
    defaultSelection.reasoningEffort,
  );
  const { runMode, branch, context, statusItems, placeholder, addButtonLabel, sendButtonLabel } =
    composerMock;

  useEffect(() => {
    if (!providerModelOptions.some((option) => option.id === selectedModelId)) {
      setSelectedModelId(defaultSelection.modelId);
    }
  }, [defaultSelection.modelId, providerModelOptions, selectedModelId]);

  useEffect(() => {
    if (selectedModelId === "not-configured" && defaultSelection.modelId !== "not-configured") {
      setSelectedModelId(defaultSelection.modelId);
    }
  }, [defaultSelection.modelId, selectedModelId]);

  useEffect(() => {
    if (selectedModelId === defaultSelection.modelId) {
      setReasoningEffort(defaultSelection.reasoningEffort);
    }
  }, [defaultSelection.modelId, defaultSelection.reasoningEffort, selectedModelId]);

  return (
    <footer className="ua-composer" aria-label="Composer dock">
      <div className="ua-composer__input-row">
        <ComingSoonGate
          phase="MVP1"
          reason="Attach project files and asset references as additional context."
        >
          <button
            className="ua-composer__add-btn"
            type="button"
            aria-label="Add context - disabled"
          >
            {addButtonLabel}
          </button>
        </ComingSoonGate>

        <PermissionSelector value={permission} onChange={setPermission} />

        <textarea
          className="ua-composer__textarea"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Composer input"
        />

        <ContextRing used={context.used} total={context.total} percent={context.percent} />

        <ModelSelector
          modelId={selectedModelId}
          reasoningEffort={reasoningEffort}
          models={providerModelOptions}
          reasoningOptionsList={reasoningOptions}
          onModelChange={setSelectedModelId}
          onReasoningChange={setReasoningEffort}
          onManageProviders={() => openSettings("provider")}
        />

        <button
          className="ua-composer__send-btn"
          type="button"
          disabled
          aria-label="Send - disabled"
        >
          {sendButtonLabel}
        </button>
      </div>

      <div className="ua-composer__status-row">
        <ProjectSelector
          value={state.activeProjectId}
          projects={MOCK_PROJECTS}
          onChange={setActiveProject}
        />

        <span className="ua-composer__status-separator" aria-hidden="true" />

        <span className="ua-composer__status-item">
          <span className="ua-composer__status-label">Mode</span>
          <span className="ua-composer__status-value">
            {runMode === "local" ? "Local mode" : "Sandbox"}
          </span>
        </span>

        <span className="ua-composer__status-item">
          <span className="ua-composer__status-label">Branch</span>
          <span className="ua-composer__status-value ua-text-mono">{branch}</span>
        </span>

        {statusItems.map((item) => (
          <span
            key={item.id}
            className={`ua-composer__status-item ua-composer__status-item--${item.tone ?? "default"}`}
          >
            <span className="ua-composer__status-label">{item.label}</span>
            <span className="ua-composer__status-value">{item.value}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
