import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore } from "../i18n";
import { createNativeRunHistory } from "../runtime/native-run-history";
import { RunHistoryPanel } from "./RunHistoryPanel";

afterEach(cleanup);
function fixture(unresolved = false) {
  const answer = "Complete saved answer\n\n" + "Body text. ".repeat(1000) + "SAVED FINAL SENTENCE";
  const descriptor = {
    projectId: "A",
    projectLabel: "Archived project",
    projectRoot: "G:/missing-project",
    sessionId: "chat",
    sessionTitle: "Archived session",
    runId: "run",
    goal: "Saved investigation",
    status: "paused",
    updatedAt: 123,
    hasUnresolvedEffects: unresolved,
  };
  const provider = [
    { role: "user", content: "Complete saved user question" },
    { role: "assistant", content: answer },
  ];
  const raw = {
    schemaVersion: 1,
    descriptor,
    snapshot: {
      run: {
        projectId: "A",
        id: "run",
        sessionId: "chat",
        goal: descriptor.goal,
        status: "paused",
        revision: 1,
        createdAt: 100,
        updatedAt: 123,
      },
      checkpoint: null,
      steps: [],
      toolCalls: [
        {
          id: "tool",
          stepId: "step",
          toolName: "project.read",
          arguments: { path: "Source/Main.cpp" },
          result: {
            output: "full readonly result",
            sources: [
              { projectId: "A", path: "Source/Main.cpp", version: "v1", kind: "file_preview" },
            ],
          },
          status: unresolved ? "unknown" : "succeeded",
        },
      ],
      changesets: [],
      artifacts: [],
      requiresFreshAuthorization: true,
      hasUnknownExternalEffects: unresolved,
    },
    coordinatorState: {
      format: "uagent.coordinator-state.v1",
      projectId: "A",
      runId: "run",
      conversationId: "chat",
      messageCount: 2,
      requiresFreshAuthorization: true,
      contextPlan: { segments: [{ sources: [{ path: "Source/Main.cpp", version: "v1" }] }] },
    },
    messages: provider.map((message, index) => ({
      id: "run:message:" + index,
      role: message.role,
      body: JSON.stringify({ format: "uagent.provider-message.v1", message }),
      createdAt: 123,
    })),
    events: [] as Array<{ id: string; kind: string; createdAt: number; data: unknown }>,
    completeness: { complete: true, loadedMessageCount: 2, storedMessageCount: 2, reason: null },
  };
  const invoke = vi.fn(async (command: string) =>
    command === "list_native_run_history"
      ? { schemaVersion: 1, runs: [descriptor], offset: 0, limit: 30, hasMore: false }
      : raw,
  );
  return { raw, invoke, history: createNativeRunHistory(invoke) };
}
function view(value: ReturnType<typeof fixture>, onContinue = vi.fn()) {
  render(
    <I18nProvider store={createLocaleStore({ initialLocale: "en", storage: null })}>
      <RunHistoryPanel history={value.history} projectId="A" onContinue={onContinue} />
    </I18nProvider>,
  );
  return onContinue;
}
describe("archived run history panel", () => {
  it("shows full saved conversation on selection and requires an explicit new-task click", async () => {
    const saved = fixture(),
      onContinue = view(saved);
    fireEvent.click(await screen.findByRole("button", { name: /Saved investigation/ }));
    await screen.findByText(/SAVED FINAL SENTENCE/);
    expect(screen.getByText("Complete saved user question")).toBeTruthy();
    expect(screen.getByText(/Showing all 2 message bodies/)).toBeTruthy();
    expect(onContinue).not.toHaveBeenCalled();
    const share = screen.getByRole("checkbox") as HTMLInputElement;
    expect(share.checked).toBe(false);
    expect(screen.getByText(/Tool records/).closest("details")?.open).toBe(false);
    expect(screen.getByText("Saved context plan and sources").closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Start a new task from this record…" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
    expect(onContinue.mock.calls[0][1]).toBe(false);
    expect(onContinue.mock.calls[0][0].descriptor.projectRoot).toBe("G:/missing-project");
    expect(saved.invoke.mock.calls.map((call) => call[0])).toEqual([
      "list_native_run_history",
      "snapshot_native_run_store",
    ]);
  });
  it("blocks unresolved effects and never continues from just selecting a record", async () => {
    const onContinue = view(fixture(true));
    fireEvent.click(await screen.findByRole("button", { name: /Saved investigation/ }));
    await screen.findByText(/Reconcile its actual outcome/);
    const button = screen.getByRole("button", {
      name: "Start a new task from this record…",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onContinue).not.toHaveBeenCalled();
  });
  it("resets optional sharing when another record selection is loaded", async () => {
    const saved = fixture();
    view(saved);
    const select = await screen.findByRole("button", { name: /Saved investigation/ });
    fireEvent.click(select);
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(select);
    await waitFor(() =>
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false),
    );
  });

  it("still displays an earlier partial reply after a later successful retry without duplicating completed deltas",async()=>{
    const saved=fixture();
    const event=(kind:string,sequence:number,payload:unknown)=>({
      id:"run:"+sequence,kind,createdAt:123,data:{eventId:"run:"+sequence,runId:"run",sequence,createdAt:123,type:kind,payload}
    });
    saved.raw.events=[
      event("model_started",1,{requestId:"failed"}),
      event("model_text_delta",2,{requestId:"failed",text:"Earlier failed partial stays visible"}),
      event("model_started",3,{requestId:"success"}),
      event("model_text_delta",4,{requestId:"success",text:"Do not duplicate this completed delta"}),
      event("model_completed",5,{requestId:"success"})
    ];
    view(saved);fireEvent.click(await screen.findByRole("button",{name:/Saved investigation/}));
    await screen.findByText("Earlier failed partial stays visible");
    expect(screen.queryByText("Do not duplicate this completed delta")).toBeNull();
    expect(screen.getByText(/It is not a completed answer/)).toBeTruthy();
  });

  it("labels a saved interrupted assistant stream as partial, outside completed messages", async () => {
    const saved = fixture();
    saved.raw.events = [
      {
        id: "run:1",
        kind: "model_started",
        createdAt: 123,
        data: {
          eventId: "run:1",
          runId: "run",
          sequence: 1,
          createdAt: 123,
          type: "model_started",
          payload: { requestId: "request" },
        },
      },
      {
        id: "run:2",
        kind: "model_text_delta",
        createdAt: 123,
        data: {
          eventId: "run:2",
          runId: "run",
          sequence: 2,
          createdAt: 123,
          type: "model_text_delta",
          payload: { text: "Saved partial stream text" },
        },
      },
    ];
    view(saved);
    fireEvent.click(await screen.findByRole("button", { name: /Saved investigation/ }));
    await screen.findByText("Saved partial stream text");
    expect(screen.getByText(/It is not a completed answer/)).toBeTruthy();
    expect(screen.getByText("Saved task events").closest("details")?.open).toBe(false);
  });
});
