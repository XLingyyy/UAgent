import type { OrdinaryChatArchive, OrdinaryChatArchiveInput, OrdinaryChatRequestArchive } from "@uagent/runtime";
import type { NativeInvoke } from "./project-native-adapter";

const unavailable = () => Error("discussion_archive_unavailable");
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 256 &&
  !Array.from(value).some(character => { const code=character.codePointAt(0)!; return code<=31 || (code>=127 && code<=159); });
type Entry = { handle: string; revision: number; messageCount: number };
/** The handles only write app-owned records. They never authorize transport or a tool. */
export function createNativeOrdinaryChatArchive(invoke: NativeInvoke): OrdinaryChatArchive {
  let closed = false, poisoned = false, closing: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const entries = new Map<string, Entry>();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  async function call(command: string, input: unknown): Promise<unknown> {
    try { return await invoke(command, { input }); }
    catch { poisoned = true; throw unavailable(); }
  }
  function ack(entry: Entry, value: unknown) {
    const v = value as {revision?: number; messageCount?: number};
    if (!v || !Number.isSafeInteger(v.revision) || !Number.isSafeInteger(v.messageCount) ||
        v.revision! < entry.revision || v.messageCount! < entry.messageCount) {
      poisoned = true; throw unavailable();
    }
    entry.revision = v.revision!; entry.messageCount = v.messageCount!;
  }
  async function mutate(entry: Entry, mutation: unknown) {
    ack(entry, await call("mutate_native_discussion_archive", {
      schemaVersion: 1, archiveHandle: entry.handle, mutation,
    }));
  }
  return {
    async open(input: OrdinaryChatArchiveInput): Promise<OrdinaryChatRequestArchive> {
      input = { ...input, messages: input.messages.map(message => ({role:message.role,content:message.content})) };
      if (closed || poisoned || input.providerId !== "deepseek" || input.modelId !== "deepseek-flash" ||
          !validId(input.conversationId) || !validId(input.requestId) ||
          (input.projectId !== null && !validId(input.projectId))) throw unavailable();
      // Freeze the observed wire text; later caller edits cannot alter the saved request.
      const messages = input.messages.map(m => ({ role: m.role, content: m.content }));
      if (!messages.length || messages.some(m => !["system","developer","user","assistant"].includes(m.role) || typeof m.content !== "string")) throw unavailable();
      const key = JSON.stringify([input.projectId,input.conversationId,input.providerId,input.modelId]);
      const entry = await enqueue(async () => {
        if (closed || poisoned) throw unavailable();
        let entry = entries.get(key);
        if (!entry) {
          const value = await call("open_native_discussion_archive", {
            schemaVersion: 1, providerId: input.providerId, modelId: input.modelId,
            conversationId: input.conversationId, logicalProjectId: input.projectId,
          }) as {schemaVersion?: number; archiveHandle?: string; projectId?: string; runId?: string};
          const project = input.projectId === null ? "chat:local" : "chat:project:" + input.projectId;
          if (!value || value.schemaVersion !== 1 || !validId(value.archiveHandle) ||
              !validId(value.runId) || value.projectId !== project) { poisoned = true; throw unavailable(); }
          entry = {handle: value.archiveHandle, revision: 0, messageCount: 0};
          entries.set(key, entry);
        }
        if (closed) throw unavailable(); // close() will drain any already-created handle.
        await mutate(entry, {kind:"begin",requestId:input.requestId,messages});
        return entry;
      });
      let index = 0, terminal: "received" | "completed" | "failed" | null = null;
      return {
        append(text) { return enqueue(async () => {
          if (closed || poisoned || terminal) throw unavailable();
          if (!text) return;
          await mutate(entry, {kind:"delta",requestId:input.requestId,index,text}); index++;
        }); },
        complete(text, usage) { return enqueue(async () => {
          if (closed || poisoned || terminal) throw unavailable();
          await mutate(entry, {kind:"complete",requestId:input.requestId,text,usage});
          terminal = "received";
        }); },
        confirmDelivery() { return enqueue(async () => {
          if (closed || poisoned || (terminal !== "received" && terminal !== "completed")) throw unavailable();
          if (terminal === "completed") return;
          await mutate(entry, {kind:"confirmDelivery",requestId:input.requestId});
          terminal = "completed";
        }); },
        fail(cancelled) {
          if (closed) return closing ?? Promise.resolve();
          return enqueue(async () => {
            if (terminal === "failed") return;
            await mutate(entry, {kind:"fail",requestId:input.requestId,cancelled});
            terminal = "failed";
          });
        },
      };
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = enqueue(async () => {
        let failed = false;
        for (const entry of entries.values()) {
          try { ack(entry, await call("close_native_discussion_archive", {schemaVersion:1,archiveHandle:entry.handle})); }
          catch { failed = true; }
        }
        entries.clear();
        if (failed) throw unavailable();
      });
      return closing;
    },
  };
}
