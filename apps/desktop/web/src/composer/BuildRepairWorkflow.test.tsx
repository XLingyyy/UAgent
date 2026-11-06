import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore } from "../i18n";
import { BuildRepairWorkflow } from "./BuildRepairWorkflow";
import { InvestigationWorkflow } from "./InvestigationWorkflow";
import { createNativeUEBuildPreview, type UEBuildPreviewConfiguration } from "../runtime/native-ue-build-preview";
const state = vi.hoisted(() => ({ project: { activeProjectId: "root:abc", nativeSource: "native", registeredProjects: [{ id: "root:abc", name: "Synthetic", trustState: "trusted", updatedAt: 1 }] } }));
vi.mock("../stores/ui-store", () => ({
  useProjectStore: (selector: (s: typeof state.project) => unknown) => selector(state.project),
  useRuntimeStore: (selector: (s: { activeTaskId: null; tasksById: object }) => unknown) => selector({ activeTaskId: null, tasksById: {} }),
}));
afterEach(cleanup);
beforeEach(() => { state.project.activeProjectId = "root:abc"; });
function mount(client?: ReturnType<typeof createNativeUEBuildPreview>) {
  const store = createLocaleStore({ initialLocale: "en", storage: null, eventTarget: null });
  const element = <I18nProvider store={store}><BuildRepairWorkflow client={client}/></I18nProvider>;
  return { ...render(element), element };
}
function receipt(input: UEBuildPreviewConfiguration) {
  const now = Date.now(), projectRoot = "E:/Synthetic", up = projectRoot + "/Game.uproject";
  return { schemaVersion: 1, preparedId: "a".repeat(32), projectId: input.projectId, preparedAtMs: now, expiresAtMs: now + 120000,
    status: "preview_only", executionEnabled: false, verification: "not_started", preview: {
      profile: { ...input, schemaVersion: 1, profileId: "desktop-fixed-editor-preview-v1", platform: "Win64", configuration: "Development", method: "ubt", timeoutMs: 600000 },
      fingerprint: "b".repeat(64), engineVersion: "5.8.4", projectRoot, uproject: up, targetFile: projectRoot + "/Source/GameEditor.Target.cs",
      program: input.engineRoot + "/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe", cwd: input.engineRoot + "/Engine/Source",
      arguments: [input.target, "Win64", "Development", "-Project=" + up, "-WaitMutex", "-NoHotReloadFromIDE", "-UTF8Output"],
      timeoutMs: 600000, expectedMutation: "build_artifacts_and_project_build_logic", verification: "not_started" } };
}
function prepare() {
  fireEvent.click(screen.getByRole("button", { name: "Prepare target command" }));
  for (const [label, value] of [["Engine installation directory", "G:/UnrealEngine/UE_5.8"], [".uproject relative path", "Game.uproject"], ["Editor target name", "GameEditor"], ["Engine-bundled .NET directory version", "10.0"]])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare command preview" }));
}
it("selects build preparation without creating an executable task draft", () => {
  const apply = vi.fn();
  render(<I18nProvider store={createLocaleStore({ initialLocale: "en", storage: null })}><InvestigationWorkflow disabled={false} hasDraft={true} onApply={apply}/></I18nProvider>);
  fireEvent.click(screen.getByText("Built-in workflows"));
  fireEvent.change(screen.getByLabelText("Workflow template"), { target: { value: "build" } });
  expect(screen.getByRole("region", { name: "Build repair" })).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
});
it("parses real compiler syntax locally, redacts secrets and invalidates the report when edited", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Paste build log"), { target: { value: "E:/Synthetic/Source/Game.cpp(12,4): error C2065: Missing api_key=synthetic-secret\nerror LNK2019: unresolved symbol Foo" } });
  fireEvent.click(screen.getByRole("button", { name: "Analyze diagnostics" }));
  const report = screen.getByRole("region", { name: "Diagnostic report" });
  expect(report.textContent).toContain("2 error groups"); expect(report.textContent).toContain("C2065");
  expect(report.textContent).toContain("LNK2019"); expect(report.textContent).not.toContain("synthetic-secret");
  expect(report.textContent).toContain("outcome is unverified");
  fireEvent.change(screen.getByLabelText("Paste build log"), { target: { value: "changed" } });
  expect(screen.queryByRole("region", { name: "Diagnostic report" })).toBeNull();
});
it("does not infer successful builds from pasted success text or unrecognized logs", () => {
  mount(); fireEvent.change(screen.getByLabelText("Paste build log"), { target: { value: "Result: Succeeded" } });
  fireEvent.click(screen.getByRole("button", { name: "Analyze diagnostics" }));
  expect(screen.getByRole("region", { name: "Diagnostic report" }).textContent).toContain("No recognized errors does not establish a successful build");
});
it("prepares the real preview IPC contract and releases on close without executing a build", async () => {
  const invoke = vi.fn(async (command: string, payload?: unknown) => {
    if (command === "prepare_ue_build_preview") return receipt((payload as { input: UEBuildPreviewConfiguration }).input);
    if (command === "release_ue_build_preview") return { released: true };
    throw Error("unexpected command");
  });
  mount(createNativeUEBuildPreview(invoke as never)); prepare();
  await screen.findByText("5.8.4"); expect(screen.getByText("-Project=E:/Synthetic/Game.uproject")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close target preview" }));
  await waitFor(() => expect(invoke.mock.calls.map(([command]) => command)).toEqual(["prepare_ue_build_preview", "release_ue_build_preview"]));
});
it("rejects a receipt that claims execution was enabled", async () => {
  const invoke = vi.fn(async (_command: string, payload?: unknown) => ({ ...receipt((payload as { input: UEBuildPreviewConfiguration }).input), executionEnabled: true }));
  mount(createNativeUEBuildPreview(invoke as never)); prepare();
  await screen.findByRole("alert"); expect(screen.queryByText("5.8.4")).toBeNull();
});
it("discards and releases a late preview after the selected project changes", async () => {
  let finish: (value: unknown) => void = () => undefined; let input: UEBuildPreviewConfiguration;
  const invoke = vi.fn((command: string, payload?: unknown) => {
    if (command === "release_ue_build_preview") return Promise.resolve({ released: true });
    input = (payload as { input: UEBuildPreviewConfiguration }).input;
    return new Promise(resolve => { finish = resolve; });
  });
  const h = mount(createNativeUEBuildPreview(invoke as never)); prepare();
  state.project.activeProjectId = "root:def"; h.rerender(<I18nProvider store={createLocaleStore({ initialLocale: "en", storage: null })}><BuildRepairWorkflow client={createNativeUEBuildPreview(invoke as never)}/></I18nProvider>);
  finish(receipt(input!));
  await waitFor(() => expect(invoke.mock.calls.some(([command]) => command === "release_ue_build_preview")).toBe(true));
  expect(screen.queryByText("5.8.4")).toBeNull();
});
