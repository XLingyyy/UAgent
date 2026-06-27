import { evaluateSandboxPolicy } from "./sandbox-policy.js";
import {
  type SandboxExecutionRequest,
  type SandboxExecutionStatus,
} from "@uagent/shared";

export type FixtureResultMode = "success" | "failure" | "timeout" | "blocked";

export interface FixtureSandboxResult {
  id: string;
  requestId: string;
  mode: FixtureResultMode;
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

export interface FixtureSandboxAdapter {
  execute(request: SandboxExecutionRequest): FixtureSandboxResult;
  getResult(requestId: string): FixtureSandboxResult | undefined;
  resetFixtures(): void;
}

function detectResultMode(request: SandboxExecutionRequest): FixtureResultMode {
  const policyCheck = evaluateSandboxPolicy(request.policy, request.capability);
  if (!policyCheck.allowed) {
    return "blocked";
  }
  if (request.input.includes("#timeout") || request.timeoutTicks > request.policy.timeoutTicks) {
    return "timeout";
  }
  if (request.input.includes("#fail")) {
    return "failure";
  }
  return "success";
}

function buildResult(
  request: SandboxExecutionRequest,
  mode: FixtureResultMode,
): FixtureSandboxResult {
  const now = request.createdAt;
  let status: SandboxExecutionStatus;
  let stdoutSummary = "";
  let stderrSummary = "";
  let diffSummary = "";
  let warnings: string[] = [];
  const artifactRefs: string[] = [];
  let policyReason: string | null = null;
  let evidenceSummary = "";

  switch (mode) {
    case "success":
      status = "completed";
      stdoutSummary = `stdout fixture output for ${request.capability}`;
      diffSummary = `diff fixture output for ${request.capability}`;
      evidenceSummary = `evidence fixture output for ${request.capability}`;
      break;
    case "failure":
      status = "failed";
      stderrSummary = `stderr fixture failure for ${request.capability}`;
      warnings = [`WARNING: capability "${request.capability}" failed`];
      break;
    case "timeout":
      status = "timed_out";
      warnings = [`TIMEOUT: capability "${request.capability}" exceeded ${request.policy.timeoutTicks} ticks`];
      break;
    case "blocked":
      status = "blocked";
      policyReason = `capability "${request.capability}" blocked by policy`;
      break;
    default:
      status = "failed";
      stderrSummary = "unknown mode";
  }

  return {
    id: `fixture-${request.id}`,
    requestId: request.id,
    mode,
    status,
    stdoutSummary,
    stderrSummary,
    diffSummary,
    warnings,
    artifactRefs,
    policyReason,
    evidenceSummary,
    createdAt: now,
  };
}

export function createFixtureSandboxAdapter(): FixtureSandboxAdapter {
  const results = new Map<string, FixtureSandboxResult>();

  return {
    execute(request: SandboxExecutionRequest): FixtureSandboxResult {
      const mode = detectResultMode(request);
      const result = buildResult(request, mode);
      results.set(request.id, result);
      return result;
    },

    getResult(requestId: string): FixtureSandboxResult | undefined {
      return results.get(requestId);
    },

    resetFixtures(): void {
      results.clear();
    },
  };
}
