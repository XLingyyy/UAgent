import { ComingSoonGate } from "../components/ComingSoonGate";
import { ContextRing } from "./ContextRing";
import { ModelSelector } from "./ModelSelector";
import { PermissionSelector } from "./PermissionSelector";
import { ProjectSelector } from "./ProjectSelector";
import { composerMock, createComposerModelOptions, reasoningOptions, toSharedPermissionMode } from "./composer-data";
import { MOCK_PROJECTS } from "../project/project-data";
import {
  useComposerActions,
  useComposerStore,
  useProjectActions,
  useProjectStore,
  useProviderStore,
  useRuntimeStore,
  useSettingsActions,
} from "../stores/ui-store";
import "./ComposerDock.css";

export interface ComposerDockProps {
  mode?: "welcome" | "thread";
}

export function ComposerDock({ mode = "thread" }: ComposerDockProps) {
  const composer = useComposerStore((state) => state);
  const provider = useProviderStore((state) => state);
  const mcpStatus = useRuntimeStore((state) => state.mcp.status);
  const mcpCapabilities = useRuntimeStore((state) => state.mcp.capabilities);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const { setActiveProject } = useProjectActions();
  const { openSettings } = useSettingsActions();
  const {
    setComposerInput,
    setComposerPermission,
    setComposerModel,
    setComposerReasoning,
    submitComposerTask,
  } = useComposerActions();
  const providerModelOptions = createComposerModelOptions(provider.providers);
  const { input, permission, selectedModelId, reasoningEffort, runMode, branch, context } =
    composer;
  const { placeholder, addButtonLabel, sendButtonLabel } = composerMock;
  const trimmedInput = input.trim();
  const canSubmit = trimmedInput.length > 0;
  const providerStatus = selectedModelId === "not-configured" ? "not_configured" : "configured";

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }

    void submitComposerTask({
      input: trimmedInput,
      projectId: activeProjectId,
      permissionMode: toSharedPermissionMode(permission),
      modelId: selectedModelId,
      reasoningEffort,
      runMode,
      branch,
      contextPercent: context.percent,
      providerStatus,
    });
  };

  return (
    <footer className="ua-composer" aria-label="Composer dock" data-composer-mode={mode}>
      <div className="ua-composer__input-row">
        <div className="ua-composer__left-tools">
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

          <PermissionSelector value={permission} onChange={setComposerPermission} />
        </div>

        <div className="ua-composer__input-zone">
          <textarea
            className="ua-composer__textarea"
            placeholder={placeholder}
            value={input}
            onChange={(e) => setComposerInput(e.target.value)}
            aria-label="Composer input"
          />
        </div>

        <div className="ua-composer__right-tools">
          <ContextRing used={context.used} total={context.total} percent={context.percent} />

          <ModelSelector
            modelId={selectedModelId}
            reasoningEffort={reasoningEffort}
            models={providerModelOptions}
            reasoningOptionsList={reasoningOptions}
            onModelChange={setComposerModel}
            onReasoningChange={setComposerReasoning}
            onManageProviders={() => openSettings("provider")}
          />

          <button
            className="ua-composer__send-btn"
            type="button"
            disabled={!canSubmit}
            aria-label={canSubmit ? "Send mock task" : "Send - disabled"}
            onClick={handleSubmit}
          >
            {sendButtonLabel}
          </button>
        </div>
      </div>

      <div className="ua-composer__status-row">
        <ProjectSelector
          value={activeProjectId}
          projects={MOCK_PROJECTS}
          onChange={setActiveProject}
        />

        <span className="ua-composer__status-separator" aria-hidden="true" />

        <span className="ua-composer__status-item">
          <span className="ua-composer__status-label">Runtime</span>
          <span className="ua-composer__status-value">
            {mcpStatus === "connected" && mcpCapabilities ? "MCP read-only" : mcpStatus === "connected" ? "Discovery required" : "Mock only"}
          </span>
        </span>

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

        {providerStatus === "not_configured" && (
          <span className="ua-composer__status-item ua-composer__status-item--warning">
            <span className="ua-composer__status-label">Model</span>
            <span className="ua-composer__status-value">Mock runtime / no provider call</span>
          </span>
        )}
      </div>
    </footer>
  );
}
