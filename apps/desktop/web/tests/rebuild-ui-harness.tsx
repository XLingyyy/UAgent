import { createEmptyMvp15State } from "../src/runtime/runtime-store";
// Dedicated dev-only browser verification entry. Not imported by the production application.
// All projects and submit transport here are synthetic. No filesystem/UE/provider operation occurs.
import React from "react";
import { createRoot } from "react-dom/client";
import { UIProvider, useComposerStore, useProjectStore } from "../src/stores/ui-store";
import { AppShell } from "../src/shell/AppShell";
import { createDesktopRuntimeAdapter } from "../src/runtime/desktop-runtime-adapter";
import type { ProjectProfile, TaskRecord } from "@uagent/shared";
import "../src/styles/tokens.css";
import "../src/styles/theme.css";
import "../src/styles/animations.css";
import "../src/styles/globals.css";

let calls = 0;
const submitted: { projectId: string | null; input: string }[] = [];
const runtime = createDesktopRuntimeAdapter({ nativeInvoke: null });
runtime.submitTask = async (draft) => {
  const count = ++calls;
  submitted.push({ projectId: draft.projectId, input: draft.input });
  document.documentElement.dataset.submitCalls = String(calls);
  document.documentElement.dataset.lastSubmittedProject = draft.projectId ?? "none";
  await new Promise(resolve => setTimeout(resolve, 350));
  if (count === 1) throw new Error("synthetic_offline");
  return { id: `harness-task-${count}` } as TaskRecord;
};
const evidenceState = new URLSearchParams(location.search).has("evidence") ? { mvp15: { ...createEmptyMvp15State(), executionMode: "fixture" as const, sourceAssetPath: "/Game/UAgentSandbox/" + "LongAssetName".repeat(8), lastError: "token=redaction-canary C:/synthetic-private/probe.txt" } } : undefined;
const projects = ["Alpha", "Beta"].map(name => ({ id: name, name, rootRef: `test:${name}`, displayRoot: "[test-project]", indexStatus: "not_indexed", trustState: "untrusted", engine: { label: "Unknown", association: null, source: "unknown" }, createdAt: 0, updatedAt: 0 })) as ProjectProfile[];
function Probe() {
  const project = useProjectStore(state => state.activeProjectId);
  const submitting = useComposerStore(state => state.submitting);
  return <output hidden data-testid="harness-state" data-project={project} data-submitting={String(Boolean(submitting))} />;
}
createRoot(document.getElementById("root")!).render(<UIProvider runtimeClient={runtime} initialState={{ runtime: evidenceState, project: { registeredProjects: projects, activeProjectId: "Alpha" }, layout: { inspector: { open: false } } }}><Probe /><AppShell /></UIProvider>);
