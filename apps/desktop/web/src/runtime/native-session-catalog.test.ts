import { describe, expect, it, vi } from "vitest";
import { createNativeSessionCatalog, type NativeCatalogSession } from "./native-session-catalog";
function saved(overrides: Partial<NativeCatalogSession> = {}): NativeCatalogSession {
  return { projectId: "A", id: "session", title: "Alpha", createdAt: 1, archived: false, parentId: null, origin: "native", messageCount: 1, lastOrdinal: 1, latestRunId: "run", ...overrides };
}
const page = (sessions = [saved()]) => ({ schemaVersion: 1, projectId: "A", requestId: "req", includeArchived: false, offset: 0, limit: 30, hasMore: false, sessions });
const mutation = (session = saved()) => ({ schemaVersion: 1, projectId: "A", requestId: "req", session, requiresFreshAuthorization: true });
const message = (body = "全文\0🙂" + "complete text".repeat(3000)) => ({ projectId: "A", sessionId: "session", id: "message", ordinal: 1, role: "user", body, createdAt: 1, origin: "native" });

describe("native session catalog boundary", () => {
  it("lists one project with explicit paging and only returns descriptive fields", async () => {
    const invoke = vi.fn(async () => page());
    const value = await createNativeSessionCatalog(invoke).list({ projectId: "A", requestId: "req" });
    expect(invoke).toHaveBeenCalledWith("list_native_session_catalog", { input: { schemaVersion: 1, projectId: "A", requestId: "req", includeArchived: false, offset: 0, limit: 30 } });
    expect(value.sessions).toEqual([saved()]);
    expect(JSON.stringify(value)).not.toMatch(/scope|approval|executionToken|apiKey/);
  });
  it("rejects invalid IDs, byte lengths and unsafe ordinals before invoking native code", async () => {
    const invoke = vi.fn(async () => null), port = createNativeSessionCatalog(invoke);
    await expect(port.list({ projectId: "A\0" })).rejects.toThrow("invalid_record");
    await expect(port.list({ projectId: "A", limit: 51 })).rejects.toThrow("invalid_record");
    await expect(port.update({ projectId: "A", sessionId: "session", patch: { kind: "rename", title: "中".repeat(342), expectedTitle: "Alpha" } })).rejects.toThrow("invalid_record");
    await expect(port.branch({ projectId: "A", sessionId: "session", newSessionId: "new", title: "Title", throughOrdinal: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow("invalid_record");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects cross-project, duplicate, hidden archived and incomplete pages", async () => {
    for (const output of [page([saved({ projectId: "B" })]), page([saved(), saved()]), page([saved({ archived: true })]), { ...page([]), hasMore: true }]) {
      await expect(createNativeSessionCatalog(async () => output).list({ projectId: "A", requestId: "req" })).rejects.toThrow("invalid_record");
    }
  });
  it("verifies update identity, title, origin and fresh authority marker", async () => {
    const input = { projectId: "A", requestId: "req", sessionId: "session", patch: { kind: "rename" as const, title: "New", expectedTitle: "Alpha" } };
    const invoke = vi.fn(async () => mutation(saved({ title: "New", archived: true })));
    expect((await createNativeSessionCatalog(invoke).update(input)).session.title).toBe("New");
    for (const output of [mutation(saved({ title: "Old", archived: true })), mutation(saved({ title: "New", archived: true, origin: "historicalTextCopy" })), { ...mutation(saved({ title: "New", archived: true })), requiresFreshAuthorization: false }]) {
      await expect(createNativeSessionCatalog(async () => output).update(input)).rejects.toThrow("invalid_record");
    }
  });
  it("verifies branch parent, prefix, native origin and absence of a copied run", async () => {
    const input = { projectId: "A", requestId: "req", sessionId: "session", newSessionId: "new", title: "Branch", throughOrdinal: 1 };
    const branched = saved({ id: "new", title: "Branch", parentId: "session", latestRunId: null });
    expect((await createNativeSessionCatalog(async () => mutation(branched)).branch(input)).session).toEqual(branched);
    for (const output of [saved({ ...branched, parentId: "wrong" }), saved({ ...branched, lastOrdinal: 2 }), saved({ ...branched, latestRunId: "copied-run" })]) {
      await expect(createNativeSessionCatalog(async () => mutation(output)).branch(input)).rejects.toThrow("invalid_record");
    }
  });
  it("preserves complete Unicode/NUL text and origin in bounded session reads", async () => {
    const exact = message(), output = { ...mutation(), throughOrdinal: 1, prefixMessageCount: 1, messages: [exact] };
    const result = await createNativeSessionCatalog(async () => output).read({ projectId: "A", requestId: "req", sessionId: "session", throughOrdinal: 1 });
    expect(result.messages[0].body).toBe(exact.body);
    expect(result.requiresFreshAuthorization).toBe(true);
    expect(result).not.toHaveProperty("scope");
  });
  it("rejects truncated, duplicate, cross-project and oversized message reads", async () => {
    const base = { ...mutation(), throughOrdinal: 1, prefixMessageCount: 1, messages: [message()] };
    for (const output of [{ ...base, messages: [] }, { ...base, messages: [message(), message()] }, { ...base, messages: [{ ...message(), projectId: "B" }] }, { ...base, messages: [message("x".repeat(256 * 1024 + 1))] }]) {
      await expect(createNativeSessionCatalog(async () => output).read({ projectId: "A", requestId: "req", sessionId: "session", throughOrdinal: 1 })).rejects.toThrow("invalid_record");
    }
  });
  it("captures mutable request identities before awaiting IPC", async () => {
    let resolve!: (value: unknown) => void;
    const invoke = vi.fn((_command: string, _args: { input: unknown }) => new Promise<unknown>(done => { resolve = done; }));
    const input = { projectId: "A", requestId: "req", sessionId: "session", patch: { kind: "rename" as const, title: "New", expectedTitle: "Alpha" } };
    const pending = createNativeSessionCatalog(invoke).update(input);
    input.projectId = "B"; input.sessionId = "other"; input.patch.title = "Changed";
    resolve(mutation(saved({ title: "New" })));
    expect((await pending).projectId).toBe("A");
    expect(invoke.mock.calls[0][1]).toEqual({ input: { schemaVersion: 1, projectId: "A", requestId: "req", sessionId: "session", patch: { kind: "rename", title: "New", expectedTitle: "Alpha" } } });
  });
  it("fails explicitly when the native bridge is unavailable", async () => {
    await expect(createNativeSessionCatalog(null).list({ projectId: "A" })).rejects.toThrow("native_session_catalog_unavailable");
  });
  it("sends only an archive patch and preserves the returned concurrent name", async () => {
    const invoke = vi.fn(async () => mutation(saved({ title: "Renamed elsewhere", archived: true })));
    const result = await createNativeSessionCatalog(invoke).update({ projectId: "A", requestId: "req", sessionId: "session", patch: { kind: "setArchived", archived: true, expectedArchived: false } });
    expect(result.session.title).toBe("Renamed elsewhere");
    expect(invoke).toHaveBeenCalledWith("update_native_session_catalog", { input: { schemaVersion: 1, projectId: "A", requestId: "req", sessionId: "session", patch: { kind: "setArchived", archived: true, expectedArchived: false } } });
  });
  it("rejects tail-only and missing-middle prefixes even if their final ordinal matches", async () => {
    const rows = [1, 2, 3].map(ordinal => ({ ...message("complete"), id: "m" + ordinal, ordinal }));
    const base = { ...mutation(saved({ messageCount: 3, lastOrdinal: 3 })), throughOrdinal: 3, prefixMessageCount: 3, messages: rows };
    for (const output of [{ ...base, messages: [rows[2]] }, { ...base, messages: [rows[0], rows[2]] }, { ...base, prefixMessageCount: 1, messages: [rows[2]] }, { ...base, prefixMessageCount: 2, messages: [rows[0], rows[2]] }]) {
      await expect(createNativeSessionCatalog(async () => output).read({ projectId: "A", requestId: "req", sessionId: "session", throughOrdinal: 3 })).rejects.toThrow("invalid_record");
    }
    expect((await createNativeSessionCatalog(async () => base).read({ projectId: "A", requestId: "req", sessionId: "session", throughOrdinal: 3 })).messages).toHaveLength(3);
  });
  it("accepts complete sparse prefixes and requires the total count for the full session", async () => {
    const rows = [2, 5, 9].map(ordinal => ({ ...message("sparse"), id: "m" + ordinal, ordinal }));
    const base = mutation(saved({ messageCount: 3, lastOrdinal: 9 }));
    const prefix = { ...base, throughOrdinal: 5, prefixMessageCount: 2, messages: rows.slice(0, 2) };
    expect((await createNativeSessionCatalog(async () => prefix).read({ projectId: "A", requestId: "req", sessionId: "session", throughOrdinal: 5 })).messages.map(value => value.ordinal)).toEqual([2, 5]);
    const all = { ...base, throughOrdinal: 9, prefixMessageCount: 3, messages: rows };
    expect((await createNativeSessionCatalog(async () => all).read({ projectId: "A", requestId: "req", sessionId: "session", throughOrdinal: 9 })).prefixMessageCount).toBe(3);
  });
  it("scopes cancellation to the exact native project and request", async () => {
    const invoke = vi.fn(async () => ({ schemaVersion: 1, projectId: "A", requestId: "req", cancellationRequested: true }));
    expect((await createNativeSessionCatalog(invoke).cancel({ projectId: "A", requestId: "req" })).cancellationRequested).toBe(true);
    expect(invoke).toHaveBeenCalledWith("cancel_native_session_catalog", { input: { schemaVersion: 1, projectId: "A", requestId: "req" } });
    await expect(createNativeSessionCatalog(async () => ({ schemaVersion: 1, projectId: "B", requestId: "req", cancellationRequested: true })).cancel({ projectId: "A", requestId: "req" })).rejects.toThrow("invalid_record");
  });
});
