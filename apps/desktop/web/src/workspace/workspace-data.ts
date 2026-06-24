export interface WorkspaceHeroSummary {
  projectName: string;
  capability: string;
  previewStatus: string;
  ueStatus: string;
  description: string;
}

export interface WorkspaceStatusItem {
  label: string;
  value: string;
  tone?: "default" | "warning" | "accent";
}

export type WorkspaceMessageKind = "user-request" | "agent-plan" | "tool-event" | "review-summary";

export interface WorkspaceMessage {
  id: string;
  kind: WorkspaceMessageKind;
  label: string;
  title: string;
  body: string;
  meta: string;
  timestamp: string;
}

export const workspaceHero: WorkspaceHeroSummary = {
  projectName: "Lyra_Prototype",
  capability: "Plan / Build / Review mock workflows",
  previewStatus: "Local UI preview",
  ueStatus: "UE not connected",
  description:
    "Central context for mock planning, tool events, and review notes in the current Unreal project.",
};

export const workspaceStatusItems: WorkspaceStatusItem[] = [
  {
    label: "Project",
    value: "Lyra_Prototype",
    tone: "accent",
  },
  {
    label: "Mode",
    value: "Plan",
  },
  {
    label: "Runtime",
    value: "Mock",
  },
  {
    label: "UE",
    value: "Not connected",
    tone: "warning",
  },
];

export const workspaceMessages: WorkspaceMessage[] = [
  {
    id: "workspace-message-user-request",
    kind: "user-request",
    label: "User request",
    title: "Map the next safe UI pass",
    body: "Prepare a scoped plan for the Lyra_Prototype workspace without touching live Unreal state.",
    meta: "Thread: Initial project setup",
    timestamp: "09:12",
  },
  {
    id: "workspace-message-agent-plan",
    kind: "agent-plan",
    label: "Agent plan",
    title: "Stage workspace context before execution",
    body: "Keep the route in mock mode, surface project context, then reserve room for tool output and review notes.",
    meta: "Plan lane: UI foundation",
    timestamp: "09:14",
  },
  {
    id: "workspace-message-tool-event",
    kind: "tool-event",
    label: "Tool event",
    title: "Project tree context attached",
    body: "Using the accepted Lyra_Prototype mock tree as local context. No editor command has been executed.",
    meta: "Event source: static mock data",
    timestamp: "09:16",
  },
  {
    id: "workspace-message-review-summary",
    kind: "review-summary",
    label: "Review summary",
    title: "Ready for visual inspection",
    body: "Workspace can now display requests, plans, events, and summaries while remaining non-executable.",
    meta: "Review lane: diagnostic placeholder",
    timestamp: "09:18",
  },
];

export const composerModes = ["Plan", "Build", "Review"] as const;
