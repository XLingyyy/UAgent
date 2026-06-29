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
  useRuntimeActions,
  useRuntimeStore,
  useSettingsActions,
} from "../stores/ui-store";
import { useState } from "react";
import "./ComposerDock.css";

export interface ComposerDockProps {
  mode?: "welcome" | "thread";
}

interface CommandSuggestion {
  command: string;
  label: string;
  risk: "allowlisted" | "blocked";
  reason: string;
}

function detectTerminalIntent(input: string): CommandSuggestion | null {
  const trimmed = input.trim().toLowerCase();
  if (/[;&|`$()<>{}!^]/.test(trimmed)) {
    return { command: trimmed, label: trimmed, risk: "blocked", reason: "Shell metacharacters are not supported" };
  }
  const suggestions: [RegExp, string, string][] = [
    [/\b(pnpm\s+)?typecheck\b/, "pnpm typecheck", "Run TypeScript type checking"],
    [/\b(pnpm\s+)?lint\b/, "pnpm lint", "Run ESLint"],
    [/\b(pnpm\s+)?test\b/, "pnpm test", "Run test suite"],
    [/\b(build|compile|bundle)\s/, "pnpm --filter @uagent/desktop web:build", "Build desktop web frontend"],
    [/\b(check|validate)\s+types?\b/, "pnpm typecheck", "Check TypeScript types"],
    [/\bgit\s+status\b/, "git status", "Check repository status"],
    [/\bgit\s+diff\b/, "git diff", "Show working tree diff"],
    [/\bcargo\s+test\b/, "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml", "Run Rust tests"],
  ];
  for (const [re, command, label] of suggestions) {
    if (re.test(trimmed)) {
      return { command, label, risk: "allowlisted", reason: "Command is in the allowlist" };
    }
  }
  if (trimmed.includes("rm ") || trimmed.includes("curl ") || trimmed.includes("wget ") || trimmed.includes("sudo ")) {
    return { command: trimmed, label: trimmed, risk: "blocked", reason: "Dangerous or network command" };
  }
  return null;
}

export function ComposerDock({ mode = "thread" }: ComposerDockProps) {
  const composer = useComposerStore((state) => state);
  const provider = useProviderStore((state) => state);
  const mcpStatus = useRuntimeStore((state) => state.mcp.status);
  const mcpCapabilities = useRuntimeStore((state) => state.mcp.capabilities);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) =>
    state.activeProjectId ? state.registeredProjects.find((p) => p.id === state.activeProjectId) ?? null : null,
  );
  const { setActiveProject } = useProjectActions();
  const { openSettings } = useSettingsActions();
  const {
    setComposerInput,
    setComposerAttachMenuOpen,
    setComposerPermission,
    setComposerModel,
    setComposerReasoning,
    submitComposerTask,
  } = useComposerActions();
  const { proposeMvp10TerminalCommand } = useRuntimeActions();
  const [suggestionCard, setSuggestionCard] = useState<CommandSuggestion | null>(null);

  const providerModelOptions = createComposerModelOptions(provider.providers);
  const { input, permission, selectedModelId, reasoningEffort, runMode, branch, context } =
    composer;
  const { placeholder, addButtonLabel, sendButtonLabel } = composerMock;
  const trimmedInput = input.trim();
  const canSubmit = trimmedInput.length > 0;
  const providerStatus = selectedModelId === "not-configured" ? "not_configured" : "configured";
  const nativeRoot = activeProject?.rootRef ?? null;
  const displayRoot = activeProject?.displayRoot ?? "[project-root]";

  const handleInputChange = (value: string) => {
    setComposerInput(value);
    const suggestion = detectTerminalIntent(value);
    setSuggestionCard(suggestion);
  };

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    setSuggestionCard(null);
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
          <div className="ua-composer__attach">
            <button
              className="ua-composer__add-btn"
              type="button"
              aria-label="Open attach menu"
              aria-haspopup="menu"
              aria-expanded={composer.attachMenuOpen}
              onClick={() => setComposerAttachMenuOpen(!composer.attachMenuOpen)}
            >
              {addButtonLabel}
            </button>
            {composer.attachMenuOpen && (
              <div className="ua-composer__attach-menu" role="menu" aria-label="Attach context">
                {[
                  ["File", "Attach local files after filesystem approval is implemented."],
                  ["Asset", "Attach UE asset references after asset indexing is implemented."],
                  ["Screenshot", "Attach screenshots after capture approval is implemented."],
                  ["Context Pack", "Attach reusable context packs after packaging is implemented."],
                ].map(([label, reason]) => (
                  <ComingSoonGate key={label} phase="MVP7" reason={reason}>
                    <button className="ua-composer__attach-item" type="button" role="menuitem">
                      {label}
                    </button>
                  </ComingSoonGate>
                ))}
              </div>
            )}
          </div>

          <PermissionSelector value={permission} onChange={setComposerPermission} />
        </div>

        <div className="ua-composer__input-zone">
          <textarea
            className="ua-composer__textarea"
            placeholder={placeholder}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
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

      {suggestionCard && (
        <div
          className={`ua-composer__suggestion ${suggestionCard.risk === "blocked" ? "ua-composer__suggestion--blocked" : ""}`}
          role="status"
          aria-label="Command suggestion"
        >
          <div className="ua-composer__suggestion-info">
            <span className="ua-composer__suggestion-command">
              <code>{suggestionCard.command}</code>
            </span>
            <span className="ua-composer__suggestion-label">{suggestionCard.label}</span>
          </div>
          <div className="ua-composer__suggestion-actions">
            {suggestionCard.risk === "allowlisted" ? (
              <button
                className="ua-btn ua-btn--primary"
                type="button"
                onClick={() => {
                  if (!nativeRoot) {
                    return;
                  }
                  void proposeMvp10TerminalCommand(
                    suggestionCard.command,
                    nativeRoot,
                    null,
                    nativeRoot,
                    activeProject?.id ?? activeProjectId,
                  );
                  setSuggestionCard(null);
                }}
                disabled={!nativeRoot}
                aria-label={`Propose command: ${suggestionCard.command}`}
                title={nativeRoot ? `Working directory: ${displayRoot}` : "Select and trust a project before proposing a command"}
              >
                Propose command
              </button>
            ) : (
              <span className="ua-composer__suggestion-blocked">{suggestionCard.reason}</span>
            )}
          </div>
        </div>
      )}

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
          <span className="ua-composer__status-label">Safety</span>
          <span className="ua-composer__status-value">
            {permission === "request-approval"
              ? "Approval required / fixture ready"
              : "Fixture sandbox / no real writes"}
          </span>
        </span>

        <span className="ua-composer__status-item">
          <span className="ua-composer__status-label">Branch</span>
          <span className="ua-composer__status-value ua-text-mono">{branch}</span>
        </span>

        {providerStatus === "not_configured" ? (
          <span className="ua-composer__status-item ua-composer__status-item--warning">
            <span className="ua-composer__status-label">Model</span>
            <span className="ua-composer__status-value">Mock runtime / no provider call</span>
          </span>
        ) : (
          <span className="ua-composer__status-item">
            <span className="ua-composer__status-label">Provider</span>
            <span className="ua-composer__status-value">
              {selectedModelId !== "not-configured"
                ? `Fixture / no network`
                : "Not configured"}
            </span>
          </span>
        )}
      </div>
    </footer>
  );
}
