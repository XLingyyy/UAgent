import {
  createEmptyRuntimeSnapshot,
  createEventId,
  createEvidenceId,
  createTaskId,
  createTaskTitle,
  isTerminalTaskState,
  type RuntimeClient,
  type RuntimeSnapshot,
  type TaskDraft,
  type TaskEvent,
  type TaskEventLevel,
  type TaskEventType,
  type TaskRecord,
} from "@uagent/shared";
import { applyTaskEvent } from "./task-event-reducer.js";

export interface MockRuntimeOptions {
  clockStart?: number;
  autoFlush?: boolean;
  failAtEvent?: TaskEventType;
}

export interface MockRuntimeClient extends RuntimeClient {
  flushNextEvent(taskId: string): Promise<void>;
  flushAll(taskId?: string): Promise<void>;
}

interface QueuedTask {
  taskId: string;
  events: TaskEvent[];
  cursor: number;
  cancelled: boolean;
}

const DEFAULT_CLOCK_START = 1_000;

export function createMockRuntime(options: MockRuntimeOptions = {}): MockRuntimeClient {
  let sequence = 0;
  let eventSequence = 0;
  let evidenceSequence = 0;
  let clock = options.clockStart ?? DEFAULT_CLOCK_START;
  let snapshot = createEmptyRuntimeSnapshot();
  const queues = new Map<string, QueuedTask>();
  const listeners = new Set<(nextSnapshot: RuntimeSnapshot) => void>();

  function nextTime(): number {
    const time = clock;
    clock += 1;
    return time;
  }

  function notify() {
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function makeEvent(
    taskId: string,
    type: TaskEventType,
    title: string,
    body: string,
    level: TaskEventLevel = "info",
    payload?: unknown,
  ): TaskEvent {
    eventSequence += 1;
    return {
      id: createEventId(taskId, eventSequence),
      taskId,
      type,
      title,
      body,
      level,
      createdAt: nextTime(),
      payload,
    };
  }

  function buildEvents(taskId: string, draft: TaskDraft): TaskEvent[] {
    const events: TaskEvent[] = [
      makeEvent(taskId, "task_submitted", "User request", draft.input, "info", { draft }),
      makeEvent(
        taskId,
        "plan_created",
        "Agent plan",
        "Create a mock execution plan, inspect project context, collect evidence, and summarize review status.",
        "info",
        {
          steps: [
            "Read mock project context",
            "Identify likely implementation risks",
            "Attach deterministic evidence",
            "Prepare review summary",
          ],
        },
      ),
      makeEvent(
        taskId,
        "tool_started",
        "Tool started",
        "MockRuntime is reading project context without touching files, UE, MCP, or network.",
      ),
      makeEvent(
        taskId,
        "tool_completed",
        "Tool completed",
        "Mock project context attached from deterministic runtime data.",
        "success",
        { toolName: "mock.project_context" },
      ),
      makeEvent(
        taskId,
        "evidence_created",
        "Evidence created",
        "Project summary, risk note, and artifact placeholder are available in the utility drawer.",
        "success",
        {
          evidence: {
            id: createEvidenceId(++evidenceSequence),
            taskId,
            kind: "project_summary",
            title: "Mock project context summary",
            summary: "Lyra_Prototype context summarized by MockRuntime only.",
            source: "mock-runtime",
            createdAt: clock,
          },
        },
      ),
      makeEvent(
        taskId,
        "review_created",
        "Review summary",
        "Mock review found no real side effects and recommends keeping provider calls disabled for MVP1.",
        "info",
        {
          recommendations: [
            "Keep provider execution disabled",
            "Promote this flow to MVP2 read-only runtime later",
          ],
        },
      ),
      makeEvent(
        taskId,
        "task_completed",
        "Task completed",
        "Mock task completed with plan, tool event, evidence, and review summary.",
        "success",
      ),
    ];

    const shouldFail = draft.input.includes("#fail") || options.failAtEvent;
    if (!shouldFail) {
      return events;
    }

    const failAfterType = options.failAtEvent ?? "tool_completed";
    const failAfterIndex = Math.max(
      0,
      events.findIndex((event) => event.type === failAfterType),
    );
    return [
      ...events.slice(0, failAfterIndex + 1),
      makeEvent(
        taskId,
        "task_failed",
        "Task failed",
        "Mock failure injected by #fail or failAtEvent.",
        "error",
        { reason: "#fail" },
      ),
    ];
  }

  function applyEvent(event: TaskEvent) {
    snapshot = applyTaskEvent(snapshot, event);
    notify();
  }

  async function flushNextEvent(taskId: string): Promise<void> {
    const queue = queues.get(taskId);
    if (!queue || queue.cancelled) {
      return;
    }
    const event = queue.events[queue.cursor];
    if (!event) {
      return;
    }
    queue.cursor += 1;
    applyEvent(event);
  }

  async function flushAll(taskId?: string): Promise<void> {
    const taskIds = taskId ? [taskId] : [...queues.keys()];
    for (const id of taskIds) {
      const queue = queues.get(id);
      while (queue && !queue.cancelled && queue.cursor < queue.events.length) {
        await flushNextEvent(id);
      }
    }
  }

  return {
    async submitTask(draft: TaskDraft): Promise<TaskRecord> {
      sequence += 1;
      eventSequence = 0;
      const taskId = createTaskId(sequence);
      const createdAt = draft.createdAt ?? nextTime();
      const normalizedDraft = { ...draft, createdAt };
      const record: TaskRecord = {
        id: taskId,
        title: createTaskTitle(draft.input),
        state: "submitted",
        draft: normalizedDraft,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        error: null,
      };
      snapshot = {
        ...snapshot,
        status: "running",
        activeTaskId: taskId,
        tasksById: {
          ...snapshot.tasksById,
          [taskId]: record,
        },
      };
      const queue: QueuedTask = {
        taskId,
        events: buildEvents(taskId, normalizedDraft),
        cursor: 0,
        cancelled: false,
      };
      queues.set(taskId, queue);
      notify();

      if (options.autoFlush !== false) {
        await flushAll(taskId);
      }

      return snapshot.tasksById[taskId] ?? record;
    },
    async cancelTask(taskId: string): Promise<void> {
      const task = snapshot.tasksById[taskId];
      if (!task || isTerminalTaskState(task.state)) {
        return;
      }

      const queue = queues.get(taskId);
      if (queue) {
        queue.cancelled = true;
      }
      applyEvent(
        makeEvent(
          taskId,
          "task_cancelled",
          "Task cancelled",
          "Mock task cancellation requested; remaining runtime events were stopped.",
          "warning",
        ),
      );
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flushNextEvent,
    flushAll,
  };
}
