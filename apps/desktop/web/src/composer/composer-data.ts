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

export interface ComposerModel {
  id: string;
  label: string;
  provider: string;
  reasoningEffort: string;
}

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
  model: ComposerModel;
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
  model: {
    id: "mock-model",
    label: "Model not configured",
    provider: "None",
    reasoningEffort: "N/A",
  },
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
