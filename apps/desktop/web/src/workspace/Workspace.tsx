import {CodexConversation} from "./CodexConversation";
import {HostedTasksPanel} from "./HostedTasksPanel";
import {useI18n} from "../i18n";
import "./Workspace.css";
import { ConversationViewport } from "./ConversationViewport";
import { WelcomeHero } from "./WelcomeHero";
import { WorkspaceStatusStrip } from "./WorkspaceStatusStrip";
import { ComposerDock } from "../composer/ComposerDock";
import { useThreadStore, useProjectStore, useRuntimeStore, useSettingsActions } from "../stores/ui-store";

export function Workspace() {
  const {text: uiText} = useI18n();
  const {openSettings}=useSettingsActions();
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const project = useProjectStore((state) => state.registeredProjects.find((item) => item.id === state.activeProjectId));
  const editorStatus = useRuntimeStore((state) => state.mvp14.session?.status ?? "not connected");
  const workspaceMode = activeThreadId ? "thread" : "welcome";

  return (
    <main className="ua-workspace" aria-label={uiText("Workspace")} data-workspace-mode={workspaceMode}>
      <div className="ua-workspace__toolbar">
        <div className="ua-workspace__identity"><span className="ua-workspace__mark" aria-hidden>U</span><div><strong>{project?.name ?? uiText("Workspace")}</strong><span>{uiText("Local workspace")}</span></div></div>
      <CodexConversation key={project?.id??"none"} projectId={project?.id??null} projectTrusted={project?.trustState==="trusted"} onProjectSetup={()=>openSettings("config")}/>
      <HostedTasksPanel />
      </div>
      <div className={`ua-workspace__content ua-workspace__content--${workspaceMode}`}>
        {workspaceMode === "welcome" ? (
          <div className="ua-workspace__welcome-stack">
            <WelcomeHero hero={{ projectName: project?.name ?? "", capability: "Plan and inspect", previewStatus: "Local workspace", ueStatus: `UE ${editorStatus}`, description: project ? "Inspect the selected project. Execution requires separate approval." : "Select a project to inspect its context. Execution requires separate approval." }} />
            <WorkspaceStatusStrip />
          </div>
        ) : (
          <>
            <WorkspaceStatusStrip />
            <ConversationViewport />
          </>
        )}
      </div>
      {/* Keep configuration and live session ownership across welcome -> thread. */}
      <ComposerDock mode={workspaceMode} />
    </main>
  );
}
