import type { ProjectStoreState, UIInitialState } from "../types/ui";

export const DEFAULT_PROJECT_STATE: ProjectStoreState = {
  activeProjectId: "lyra",
};

export function createInitialProjectState(initialState?: UIInitialState): ProjectStoreState {
  return {
    ...DEFAULT_PROJECT_STATE,
    ...initialState?.project,
  };
}
