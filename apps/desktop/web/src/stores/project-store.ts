import { FIXTURES_ENABLED } from "../runtime/build-capabilities";
import type { ProjectStoreState, UIInitialState } from "../types/ui";

export const DEFAULT_PROJECT_STATE: ProjectStoreState = {
  activeProjectId: FIXTURES_ENABLED ? "lyra" : null,
  validation: null,
  registeredProjects: [],
  activeProjectIndex: null,
  scanStatus: "idle",
  lastError: null,
  assetFilter: "",
  selectedAssetPath: null,
  preview: null,
  auditTrail: [],
  nativeSource: "unknown",
  capabilityStatus: [],
  fsPolicy: null,
};

export function createInitialProjectState(initialState?: UIInitialState): ProjectStoreState {
  return {
    ...DEFAULT_PROJECT_STATE,
    ...initialState?.project,
  };
}
