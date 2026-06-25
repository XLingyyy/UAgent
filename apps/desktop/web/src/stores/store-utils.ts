import { useSyncExternalStore } from "react";

export type StateUpdater<TState> = TState | ((previousState: TState) => TState);

function isStateReducer<TState>(
  updater: StateUpdater<TState>,
): updater is (previousState: TState) => TState {
  return typeof updater === "function";
}

export interface SliceStore<TState> {
  getState: () => TState;
  setState: (updater: StateUpdater<TState>) => TState;
  subscribe: (listener: () => void) => () => void;
}

export function createSliceStore<TState>(initialState: TState): SliceStore<TState> {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (updater) => {
      const nextState = isStateReducer(updater) ? updater(state) : updater;
      if (Object.is(nextState, state)) {
        return state;
      }

      state = nextState;
      listeners.forEach((listener) => listener());
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useSliceStore<TState, TSelected>(
  store: SliceStore<TState>,
  selector: (state: TState) => TSelected,
): TSelected {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
