import {
  createEmptyRuntimeSnapshot,
  createEventId,
  createEvidenceId,
  createTaskId,
  createTaskTitle,
  isTerminalTaskState,
  type McpDiscoverySnapshot,
  type RuntimeClient,
  type RuntimeSnapshot,
  type TaskDraft,
  type TaskEvent,
  type TaskEventLevel,
  type TaskEventType,
  type TaskRecord,
} from "@uagent/shared";
import { applyTaskEvent } from "./task-event-reducer.js";
import { classifyMcpToolRisk } from "./mcp-readonly-policy.js";
import { createSemanticCapabilityIndex } from "./mcp-semantic-index.js";

export interface McpReadOnlyRuntimeOptions {
  discovery: McpDiscoverySnapshot;
  readResource?: (uri: string) => Promise<unknown>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  clockStart?: number;
}

export interface McpReadOnlyRuntimeClient extends RuntimeClient {
  disconnect(): void;
}

export function createMcpReadOnlyRuntime(options: McpReadOnlyRuntimeOptions): McpReadOnlyRuntimeClient {
  let sequence = 0;
  let eventSequence = 0;
  let evidenceSequence = 0;
  let clock = options.clockStart ?? Date.now();
  let snapshot = createEmptyRuntimeSnapshot();
  const listeners = new Set<(nextSnapshot: RuntimeSnapshot) => void>();
  const semanticIndex = createSemanticCapabilityIndex(options.discovery);

  function nextTime(): number {
    const time = clock;
    clock += 1;
    return time;
  }

  function emit(
    taskId: string,
    type: TaskEventType,
    title: string,
    body: string,
    level: TaskEventLevel = "info",
    payload?: unknown,
  ): TaskEvent {
    eventSequence += 1;
    const event: TaskEvent = {
      id: createEventId(taskId, eventSequence),
      taskId,
      type,
      title,
      body,
      level,
      createdAt: nextTime(),
      payload,
    };
    snapshot = applyTaskEvent(snapshot, event);
    for (const listener of listeners) {
      listener(snapshot);
    }
    return event;
  }

  return {
    async submitTask(draft: TaskDraft): Promise<TaskRecord> {
      sequence += 1;
      eventSequence = 0;
      const taskId = createTaskId(sequence);
      const createdAt = draft.createdAt ?? nextTime();
      const normalizedDraft = { ...draft, createdAt };
      snapshot = {
        ...snapshot,
        status: "running",
        activeTaskId: taskId,
        tasksById: {
          ...snapshot.tasksById,
          [taskId]: {
            id: taskId,
            title: createTaskTitle(draft.input),
            state: "submitted",
            draft: normalizedDraft,
            createdAt,
            updatedAt: createdAt,
            completedAt: null,
            error: null,
          },
        },
      };
      emit(taskId, "task_submitted", "User request", draft.input, "info", { draft: normalizedDraft });
      emit(taskId, "mcp_discovery_started", "MCP discovery started", "Using cached MCP discovery for read-only routing.");
      emit(
        taskId,
        "mcp_discovery_completed",
        "MCP discovery completed",
        semanticIndex.getSummary().join(", "),
        "success",
        { discovery: options.discovery },
      );

      const resolved = semanticIndex.resolveIntent(draft.input);
      if (resolved.kind === "blocked_tool") {
        emit(taskId, "mcp_tool_blocked", "MCP tool blocked", resolved.reason, "warning", {
          toolName: resolved.name,
        });
        emit(taskId, "review_created", "Review summary", "Blocked a mutating MCP tool and preserved read-only runtime boundaries.");
        emit(taskId, "task_completed", "Task completed", "Blocked MCP tool; task completed in blocked state.", "success");
        return snapshot.tasksById[taskId];
      }
      if (resolved.kind === "unresolved") {
        emit(taskId, "task_failed", "Task failed", resolved.reason, "error");
        return snapshot.tasksById[taskId];
      }

      emit(taskId, "mcp_read_started", "MCP read started", resolved.title);
      const result =
        resolved.kind === "resource"
          ? await (options.readResource?.(resolved.uri) ?? Promise.resolve({ uri: resolved.uri, text: "No fixture reader configured." }))
          : await callAllowedTool(options, resolved.name);
      emit(taskId, "mcp_read_completed", "MCP read completed", summarizeResult(result), "success", {
        result,
      });
      emit(taskId, "evidence_created", "Evidence created", "MCP read-only result attached as task evidence.", "success", {
        evidence: {
          id: createEvidenceId(++evidenceSequence),
          taskId,
          kind: "tool_result",
          title: "MCP read-only evidence",
          summary: summarizeResult(result),
          source: "mcp-readonly",
          createdAt: clock,
        },
      });
      emit(taskId, "review_created", "Review summary", "Read-only MCP query completed without UE write actions.");
      emit(taskId, "task_completed", "Task completed", "MCP read-only task completed.", "success");
      return snapshot.tasksById[taskId];
    },
    async cancelTask(taskId: string): Promise<void> {
      const task = snapshot.tasksById[taskId];
      if (!task || isTerminalTaskState(task.state)) {
        return;
      }
      emit(taskId, "task_cancelled", "Task cancelled", "MCP read-only task cancellation requested.", "warning");
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    disconnect() {
      const taskId = snapshot.activeTaskId ?? createTaskId(sequence + 1);
      emit(taskId, "mcp_disconnected", "MCP disconnected", "MCP read-only runtime disconnected.", "warning");
    },
  };
}

async function callAllowedTool(options: McpReadOnlyRuntimeOptions, name: string): Promise<unknown> {
  const risk = classifyMcpToolRisk({ name });
  if (risk.level !== "read_only") {
    throw new Error(risk.reason);
  }
  return options.callTool?.(name, {}) ?? { toolName: name, text: "No fixture tool runner configured." };
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result === "object" && "text" in result && typeof result.text === "string") {
    return result.text;
  }
  return JSON.stringify(result).slice(0, 240);
}
