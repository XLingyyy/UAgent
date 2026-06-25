import { DEFAULT_SETTINGS_PAGE } from "../settings/settings-pages";
import type { SettingsShellState, UIInitialState } from "../types/ui";

export const DEFAULT_SETTINGS_STATE: SettingsShellState = {
  open: false,
  activePageId: DEFAULT_SETTINGS_PAGE,
};

export function createInitialSettingsState(initialState?: UIInitialState): SettingsShellState {
  return {
    ...DEFAULT_SETTINGS_STATE,
    ...initialState?.settings,
  };
}
