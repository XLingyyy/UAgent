import { createMockRuntime, type MockRuntimeClient } from "@uagent/runtime";
import type { RuntimeSnapshot, TaskDraft } from "@uagent/shared";

export interface RuntimeStoreState extends RuntimeSnapshot {
  mockOnlyWarning: string | null;
}

export interface RuntimeStoreActions {
  submitComposerTask: (draft: TaskDraft) => Promise<string>;
  cancelRuntimeTask: (taskId: string) => Promise<void>;
}

export const DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS = 500;

export function createRuntimeStoreState(snapshot: RuntimeSnapshot): RuntimeStoreState {
  return {
    ...snapshot,
    mockOnlyWarning: null,
  };
}

export function createDesktopMockRuntimeClient(): MockRuntimeClient {
  return createMockRuntime({ clockStart: 1_000, autoFlush: false });
}

export function getRuntimeTaskIds(state: RuntimeStoreState): string[] {
  return Object.keys(state.tasksById).sort(
    (left, right) => state.tasksById[right].updatedAt - state.tasksById[left].updatedAt,
  );
}
