import type { ThreadStoreState, UIInitialState } from "../types/ui";

export const DEFAULT_THREAD_STATE: ThreadStoreState = {
  activeThreadId: "thread-1",
};

export function createInitialThreadState(initialState?: UIInitialState): ThreadStoreState {
  return {
    ...DEFAULT_THREAD_STATE,
    ...initialState?.thread,
  };
}
