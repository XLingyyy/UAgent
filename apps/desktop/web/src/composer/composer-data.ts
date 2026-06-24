export type ComposerPermission = "auto-approve" | "request-approval";

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
