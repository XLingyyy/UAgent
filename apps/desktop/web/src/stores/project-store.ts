import type { ProjectStoreState, UIInitialState } from "../types/ui";

export const DEFAULT_PROJECT_STATE: ProjectStoreState = {
  activeProjectId: "lyra",
  rootInput: "",
  validation: null,
  registeredProjects: [],
  activeProjectIndex: null,
  scanStatus: "idle",
  lastError: null,
  assetFilter: "",
  selectedAssetPath: null,
  preview: null,
  auditTrail: [],
  nativeSource: "fixture",
  capabilityStatus: [],
  fsPolicy: null,
};

export function createInitialProjectState(initialState?: UIInitialState): ProjectStoreState {
  return {
    ...DEFAULT_PROJECT_STATE,
    ...initialState?.project,
  };
}
