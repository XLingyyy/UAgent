import { completedArchivedDiscussionText,type NativeRunArchive } from "./native-run-history";
import { describe, expect, it, vi } from "vitest";
import {
  archivedPartialAssistantText,
  canContinueNativeHistory,
  createNativeRunHistory,
} from "./native-run-history";

function archiveFixture() {
  const body = "Full answer 中文 🟢\n" + "Exact text. ".repeat(1200) + "END OF SAVED ANSWER";
  const provider = [
    { role: "developer", content: "Saved descriptive constraints" },
    { role: "user", content: "Inspect project" },
    { role: "assistant", content: body },
  ];
  const descriptor = {
    projectId: "A",
    projectLabel: "Project A",
    projectRoot: "G:/does-not-have-to-exist/A",
    sessionId: "chat",
    sessionTitle: "Saved chat",
    runId: "run",
    goal: "Inspect project",
    status: "paused",
    updatedAt: 123,
    hasUnresolvedEffects: false,
  };
  return {
    schemaVersion: 1,
    descriptor,
    snapshot: {
      run: {
        projectId: "A",
        id: "run",
        sessionId: "chat",
        goal: "Inspect project",
        status: "paused",
        revision: 2,
        createdAt: 100,
        updatedAt: 123,
      },
      checkpoint: null,
      steps: [],
      toolCalls: [],
      changesets: [],
      artifacts: [],
      requiresFreshAuthorization: true,
      hasUnknownExternalEffects: false,
    },
    coordinatorState: {
      format: "uagent.coordinator-state.v1",
      runId: "run",
      projectId: "A",
      conversationId: "chat",
      messageCount: provider.length,
      requiresFreshAuthorization: true,
      scopeDescription: { mode: "read_only", readPrefixes: ["Source"], sharePrefixes: [] },
      contextPlan: {
        segments: [
          {
            sources: [
              { projectId: "A", path: "Source/A.cpp", version: "v1", kind: "file_preview" },
            ],
          },
        ],
      },
    },
    messages: provider.map((message, index) => ({
      id: "run:message:" + (index + 1),
      role: message.role === "developer" ? "system" : message.role,
      body: JSON.stringify({ format: "uagent.provider-message.v1", message }),
      createdAt: 123,
    })),
    events: [] as Array<{ id: string; kind: string; createdAt: number; data: unknown }>,
    completeness: { complete: true, loadedMessageCount: 3, storedMessageCount: 3, reason: null },
  };
}
it("selects only completed archived discussion turns, preserving the current user block and excluding failed input",()=>{
 const archive={coordinatorState:{taskMode:"discussion"},providerMessages:[{role:"user",content:"failed"},{role:"user",content:"question"},{role:"user",content:"selected reference"},{role:"assistant",content:"answer"},{role:"user",content:"cancelled"}],events:[
 {kind:"model_started",data:{payload:{requestId:"failed",messages:[{role:"user",content:"failed"}]}}},
 {kind:"coordinator_state_v1",data:{taskMode:"discussion",lastRequestId:"failed",lastRequestStatus:"failed",messageCount:1}},
 {kind:"model_started",data:{payload:{requestId:"done",messages:[{role:"system",content:"data"},{role:"user",content:"question"},{role:"user",content:"selected reference"}]}}},
 {kind:"coordinator_state_v1",data:{taskMode:"discussion",lastRequestId:"done",lastRequestStatus:"completed",messageCount:4}},
 {kind:"coordinator_state_v1",data:{taskMode:"discussion",lastRequestId:"done",lastRequestStatus:"completed",messageCount:4}},
 {kind:"model_started",data:{payload:{requestId:"cancelled",messages:[{role:"user",content:"cancelled"}]}}},
 ]} as unknown as NativeRunArchive;
 expect(completedArchivedDiscussionText(archive)).toEqual([{role:"user",content:"question\n\nselected reference"},{role:"assistant",content:"answer"}]);
});
describe("native run history read-only port", () => {
  it("reads bounded descriptors and exact archived message bodies without a project authority command", async () => {
    const saved = archiveFixture(),
      invoke = vi.fn(async (command: string) =>
        command === "list_native_run_history"
          ? { schemaVersion: 1, runs: [saved.descriptor], limit: 30, offset: 0, hasMore: false }
          : saved,
      );
    const history = createNativeRunHistory(invoke);
    expect((await history.list()).runs[0].projectRoot).toBe("G:/does-not-have-to-exist/A");
    const result = await history.snapshot("A", "run");
    expect(result.providerMessages[2].content).toBe(
      JSON.parse(saved.messages[2].body).message.content,
    );
    expect(result.providerMessages[2].content.endsWith("END OF SAVED ANSWER")).toBe(true);
    expect(result.providerMessages[0].role).toBe("developer");
    expect(result.completeness.complete).toBe(true);
    expect(canContinueNativeHistory(result)).toBe(true);
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      "list_native_run_history",
      "snapshot_native_run_store",
    ]);
  });
  it("passes explicit project pagination and rejects a foreign descriptor or snapshot", async () => {
    const saved = archiveFixture();
    const invoke = vi.fn(async () => ({
      schemaVersion: 1,
      runs: [saved.descriptor],
      offset: 30,
      limit: 30,
      hasMore: true,
    }));
    await expect(
      createNativeRunHistory(invoke).list({ projectId: "B", offset: 30 }),
    ).rejects.toThrow("invalid_record");
    expect(invoke).toHaveBeenCalledWith("list_native_run_history", {
      input: { schemaVersion: 1, projectId: "B", offset: 30, limit: 30 },
    });
    await expect(createNativeRunHistory(async () => saved).snapshot("B", "run")).rejects.toThrow(
      "invalid_record",
    );
    await expect(createNativeRunHistory(invoke).list({ limit: 101 })).rejects.toThrow(
      "invalid_record",
    );
  });
  it("refuses structured saved authority while leaving conversation text exact", async () => {
    const saved = archiveFixture();
    Object.assign(saved.coordinatorState, { approvalToken: "synthetic-stale-token" });
    await expect(createNativeRunHistory(async () => saved).snapshot("A", "run")).rejects.toThrow(
      "invalid_record",
    );
  });
  it("disables continuation for in-flight effects and incomplete records", async () => {
    const saved = archiveFixture();
    saved.snapshot.steps = [
      { id: "step", title: "read", status: "inFlight", dependsOn: [] },
    ] as never[];
    const result = await createNativeRunHistory(async () => saved).snapshot("A", "run");
    expect(result.descriptor.hasUnresolvedEffects).toBe(true);
    expect(canContinueNativeHistory(result)).toBe(false);
    const partial = archiveFixture();
    partial.completeness.complete = false;
    partial.completeness.storedMessageCount = 5;
    Object.assign(partial.completeness, { reason: "displayLimit" });
    expect(
      canContinueNativeHistory(
        await createNativeRunHistory(async () => partial).snapshot("A", "run"),
      ),
    ).toBe(false);
  });
  it("rejects a false completeness claim or provider role mismatch", async () => {
    const saved = archiveFixture();
    saved.completeness.storedMessageCount = 4;
    await expect(createNativeRunHistory(async () => saved).snapshot("A", "run")).rejects.toThrow(
      "invalid_record",
    );
    const mismatch = archiveFixture();
    mismatch.messages[2].role = "user";
    await expect(createNativeRunHistory(async () => mismatch).snapshot("A", "run")).rejects.toThrow(
      "invalid_record",
    );
  });
  it("keeps saved stream deltas ordered and separate from completed provider messages", async () => {
    const saved = archiveFixture();
    const event = (kind: string, sequence: number, payload: unknown) => ({
      id: `run:${sequence}`,
      kind,
      createdAt: 123,
      data: {
        schemaVersion: 1,
        eventId: `run:${sequence}`,
        runId: "run",
        sequence,
        createdAt: 123,
        type: kind,
        payload,
      },
    });
    saved.events = [
      event("model_started", 1, { requestId: "request" }),
      event("model_text_delta", 2, { text: "Interrupted " }),
      event("model_text_delta", 3, { text: "response 中文" }),
    ];
    const archive = await createNativeRunHistory(async () => saved).snapshot("A", "run");
    expect(archivedPartialAssistantText(archive)).toBe("Interrupted response 中文");
    expect(archive.providerMessages).toHaveLength(3);
    saved.events.push(event("model_completed", 4, { requestId: "request" }));
    expect(
      archivedPartialAssistantText(
        await createNativeRunHistory(async () => saved).snapshot("A", "run"),
      ),
    ).toBe("");
    saved.events.reverse();
    await expect(createNativeRunHistory(async () => saved).snapshot("A", "run")).rejects.toThrow(
      "invalid_record",
    );
  });
});
