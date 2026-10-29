import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderAdapter } from "@uagent/runtime";
import { UIProvider, useComposerActions, useProjectActions, useThreadStore } from "../stores/ui-store";
import { ConversationViewport } from "../workspace/ConversationViewport";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";

afterEach(cleanup);
let actions!: { composer: ReturnType<typeof useComposerActions>; project: ReturnType<typeof useProjectActions>; thread: string | null };
function Probe() { actions = { composer: useComposerActions(), project: useProjectActions(), thread: useThreadStore(s => s.activeThreadId) }; return <ConversationViewport />; }
function mount() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const adapter: ProviderAdapter = {
    id: "deepseek", getCapabilities: () => ({ providerId: "deepseek", modelIds: ["deepseek-flash"], supportsStreaming: true, supportsTools: false, isMock: true }),
    complete: async () => { throw Error("unused"); },
    async *stream(request) {
      yield { id: "one", requestId: request.id, providerId: "deepseek", modelId: request.modelId, index: 0, delta: "Synthetic streaming analysis", done: false };
      await gate;
      yield { id: "two", requestId: request.id, providerId: "deepseek", modelId: request.modelId, index: 1, delta: " ending", done: true, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
    },
  };
  const runtime = createDesktopRuntimeAdapter({ nativeInvoke: null, providerAdapter: adapter, providerEnabled: true });
  render(<UIProvider runtimeClient={runtime} initialState={{ project: { activeProjectId: "A" } }}><Probe /></UIProvider>);
  const draft = { input: "Inspect synthetic cube", projectId: "A", providerId: "deepseek", modelId: "deepseek-flash", permissionMode: "request_approval" as const, reasoningEffort: "medium", runMode: "local" as const, branch: null, contextPercent: null };
  return { release, draft };
}
describe("streaming task routing", () => {
  it("shows a provider delta in the active conversation before submit completes", async () => {
    const { release, draft } = mount();
    let pending!: Promise<string>;
    act(() => { pending = actions.composer.submitComposerTask(draft); });
    await waitFor(() => expect(screen.getAllByText("Synthetic streaming analysis").length).toBeGreaterThan(0));
    expect(actions.thread).not.toBeNull();
    await act(async () => { release(); await pending; });
  });
  it("does not route a cancelled stream back after A to B to A", async () => {
    const { release, draft } = mount();
    let pending!: Promise<string>;
    act(() => { pending = actions.composer.submitComposerTask(draft); });
    await waitFor(() => expect(actions.thread).not.toBeNull());
    act(() => { actions.project.setActiveProject("B"); actions.project.setActiveProject("A"); });
    await act(async () => { release(); await pending; });
    expect(actions.thread).toBeNull();
    expect(screen.queryByText("Synthetic streaming analysis ending")).toBeNull();
  });
});
