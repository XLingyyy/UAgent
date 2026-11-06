import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { I18nProvider, createLocaleStore } from "../i18n";
import { createNativeRunHistory, type NativeRunArchive } from "../runtime/native-run-history";
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
    if (command === "search_native_run_history") { const input = args.input as { projectId: string; query: string; offset: number; limit: number }; return { schemaVersion: 1, ...input, hasMore: false, messages: [hit] }; }
    throw Error("Unexpected non-read command: " + command);
  });
  const history = createNativeRunHistory(invoke), archive = await history.snapshot("A", "run");
  const selection: NativeHistorySearchSelection = { archive, messageId: "message-1", identity: { projectId: "A", sessionId: "session", runId: "run", revision: 1 } };
  return { history, archive, selection, invoke };
}
function element(f: Awaited<ReturnType<typeof fixture>>, selection: NativeHistorySearchSelection | null = f.selection, projectId = "A", onContinue = vi.fn(), locale: "en" | "zh-CN" = "en") {
  return <I18nProvider store={createLocaleStore({ initialLocale: locale, storage: null })}><RunHistoryPanel history={f.history} projectId={projectId} initialSelection={selection} onContinue={onContinue} /></I18nProvider>;
}
async function match() { return screen.findByRole("article", { name: "Search match" }); }

describe("history search match navigation", () => {
  it.each(["user", "assistant", "tool"] as const)("focuses the exact %s body without using filtered message position", async role => {
    const f = await fixture(role), onContinue = vi.fn(); render(element(f, f.selection, "A", onContinue));
    const target = await match(); expect(document.activeElement).toBe(target);
    expect(target.querySelector("pre")?.textContent).toBe(f.archive.providerMessages[1].content);
    expect(within(target).getByText("Message: message-1")).toBeTruthy();
    expect(within(target).getByText("Role: " + role)).toBeTruthy();
    expect(target.querySelector("img")).toBeNull(); expect(onContinue).not.toHaveBeenCalled();
  });
  it("keeps the verified hit when the real search view hands navigation back to the archive", async () => {
    const f = await fixture("tool"), onContinue = vi.fn();
    vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("__TAURI_INTERNALS__", { invoke: f.invoke });
    render(element(f, null, "A", onContinue));
    fireEvent.click(await screen.findByRole("button", { name: /Stored task/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Search messages in this project" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Search messages in this project" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Exact" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Verify and open archive" }));
    const target = await match(); expect(document.activeElement).toBe(target);
    expect(target.querySelector("pre")?.textContent).toBe(f.archive.providerMessages[1].content);
    expect(screen.queryByRole("searchbox")).toBeNull(); expect(onContinue).not.toHaveBeenCalled();
    expect(f.invoke.mock.calls.every(([command]) => ["list_native_run_history", "snapshot_native_run_store", "search_native_run_history"].includes(command))).toBe(true);
  });
  it.each(["refresh", "record", "project"])("clears the old match on %s changes", async change => {
    const f = await fixture(), view = render(element(f)); await match();
    if (change === "project") view.rerender(element(f, f.selection, "B"));
    else if (change === "refresh") { await waitFor(() => expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole("button", { name: "Refresh" })); }
    else fireEvent.click(await screen.findByRole("button", { name: /Stored task/ }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Search match" })).toBeNull());
  });
  it.each(["missing", "identity", "duplicate"])("shows an explicit %s target failure instead of another body", async kind => {
    const f = await fixture();
    const selection = { ...f.selection, identity: { ...f.selection.identity }, archive: { ...f.archive, messages: [...f.archive.messages] } };
    if (kind === "missing") selection.messageId = "not-in-archive";
    if (kind === "identity") selection.identity.sessionId = "other-session";
    if (kind === "duplicate") selection.archive.messages.push({ ...selection.archive.messages[1] });
    render(element(f, selection));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot be located");
    expect(screen.queryByRole("article", { name: "Search match" })).toBeNull();
  });
  it("does not let an older record load replace a newer verified search hit", async () => {
    const f = await fixture(); let resolve!: (archive: NativeRunArchive) => void;
    f.history.snapshot = vi.fn(() => new Promise<NativeRunArchive>(done => { resolve = done; }));
    const view = render(element(f, null)); fireEvent.click(await screen.findByRole("button", { name: /Stored task/ }));
    view.rerender(element(f)); await match();
    await act(async () => resolve({ ...f.archive, providerMessages: [{ role: "user", content: "Late wrong archive" }] }));
    expect((await match()).querySelector("pre")?.textContent).toBe(f.archive.providerMessages[1].content);
  });
  it("uses the existing Chinese locale for the focused match", async () => {
    const f = await fixture(); render(element(f, f.selection, "A", vi.fn(), "zh-CN"));
    const target = await screen.findByRole("article", { name: "搜索命中的消息" });
    expect(document.activeElement).toBe(target); expect(within(target).getByText("消息：message-1")).toBeTruthy();
  });
});
