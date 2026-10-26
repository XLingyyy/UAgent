import { ProviderSettings } from "../settings/pages/ProviderSettings";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { TaskDraft, ProjectProfile, ProjectIndexSnapshot } from "@uagent/shared";
import type { NativeProjectAdapter } from "../runtime/project-native-adapter";
import type { UIInitialState } from "../types/ui";
import { createDesktopRuntimeAdapter, type DesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import { createEmptyMvp12State, createEmptyMvp14State, createEmptyMvp15State } from "../runtime/runtime-store";
import { UIProvider, useProjectActions, useProjectStore, useComposerActions, useComposerStore, useRuntimeActions, useRuntimeStore, useProviderStore, useProviderActions, useThreadStore } from "./ui-store";
import { ComposerDock } from "../composer/ComposerDock";
import { createComposerModelOptions } from "../composer/composer-data";
import { DEFAULT_PROVIDER_STATE } from "../provider/provider-data";
import { UtilityEvidencePanel } from "../inspector/UtilityPlaceholderPanel";
import { ReviewPanel } from "../inspector/ReviewPanel";
import { AssetLifecycleEvidence } from "../inspector/AssetLifecycleEvidence";
import { TitleBar } from "../shell/TitleBar";
import { AppShell } from "../shell/AppShell";
import { ModelSelector } from "../composer/ModelSelector";

const switches = vi.hoisted(() => ({ fixtures: false, adapter: null as NativeProjectAdapter | null, probe: null as null | (() => Promise<unknown>), execute: null as null | (() => Promise<unknown>) }));
vi.mock("../runtime/build-capabilities", () => ({ get FIXTURES_ENABLED() { return switches.fixtures; }, ACCEPTANCE_ENABLED: false }));
vi.mock("../runtime/project-native-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime/project-native-adapter")>();
  return { ...actual, createNativeProjectAdapter: (...args: Parameters<typeof actual.createNativeProjectAdapter>) => switches.adapter ?? actual.createNativeProjectAdapter(...args) };
});
vi.mock("@uagent/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uagent/runtime")>();
  return { ...actual, createProviderHttpTransport: (...args: Parameters<typeof actual.createProviderHttpTransport>) => { const transport = actual.createProviderHttpTransport(...args); return { ...transport, sendJson: (...params: Parameters<typeof transport.sendJson>) => switches.probe ? switches.probe() : transport.sendJson(...params) }; }, createAssetChangeSetService: (...args: Parameters<typeof actual.createAssetChangeSetService>) => {
    const service = actual.createAssetChangeSetService(...args);
    return { ...service, execute: (...params: Parameters<typeof service.execute>) => switches.execute ? switches.execute() : service.execute(...params) };
  } };
});

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function useProbe() { return { project: useProjectActions(), projectState: useProjectStore(s => s), composer: useComposerActions(), composerState: useComposerStore(s => s), runtime: useRuntimeActions(), state: useRuntimeStore(s => s), provider: useProviderActions(), providerState: useProviderStore(s => s), thread: useThreadStore(s => s) }; }
let probe!: ReturnType<typeof useProbe>;
function Probe() { probe = useProbe(); return null; }
function mount(children: ReactNode = null, initialState?: UIInitialState, overrides: Partial<DesktopRuntimeAdapter> = {}) {
  const runtime = { ...createDesktopRuntimeAdapter({ nativeInvoke: null }), ...overrides };
  const view = render(<UIProvider initialState={initialState} runtimeClient={runtime}><Probe />{children}</UIProvider>);
  return { ...view, runtime };
}
function snapshot(id: string, marker = 1): ProjectIndexSnapshot { return { projectId: id, rootRef: `root:${id}`, id: `snapshot-${id}-${marker}`, status: "ready", files: [], directories: [], assets: [], summary: {} } as unknown as ProjectIndexSnapshot; }
function project(id: string): ProjectProfile { return { id, name: id, rootRef: `root:${id}`, displayRoot: "[project-root]", indexStatus: "not_indexed", trustState: "trusted", engine: { label: "Unknown", association: null, source: "unknown" }, createdAt: 0, updatedAt: 0 } as ProjectProfile; }
function projectAdapter() {
  const adapter = { source: "native", listProjects: () => [project("A"), project("B")], updateIndexStatus: vi.fn(), scanProject: vi.fn(), cancelScan: vi.fn(), previewFile: vi.fn(), getProject: vi.fn() } as unknown as NativeProjectAdapter;
  switches.adapter = adapter; return adapter;
}
const draft: TaskDraft = { input: "hello", projectId: "A", permissionMode: "request_approval", modelId: "not-configured", providerId: null, reasoningEffort: "medium", runMode: "local", branch: null, contextPercent: null, providerStatus: "not_configured" } as TaskDraft;
const tauri = globalThis as typeof globalThis & { __TAURI_INTERNALS__?: { invoke: (...args: unknown[]) => Promise<unknown> } };
const originalTauri = tauri.__TAURI_INTERNALS__;
beforeEach(() => { switches.fixtures = false; switches.adapter = null; switches.execute = null; switches.probe = null; });
afterEach(() => { cleanup(); tauri.__TAURI_INTERNALS__ = originalTauri; vi.restoreAllMocks(); });

describe("rebuild stabilization regressions", () => {
  it("starts production without sample provider/project/review/evidence or an enabled asset gate", async () => {
    mount(<><ReviewPanel /><UtilityEvidencePanel /></>);
    expect(probe.providerState.providers).toEqual([]);
    expect(probe.projectState.activeProjectId).toBeNull();
    expect(probe.state.mvp15.gate.mode).toBe("disabled");
    expect(screen.getByText("No review recorded for the current project.")).toBeTruthy();
    expect(screen.getByText("No evidence recorded for the current project.")).toBeTruthy();
    await act(async () => { await probe.runtime.runMvp15AssetDryRun("/Game/Test01"); });
    expect(probe.state.mvp15.activeChangeSet).toBeNull();
    expect(probe.state.mvp15.lastError).toBe("native_asset_context_required");
  });
  it("projects a native boolean gate and preserves it while switching projects", async () => {
    mount(null, undefined, { getAssetMutationCapability: async () => true });
    await waitFor(() => expect(probe.state.mvp15.gate.mode).toBe("sandbox-enabled"));
    act(() => probe.project.setActiveProject("B"));
    expect(probe.state.mvp15.gate.mode).toBe("sandbox-enabled");
  });
  it("discards a late A scan after A to B to A and a newer result", async () => {
    const adapter = projectAdapter(); const old = deferred<{ snapshot: ProjectIndexSnapshot; events: string[] }>(); const fresh = deferred<{ snapshot: ProjectIndexSnapshot; events: string[] }>();
    vi.mocked(adapter.scanProject).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    mount(null, { project: { activeProjectId: "A" } });
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = probe.project.scanProjectIndex("A"); probe.project.setActiveProject("B"); probe.project.setActiveProject("A"); second = probe.project.scanProjectIndex("A"); });
    await act(async () => { fresh.resolve({ snapshot: snapshot("A", 2), events: ["fresh"] }); await second; });
    await act(async () => { old.resolve({ snapshot: snapshot("A", 1), events: ["stale"] }); await first; });
    expect(probe.projectState.activeProjectIndex?.id).toBe("snapshot-A-2");
    expect(probe.projectState.auditTrail).not.toContain("stale");
  });
  it("keeps cancellation after an older scan finishes and permits a later retry", async () => {
    const adapter = projectAdapter(); const old = deferred<{ snapshot: ProjectIndexSnapshot; events: string[] }>();
    vi.mocked(adapter.scanProject).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ snapshot: snapshot("A", 3), events: ["retry"] });
    vi.mocked(adapter.cancelScan).mockResolvedValue({ snapshot: snapshot("A", 0), events: ["cancel"] });
    mount(null, { project: { activeProjectId: "A" } }); let pending!: Promise<void>;
    act(() => { pending = probe.project.scanProjectIndex("A"); });
    await act(async () => { await probe.project.cancelProjectScan("A"); old.resolve({ snapshot: snapshot("A"), events: [] }); await pending; });
    expect(probe.projectState.scanStatus).toBe("cancelled");
    await act(async () => { await probe.project.scanProjectIndex("A"); });
    expect(probe.projectState.activeProjectIndex?.id).toBe("snapshot-A-3");
  });
  it("does not publish a stale diagnostics preview or its error into a new project", async () => {
    const adapter = projectAdapter(); const pending = deferred<never>(); vi.mocked(adapter.previewFile).mockReturnValue(pending.promise);
    const index = { ...snapshot("A"), files: [{ extension: ".uproject", displayName: "A.uproject", rootRelativePath: "A.uproject" }] } as ProjectIndexSnapshot;
    mount(null, { project: { activeProjectId: "A", registeredProjects: [project("A")], activeProjectIndex: index } }); let work!: Promise<void>;
    act(() => { work = probe.runtime.analyzeActiveProjectDiagnostics(); probe.project.setActiveProject("B"); });
    await act(async () => { pending.reject(new Error("private C:/secret")); await work; });
    expect(probe.state.mvp11.metadataStatus).toBe("idle"); expect(probe.state.mvp11.lastError).toBeNull();
  });
  it("submits once on rapid clicks, retains failed input, retries and preserves newer edits", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopRuntimeAdapter["submitTask"]>>>();
    const submit = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ id: "retry-task" });
    mount(<ComposerDock />, { composer: { input: "hello" }, project: { activeProjectId: "A" } }, { submitTask: submit });
    const send = screen.getByRole("button", { name: "Send task" });
    fireEvent.click(send); fireEvent.click(send);
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error("offline")); });
    expect(probe.composerState.input).toBe("hello"); expect(screen.getByRole("alert").textContent).toContain("kept");
    fireEvent.click(screen.getByRole("button", { name: "Send task" }));
    act(() => probe.composer.setComposerInput("newer edit"));
    await waitFor(() => expect(probe.thread.activeThreadId).toBe("retry-task"));
    expect(probe.composerState.input).toBe("newer edit");
  });
  it("does not route a late submission to the newly selected project", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopRuntimeAdapter["submitTask"]>>>(); mount(null, { composer: { input: "hello" }, project: { activeProjectId: "A" } }, { submitTask: () => pending.promise });
    let work!: Promise<string>; act(() => { work = probe.composer.submitComposerTask(draft); probe.project.setActiveProject("B"); });
    await act(async () => { pending.resolve({ id: "old-task" } as Awaited<ReturnType<DesktopRuntimeAdapter["submitTask"]>>); await work; });
    expect(probe.thread.activeThreadId).toBeNull(); expect(probe.composerState.input).toBe("hello");
  });
  it("keeps duplicate model names distinct by provider and submits the selected provider identity", async () => {
    const providers = ["one", "two"].map(providerId => ({ ...DEFAULT_PROVIDER_STATE.providers[0], providerId, enabled: true, models: [{ id: "same", label: "Same", contextWindow: 1000, supportsReasoning: false }], defaultModel: "same" }));
    const options = createComposerModelOptions(providers); expect(options[1].id).not.toBe(options[2].id);
    const submit = vi.fn().mockResolvedValue({ id: "task" });
    mount(<ComposerDock />, { composer: { input: "hello", selectedModelId: options[2].id }, provider: { providers, defaultProviderId: "two" } }, { submitTask: submit });
    fireEvent.click(screen.getByRole("button", { name: "Send task" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ providerId: "two", modelId: "same" })));
  });
  it("blocks overlapping asset execute/rollback and drops late completion after switching projects", async () => {
    switches.fixtures = true; const pending = deferred<unknown>(); const execute = vi.fn(() => pending.promise); switches.execute = execute;
    mount(null, { project: { activeProjectId: "A" } });
    await act(async () => { await probe.runtime.runMvp15AssetDryRun("/Game/Test01"); await probe.runtime.approveMvp15AssetChangeSet(); });
    expect(probe.state.mvp15.activeChangeSet?.state).toBe("approved");
    let first!: Promise<void>; act(() => { first = probe.runtime.executeMvp15AssetChangeSet(); void probe.runtime.executeMvp15AssetChangeSet(); void probe.runtime.rollbackMvp15AssetChangeSet(); });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    act(() => probe.project.setActiveProject("B"));
    await act(async () => { pending.resolve({ changeSet: { id: "late", state: "executed" }, reason: null }); await first; });
    expect(probe.state.mvp15.activeChangeSet).toBeNull(); expect(probe.state.mvp15.busy).toBe(false);
  });
  it("keeps Stop final when a snapshot resolves later and prevents another read on the stopped session", async () => {
    const pending = deferred<unknown>(); const readSnapshot = vi.fn(() => pending.promise);
    const session = { sessionId: "test-session", projectId: "A", rootId: "root:A", status: "attached", mode: "attached" } as NonNullable<ReturnType<typeof createEmptyMvp14State>["session"]>;
    const editor = { readSnapshot, stopSession: vi.fn(async () => ({ ...session, status: "stopped" })) } as unknown as ReturnType<DesktopRuntimeAdapter["getEditorObservationAdapter"]>;
    mount(null, { runtime: { mvp14: { ...createEmptyMvp14State(), session } } }, { getEditorObservationAdapter: () => editor }); let work!: Promise<void>;
    act(() => { work = probe.runtime.readMvp14EditorSnapshot(); });
    await act(async () => { await probe.runtime.stopMvp14ObservationSession(); pending.resolve({ editorState: "ready" }); await work; await probe.runtime.readMvp14EditorSnapshot(); });
    expect(probe.state.mvp14.session?.status).toBe("stopped"); expect(probe.state.mvp14.snapshot).toBeNull(); expect(readSnapshot).toHaveBeenCalledTimes(1);
  });
  it("navigates popup options by keyboard and restores the trigger on Escape", async () => {
    const select = vi.fn(); render(<ModelSelector modelId="a" reasoningEffort="medium" models={[{ id: "a", label: "Alpha", provider: "P", contextWindow: "1k", enabled: true }, { id: "b", label: "Beta", provider: "P", contextWindow: "1k", enabled: true }]} reasoningOptionsList={[]} onModelChange={select} onReasoningChange={() => {}} />);
    const trigger = screen.getByRole("button"); fireEvent.click(trigger);
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Alpha"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(select).toHaveBeenCalledWith("b");
    fireEvent.click(trigger); await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy()); fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(trigger); expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("traps narrow drawer focus and restores the opening button on Escape", async () => {
    const oldWidth = window.innerWidth; Object.defineProperty(window, "innerWidth", { value: 900, configurable: true });
    try {
      mount(<AppShell />, { layout: { inspector: { open: false } } });
      const opener = screen.getByRole("button", { name: "Open utility drawer" }); opener.focus(); fireEvent.click(opener);
      const dialog = await screen.findByRole("dialog", { name: "Utility drawer" });
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true }); expect(dialog.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      await waitFor(() => expect(document.activeElement).toBe(opener)); expect(screen.queryByRole("dialog")).toBeNull();
    } finally { Object.defineProperty(window, "innerWidth", { value: oldWidth, configurable: true }); }
  });
  it("uses the latest native maximize response and ignores an older response", async () => {
    const first = deferred<boolean>(); const second = deferred<boolean>(); const invoke = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); tauri.__TAURI_INTERNALS__ = { invoke };
    mount(<TitleBar />); fireEvent(window, new Event("resize"));
    await act(async () => { second.resolve(true); }); expect(screen.getByRole("button", { name: "Restore window" })).toBeTruthy();
    await act(async () => { first.resolve(false); }); expect(screen.getByRole("button", { name: "Restore window" })).toBeTruthy();
  });
  it("redacts asset lifecycle evidence text and renders semantic rows", () => {
    const state = { ...createEmptyMvp15State(), sourceAssetPath: "/Game/Test", lastError: "token=private-value C:\\private\\secret.txt" };
    const { container } = render(<AssetLifecycleEvidence state={state} title="Evidence" />);
    expect(container.textContent).not.toContain("private-value"); expect(container.textContent).not.toContain("secret.txt"); expect(container.querySelectorAll("dt").length).toBeGreaterThan(8);
  });
  it("does not label live Provider connectivity successful without a transport", async () => {
    const provider = { ...DEFAULT_PROVIDER_STATE.providers[0], enabled: true, networkMode: "live" as const };
    mount(<ProviderSettings />, { provider: { providers: [provider], selectedProviderId: provider.providerId } });
    fireEvent.click(screen.getByRole("button", { name: "Check connection availability" }));
    await waitFor(() => expect(probe.providerState.testStatus).toBe("failure"));
    expect(screen.getByRole("status", { name: "Provider test connection status" }).textContent).toContain("No network request was sent");
  });
  it("runs the explicit fixture probe and discards its result after configuration edits", async () => {
    switches.fixtures = true; const pending = deferred<unknown>(); switches.probe = () => pending.promise;
    const provider = { ...DEFAULT_PROVIDER_STATE.providers[0], enabled: true, networkMode: "fixture" as const };
    mount(<ProviderSettings />, { provider: { providers: [provider], selectedProviderId: provider.providerId } });
    fireEvent.click(screen.getByRole("button", { name: "Check connection availability" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit provider" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), { target: { value: "https://changed.invalid" } });
    await act(async () => { pending.resolve({ status: 200, body: JSON.stringify({ id: "fixture-response" }) }); });
    expect(probe.providerState.testStatus).toBe("idle");
    switches.probe = null;
    fireEvent.click(screen.getByRole("button", { name: "Check connection availability" }));
    await waitFor(() => expect(probe.providerState.testStatus).toBe("success"));
  });
  it("accepts only a strict native true for the asset gate", async () => {
    for (const value of [false, "true", 1, null]) {
      const adapter = createDesktopRuntimeAdapter({ nativeInvoke: async <T,>() => value as T });
      expect(await adapter.getAssetMutationCapability?.()).toBe(false);
    }
  });

  it("keeps the adapter cache from being cancelled by an obsolete cancel completion", async () => {
    const { createNativeProjectAdapter } = await vi.importActual<typeof import("../runtime/project-native-adapter")>("../runtime/project-native-adapter");
    const cancel = deferred<unknown>();
    const adapter = createNativeProjectAdapter({ invoke: async <T,>(command: string) => {
      if (command === "validate_native_project_root") return { ok: true, reason: "valid", displayRoot: "[test-root]", projectName: "Test", engine: { label: "Unknown", association: null, source: "unknown" } } as T;
      if (command === "cancel_native_project_scan") return await cancel.promise as T;
      if (command === "scan_native_project_index") return { id: "fresh-index", status: "ready", directories: [{}], files: [{}], assets: [{}], summary: {} } as T;
      throw new Error("unexpected_test_command");
    } });
    const registered = await adapter.addProject("G:/SyntheticTestRoot");
    const cancelling = adapter.cancelScan(registered.id).catch(error => error.message);
    const fresh = await adapter.scanProject(registered.id);
    cancel.resolve({}); expect(await cancelling).toBe("scan_cancel_superseded");
    expect(adapter.getProject(registered.id)?.indexStatus).toBe("ready"); expect(adapter.getStableSnapshot(registered.id)).toBe(fresh.snapshot);
  });
  it("discards a late text approval after switching projects", async () => {
    const pending = deferred<unknown>();
    const adapter = { approve: vi.fn(() => pending.promise) } as unknown as ReturnType<DesktopRuntimeAdapter["getTextMutationAdapter"]>;
    const mvp12 = { ...createEmptyMvp12State(), activeChangeSet: { id: "old-change", state: "previewed", operations: [] } as unknown as NonNullable<ReturnType<typeof createEmptyMvp12State>["activeChangeSet"]> };
    mount(null, { project: { activeProjectId: "A", registeredProjects: [project("A")] }, runtime: { mvp12 } }, { getTextMutationAdapter: () => adapter });
    let work!: Promise<void>; act(() => { work = probe.runtime.approveChangeSet("old-change"); probe.project.setActiveProject("B"); });
    await act(async () => { pending.resolve({ status: "approved", approval: { approvalToken: "test-token" } }); await work; });
    expect(probe.state.mvp12.activeChangeSet).toBeNull(); expect(probe.state.mvp12.lastError).toBeNull();
  });

});
