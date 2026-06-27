import {
  createEventId,
  type RuntimeClient,
  type RuntimeSnapshot,
  type TaskDraft,
  type TaskRecord,
} from "@uagent/shared";
import type { ApprovalDecisionValue } from "@uagent/shared";
import type { McpReadOnlyRuntimeClient } from "./mcp-readonly-runtime.js";

export interface RuntimeRouterOptions {
  mockRuntime: RuntimeClient;
  mcpRuntime: McpReadOnlyRuntimeClient | null;
}

export function createRuntimeRouter(options: RuntimeRouterOptions): RuntimeClient {
  let snapshot: RuntimeSnapshot = options.mockRuntime.getSnapshot();
  const listeners = new Set<(nextSnapshot: RuntimeSnapshot) => void>();
  const fallbackEventsByTaskId = new Map<string, RuntimeSnapshot["eventsByTaskId"][string][number]>();

  function publish(nextSnapshot: RuntimeSnapshot) {
    snapshot = mergeFallbackEvents(nextSnapshot);
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function mergeFallbackEvents(nextSnapshot: RuntimeSnapshot): RuntimeSnapshot {
    let changed = false;
    const eventsByTaskId = { ...nextSnapshot.eventsByTaskId };
    for (const [taskId, fallbackEvent] of fallbackEventsByTaskId) {
      const events = eventsByTaskId[taskId] ?? [];
      if (!events.some((event) => event.type === "mcp_fallback_to_mock")) {
        eventsByTaskId[taskId] = [fallbackEvent, ...events];
        changed = true;
      }
    }
    return changed ? { ...nextSnapshot, eventsByTaskId } : nextSnapshot;
  }

  options.mockRuntime.subscribe(publish);
  options.mcpRuntime?.subscribe(publish);

  return {
    async submitTask(draft: TaskDraft): Promise<TaskRecord> {
      if (options.mcpRuntime) {
        const record = await options.mcpRuntime.submitTask(draft);
        snapshot = options.mcpRuntime.getSnapshot();
        return record;
      }

      const record = await options.mockRuntime.submitTask(draft);
      const mockSnapshot = options.mockRuntime.getSnapshot();
      const fallbackEvent = {
        id: createEventId(record.id, 0),
        taskId: record.id,
        type: "mcp_fallback_to_mock" as const,
        title: "MCP fallback to MockRuntime",
        body: "No MCP read-only runtime is connected; task used MockRuntime fallback.",
        level: "warning" as const,
        createdAt: record.createdAt,
      };
      fallbackEventsByTaskId.set(record.id, fallbackEvent);
      snapshot = mergeFallbackEvents(mockSnapshot);
      publish(snapshot);
      return record;
    },
    async cancelTask(taskId: string): Promise<void> {
      const client = options.mcpRuntime ?? options.mockRuntime;
      await client.cancelTask(taskId);
      snapshot = mergeFallbackEvents(client.getSnapshot());
    },
    async submitApprovalDecision(taskId: string, stepId: string | null, decision: ApprovalDecisionValue, actor: string, reason: string): Promise<void> {
      const client = options.mcpRuntime ?? options.mockRuntime;
      if (client.submitApprovalDecision) {
        await client.submitApprovalDecision(taskId, stepId, decision, actor, reason);
        snapshot = client.getSnapshot();
      }
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
