import type { SettingsPageId } from "../types/ui";

export type SettingsPageGroup = "Personal" | "Integration" | "Coding" | "Archived";

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
    id: "general",
    title: "General",
    group: "Personal",
    phase: "MVP0",
    enabled: true,
    summary: "Work mode defaults, permission defaults, language, and bottom-panel settings.",
  },
  {
    id: "appearance",
    title: "Appearance",
    group: "Personal",
    phase: "MVP0",
    enabled: true,
    summary: "Theme, accent color, font, and contrast settings.",
  },
  {
    id: "config",
    title: "Config",
    group: "Personal",
    phase: "MVP0",
    enabled: true,
    summary: "Approval policy, sandbox permissions, and diagnostics configuration.",
  },
  {
    id: "personalization",
    title: "Personalization",
    group: "Personal",
    phase: "MVP0",
    enabled: true,
    summary: "Default agent style and custom instructions.",
  },
  {
    id: "archived-chats",
    title: "Archived chats",
    group: "Archived",
    phase: "MVP0",
    enabled: true,
    summary: "Browse and search your archived conversation history.",
  },
  {
    id: "provider",
    title: "Provider",
    group: "Integration",
    phase: "MVP0",
    enabled: true,
    summary: "Provider configuration form will be implemented in UI-014.",
  },
  {
    id: "mcp-servers",
    title: "MCP servers",
    group: "Integration",
    phase: "MVP1",
    enabled: false,
    summary: "Manage MCP server configurations and connections.",
    disabledReason: "Coming in MVP1",
  },
  {
    id: "browser",
    title: "Browser",
    group: "Coding",
    phase: "MVP3",
    enabled: false,
    summary: "Built-in browser configuration and sandbox settings.",
    disabledReason: "Coming in MVP3",
  },
  {
    id: "computer-control",
    title: "Computer control",
    group: "Coding",
    phase: "MVP3",
    enabled: false,
    summary: "Desktop automation and computer control permissions.",
    disabledReason: "Coming in MVP3",
  },
  {
    id: "git",
    title: "Git",
    group: "Coding",
    phase: "MVP2",
    enabled: false,
    summary: "Git integration, repository, and branch management.",
    disabledReason: "Coming in MVP2",
  },
  {
    id: "worktrees",
    title: "Worktrees",
    group: "Coding",
    phase: "MVP2",
    enabled: false,
    summary: "Git worktree management and isolation settings.",
    disabledReason: "Coming in MVP2",
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
  const groupOrder: SettingsPageGroup[] = ["Personal", "Integration", "Coding", "Archived"];
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
