import {CodexLeadField} from "./CodexLeadField";
import {CODEX_ENDPOINT,codexMemberSessions,codexLeadSession,subscribeCodexMembers,codexMembersRevision} from "../runtime/codex-member-session";
import {collaborationSessions} from "../runtime/collaboration-sessions";
import type {CollaborationMembers} from "@uagent/shared";
import {CollaborationMemberFields} from "./CollaborationMemberFields";
import { InvestigationWorkflow } from "./InvestigationWorkflow";
import {useI18n} from "../i18n";
import {safeProviderSession} from "../runtime/safe-provider-session";
import {nativeProviderCredentials,type ProviderCredentialRecovery} from "../runtime/native-provider-credentials";
import {sessionMatchesProviderModel} from "../provider/runtime-availability";
import {AttachmentPanel} from "./AttachmentPanel";
import { ComingSoonGate } from "../components/ComingSoonGate";
import { ModelSelector } from "./ModelSelector";
import { PermissionSelector } from "./PermissionSelector";
import { ProjectSelector } from "./ProjectSelector";
import { composerMock, createComposerModelOptions, reasoningOptions, toSharedPermissionMode } from "./composer-data";
import {
  useComposerActions,
  useComposerStore,
  useRuntimeStore,
  useProjectActions,
  useProjectStore,
  useProviderStore,
  useRuntimeActions,
  useSettingsActions,
  useSettingsStore,
  useLayoutActions,
} from "../stores/ui-store";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  const raw = input.trim();
  if (!/^\/run(?:\s|$)/i.test(raw)) return null;
  const trimmed = raw.replace(/^\/run\s*/i, "").toLowerCase();
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
  const {text: uiText,t,locale} = useI18n();
  const [collaboration,setCollaboration]=useState(false);
  const [dynamicDelegation,setDynamicDelegation]=useState(false);
  const [settingsPanel, setSettingsPanel] = useState<"workflow" | "agents" | null>(null);
  const settingsOpen = useSettingsStore(state => state.open);
  useEffect(() => {
    if (settingsOpen) setSettingsPanel(null);
  }, [settingsOpen]);
  const settingsClose = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const openSettingsPanel = (panel: "workflow" | "agents", trigger: HTMLElement) => {
    settingsTrigger.current = trigger;
    setSettingsPanel(panel);
  };
  const closeSettingsPanel = () => {
    setSettingsPanel(null);
    settingsTrigger.current?.focus();
  };
  useEffect(() => {
    if (!settingsPanel) return;
    settingsClose.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsPanel(null);
        settingsTrigger.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [settingsPanel]);
  const [useCodexLead,setUseCodexLead]=useState(false);
  const leadState=useSyncExternalStore(codexLeadSession.subscribe,codexLeadSession.getSnapshot,codexLeadSession.getSnapshot);
  useSyncExternalStore(subscribeCodexMembers,codexMembersRevision,codexMembersRevision);
  const investigatorSession=useSyncExternalStore(collaborationSessions.investigator.subscribe,collaborationSessions.investigator.getSnapshot,collaborationSessions.investigator.getSnapshot);
  const reviewerSession=useSyncExternalStore(collaborationSessions.reviewer.subscribe,collaborationSessions.reviewer.getSnapshot,collaborationSessions.reviewer.getSnapshot);
  const thirdSession=useSyncExternalStore(collaborationSessions.member_3.subscribe,collaborationSessions.member_3.getSnapshot,collaborationSessions.member_3.getSnapshot);
  const fourthSession=useSyncExternalStore(collaborationSessions.member_4.subscribe,collaborationSessions.member_4.getSnapshot,collaborationSessions.member_4.getSnapshot);
  const [collaborationMembers,setCollaborationMembers]=useState<CollaborationMembers>({investigator:{role:"source_analyst",focus:""},reviewer:{role:"risk_reviewer",focus:""}});
  const composer = useComposerStore((state) => state);
  const activeTask=useRuntimeStore(state=>state.activeTaskId?state.tasksById[state.activeTaskId]:null);
  const canStop=Boolean(activeTask&&!(["completed","failed","cancelled"] as string[]).includes(activeTask.state));
  const [stopError,setStopError]=useState<string|null>(null);
  const investigation=composer.taskMode==="investigation";
  const pauseReason=useRuntimeStore(state=>{const id=state.activeTaskId;if(!id)return null;const event=(state.eventsByTaskId[id]??[]).filter(e=>e.type==="approval_required").at(-1);return (event?.payload as {run?:{stopReason?:string}}|undefined)?.run?.stopReason??null;});
  const session = useSyncExternalStore(safeProviderSession.subscribe, safeProviderSession.getSnapshot, safeProviderSession.getSnapshot);
  const provider = useProviderStore((state) => state);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) =>
    state.activeProjectId ? state.registeredProjects.find((p) => p.id === state.activeProjectId) ?? null : null,
  );
  const { setActiveProject } = useProjectActions();
  const { openSettings } = useSettingsActions();
  const {
    setComposerTaskMode,
    setSavedRun,
    setComposerInput,
    setComposerAttachMenuOpen,
    setComposerPermission,
    setComposerModel,
    setComposerReasoning,
    submitComposerTask,
    cancelRuntimeTask,
    pauseTaskRun,
    resumeTaskRun,
  } = useComposerActions();
  const { proposeMvp10TerminalCommand } = useRuntimeActions();
  const [suggestionCard, setSuggestionCard] = useState<CommandSuggestion | null>(null);

  const { setInspectorOpen } = useLayoutActions();
  const registeredProjects = useProjectStore((state) => state.registeredProjects);
  const submitting = useRef(false);
  const providerModelOptions = createComposerModelOptions(provider.providers);
  const { input, permission, selectedModelId, reasoningEffort, runMode } =
    composer;
  const { addButtonLabel } = composerMock;
  const trimmedInput = input.trim();
  const selectedOption=providerModelOptions.find(option=>option.id===selectedModelId);
  const selectedProvider=provider.providers.find(item=>item.providerId===selectedOption?.providerId);
  const responses=selectedProvider?.wireApi==="responses";
  const [savedCredential,setSavedCredential]=useState<{providerId:string;version:string}|null>(null);
  const [credentialRecovery,setCredentialRecovery]=useState<ProviderCredentialRecovery|null>(null);
  const [credentialCleanupPending,setCredentialCleanupPending]=useState(false);
  useEffect(()=>{
    let current=true;setSavedCredential(null);setCredentialRecovery(null);setCredentialCleanupPending(false);
    if(!selectedProvider||!selectedOption?.runtimeSupported||!nativeProviderCredentials.available())return;
    const refresh=()=>{
      void nativeProviderCredentials.get(selectedProvider.providerId).then(receipt=>{
        if(current){
          setSavedCredential(receipt.saved&&!receipt.cleanupPending&&!receipt.recovery&&receipt.version?
            {providerId:selectedProvider.providerId,version:receipt.version}:null);
          setCredentialRecovery(receipt.recovery??null);setCredentialCleanupPending(receipt.cleanupPending===true);
        }
      },()=>{if(current){setSavedCredential(null);setCredentialRecovery("unavailable");setCredentialCleanupPending(false);}});
    };
    refresh();
    const unsubscribe=nativeProviderCredentials.subscribe(id=>{if(id===selectedProvider.providerId)refresh();});
    return()=>{current=false;unsubscribe();};
  },[selectedProvider,selectedOption?.runtimeSupported]);
  const savedUsable=Boolean(savedCredential&&savedCredential.providerId===selectedProvider?.providerId);
  const sessionReady=sessionMatchesProviderModel(session,selectedProvider,selectedOption?.modelId);
  const responseProjectReady=Boolean(activeProject&&activeProject.trustState==="trusted"&&activeProject.indexStatus==="ready");
  const responseModeUnavailable=responses&&investigation&&!responseProjectReady;
  const savedModeUnavailable=investigation&&Boolean(session.savedCredential||(!sessionReady&&savedUsable));
  const credentialUnavailable=Boolean((credentialRecovery||credentialCleanupPending)&&(session.savedCredential||!sessionReady));
  const codexLead=investigation&&collaboration&&!composer.savedRun&&useCodexLead;
  const modelUnavailable=codexLead?!codexLeadSession.current(activeProjectId??"",leadState.modelId):selectedModelId!=="not-configured"&&(selectedOption?.runtimeSupported!==true||(!sessionReady&&!savedUsable)||responseModeUnavailable||savedModeUnavailable||credentialUnavailable||session.nativeClosing||session.nativeCloseFailed);
  const memberModelsReady=(!investigation||!collaboration)||Object.keys(collaborationMembers).every(role=>{
    const model=collaborationMembers[role].model,state=({investigator:investigatorSession,reviewer:reviewerSession,member_3:thirdSession,member_4:fourthSession} as Record<string,typeof investigatorSession>)[role];
    if(model?.providerId==="codex")return model.endpoint===CODEX_ENDPOINT&&codexMemberSessions[role].current(activeProject?.id??"",model.modelId);
    return !model || (state.ready&&!state.savedCredential&&!state.nativeClosing&&state.providerId===model.providerId&&state.modelId===model.modelId&&state.endpoint===model.endpoint&&providerModelOptions.some(option=>option.runtimeSupported&&option.providerId===model.providerId&&option.modelId===model.modelId));
  });
  const canSubmit = memberModelsReady && trimmedInput.length > 0 && !composer.submitting && !canStop && !modelUnavailable;
  const providerStatus = !codexLead&&selectedModelId === "not-configured" ? "not_configured" : "configured";
  const nativeRoot = activeProject?.rootRef ?? null;
  const displayRoot = activeProject?.displayRoot ?? "[project-root]";

  const handleInputChange = (value: string) => {
    setComposerInput(value);
    const suggestion = detectTerminalIntent(value);
    setSuggestionCard(suggestion);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting.current) return;
    if (!investigation && /(sandbox|沙盒)/i.test(trimmedInput) && /(asset|资产|复制|重命名|移动|保存|duplicate|rename|move|save)/i.test(trimmedInput)) {
      setInspectorOpen(true);
      window.dispatchEvent(new CustomEvent("uagent:open-asset-workflow"));
      return;
    }
    setSettingsPanel(null);
    submitting.current = true;
    setSuggestionCard(null);
    setStopError(null);
    const selected = providerModelOptions.find((option) => option.id === selectedModelId);
    try {
      await submitComposerTask({
        input: trimmedInput, projectId: activeProjectId, taskMode:investigation?"investigation":"discussion", ...(investigation&&collaboration&&!composer.savedRun?{collaboration:dynamicDelegation?"dynamic_delegation" as const:"independent_review" as const,collaborationMembers}:{}), ...(composer.savedRun?{savedRun:composer.savedRun}:{}),
        permissionMode: toSharedPermissionMode(permission),
        modelId: codexLead?leadState.modelId:selected?.modelId ?? "not-configured", providerId: codexLead?"codex":selected?.providerId ?? null,
        reasoningEffort: codexLead?(leadState.effort??"server default"):reasoningEffort, runMode, branch: null, contextPercent: null, providerStatus,
      });
    } catch { /* Store owns the safe, retryable error; keep the user's input. */ }
    finally { submitting.current = false; }
  };

  return (
    <footer className="ua-composer" aria-label={uiText("Composer dock")} data-composer-mode={mode}>
      <div className="ua-composer__workflow-bar">
        <button type="button" className="ua-composer__mode-btn" aria-expanded={settingsPanel === "workflow"} aria-controls="composer-settings" onClick={event => openSettingsPanel("workflow", event.currentTarget)}>
          <span aria-hidden="true">▧</span> {locale === "zh-CN" ? "内置工作流" : "Built-in workflows"}
        </button>
        {investigation && <label className="ua-composer__collaboration-toggle">
          <input type="checkbox" checked={collaboration && !composer.savedRun} disabled={composer.submitting || canStop || Boolean(composer.savedRun)}
            aria-label={locale === "zh-CN" ? "双 Agent 独立调查，可配置职责后汇总" : "Multi-agent independent investigation with configurable roles, then synthesis"}
            onChange={event => {
              setCollaboration(event.target.checked);
              if (event.target.checked) openSettingsPanel("agents", event.currentTarget);
              else setSettingsPanel(null);
            }}/>
          {locale === "zh-CN" ? "多 Agent 协作" : "Multi-agent"}
        </label>}
        {investigation && collaboration && !composer.savedRun && <button type="button" className="ua-composer__team-summary" aria-label={locale === "zh-CN" ? "配置协作成员" : "Configure collaboration"} aria-expanded={settingsPanel === "agents"} aria-controls="composer-settings" onClick={event => openSettingsPanel("agents", event.currentTarget)}>
          {Object.keys(collaborationMembers).length} {locale === "zh-CN" ? "位成员" : "members"} · {useCodexLead ? "Codex" : "DeepSeek"} <span aria-hidden="true">↗</span>
        </button>}
      </div>
      {/* Keep connection controls mounted: hiding settings must not revoke a live session. */}
      <aside id="composer-settings" className="ua-composer-settings" role="dialog" aria-modal="false" aria-labelledby="composer-settings-title" hidden={!settingsPanel}>
        <header className="ua-composer-settings__header">
          <div><span className="ua-composer-settings__eyebrow">{locale === "zh-CN" ? "任务配置" : "TASK SETUP"}</span>
            <h2 id="composer-settings-title">{settingsPanel === "workflow" ? (locale === "zh-CN" ? "内置工作流" : "Built-in workflows") : (locale === "zh-CN" ? "Agent 协作" : "Agent collaboration")}</h2>
          </div>
          <button ref={settingsClose} type="button" className="ua-composer-settings__close" aria-label={locale === "zh-CN" ? "关闭任务配置" : "Close task settings"} onClick={closeSettingsPanel}>×</button>
        </header>
        <div className="ua-composer-settings__body">
          <section hidden={settingsPanel !== "workflow"}>
            <InvestigationWorkflow embedded key={activeProjectId ?? "no-project"} disabled={composer.submitting || canStop} hasDraft={Boolean(input.trim())} onApply={draft => {
              setSavedRun(undefined);
              setComposerTaskMode("investigation");
              setComposerInput(draft.input);
              setSuggestionCard(null);
              closeSettingsPanel();
            }}/>
          </section>
          <section hidden={settingsPanel !== "agents"}>
            <p className="ua-composer-settings__intro">{locale === "zh-CN" ? "成员独立调查，主 Agent 汇总结论。共享工具预算，每次外发仍需确认。" : "Members investigate independently; the lead synthesizes their findings. Tool budget is shared and each outbound request needs approval."}</p>
            <label className="ua-composer-settings__delegation"><input type="checkbox" checked={dynamicDelegation} disabled={composer.submitting || canStop} onChange={e => setDynamicDelegation(e.target.checked)} aria-label={locale === "zh-CN" ? "主 Agent 动态分工：根据任务分配给所配置成员，再汇总（增加一次模型请求）" : "Lead agent delegates tasks to configured members, then synthesizes (one extra model request)"}/><span>{locale === "zh-CN" ? "由主 Agent 动态分工" : "Let the lead assign tasks"}<small>{locale === "zh-CN" ? "根据任务分配职责，增加一次模型请求" : "Assign roles for this task; uses one additional request"}</small></span></label>
            <CodexLeadField enabled={useCodexLead} onChange={setUseCodexLead} projectId={activeProjectId} input={input} disabled={composer.submitting || canStop} locale={locale}/>
            <CollaborationMemberFields providers={provider.providers} projectId={activeProjectId} input={input} mainModel={codexLead ? `Codex / ${leadState.modelId} / ${leadState.effort ?? "server default"}` : `${selectedOption?.provider ?? ""} / ${selectedOption?.modelId ?? ""}`} members={collaborationMembers} onChange={setCollaborationMembers} disabled={composer.submitting || canStop} locale={locale}/>
          </section>
        </div>
        <footer className="ua-composer-settings__footer"><span>{locale === "zh-CN" ? "关闭面板会保留当前配置" : "Your setup stays active when this panel closes"}</span><button type="button" onClick={closeSettingsPanel}>{locale === "zh-CN" ? "完成" : "Done"}</button></footer>
      </aside>
      <div className="ua-composer__input-row">
        <div className="ua-composer__left-tools">
          <div className="ua-composer__attach">
            <button
              className="ua-composer__add-btn"
              type="button"
              aria-label={uiText("Open attach menu")}
              aria-haspopup="menu"
              aria-expanded={composer.attachMenuOpen}
              onClick={() => setComposerAttachMenuOpen(!composer.attachMenuOpen)}
            >
              {addButtonLabel}
            </button>
            {composer.attachMenuOpen && (
              <div className="ua-composer__attach-menu" role="menu" aria-label={uiText("Attach context")}>
                <AttachmentPanel/>
                {[
                  ["Screenshot", "Attach screenshots after capture approval is implemented."],
                  ["Context Pack", "Attach reusable context packs after packaging is implemented."],
                ].map(([label, reason]) => (
                  <ComingSoonGate key={label} phase="MVP7" reason={reason}>
                    <button className="ua-composer__attach-item" type="button" role="menuitem">
                      {uiText(label)}
                    </button>
                  </ComingSoonGate>
                ))}
              </div>
            )}
          </div>

          <PermissionSelector value={permission} onChange={setComposerPermission} />
          <button type="button" className="ua-composer__mode-btn" aria-label={t("run.modeLabel")} aria-pressed={investigation} disabled={composer.submitting||canStop} onClick={()=>setComposerTaskMode(investigation?"discussion":"investigation")}>{t(investigation?"run.investigate":"run.discussion")}</button>
        </div>

        <div className="ua-composer__input-zone">
          <textarea
            className="ua-composer__textarea"
            placeholder={uiText("Describe a task. Start with a question or a small change.")}
            value={input}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void handleSubmit(); } }}
            onChange={(e) => handleInputChange(e.target.value)}
            aria-label={uiText("Composer input")}
          />
        </div>

        <div className="ua-composer__right-tools">


          {codexLead?<button type="button" className="ua-composer__lead-summary" title={`Codex / ${leadState.modelId} / ${leadState.effort??"server default"}`} onClick={event=>openSettingsPanel("agents",event.currentTarget)}>Codex · {leadState.modelId || (locale === "zh-CN" ? "待配置" : "Set up")}<span>{leadState.effort}</span></button>:<ModelSelector
            modelId={selectedModelId}
            reasoningEffort={reasoningEffort}
            models={providerModelOptions}
            reasoningOptionsList={selectedOption?.reasoningSupported?reasoningOptions:[]}
            onModelChange={setComposerModel}
            onReasoningChange={setComposerReasoning}
            onManageProviders={() => openSettings("provider")}
          />}

          {canStop&&activeTask?.draft.taskMode==="investigation"&&activeTask.state!=="awaiting_approval"&&<button type="button" className="ua-composer__mode-btn" onClick={()=>pauseTaskRun?.(activeTask.id)}>{t("run.pause")}</button>}
          {canStop&&pauseReason==="persistence_failed_reconciliation_required"&&<p role="status">{locale==="zh-CN"?"原生存档确认失败，当前任务已锁定以防重复写入。可核对已保存的最终结果；无法确认时继续锁定，不会重写或再次请求模型。":"Native save acknowledgement failed. This task is locked against duplicate writes. Check the saved final result; if it cannot be confirmed, the task stays locked without writes or model retries."}</p>}
          {canStop&&pauseReason==="persistence_failed_reconciliation_required"&&<button type="button" className="ua-composer__mode-btn" onClick={()=>{void resumeTaskRun?.(activeTask!.id);}}>{locale==="zh-CN"?"核对保存结果":"Check saved result"}</button>}
          {canStop&&(pauseReason==="user_paused"||pauseReason==="persistence_failed")&&<button type="button" className="ua-composer__mode-btn" onClick={()=>{void resumeTaskRun?.(activeTask!.id);}}>{t("run.resume")}</button>}
          {canStop&&<button className="ua-composer__stop-btn" type="button" aria-label={uiText("Stop task")} onClick={()=>{safeProviderSession.close("stopped");void cancelRuntimeTask(activeTask!.id).catch(()=>setStopError("Stop could not be confirmed. Review task details before retrying."));}}>{uiText("Stop")}</button>}
          <button
            className="ua-composer__send-btn"
            type="button"
            disabled={!canSubmit}
            aria-label={composer.submitting ? uiText("Submitting task") : canSubmit ? uiText("Send task") : uiText("Send - disabled")}
            onClick={() => void handleSubmit()}
          >
            {composer.submitting ? uiText("Preparing…") : uiText("Send task")}
          </button>
        </div>
      </div>

      {!codexLead&&credentialUnavailable&&<p role="status">{t(credentialCleanupPending?"vault.cleanupPending":credentialRecovery==="missing"?"vault.recoveryMissing":credentialRecovery==="corrupt"?"vault.recoveryCorrupt":"vault.recoveryUnavailable")}</p>}
      {!codexLead&&savedModeUnavailable&&<p role="status">{t("vault.discussionOnly")}</p>}
      {responses&&selectedOption?.runtimeSupported!==true&&<p role="status">{t("responses.nativeUnavailable")}</p>}
      {responses&&selectedOption?.runtimeSupported===true&&investigation&&!responseProjectReady&&<p role="status">{t("run.scopeNeedsProject")}</p>}
      {composer.savedRun&&<p role="status">{t(composer.savedRun.taskMode==="discussion"?"responses.continueChatHint":"historyRun.continueHint")} <button type="button" className="ua-btn" onClick={()=>setSavedRun(undefined)}>{t("common.cancel")}</button></p>}
      {stopError&&<p role="alert">{uiText(stopError)}</p>}
      {composer.submitError && <p role="alert">{composer.submitError==="run.scopeCancelled"?t("run.scopeCancelled"):composer.submitError==="run.scopeNeedsProject"?t("run.scopeNeedsProject"):composer.submitError==="run.scopeExpired"?t("run.scopeExpired"):uiText(composer.submitError)}</p>}
      {suggestionCard && (
        <div
          className={`ua-composer__suggestion ${suggestionCard.risk === "blocked" ? "ua-composer__suggestion--blocked" : ""}`}
          role="status"
          aria-label={uiText("Command suggestion")}
        >
          <div className="ua-composer__suggestion-info">
            <span className="ua-composer__suggestion-command">
              <code>{suggestionCard.command}</code>
            </span>
            <span className="ua-composer__suggestion-label">{suggestionCard.risk === "allowlisted" ? uiText(suggestionCard.label) : suggestionCard.command}</span>
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
                aria-label={t("composer.proposeCommandLabel",{command:suggestionCard.command})}
                title={nativeRoot ? t("composer.workingDirectoryLabel",{path:displayRoot}) : uiText("Select and trust a project before proposing a command")}
              >
                {uiText("Propose command")}{" "}</button>
            ) : (
              <span className="ua-composer__suggestion-blocked">{uiText(suggestionCard.reason)}</span>
            )}
          </div>
        </div>
      )}

      <div className="ua-composer__status-row">
        <ProjectSelector onManageProjects={()=>openSettings("config")} value={activeProjectId} projects={registeredProjects.map(p=>({id:p.id,name:p.name,engineVersion:p.engine.label,connectionStatus:p.trustState,path:p.displayRoot}))} onChange={setActiveProject}/>
        <span className="ua-composer__status-item"><span className="ua-composer__status-value">{permission==="request-approval"?t("chat.toolApproval"):uiText("Native approval policy enforced")}</span></span>
        <button type="button" className="ua-composer__session-link" onClick={()=>openSettings("provider")}>
          {codexLead?(locale==="zh-CN"?"Codex 主 Agent":"Codex lead"):selectedModelId==="not-configured"?t("productUi.local"):providerModelOptions.find(m=>m.id===selectedModelId)?.runtimeSupported!==true?t("productUi.unavailable"):credentialUnavailable?t(credentialCleanupPending?"vault.cleanupPending":"vault.recoveryUnavailable"):sessionReady?t(responses&&session.fixture?"demo.sessionReady":"product.sessionReady"):savedUsable?t("vault.saved"):t("product.sessionClosed")}
        </button>
      </div>
    </footer>
  );
}
