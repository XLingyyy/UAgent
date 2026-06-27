import type { SettingsPageId } from "../types/ui";

export interface SettingsRow {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface SettingsSectionData {
  id: string;
  title: string;
  description?: string;
  rows: SettingsRow[];
}

export interface SettingsPageData {
  id: SettingsPageId | string;
  title: string;
  description: string;
  sections: SettingsSectionData[];
}

export const generalPageData: SettingsPageData = {
  id: "general",
  title: "General",
  description:
    "Configure work mode defaults, permission defaults, language, and bottom-panel settings.",
  sections: [
    {
      id: "work-mode",
      title: "Work mode",
      rows: [
        {
          id: "default-work-mode",
          label: "Default work mode",
          description: "Choose the primary context for new conversations.",
          disabled: false,
        },
      ],
    },
    {
      id: "permission-defaults",
      title: "Permission defaults",
      rows: [
        {
          id: "default-permission",
          label: "Default permission",
          description: "Default permission applied when creating a new conversation.",
          disabled: false,
        },
      ],
    },
    {
      id: "language",
      title: "Language",
      rows: [
        {
          id: "ui-language",
          label: "Language",
          description: "UI display language.",
          disabled: false,
        },
      ],
    },
    {
      id: "bottom-panel",
      title: "Bottom panel",
      rows: [
        {
          id: "bottom-panel-default",
          label: "Default view",
          description: "What the bottom panel shows by default when opened.",
          disabled: false,
        },
      ],
    },
  ],
};

export const profilePageData: SettingsPageData = {
  id: "profile",
  title: "Profile",
  description: "Review local-only profile identity and account status.",
  sections: [
    {
      id: "profile-summary",
      title: "Local profile summary",
      description: "Mock identity shown inside this workspace only.",
      rows: [],
    },
    {
      id: "account-status",
      title: "Account status",
      description: "No remote account is attached in MVP0.",
      rows: [],
    },
    {
      id: "future-account-sync",
      title: "Future account sync",
      description: "Reserved placeholder for a later account task.",
      rows: [],
    },
  ],
};

export const appearancePageData: SettingsPageData = {
  id: "appearance",
  title: "Appearance",
  description: "Customize theme, accent color, typography, and display settings.",
  sections: [
    {
      id: "theme",
      title: "Theme",
      description: "Select the UI color scheme.",
      rows: [
        {
          id: "theme-mode",
          label: "Theme mode",
          description: "Controls the application color scheme.",
          disabled: false,
        },
      ],
    },
    {
      id: "accent",
      title: "Accent",
      description: "Accent color affects buttons, selection states, and focus rings.",
      rows: [
        {
          id: "accent-color",
          label: "Accent color",
          description: "Choose the accent hue used throughout the interface.",
          disabled: false,
        },
      ],
    },
    {
      id: "typography",
      title: "Typography",
      rows: [
        {
          id: "ui-font",
          label: "UI font",
          description: "Font family used for the user interface.",
          disabled: false,
        },
        {
          id: "code-font",
          label: "Code font",
          description: "Font family used for code blocks and terminal output.",
          disabled: false,
        },
      ],
    },
    {
      id: "display",
      title: "Display",
      rows: [
        {
          id: "contrast",
          label: "Contrast",
          description: "Adjust the interface contrast level.",
          disabled: false,
        },
      ],
    },
  ],
};

export const configPageData: SettingsPageData = {
  id: "config",
  title: "Config",
  description: "Manage MCP read-only runtime, approval policy, sandbox permissions, paths, and diagnostics.",
  sections: [
    {
      id: "mcp",
      title: "MCP read-only runtime",
      description: "Connect to a localhost MCP endpoint and discover read-only capabilities.",
      rows: [
        {
          id: "mcp-connection",
          label: "Local MCP endpoint",
          description:
            "MVP2 accepts localhost endpoints only. Discovery is read-only and write-like tools are blocked.",
          disabled: false,
        },
      ],
    },
    {
      id: "approval",
      title: "Approval policy",
      rows: [
        {
          id: "approval-policy",
          label: "Default approval strategy",
          description:
            "Controls when UAgent requires manual confirmation before executing actions.",
          disabled: false,
        },
      ],
    },
    {
      id: "sandbox",
      title: "Sandbox permissions",
      rows: [
        {
          id: "sandbox-permissions",
          label: "Allowed operations",
          description: "Permissions granted to the agent within the sandbox environment.",
          disabled: false,
        },
      ],
    },
    {
      id: "audit-session",
      title: "Audit and session history",
      rows: [
        {
          id: "audit-session-retention",
          label: "Retention policy",
          description:
            "Controls append-only audit projection and local session history retention.",
          disabled: false,
        },
      ],
    },
    {
      id: "paths",
      title: "Configuration paths",
      rows: [
        {
          id: "config-path",
          label: "Config path",
          description: "Path to the active UAgent configuration file.",
          disabled: true,
          disabledReason: "Read-only",
        },
      ],
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      rows: [
        {
          id: "diagnostics-config",
          label: "Diagnostics configuration",
          description: "Configure logging level and runtime diagnostics output.",
          disabled: false,
        },
      ],
    },
    {
      id: "danger-zone",
      title: "Danger zone",
      rows: [
        {
          id: "reset-workspace",
          label: "Reset workspace",
          description:
            "Remove all local agent state, conversations, and settings. This action cannot be undone.",
          disabled: true,
          disabledReason: "Not available in MVP0",
        },
      ],
    },
  ],
};

export const personalizationPageData: SettingsPageData = {
  id: "personalization",
  title: "Personalization",
  description: "Define the default agent style and custom instructions for new conversations.",
  sections: [
    {
      id: "agent-style",
      title: "Agent style",
      rows: [
        {
          id: "default-agent-style",
          label: "Default agent style",
          description: "Sets the tone and communication style for new agent interactions.",
          disabled: false,
        },
      ],
    },
    {
      id: "instructions",
      title: "Custom instructions",
      description: "Instructions appended to every new conversation.",
      rows: [
        {
          id: "project-instructions",
          label: "Project custom instructions",
          description: "Instructions that apply when working within the active project.",
          disabled: true,
          disabledReason: "Coming in MVP1",
        },
        {
          id: "global-instructions",
          label: "Global custom instructions",
          description: "Instructions that apply to all conversations regardless of project.",
          disabled: true,
          disabledReason: "Coming in MVP1",
        },
      ],
    },
    {
      id: "memory",
      title: "Memory",
      description: "Agent memory and context persistence settings.",
      rows: [
        {
          id: "enable-memory",
          label: "Enable agent memory",
          description: "Allow the agent to remember preferences and context across sessions.",
          disabled: true,
          disabledReason: "Coming in MVP4",
        },
        {
          id: "memory-scope",
          label: "Memory scope",
          description: "Per-project or global memory retention.",
          disabled: true,
          disabledReason: "Coming in MVP4",
        },
      ],
    },
  ],
};

export const archivedChatsPageData: SettingsPageData = {
  id: "archived-chats",
  title: "Archived chats",
  description: "Browse and search your archived conversation history.",
  sections: [
    {
      id: "filters",
      title: "Search and filters",
      rows: [
        {
          id: "search-archived",
          label: "Search archives",
          description: "Search across archived conversation titles and content.",
          disabled: true,
          disabledReason: "Coming in MVP1",
        },
        {
          id: "filter-project",
          label: "Filter by project",
          description: "Show only archived conversations from a specific project.",
          disabled: true,
          disabledReason: "Coming in MVP1",
        },
      ],
    },
    {
      id: "archived-list",
      title: "Archived conversations",
      description: "Your archived conversation history. Archives are read-only.",
      rows: [],
    },
    {
      id: "actions",
      title: "Actions",
      rows: [
        {
          id: "delete-all-archived",
          label: "Delete all archived chats",
          description:
            "Permanently remove all archived conversations. This action cannot be undone.",
          disabled: true,
          disabledReason: "Not available in MVP0",
        },
      ],
    },
  ],
};

export const providerPageData: SettingsPageData = {
  id: "provider",
  title: "Provider",
  description: "Manage provider connections, network modes, and secret-safe configuration.",
  sections: [
    {
      id: "provider-list",
      title: "Available providers",
      description: "Local provider entries available for model selection.",
      rows: [],
    },
    {
      id: "provider-detail",
      title: "Selected provider detail",
      description: "Configure provider connection with secret-safe settings.",
      rows: [
        {
          id: "basic-info",
          label: "Basic information",
          description: "Provider name, wire API, and base URL.",
          disabled: true,
          disabledReason: "Select a provider",
        },
        {
          id: "auth-config",
          label: "Authentication",
          description: "Authentication mode and environment variable name.",
          disabled: true,
          disabledReason: "Select a provider",
        },
      ],
    },
    {
      id: "model-defaults",
      title: "Model defaults",
      description: "Choose the local default model and reasoning effort.",
      rows: [
        {
          id: "model-catalog",
          label: "Model catalog",
          description: "Available models from this provider.",
          disabled: true,
          disabledReason: "Select a provider",
        },
        {
          id: "default-model",
          label: "Default model",
          description: "The default model used for new conversations.",
          disabled: true,
          disabledReason: "Select a provider",
        },
        {
          id: "reasoning",
          label: "Reasoning effort",
          description: "Default reasoning effort level for supported models.",
          disabled: true,
          disabledReason: "Select a provider",
        },
        {
          id: "context-window",
          label: "Context window",
          description: "Maximum context window size for models from this provider.",
          disabled: true,
          disabledReason: "Select a provider",
        },
      ],
    },
    {
      id: "provider-actions",
      title: "Local-only actions",
      rows: [
        {
          id: "add-provider",
          label: "Add provider",
          description: "Add a new LLM provider connection.",
          disabled: true,
          disabledReason: "Coming in UI-014",
        },
        {
          id: "edit-provider",
          label: "Edit provider",
          description: "Modify the selected provider configuration.",
          disabled: true,
          disabledReason: "Coming in UI-014",
        },
        {
          id: "delete-provider",
          label: "Delete provider",
          description: "Remove this provider and its configuration.",
          disabled: true,
          disabledReason: "Coming in UI-014",
        },
        {
          id: "save-provider",
          label: "Save provider",
          description: "Save changes to the current provider configuration.",
          disabled: true,
          disabledReason: "Coming in UI-014",
        },
        {
          id: "test-connection",
          label: "Test connection",
          description: "Verify connectivity to the provider endpoint.",
          disabled: true,
          disabledReason: "Coming in UI-014",
        },
      ],
    },
  ],
};

const pageDataMap: Record<string, SettingsPageData> = {
  general: generalPageData,
  profile: profilePageData,
  appearance: appearancePageData,
  config: configPageData,
  personalization: personalizationPageData,
  provider: providerPageData,
};

export function getSettingsPageData(id: SettingsPageId): SettingsPageData | undefined {
  return pageDataMap[id];
}
