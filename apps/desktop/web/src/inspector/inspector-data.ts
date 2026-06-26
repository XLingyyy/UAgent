export type FindingSeverity = "info" | "warning" | "passed";

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  scope: string;
  evidenceRef: string;
}

export interface ReviewEvidenceItem {
  id: string;
  label: string;
  status: "checked" | "unchecked" | "pending";
}

export interface ReviewSummary {
  status: string;
  verdict: string;
  evidenceLabel: string;
  evidenceItems: ReviewEvidenceItem[];
}

export interface DiagnosticItem {
  id: string;
  label: string;
  state: string;
  description: string;
  tone: "default" | "warning" | "accent" | "success";
}

export interface DiagnosticSummary {
  status: string;
  items: DiagnosticItem[];
}

export type UtilityToolId =
  | "review"
  | "diagnostics"
  | "runtime"
  | "agent-trace"
  | "terminal"
  | "browser"
  | "files"
  | "evidence"
  | "logs"
  | "ue"
  | "asset-search";

export type UtilityPlaceholderToolId = Exclude<
  UtilityToolId,
  "review" | "diagnostics" | "runtime" | "agent-trace" | "evidence"
>;

export interface UtilityToolDefinition {
  id: UtilityToolId;
  label: string;
  summary: string;
}

export interface UtilityPlaceholderPanelData {
  id: UtilityPlaceholderToolId;
  title: string;
  state: string;
  badge: string;
  items: string[];
  actionLabel: string;
}

export interface UtilityEvidencePanelData {
  title: string;
  state: string;
  badge: string;
  actionLabel: string;
}

export const reviewSummary: ReviewSummary = {
  status: "Review: Mock ready",
  verdict: "No blocking issues",
  evidenceLabel: "Mock evidence — no real verifier execution",
  evidenceItems: [
    { id: "ev-workspace-ui", label: "Workspace skeleton render", status: "checked" },
    { id: "ev-sidebar-nav", label: "Sidebar nav & project tree", status: "checked" },
    { id: "ev-mock-only", label: "No real UE/MCP/LLM calls", status: "checked" },
    { id: "ev-theme", label: "Theme tokens applied", status: "checked" },
  ],
};

export const reviewFindings: ReviewFinding[] = [
  {
    id: "finding-001",
    severity: "passed",
    title: "AppShell layout is stable",
    description:
      "Three-column layout renders without overflow or overlap at supported viewport widths. TitleBar, Sidebar, Workspace, and InspectorPane all participate in the flex flow.",
    scope: "apps/desktop/web/src/shell/",
    evidenceRef: "ev-workspace-ui",
  },
  {
    id: "finding-002",
    severity: "info",
    title: "ComposerDock is placeholder only",
    description:
      "The composer area shows mock modes (Plan / Build / Review) but no real send, network, or LLM behavior is wired. This is expected at the current UI foundation stage.",
    scope: "apps/desktop/web/src/workspace/",
    evidenceRef: "ev-mock-only",
  },
  {
    id: "finding-003",
    severity: "warning",
    title: "Project tree uses static mock data",
    description:
      "The sidebar project tree renders a hardcoded UE folder structure. Real filesystem scanning or Unreal Editor project introspection is not yet implemented.",
    scope: "apps/desktop/web/src/sidebar/",
    evidenceRef: "ev-sidebar-nav",
  },
  {
    id: "finding-004",
    severity: "info",
    title: "Inspector panels are UI mocks",
    description:
      "Review and Diagnostics panels display mock data only. No real verifier, diagnostic agent, or runtime health check is executed.",
    scope: "apps/desktop/web/src/inspector/",
    evidenceRef: "ev-mock-only",
  },
];

export const diagnosticSummary: DiagnosticSummary = {
  status: "Mock diagnostics — no live runtime",
  items: [
    {
      id: "diag-runtime",
      label: "Runtime",
      state: "Mock",
      description: "Agent state machine placeholder; no execution loop or task scheduling yet.",
      tone: "default",
    },
    {
      id: "diag-ue",
      label: "UE Connection",
      state: "Not connected",
      description:
        "No Unreal Editor or MCP server connection is active. This is a local UI preview.",
      tone: "warning",
    },
    {
      id: "diag-verifier",
      label: "Verifier",
      state: "Offline",
      description: "No review verifier or evidence collector is running. Panels display mock data.",
      tone: "warning",
    },
    {
      id: "diag-llm",
      label: "LLM Provider",
      state: "None",
      description:
        "No provider key or endpoint is configured. All responses are mock placeholders.",
      tone: "default",
    },
    {
      id: "diag-filesystem",
      label: "File System",
      state: "Not accessed",
      description:
        "No Tauri FS API or project file reads are performed. Tree data is in-memory mock.",
      tone: "default",
    },
  ],
};

export const utilityTools: UtilityToolDefinition[] = [
  {
    id: "review",
    label: "Review",
    summary: "Review queue",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    summary: "Mock diagnostics",
  },
  {
    id: "runtime",
    label: "Runtime",
    summary: "Task event state",
  },
  {
    id: "agent-trace",
    label: "Agent Trace",
    summary: "Trace replay",
  },
  {
    id: "terminal",
    label: "Terminal",
    summary: "Static transcript",
  },
  {
    id: "browser",
    label: "Browser",
    summary: "Preview placeholder",
  },
  {
    id: "files",
    label: "Files",
    summary: "Mock project references",
  },
  {
    id: "evidence",
    label: "Evidence",
    summary: "Evidence bundle",
  },
  {
    id: "logs",
    label: "Logs",
    summary: "Static rows",
  },
  {
    id: "ue",
    label: "UE",
    summary: "UE connection",
  },
  {
    id: "asset-search",
    label: "Asset Search",
    summary: "Asset lookup",
  },
];

export const utilityPlaceholderPanels: Record<
  UtilityPlaceholderToolId,
  UtilityPlaceholderPanelData
> = {
  terminal: {
    id: "terminal",
    title: "Terminal",
    state: "Session unavailable",
    badge: "Mock only",
    items: [
      "Transcript preview is static.",
      "No executable prompt is rendered.",
      "Session controls are reserved for a later MVP.",
    ],
    actionLabel: "Future terminal bridge",
  },
  browser: {
    id: "browser",
    title: "Browser",
    state: "Preview unavailable",
    badge: "Mock only",
    items: [
      "Page preview is not mounted.",
      "No address entry or navigation control is rendered.",
      "External content loading is outside this UI task.",
    ],
    actionLabel: "Future embedded browser",
  },
  files: {
    id: "files",
    title: "Files",
    state: "Not mounted",
    badge: "Mock only",
    items: [
      "Project references are static labels.",
      "No local project mount is attached.",
      "File operations stay outside this drawer mock.",
    ],
    actionLabel: "Future file browser",
  },
  logs: {
    id: "logs",
    title: "Logs",
    state: "Static rows only",
    badge: "Mock only",
    items: [
      "09:41 UI shell rendered",
      "09:42 Tools drawer opened",
      "09:43 Placeholder row selected",
    ],
    actionLabel: "Future log stream",
  },
  ue: {
    id: "ue",
    title: "UE",
    state: "Not connected",
    badge: "Mock only",
    items: [
      "MCP profile is not attached.",
      "Editor session status is not inspected.",
      "Connection controls remain disabled.",
    ],
    actionLabel: "Future UE connection",
  },
  "asset-search": {
    id: "asset-search",
    title: "Asset Search",
    state: "Static placeholder",
    badge: "Mock only",
    items: [
      "Index is not available in this UI stage.",
      "Example asset rows are static copy.",
      "Project queries are reserved for a later MVP.",
    ],
    actionLabel: "Future asset index",
  },
};

export const utilityEvidencePanel: UtilityEvidencePanelData = {
  title: "Review evidence",
  state: "No live evidence collection",
  badge: "Mock only",
  actionLabel: "Future evidence capture",
};
