import type { SettingsPageId } from "../types/ui";

export type SettingsPageGroup = "Account" | "Preferences" | "System";

export interface SettingsPageEntry {
  id: SettingsPageId;
  title: string;
  group: SettingsPageGroup;
  phase: string;
  enabled: boolean;
  summary: string;
  disabledReason?: string;
}

export const settingsPages: SettingsPageEntry[] = [
  {
    id: "profile",
    title: "Profile",
    group: "Account",
    phase: "MVP6",
    enabled: true,
    summary: "Local profile identity and account status.",
  },
  {
    id: "general",
    title: "General",
    group: "Preferences",
    phase: "MVP6",
    enabled: true,
    summary: "Work mode defaults, permission defaults, language, and bottom-panel settings.",
  },
  {
    id: "appearance",
    title: "Appearance",
    group: "Preferences",
    phase: "MVP6",
    enabled: true,
    summary: "Theme, accent color, font, and contrast settings.",
  },
  {
    id: "personalization",
    title: "Personalization",
    group: "Preferences",
    phase: "MVP6",
    enabled: true,
    summary: "Default agent style and custom instructions.",
  },
  {
    id: "config",
    title: "Config",
    group: "System",
    phase: "MVP6",
    enabled: true,
    summary: "Approval policy, sandbox permissions, and diagnostics configuration.",
  },
  {
    id: "provider",
    title: "Provider",
    group: "System",
    phase: "MVP6",
    enabled: true,
    summary: "Local mock provider defaults and model selection.",
  },
];

const pagesById = new Map<SettingsPageId, SettingsPageEntry>();
for (const page of settingsPages) {
  pagesById.set(page.id, page);
}

export function getSettingsPage(id: SettingsPageId): SettingsPageEntry | undefined {
  return pagesById.get(id);
}

export function getSettingsGroups(): { name: SettingsPageGroup; pages: SettingsPageEntry[] }[] {
  const groupOrder: SettingsPageGroup[] = ["Account", "Preferences", "System"];
  const grouped = new Map<SettingsPageGroup, SettingsPageEntry[]>();
  for (const page of settingsPages) {
    const list = grouped.get(page.group) ?? [];
    list.push(page);
    grouped.set(page.group, list);
  }
  return groupOrder
    .filter((g) => grouped.has(g))
    .map((name) => ({ name, pages: grouped.get(name)! }));
}

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = "general";
