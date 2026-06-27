export type SandboxMode = "disabled" | "fixture";

export type SandboxExecutionStatus = "pending" | "running" | "completed" | "failed" | "blocked" | "timed_out";

export interface SandboxPolicy {
  mode: SandboxMode;
  capabilities: Record<string, "allow" | "block">;
  cwdRef: string | null;
  envPolicy: Record<string, "inherit" | "block" | "mock">;
  networkPolicy: "blocked" | "fixture_only" | "live";
  outputLimit: number;
  timeoutTicks: number;
}

export interface SandboxExecutionRequest {
  id: string;
  taskId: string;
  stepId: string | null;
  capability: string;
  input: string;
  policy: SandboxPolicy;
  timeoutTicks: number;
  createdAt: number;
}

export interface SandboxExecutionResult {
  id: string;
  requestId: string;
  status: SandboxExecutionStatus;
  stdoutSummary: string;
  stderrSummary: string;
  diffSummary: string;
  warnings: string[];
  artifactRefs: string[];
  policyReason: string | null;
  evidenceSummary: string;
  createdAt: number;
}

export interface SandboxEvent {
  id: string;
  taskId: string;
  type: "sandbox_started" | "sandbox_completed" | "sandbox_failed" | "sandbox_blocked" | "sandbox_timed_out";
  requestId: string;
  title: string;
  body?: string;
  createdAt: number;
  payload?: Record<string, unknown>;
}

export function createDefaultSandboxPolicy(): SandboxPolicy {
  return {
    mode: "fixture",
    capabilities: {},
    cwdRef: null,
    envPolicy: {},
    networkPolicy: "blocked",
    outputLimit: 4096,
    timeoutTicks: 100,
  };
}
