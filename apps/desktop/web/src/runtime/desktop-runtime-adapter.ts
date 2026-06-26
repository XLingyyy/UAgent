import { createMockRuntime, type MockRuntimeClient } from "@uagent/runtime";
import type { RuntimeSnapshot, TaskDraft, TaskRecord } from "@uagent/shared";
import { DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS } from "./runtime-store";

export interface DesktopRuntimeAdapter {
  getSnapshot(): RuntimeSnapshot;
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  submitTask(draft: TaskDraft): Promise<TaskRecord>;
  cancelTask(taskId: string): Promise<void>;
}

export function createDesktopRuntimeAdapter(): DesktopRuntimeAdapter {
  const client: MockRuntimeClient = createMockRuntime({ clockStart: 1_000, autoFlush: false });
  const pendingFlushes = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<(snapshot: RuntimeSnapshot) => void>();

  const syncSnapshot = () => {
    const snapshot = client.getSnapshot();
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const clearFlush = (taskId: string) => {
    const pending = pendingFlushes.get(taskId);
    if (pending) {
      clearTimeout(pending);
      pendingFlushes.delete(taskId);
    }
  };

  const scheduleCompletion = (taskId: string) => {
    clearFlush(taskId);
    const timer = setTimeout(() => {
      pendingFlushes.delete(taskId);
      void client.flushAll(taskId).then(syncSnapshot);
    }, DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS);
    pendingFlushes.set(taskId, timer);
  };

  return {
    getSnapshot: () => client.getSnapshot(),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    submitTask: async (draft) => {
      const record = await client.submitTask(draft);
      await client.flushNextEvent(record.id);
      await client.flushNextEvent(record.id);
      syncSnapshot();
      scheduleCompletion(record.id);
      return record;
    },

    cancelTask: async (taskId) => {
      clearFlush(taskId);
      await client.cancelTask(taskId);
      syncSnapshot();
    },
  };
}
