import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { I18nProvider, createLocaleStore } from "../i18n";
import { createNativeRunHistory } from "../runtime/native-run-history";
import type { NativeHistorySearchSelection } from "../runtime/native-run-history-search";
import { RunHistoryPanel } from "./RunHistoryPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fixture(role: "user" | "assistant" | "tool" = "assistant") {
  const descriptor = { projectId: "A", projectLabel: "Saved project", projectRoot: "G:/synthetic-not-opened", sessionId: "session", sessionTitle: "Saved session", runId: "run", goal: "Stored task", status: "succeeded", updatedAt: 3, hasUnresolvedEffects: false };
  const provider = [{ role: "user", content: "Earlier unrelated text" }, { role, content: "Exact matched body\n<img src='https://invalid.test/not-loaded'>", ...(role === "tool" ? { toolCallId: "call" } : {}) }, { role: "assistant", content: "Later unrelated text" }];
  const raw = { schemaVersion: 1, descriptor,
    snapshot: { run: { projectId: "A", id: "run", sessionId: "session", goal: "Stored task", status: "succeeded", revision: 1, createdAt: 1, updatedAt: 3 }, checkpoint: null, steps: [], toolCalls: [], changesets: [], artifacts: [], requiresFreshAuthorization: true, hasUnknownExternalEffects: false },
    coordinatorState: { format: "uagent.coordinator-state.v1", projectId: "A", runId: "run", conversationId: "session", messageCount: 3, requiresFreshAuthorization: true },
    messages: provider.map((message, index) => ({ id: "message-" + index, role: message.role, body: JSON.stringify({ format: "uagent.provider-message.v1", message }), createdAt: 2 })),
    events: [], completeness: { complete: true, loadedMessageCount: 3, storedMessageCount: 3, reason: null } };
  const hit = { projectId: "A", sessionId: "session", messageId: "message-1", ordinal: 2, role, createdAt: 2, origin: "native", preview: "Exact matched", previewTruncated: true, bodySha256: createHash("sha256").update(raw.messages[1].body).digest("hex"), archiveCandidate: { runId: "run", revision: 1 } };
  const invoke = vi.fn(async (command: string, args: { input: unknown }) => {
    if (command === "list_native_run_history") return { schemaVersion: 1, runs: [descriptor], offset: 0, limit: 30, hasMore: false };
    if (command === "snapshot_native_run_store") return raw;
    if (command === "search_native_run_history") { const input = args.input as { projectId: string; query: string; offset: number; limit: number }; return { schemaVersion: 1, ...input, hasMore: input.offset === 0, messages: input.offset === 0 ? [hit, ...Array.from({ length: 29 }, (_, index) => ({ ...hit, messageId: "other-" + index, archiveCandidate: null }))] : [hit] }; }
    throw Error("Unexpected non-read command: " + command);
  });
  const history = createNativeRunHistory(invoke), archive = await history.snapshot("A", "run");
  const selection: NativeHistorySearchSelection = { archive, messageId: "message-1", identity: { projectId: "A", sessionId: "session", runId: "run", revision: 1 } };
  return { history, archive, selection, invoke, raw, hit };
}
function element(f: Awaited<ReturnType<typeof fixture>>, selection: NativeHistorySearchSelection | null = f.selection, projectId = "A", onContinue = vi.fn(), locale: "en" | "zh-CN" = "en") {
  return <I18nProvider store={createLocaleStore({ initialLocale: locale, storage: null })}><RunHistoryPanel history={f.history} projectId={projectId} initialSelection={selection} onContinue={onContinue} /></I18nProvider>;
}
async function enterSearch() {
  fireEvent.click(await screen.findByRole("button", { name: /Stored task/ }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Search messages in this project" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Search messages in this project" }));
}
function submit(query = "Exact") {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}
function setup(f: Awaited<ReturnType<typeof fixture>>) {
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("__TAURI_INTERNALS__", { invoke: f.invoke });
  return render(element(f, null));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }


describe("history search return state", () => {
  it("returns from verified detail to the same query, second page and selected hit without another search", async () => {
    const f = await fixture(); setup(f); await enterSearch(); submit();
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await screen.findByText("Page 2");
    fireEvent.click(screen.getByRole("button", { name: "Verify and open archive" }));
    const target = await screen.findByRole("article", { name: "Search match" }); expect(document.activeElement).toBe(target);
    fireEvent.click(screen.getByRole("button", { name: "Search messages in this project" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Exact");
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify and open archive", pressed: true })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("article", { name: "Verified matching message" }));
    expect(f.invoke.mock.calls.filter(([command]) => command === "search_native_run_history")).toHaveLength(2);
  });
  it("clears retained state across project switches, including switching back", async () => {
    const f = await fixture(), view = setup(f); await enterSearch(); submit("private A query");
    await screen.findByRole("button", { name: "Verify and open archive" });
    view.rerender(element(f, null, "B")); expect(screen.queryByRole("searchbox")).toBeNull();
    view.rerender(element(f, null, "A")); await enterSearch();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Verify and open archive" })).toBeNull();
  });
  it("isolates a different archive project even when the owner project stays unchanged", async () => {
    const f = await fixture(), view = setup(f); await enterSearch(); submit("private A query");
    await screen.findByRole("button", { name: "Verify and open archive" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const other = { ...f.selection, identity: { ...f.selection.identity, projectId: "B" }, archive: { ...f.archive,
      descriptor: { ...f.archive.descriptor, projectId: "B" },
      snapshot: { ...f.archive.snapshot, run: { ...f.archive.snapshot.run, projectId: "B" } } } };
    view.rerender(element(f, other)); await screen.findByRole("article", { name: "Search match" });
    fireEvent.click(screen.getByRole("button", { name: "Search messages in this project" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Verify and open archive" })).toBeNull();
  });
  it.each(["search", "open"])("ignores a late %s after changing projects", async stage => {
    const f = await fixture(), view = setup(f); await enterSearch();
    const original = f.invoke.getMockImplementation()!, late = deferred<Awaited<ReturnType<typeof original>>>();
    if (stage === "open") { submit(); await screen.findByRole("button", { name: "Verify and open archive" }); }
    f.invoke.mockImplementation(async (command, args) => command === (stage === "search" ? "search_native_run_history" : "snapshot_native_run_store") ? late.promise : original(command, args));
    if (stage === "search") submit(); else fireEvent.click(screen.getByRole("button", { name: "Verify and open archive" }));
    view.rerender(element(f, null, "B"));
    await act(async () => late.resolve(stage === "open" ? f.raw : { schemaVersion: 1, projectId: "A", query: "Exact", offset: 0, limit: 30, hasMore: false, messages: [f.hit] }));
    expect(screen.queryByRole("article", { name: "Search match" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    f.invoke.mockImplementation(original); view.rerender(element(f, null, "A")); await enterSearch();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Verify and open archive" })).toBeNull();
  });
  it.each(["search", "open"])("invalidates a pending %s when closing search, while retaining the query", async stage => {
    const f = await fixture(); setup(f); await enterSearch();
    const original = f.invoke.getMockImplementation()!, late = deferred<Awaited<ReturnType<typeof original>>>();
    if (stage === "open") { submit(); await screen.findByRole("button", { name: "Verify and open archive" }); }
    f.invoke.mockImplementation(async (command, args) => command === (stage === "search" ? "search_native_run_history" : "snapshot_native_run_store") ? late.promise : original(command, args));
    if (stage === "search") submit(); else fireEvent.click(screen.getByRole("button", { name: "Verify and open archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => late.resolve(stage === "open" ? f.raw : { schemaVersion: 1, projectId: "A", query: "Exact", offset: 0, limit: 30, hasMore: false, messages: [f.hit] }));
    expect(screen.queryByRole("article", { name: "Search match" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search messages in this project" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Exact");
    expect(screen.queryByRole("article", { name: "Verified matching message" })).toBeNull();
    expect((screen.getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
