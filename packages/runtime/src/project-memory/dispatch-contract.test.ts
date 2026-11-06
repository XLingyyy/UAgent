import { describe, expect, it } from "vitest";
import {
  PROJECT_MEMORY_MESSAGE_PREFIX as PREFIX, PROJECT_MEMORY_RESPONSES_ENDPOINT as ENDPOINT,
  parseProjectMemoryActionReply, parseProjectMemoryBatchReceipt, parseProjectMemoryDispatchOwner,
  parseProjectMemoryPreparedReply, parseProjectMemorySelectedRevisions, parseProjectMemorySelectionReply,
  parseProjectMemoryUniqueJson, projectMemoryDispatchMembers, projectMemoryDispatchUtf8Bytes,
  validateProjectMemoryResponsesBody, type ProjectMemoryBatchReceipt,
} from "./dispatch-contract.js";

const owner = Object.freeze({ runHandle: "native-run", runId: "run", projectId: "A", projectEpoch: 7, providerId: "openai", modelId: "gpt-test" });
function row(id = "m", sources: unknown[] = []) {
  return { id, revision: 1, kind: "decision", body: "Complete synthetic memory text", sourceRefs: sources, origin: { kind: "user", sessionId: null, messageId: null }, confirmation: { kind: "user", confirmedAt: 1 }, readAt: 1 };
}
function source(projectId = "A", path = "Source/main.cpp") { return { projectId, path, version: "metadata:synthetic", kind: "file_preview" }; }
function batch(rows = [row()]): ProjectMemoryBatchReceipt {
  return { schemaVersion: 1, batchId: "a".repeat(32), projectId: "A", selected: rows.map(item => ({ id: item.id, revision: item.revision })), message: { role: "user", content: PREFIX + JSON.stringify(rows) }, sectionSha256: "b".repeat(64), maxContextBytes: 24576 };
}
function wire(receipt: ProjectMemoryBatchReceipt) {
  const message = (role: string, text: string) => ({ type: "message", role, content: [{ type: "input_text", text }] });
  return { model: owner.modelId, input: [message("system", "Original system"), message("developer", "Original developer"), message("user", receipt.message.content), message("user", "Original goal")], stream: true, store: false };
}
const invalid = (fn: () => unknown) => expect(fn).toThrow("project_memory_dispatch_invalid");

describe("project memory dispatch data contract (no native authority)", () => {
  it("preserves full native canonical text, ordered members and complete source metadata", () => {
    const original = batch([row("second", [source()]), row("first", [source("A", "Source/other.cpp")])]);
    const parsed = parseProjectMemoryBatchReceipt(original), members = projectMemoryDispatchMembers(parsed);
    expect(parsed.message.content).toBe(original.message.content);
    expect(members.map(item => item.id)).toEqual(["second", "first"]);
    expect(members[0]!.body).toBe("Complete synthetic memory text");
    expect(members[0]!.sourceRefs).toEqual([source()]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(members[0]!.sourceRefs[0])).toBe(true);
    (original.selected as Array<{ id: string; revision: number }>)[0] = { id: "modified", revision: 2 };
    expect(parsed.selected[0]!.id).toBe("second");
  });
  it("rejects serialized authority, incomplete shapes, inherited data and symbols", () => {
    invalid(() => parseProjectMemoryBatchReceipt({ ...batch(), permit: true }));
    invalid(() => parseProjectMemoryDispatchOwner({ ...owner, readPrefixes: [""] }));
    invalid(() => parseProjectMemoryDispatchOwner({ ...owner, projectEpoch: undefined }));
    invalid(() => parseProjectMemoryDispatchOwner(Object.create(owner)));
    invalid(() => parseProjectMemoryDispatchOwner({ ...owner, [Symbol("grant")]: true }));
  });
  it("does not execute data accessors or accept sparse/custom arrays", () => {
    let reads = 0;
    const hostile = { ...owner };
    Object.defineProperty(hostile, "projectId", { enumerable: true, get() { reads++; return "A"; } });
    invalid(() => parseProjectMemoryDispatchOwner(hostile));
    expect(reads).toBe(0);
    invalid(() => parseProjectMemorySelectedRevisions(new Array(1)));
    const hostileArray = [{ id: "m", revision: 1 }];
    Object.defineProperty(hostileArray, "0", { enumerable: true, get() { reads++; return { id: "m", revision: 1 }; } });
    invalid(() => parseProjectMemorySelectedRevisions(hostileArray));
    expect(reads).toBe(0);
  });
  it("rejects unsafe integers, scalar-invalid IDs and duplicate/reordered members", () => {
    for (const projectEpoch of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) invalid(() => parseProjectMemoryDispatchOwner({ ...owner, projectEpoch }));
    for (const projectId of ["", "a\0b", "\ud800", "界".repeat(86)]) invalid(() => parseProjectMemoryDispatchOwner({ ...owner, projectId }));
    invalid(() => parseProjectMemorySelectedRevisions([{ id: "m", revision: 0 }]));
    invalid(() => parseProjectMemorySelectedRevisions([{ id: "m", revision: 1 }, { id: "m", revision: 2 }]));
    const receipt = batch([row("a"), row("b")]);
    invalid(() => parseProjectMemoryBatchReceipt({ ...receipt, selected: [...receipt.selected].reverse() }));
    invalid(() => parseProjectMemorySelectedRevisions(Array.from({ length: 257 }, (_, n) => ({ id: `m${n}`, revision: 1 }))));
  });
  it("uses UTF-8 byte limits without trimming, normalizing or truncating text", () => {
    const rows = [row()]; rows[0]!.body = "界".repeat(2731);
    expect(projectMemoryDispatchUtf8Bytes(rows[0]!.body)).toBe(8193);
    invalid(() => parseProjectMemoryBatchReceipt(batch(rows)));
    const receipt = batch();
    invalid(() => parseProjectMemoryBatchReceipt({ ...receipt, maxContextBytes: projectMemoryDispatchUtf8Bytes(receipt.message.content) - 1 }));
    invalid(() => parseProjectMemoryBatchReceipt({ ...receipt, maxContextBytes: 24577 }));
  });
  it("preserves absent or exactly equal freshness and rejects malformed aliases without stripping them", () => {
    const original = source(), current = { ...original, freshness: original.version };
    const withFreshness = batch([row("m", [current])]);
    const parsed = parseProjectMemoryBatchReceipt(withFreshness);
    expect(parsed.message.content).toBe(withFreshness.message.content);
    expect(projectMemoryDispatchMembers(parsed)[0]!.sourceRefs).toEqual([current]);
    const without = projectMemoryDispatchMembers(parseProjectMemoryBatchReceipt(batch([row("m", [original])])))[0]!.sourceRefs[0]!;
    expect(Object.prototype.hasOwnProperty.call(without, "freshness")).toBe(false);
    expect(parsed.message.content).not.toBe(batch([row("m", [original])]).message.content);
    for (const freshness of ["", "old-stamp", "unknown", null, 1, "x".repeat(513)]) {
      invalid(() => parseProjectMemoryBatchReceipt(batch([row("m", [{ ...original, freshness }])])));
    }
    // JSON.stringify omits undefined object fields; test an actually malformed
    // canonical JSON value rather than falsely rejecting the accepted absent form.
    const explicitUndefined = withFreshness.message.content.replace('"freshness":"metadata:synthetic"', '"freshness":undefined');
    invalid(() => parseProjectMemoryBatchReceipt({ ...withFreshness, message: { role: "user", content: explicitUndefined } }));
    // Strict canonical source objects still reject authority or unknown fields.
    invalid(() => parseProjectMemoryBatchReceipt(batch([row("m", [{ ...current, permit: true }])])));
  });
  it("rejects unsupported, cross-project, mismatched freshness and malformed source descriptors", () => {
    for (const bad of [{ ...source(), projectId: "B" }, { ...source(), kind: "project_index" }, { ...source(), freshness: "unproved" }, { ...source(), path: "../secret" }, { ...source(), path: "CON.txt" }, { ...source(), path: "Source\\file.cpp" }, { ...source(), path: "Source/a~1.cpp" }]) {
      invalid(() => parseProjectMemoryBatchReceipt(batch([row("m", [bad])])));
    }
    const fact = { ...row(), kind: "fact" };
    invalid(() => parseProjectMemoryBatchReceipt(batch([fact])));
    invalid(() => parseProjectMemoryBatchReceipt(batch(Array.from({ length: 9 }, (_, n) => row(`m${n}`, Array.from({ length: 8 }, () => source()))))));
  });
  it("rejects missing confirmation, malformed provenance and wrong canonical identities", () => {
    invalid(() => parseProjectMemoryBatchReceipt(batch([{ ...row(), confirmation: null } as unknown as ReturnType<typeof row>])));
    invalid(() => parseProjectMemoryBatchReceipt(batch([{ ...row(), origin: { kind: "session", sessionId: null, messageId: null } }])));
    const receipt = batch();
    invalid(() => parseProjectMemoryBatchReceipt({ ...receipt, message: { role: "system", content: receipt.message.content } }));
    invalid(() => parseProjectMemoryBatchReceipt({ ...receipt, message: { role: "user", content: PREFIX + receipt.message.content } }));
    invalid(() => parseProjectMemorySelectionReply({ schemaVersion: 1, owner: { ...owner, runHandle: "other" }, expiresAt: 1000, batch: receipt }, owner));
    invalid(() => parseProjectMemorySelectionReply({ schemaVersion: 1, owner, expiresAt: 1000, batch: { ...receipt, projectId: "B" } }, owner));
  });
  it("rejects duplicate JSON keys at any depth, escaped keys, invalid scalars and depth overflow", () => {
    for (const text of ['{"input":[],"input":[]}', '{"input":[],"\\u0069nput":[]}', '{"x":{"text":"a","text":"b"}}', '[1,]', '{"x":1,}', '01', '1e999', '"\\ud800"', '{}{}']) invalid(() => parseProjectMemoryUniqueJson(text));
    invalid(() => parseProjectMemoryUniqueJson("[".repeat(66) + "0" + "]".repeat(66)));
    expect(parseProjectMemoryUniqueJson('{"__proto__":{"x":1},"valid":"\\ud834\\udd1e"}')).toEqual(JSON.parse('{"__proto__":{"x":1},"valid":"\\ud834\\udd1e"}'));
    expect(({} as { x?: number }).x).toBeUndefined();
  });
  it("accepts the exact Responses input[2] with preserved system/developer messages", () => {
    const receipt = parseProjectMemoryBatchReceipt(batch());
    expect(() => validateProjectMemoryResponsesBody(JSON.stringify(wire(receipt)), receipt, owner.modelId)).not.toThrow();
    const original = JSON.stringify(wire(receipt), null, 2);
    expect(() => validateProjectMemoryResponsesBody(original, receipt, owner.modelId)).not.toThrow();
  });
  it("rejects missing/double/wrong-slot/wrong-byte canonical segments and extra markers", () => {
    const receipt = batch(), original = wire(receipt);
    const missing = wire(receipt); missing.input.splice(2, 1);
    const doubled = wire(receipt); doubled.input.push(doubled.input[2]!);
    const moved = wire(receipt); [moved.input[2], moved.input[3]] = [moved.input[3]!, moved.input[2]!];
    const changed = wire(receipt); changed.input[2]!.content[0]!.text += " ";
    const embedded = { ...original, metadata: { summary: receipt.message.content } };
    const duplicate = JSON.stringify(original).replace('"model":', '"model":"other","model":');
    for (const body of [missing, doubled, moved, changed, embedded, { ...original, model: "other" }]) invalid(() => validateProjectMemoryResponsesBody(JSON.stringify(body), receipt, owner.modelId));
    invalid(() => validateProjectMemoryResponsesBody(duplicate, receipt, owner.modelId));
  });
  it("rejects full request and aggregate context overflow", () => {
    const receipt = batch();
    invalid(() => validateProjectMemoryResponsesBody(JSON.stringify({ ...wire(receipt), padding: "x".repeat(1048576) }), receipt, owner.modelId));
    invalid(() => validateProjectMemoryResponsesBody(JSON.stringify(wire(receipt)), { ...receipt, maxContextBytes: receipt.message.content.length }, owner.modelId));
    const tooMany = wire(receipt); tooMany.input.push(...Array.from({ length: 28 }, () => tooMany.input[3]!));
    invalid(() => validateProjectMemoryResponsesBody(JSON.stringify(tooMany), receipt, owner.modelId));
  });
  it("binds prepared replies to original owner/batch, complete body bytes and deadline", () => {
    const receipt = batch(), selected = { schemaVersion: 1 as const, owner, expiresAt: 1000, batch: receipt }, body = JSON.stringify(wire(receipt));
    const reply = { schemaVersion: 1, owner, expiresAt: 900, batchId: receipt.batchId, requestId: "request", endpoint: ENDPOINT, body, bodySha256: "c".repeat(64) };
    expect(parseProjectMemoryPreparedReply(reply, selected, body).body).toBe(body);
    for (const bad of [{ ...reply, body: body + " " }, { ...reply, expiresAt: 1001 }, { ...reply, batchId: "d".repeat(32) }, { ...reply, owner: { ...owner, projectEpoch: 8 } }, { ...reply, endpoint: "https://example.invalid" }, { ...reply, permit: true }]) invalid(() => parseProjectMemoryPreparedReply(bad, selected, body));
  });
  it("requires terminal exact-operation proofs and distinguishes admission from sending", () => {
    const reply = { schemaVersion: 1, owner, batchId: "a".repeat(32), requestId: "request", action: "scheduled", dispatchStatus: "mayHaveBeenSent", terminal: false, reason: null };
    expect(parseProjectMemoryActionReply(reply, owner, reply.batchId, reply.requestId).dispatchStatus).toBe("mayHaveBeenSent");
    for (const bad of [{ ...reply, dispatchStatus: "sent" }, { ...reply, action: "rejected" }, { ...reply, action: "cancelled", reason: "cancelled" }, { ...reply, requestId: "other" }, { ...reply, owner: { ...owner, runHandle: "other" } }]) invalid(() => parseProjectMemoryActionReply(bad, owner, reply.batchId, reply.requestId));
    const stale = { ...reply, action: "rejected", reason: "stale", terminal: true, dispatchStatus: "notDispatched" };
    expect(parseProjectMemoryActionReply(stale, owner, reply.batchId, reply.requestId).reason).toBe("stale");
    const afterAdmission = { ...stale, reason: "cleanupFailed", dispatchStatus: "mayHaveBeenSent" };
    expect(parseProjectMemoryActionReply(afterAdmission, owner, reply.batchId, reply.requestId).dispatchStatus).toBe("mayHaveBeenSent");
  });
});