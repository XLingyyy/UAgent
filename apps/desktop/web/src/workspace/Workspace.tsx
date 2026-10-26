import "./Workspace.css";
import { ConversationViewport } from "./ConversationViewport";
import { WelcomeHero } from "./WelcomeHero";
import { WorkspaceStatusStrip } from "./WorkspaceStatusStrip";
import { ComposerDock } from "../composer/ComposerDock";
import { useThreadStore, useProjectStore, useRuntimeStore } from "../stores/ui-store";

export function Workspace() {
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const project = useProjectStore((state) => state.registeredProjects.find((item) => item.id === state.activeProjectId));
  const editorStatus = useRuntimeStore((state) => state.mvp14.session?.status ?? "not connected");
  const workspaceMode = activeThreadId ? "thread" : "welcome";

  return (
    <main className="ua-workspace" aria-label="Workspace" data-workspace-mode={workspaceMode}>
      <div className={`ua-workspace__content ua-workspace__content--${workspaceMode}`}>
        {workspaceMode === "welcome" ? (
          <div className="ua-workspace__welcome-stack">
            <WelcomeHero hero={{ projectName: project?.name ?? "", capability: "Plan and inspect", previewStatus: "Local workspace", ueStatus: `UE ${editorStatus}`, description: project ? "Inspect the selected project. Execution requires separate approval." : "Select a project to inspect its context. Execution requires separate approval." }} />
            <ComposerDock mode="welcome" />
            <WorkspaceStatusStrip />
          </div>
        ) : (
          <>
            <WorkspaceStatusStrip />
            <ConversationViewport />
          </>
        )}
      </div>
      {workspaceMode === "thread" && <ComposerDock mode="thread" />}
    </main>
  );
}
