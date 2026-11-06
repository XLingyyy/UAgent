import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore } from "../i18n";
import { createNativeSessionCatalog } from "../runtime/native-session-catalog";
import type { NativeRunStoreInvoke } from "../runtime/native-run-store";
import type { NativeCatalogSession, NativeSessionCatalogPort, NativeSessionMutation, NativeSessionPage, NativeSessionRecord } from "../runtime/native-session-catalog";
import { SessionCatalogPanel } from "./SessionCatalogPanel";
afterEach(cleanup);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const saved = (overrides: Partial<NativeCatalogSession> = {}): NativeCatalogSession => ({ projectId: "A", id: "session", title: "Alpha", createdAt: 1, archived: false, parentId: null, origin: "native", messageCount: 1, lastOrdinal: 1, latestRunId: "run", ...overrides });
const changed = (session: NativeCatalogSession, requestId = "synthetic"): NativeSessionMutation => ({ schemaVersion: 1 as const, projectId: session.projectId, requestId, session, requiresFreshAuthorization: true });
function fixture(initial = saved()) {
  let value = initial;
  const port: NativeSessionCatalogPort & { save: (saved: NativeCatalogSession) => void } = {
    save: saved => { value = saved; },
    list: vi.fn(async input => ({ schemaVersion: 1 as const, projectId: input.projectId, requestId: input.requestId ?? "synthetic", includeArchived: input.includeArchived ?? false, offset: input.offset ?? 0, limit: input.limit ?? 30, hasMore: false, sessions: (!value.archived || input.includeArchived) && input.projectId === value.projectId ? [value] : [] })),
    update: vi.fn(async input => { value = input.patch.kind === "rename" ? { ...value, title: input.patch.title } : { ...value, archived: input.patch.archived }; return changed(value, input.requestId); }),
    branch: vi.fn(async input => changed(saved({ id: input.newSessionId, parentId: input.sessionId, title: input.title, lastOrdinal: input.throughOrdinal, messageCount: input.throughOrdinal, latestRunId: null }), input.requestId)),
    read: vi.fn(async input => ({ ...changed(value, input.requestId), throughOrdinal: input.throughOrdinal, prefixMessageCount: 1, messages: [{ projectId: value.projectId, sessionId: value.id, id: "message", ordinal: 1, role: "user" as const, body: "Full saved text", createdAt: 1, origin: "native" as const }] })),
    cancel: vi.fn(async input => ({ schemaVersion: 1 as const, projectId: input.projectId, requestId: input.requestId, cancellationRequested: true })),
  };
  return port;
}
const locale = createLocaleStore({ initialLocale: "en", storage: null });
function element(port: NativeSessionCatalogPort, onContinue = vi.fn(), projectId: string | null = "A", onClose = vi.fn()) {
  return <I18nProvider store={locale}><SessionCatalogPanel projectId={projectId} catalog={port} onContinue={onContinue} onClose={onClose} /></I18nProvider>;
}
async function select() { fireEvent.click(await screen.findByRole("button", { name: /Alpha Native session|Alpha Historical text copy/ })); }

describe("session catalog panel", () => {
  it("saves rename once during duplicate submissions and exposes archived sessions", async () => {
    const port = fixture(), pending = deferred<NativeSessionMutation>();
    port.update = vi.fn(() => pending.promise);
    render(element(port)); await select();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "Renamed" } });
    const form = screen.getByRole("form", { name: "Rename" }); fireEvent.submit(form); fireEvent.submit(form);
    expect(port.update).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { port.save(saved({ title: "Renamed" })); pending.resolve(changed(saved({ title: "Renamed" }))); });
    expect(await screen.findByRole("heading", { name: "Renamed" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Include archived sessions"));
    await waitFor(() => expect(port.list).toHaveBeenLastCalledWith({ projectId: "A", requestId: expect.any(String), includeArchived: true, offset: 0, limit: 30 }));
  });
  it("shows save errors and retries a branch with the same ID", async () => {
    const port = fixture(); port.branch = vi.fn().mockRejectedValueOnce({ kind: "busy" }).mockRejectedValueOnce({ kind: "alreadyExists" });
    render(element(port)); await select(); fireEvent.click(screen.getByRole("button", { name: "Branch a message prefix" }));
    fireEvent.submit(await screen.findByRole("form", { name: "Branch a message prefix" }));
    expect((await screen.findByRole("alert")).textContent).toContain("busy");
    fireEvent.submit(await screen.findByRole("form", { name: "Branch a message prefix" }));
    await waitFor(() => expect(port.branch).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(port.branch).mock.calls;
    expect(calls[0][0].newSessionId).toBe(calls[1][0].newSessionId);
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
  });
  it("keeps historical copies read-only while allowing a new branch", async () => {
    const port = fixture(saved({ origin: "historicalTextCopy", latestRunId: null }));
    render(element(port)); await select();
    for (const name of ["Rename", "Archive", "Prepare continuation"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Branch a message prefix" }) as HTMLButtonElement).disabled).toBe(false);
    expect(port.update).not.toHaveBeenCalled();
  });
  it("ignores a late list response after project switching", async () => {
    const port = fixture(), stale = deferred<NativeSessionPage>();
    port.list = vi.fn(input => input.projectId === "A" ? stale.promise : Promise.resolve({ schemaVersion: 1 as const, projectId: "B", requestId: input.requestId ?? "synthetic", includeArchived: false, offset: 0, limit: 30, hasMore: false, sessions: [saved({ projectId: "B", title: "Beta" })] }));
    const view = render(element(port)); view.rerender(element(port, vi.fn(), "B"));
    expect(await screen.findByRole("button", { name: /Beta Native session/ })).toBeTruthy();
    await act(async () => stale.resolve({ schemaVersion: 1 as const, projectId: "A", requestId: "stale", includeArchived: false, offset: 0, limit: 30, hasMore: false, sessions: [saved()] }));
    expect(screen.queryByRole("button", { name: /Alpha Native session/ })).toBeNull();
  });
  it("cancels waiting without claiming the submitted write was rolled back", async () => {
    const port = fixture(), pending = deferred<NativeSessionMutation>(), onContinue = vi.fn();
    port.branch = vi.fn(() => pending.promise);
    render(element(port, onContinue)); await select(); fireEvent.click(screen.getByRole("button", { name: "Branch a message prefix" }));
    fireEvent.submit(screen.getByRole("form", { name: "Branch a message prefix" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel waiting" }));
    expect(port.cancel).toHaveBeenCalledWith({ projectId: "A", requestId: vi.mocked(port.branch).mock.calls[0][0].requestId });
    expect(screen.getByText(/submitted local operation may still save/)).toBeTruthy();
    await act(async () => pending.resolve(changed(saved({ id: "branch", title: "Late branch", parentId: "session", latestRunId: null }))));
    expect(screen.queryByRole("heading", { name: "Late branch" })).toBeNull();
    expect(onContinue).not.toHaveBeenCalled();
  });
  it("loads complete selected context for fresh task preparation without auto-running", async () => {
    const port = fixture(), onContinue = vi.fn(); render(element(port, onContinue)); await select();
    fireEvent.click(screen.getByLabelText("Use the complete saved messages as context for the new task"));
    fireEvent.click(screen.getByRole("button", { name: "Prepare continuation" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
    expect(port.read).toHaveBeenCalledWith({ projectId: "A", requestId: expect.any(String), sessionId: "session", throughOrdinal: 1 });
    expect(onContinue.mock.calls[0][0]).toMatchObject({ shareContext: true, requiresFreshAuthorization: true, messages: [{ body: "Full saved text" }] });
    expect(onContinue.mock.calls[0][0]).not.toHaveProperty("scope");
    expect(typeof onContinue.mock.calls[0][1]).toBe("function");
  });
  it("discards a late context read after Back and never calls continuation", async () => {
    const port = fixture(), read = deferred<NativeSessionRecord>(), onContinue = vi.fn(), close = vi.fn();
    port.read = vi.fn(() => read.promise);
    render(element(port, onContinue, "A", close)); await select();
    fireEvent.click(screen.getByLabelText("Use the complete saved messages as context for the new task"));
    fireEvent.click(screen.getByRole("button", { name: "Prepare continuation" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => read.resolve({ ...changed(saved()), throughOrdinal: 1, prefixMessageCount: 0, messages: [] }));
    expect(close).toHaveBeenCalledTimes(1); expect(onContinue).not.toHaveBeenCalled();
  });
  it("synchronizes a cancelled write from refresh before a later archive without reverting its name", async () => {
    const port = fixture(), pending = deferred<NativeSessionMutation>(), normalUpdate = port.update;
    port.update = vi.fn().mockImplementationOnce(() => pending.promise).mockImplementation(normalUpdate);
    render(element(port)); await select(); fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "Renamed after cancel" } });
    fireEvent.submit(screen.getByRole("form", { name: "Rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel waiting" }));
    await act(async () => { port.save(saved({ title: "Renamed after cancel" })); pending.resolve(changed(saved({ title: "Renamed after cancel" }))); });
    expect(await screen.findByRole("heading", { name: "Renamed after cancel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(port.update).toHaveBeenCalledTimes(2));
    expect(vi.mocked(port.update).mock.calls[1][0].patch).toEqual({ kind: "setArchived", archived: true, expectedArchived: false });
    const page = await port.list({ projectId: "A", includeArchived: true });
    expect(page.sessions[0]).toMatchObject({ title: "Renamed after cancel", archived: true });
  });
  it("refreshes conflict details and closes the stale editing form", async () => {
    const port = fixture();
    port.update = vi.fn(async () => { port.save(saved({ title: "Changed elsewhere" })); throw { kind: "conflict" }; });
    render(element(port)); await select(); fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "Stale edit" } });
    fireEvent.submit(screen.getByRole("form", { name: "Rename" }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed in another operation");
    expect(await screen.findByRole("heading", { name: "Changed elsewhere" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Rename" })).toBeNull();
  });
});


describe("saved session message viewing", () => {
  function record(session: NativeCatalogSession, requestId: string, body = "Saved body"): NativeSessionRecord {
    return { ...changed(session, requestId), throughOrdinal: session.lastOrdinal, prefixMessageCount: session.messageCount,
      messages: session.messageCount ? [{ projectId: session.projectId, sessionId: session.id, id: "message", ordinal: 1, role: "user", body, createdAt: 1, origin: session.origin }] : [] };
  }
  it.each(["native", "archived", "historical"])("reads %s sessions without a Run using the real IPC adapter and never mutates or continues", async kind => {
    const session = saved({ latestRunId: null, archived: kind === "archived", origin: kind === "historical" ? "historicalTextCopy" : "native", messageCount: 3, lastOrdinal: 3 });
    const commands: string[] = [];
    const invoke: NativeRunStoreInvoke = async <T,>(command: string, args?: Record<string, unknown>) => {
      commands.push(command);
      const input = args?.input as { requestId: string; includeArchived?: boolean };
      if (command === "list_native_session_catalog") return { schemaVersion: 1 as const, projectId: "A", requestId: input.requestId, includeArchived: input.includeArchived, offset: 0, limit: 30, hasMore: false, sessions: !session.archived || input.includeArchived ? [session] : [] } as T;
      if (command === "read_native_session_catalog") return { ...record(session, input.requestId), messages: ["user", "assistant", "tool"].map((role, index) => ({ projectId: "A", sessionId: session.id, id: "m" + index, ordinal: index + 1, role, body: index === 0 ? "<img src='https://invalid.test/no-request'>\n完整正文" : "saved-" + role, createdAt: 1, origin: session.origin })) } as T;
      if (command === "cancel_native_session_catalog") return { schemaVersion: 1 as const, projectId: "A", requestId: input.requestId, cancellationRequested: true } as T;
      throw Error("unexpected write/send command: " + command);
    };
    const onContinue = vi.fn(); render(element(createNativeSessionCatalog(invoke), onContinue));
    if (session.archived) fireEvent.click(screen.getByLabelText("Include archived sessions"));
    await select(); fireEvent.click(screen.getByRole("button", { name: "View messages" }));
    expect(await screen.findByText(/完整正文/)).toBeTruthy();
    const messages = screen.getByRole("region", { name: "Saved messages" });
    expect(Array.from(messages.querySelectorAll("pre")).map(node => node.textContent)).toEqual(["<img src='https://invalid.test/no-request'>\n完整正文", "saved-assistant", "saved-tool"]);
    expect(messages.querySelector("img")).toBeNull();
    expect(messages.textContent).toContain("User"); expect(messages.textContent).toContain("Assistant"); expect(messages.textContent).toContain("Tool");
    expect(onContinue).not.toHaveBeenCalled();
    expect(commands.every(command => ["list_native_session_catalog", "read_native_session_catalog", "cancel_native_session_catalog"].includes(command))).toBe(true);
  });
  it("shows an empty-session result and readable Chinese controls", async () => {
    const session = saved({ messageCount: 0, lastOrdinal: 0, latestRunId: null }), port = fixture(session);
    port.read = vi.fn(async input => record(session, input.requestId!));
    const zh = createLocaleStore({ initialLocale: "zh-CN", storage: null });
    render(<I18nProvider store={zh}><SessionCatalogPanel projectId="A" catalog={port} onContinue={vi.fn()} /></I18nProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Alpha 原生会话/ }));
    fireEvent.click(screen.getByRole("button", { name: "查看消息" }));
    expect(await screen.findByText("此会话没有已保存消息。")).toBeTruthy();
    expect(port.read).toHaveBeenCalledWith(expect.objectContaining({ throughOrdinal: 0 }));
  });
  it.each([{ kind: "branchCapacity", text: "exceeds" }, { kind: "offline", text: "unavailable" }])("shows $kind without partial text", async error => {
    const port = fixture(); port.read = vi.fn().mockRejectedValue({ kind: error.kind });
    render(element(port)); await select(); fireEvent.click(screen.getByRole("button", { name: "View messages" }));
    expect((await screen.findByRole("alert")).textContent).toContain(error.text);
    expect(screen.getByRole("region", { name: "Saved messages" }).querySelector("pre")).toBeNull();
  });
  it("cancels a read, switches sessions and rejects its late response", async () => {
    const port = fixture(), pending = deferred<NativeSessionRecord>(), second = saved({ id: "second", title: "Second" });
    port.list = vi.fn(async input => ({ schemaVersion: 1 as const, projectId: "A", requestId: input.requestId!, includeArchived: false, offset: 0, limit: 30, hasMore: false, sessions: [saved(), second] }));
    port.read = vi.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async input => record(second, input.requestId, "Second body"));
    render(element(port)); await select(); fireEvent.click(screen.getByRole("button", { name: "View messages" }));
    const oldId = vi.mocked(port.read).mock.calls[0][0].requestId!;
    fireEvent.click(screen.getByRole("button", { name: "Cancel waiting" }));
    expect(port.cancel).toHaveBeenCalledWith({ projectId: "A", requestId: oldId });
    expect(screen.getByText("Message reading cancelled.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Second Native session/ }));
    fireEvent.click(screen.getByRole("button", { name: "View messages" }));
    expect(await screen.findByText("Second body")).toBeTruthy();
    await act(async () => pending.resolve(record(saved(), oldId, "Stale first body")));
    expect(screen.queryByText("Stale first body")).toBeNull(); expect(screen.getByText("Second body")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Alpha Native session/ }));
    expect(screen.queryByText("Second body")).toBeNull();
  });
  it("isolates an in-flight read after a project switch and allows the new project to read", async () => {
    const port = fixture(), pending = deferred<NativeSessionRecord>(), onContinue = vi.fn();
    port.read = vi.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async input => record(saved({ projectId: "B", title: "Beta" }), input.requestId, "Project B body"));
    const view = render(element(port, onContinue)); await select(); fireEvent.click(screen.getByRole("button", { name: "View messages" }));
    const oldId = vi.mocked(port.read).mock.calls[0][0].requestId!;
    port.save(saved({ projectId: "B", title: "Beta" })); view.rerender(element(port, onContinue, "B"));
    fireEvent.click(await screen.findByRole("button", { name: /Beta Native session/ })); fireEvent.click(screen.getByRole("button", { name: "View messages" }));
    expect(await screen.findByText("Project B body")).toBeTruthy();
    await act(async () => pending.resolve(record(saved(), oldId, "Wrong project body")));
    expect(screen.queryByText("Wrong project body")).toBeNull(); expect(port.cancel).toHaveBeenCalledWith({ projectId: "A", requestId: oldId });
    expect(onContinue).not.toHaveBeenCalled();
  });
  it("discards a read after closing and rejects mismatched session identity", async () => {
    const port = fixture(), pending = deferred<NativeSessionRecord>(), close = vi.fn(); port.read = vi.fn(() => pending.promise);
    const view = render(element(port, vi.fn(), "A", close)); await select(); fireEvent.click(screen.getByRole("button", { name: "View messages" }));
    const requestId = vi.mocked(port.read).mock.calls[0][0].requestId!;
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => pending.resolve(record(saved(), requestId, "Late closed text")));
    expect(screen.queryByText("Late closed text")).toBeNull(); expect(close).toHaveBeenCalledTimes(1); view.unmount();
    const wrong = fixture(); wrong.read = vi.fn(async input => record(saved({ id: "other" }), input.requestId!, "Wrong identity"));
    render(element(wrong)); await select(); fireEvent.click(screen.getByRole("button", { name: "View messages" }));
    expect((await screen.findByRole("alert")).textContent).toContain("failed verification"); expect(screen.queryByText("Wrong identity")).toBeNull();
  });
});
