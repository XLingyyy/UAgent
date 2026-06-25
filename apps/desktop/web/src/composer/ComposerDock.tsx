import { ComingSoonGate } from "../components/ComingSoonGate";
import { ContextRing } from "./ContextRing";
import { ModelSelector } from "./ModelSelector";
import { PermissionSelector } from "./PermissionSelector";
import { ProjectSelector } from "./ProjectSelector";
import { composerMock, createComposerModelOptions, reasoningOptions } from "./composer-data";
import { MOCK_PROJECTS } from "../project/project-data";
import {
  useComposerActions,
  useComposerStore,
  useProjectActions,
  useProjectStore,
  useProviderStore,
  useSettingsActions,
} from "../stores/ui-store";
import "./ComposerDock.css";

export function ComposerDock() {
  const composer = useComposerStore((state) => state);
  const provider = useProviderStore((state) => state);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const { setActiveProject } = useProjectActions();
  const { openSettings } = useSettingsActions();
  const { setComposerInput, setComposerPermission, setComposerModel, setComposerReasoning } =
    useComposerActions();
  const providerModelOptions = createComposerModelOptions(provider.providers);
  const {
    input,
    permission,
    selectedModelId,
    reasoningEffort,
    runMode,
    branch,
    context,
    statusItems,
  } = composer;
  const { placeholder, addButtonLabel, sendButtonLabel } = composerMock;

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

        <PermissionSelector value={permission} onChange={setComposerPermission} />

        <textarea
          className="ua-composer__textarea"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setComposerInput(e.target.value)}
          aria-label="Composer input"
        />

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
          disabled
          aria-label="Send - disabled"
        >
          {sendButtonLabel}
        </button>
      </div>

      <div className="ua-composer__status-row">
        <ProjectSelector
          value={activeProjectId}
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
