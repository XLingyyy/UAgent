export type ComposerPermission = "request-approval" | "auto-approve" | "full-access" | "custom";

export interface ComposerPermissionOption {
  id: ComposerPermission;
  label: string;
  description: string;
  tone: "default" | "warning" | "accent" | "muted";
  enabled: boolean;
  requiresConfirmation: boolean;
}

export const permissionOptions: ComposerPermissionOption[] = [
  {
    id: "request-approval",
    label: "Request approval",
    description: "All medium/high-risk operations require confirmation",
    tone: "default",
    enabled: true,
    requiresConfirmation: false,
  },
  {
    id: "auto-approve",
    label: "Auto approve",
    description: "Low-risk operations run automatically; medium/high still require confirmation",
    tone: "accent",
    enabled: true,
    requiresConfirmation: false,
  },
  {
    id: "full-access",
    label: "Full access",
    description: "MVP0 mock only - no real permissions elevated",
    tone: "warning",
    enabled: true,
    requiresConfirmation: true,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Future settings-backed permissions",
    tone: "muted",
    enabled: false,
    requiresConfirmation: false,
  },
];

export type ComposerRunMode = "local" | "sandbox";

export type ComposerReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type ComposerModelId =
  | "not-configured"
  | "openai-gpt-5"
  | "anthropic-claude-sonnet"
  | "local-qwen";

export interface ComposerModelOption {
  id: ComposerModelId;
  label: string;
  provider: string;
  contextWindow: string;
  enabled: boolean;
}

export interface ComposerReasoningOption {
  id: ComposerReasoningEffort;
  label: string;
}

export const reasoningOptions: ComposerReasoningOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" },
];

export const modelOptions: ComposerModelOption[] = [
  {
    id: "not-configured",
    label: "Model not configured",
    provider: "None",
    contextWindow: "N/A",
    enabled: true,
  },
  {
    id: "openai-gpt-5",
    label: "GPT-5 Mock",
    provider: "Provider A",
    contextWindow: "200k",
    enabled: true,
  },
  {
    id: "anthropic-claude-sonnet",
    label: "Claude Sonnet Mock",
    provider: "Provider A",
    contextWindow: "200k",
    enabled: true,
  },
  {
    id: "local-qwen",
    label: "Local Qwen Mock",
    provider: "Provider B",
    contextWindow: "64k",
    enabled: true,
  },
];

export interface ComposerContextUsage {
  used: number;
  total: number;
  percent: number;
}

export interface ComposerStatusItem {
  id: string;
  label: string;
  value: string;
  tone?: "default" | "warning" | "accent" | "success" | "muted";
}

export interface ComposerMockState {
  permission: ComposerPermission;
  runMode: ComposerRunMode;
  project: string;
  branch: string;
  context: ComposerContextUsage;
  statusItems: ComposerStatusItem[];
  placeholder: string;
  addButtonLabel: string;
  sendButtonLabel: string;
}

export const composerMock: ComposerMockState = {
  permission: "request-approval",
  runMode: "local",
  project: "Lyra_Prototype",
  branch: "main",
  context: {
    used: 2400,
    total: 20000,
    percent: 12,
  },
  statusItems: [
    {
      id: "status-ue",
      label: "UE",
      value: "Not connected",
      tone: "warning",
    },
    {
      id: "status-runtime",
      label: "Runtime",
      value: "Mock",
      tone: "accent",
    },
  ],
  placeholder: "Ask UAgent to plan, inspect, or modify the current Unreal project...",
  addButtonLabel: "+",
  sendButtonLabel: "Send",
};
