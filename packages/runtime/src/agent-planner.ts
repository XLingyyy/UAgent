import type {
  AgentPlan,
  AgentPlanStep,
  McpDiscoverySnapshot,
  TaskDraft,
} from "@uagent/shared";
import { createSemanticCapabilityIndex } from "./mcp-semantic-index.js";

export interface PlannerInput {
  taskId: string;
  draft: TaskDraft;
  runtimeMode: "mock" | "mcp-readonly";
  discovery: McpDiscoverySnapshot | null;
  policySummary?: string[];
}

export interface Planner {
  createPlan(input: PlannerInput): AgentPlan;
}

export interface DeterministicPlannerOptions {
  clock?: () => number;
}

const WRITE_INTENT_PATTERN = /\b(delete|save|apply|compile|run|write|launch|mutate|remove|update|create)\b/i;
const CURRENT_SELECTION_PATTERN = /current selection|selection|当前选择/i;

export class DeterministicPlanner implements Planner {
  private readonly clock: () => number;

  constructor(options: DeterministicPlannerOptions = {}) {
    this.clock = options.clock ?? Date.now;
  }

  createPlan(input: PlannerInput): AgentPlan {
    const now = this.clock();
    const steps = createSteps(input);
    return {
      id: `agent-plan-${input.taskId}`,
      taskId: input.taskId,
      goal: normalizeGoal(input.draft.input),
      state: "planning",
      steps,
      createdAt: now,
      updatedAt: now,
      metadata: {
        planner: "deterministic",
        runtimeMode: input.runtimeMode,
        discoveryRequired: input.discovery === null,
      },
    };
  }
}

function createSteps(input: PlannerInput): AgentPlanStep[] {
  const steps: AgentPlanStep[] = [
    {
      id: stepId(input.taskId, 1, "analyze"),
      kind: "analyze_intent",
      title: "Analyze request",
      description: "Classify the user request before choosing a safe runtime action.",
      status: "pending",
      target: { type: "user_intent", name: normalizeGoal(input.draft.input) },
    },
  ];

  if (WRITE_INTENT_PATTERN.test(input.draft.input)) {
    steps.push({
      id: stepId(input.taskId, 2, "policy"),
      kind: "policy_review",
      title: "Block mutating intent",
      description: "MVP3 records mutating intent but does not execute UE write actions.",
      status: "blocked",
      target: { type: "policy", name: "MVP3 read-only boundary" },
      action: {
        type: "blocked",
        toolName: findLikelyToolName(input.discovery),
        reason: "Mutating intent is outside MVP3 read-only boundaries.",
        riskLevel: "blocked",
      },
    });
    appendEvidenceAndReportSteps(input.taskId, steps, 3);
    return steps;
  }

  steps.push({
    id: stepId(input.taskId, 2, "select"),
    kind: "select_capability",
    title: "Select read-only capability",
    description: input.discovery
      ? "Use discovered MCP read-only capabilities to choose a guarded action."
      : "No discovered MCP capabilities are available; use mock observation fallback.",
    status: "pending",
    target: input.discovery ? { type: "mcp_resource", name: "Discovered MCP context" } : { type: "mock_runtime" },
  });

  steps.push(createReadContextStep(input));
  appendEvidenceAndReportSteps(input.taskId, steps, 4);
  return steps;
}

function createReadContextStep(input: PlannerInput): AgentPlanStep {
  if (!input.discovery) {
    return {
      id: stepId(input.taskId, 3, "read"),
      kind: "read_context",
      title: "Create mock observation",
      description: "Use deterministic mock observation because MCP discovery is not available.",
      status: "pending",
      target: { type: "mock_runtime", name: "Mock observation" },
      action: { type: "mock_observation" },
    };
  }

  const resolved = createSemanticCapabilityIndex(input.discovery).resolveIntent(input.draft.input);
  if (resolved.kind === "resource") {
    return {
      id: stepId(input.taskId, 3, "read"),
      kind: "read_context",
      title: `Read ${resolved.title}`,
      description: "Read MCP resource through the guarded read-only path.",
      status: "pending",
      target: { type: "mcp_resource", name: resolved.title, uri: resolved.uri },
      action: { type: "read_resource", resourceUri: resolved.uri },
    };
  }
  if (resolved.kind === "tool") {
    return {
      id: stepId(input.taskId, 3, "read"),
      kind: "read_context",
      title: `Call ${resolved.title}`,
      description: "Call a locally classified read-only MCP tool through the guarded path.",
      status: "pending",
      target: { type: "mcp_tool", name: resolved.title, toolName: resolved.name },
      action: { type: "call_readonly_tool", toolName: resolved.name, args: {} },
    };
  }
  if (resolved.kind === "blocked_tool") {
    return {
      id: stepId(input.taskId, 3, "read"),
      kind: "policy_review",
      title: `Block ${resolved.title}`,
      description: resolved.reason,
      status: "blocked",
      target: { type: "policy", name: resolved.title, toolName: resolved.name },
      action: {
        type: "blocked",
        toolName: resolved.name,
        reason: resolved.reason,
        riskLevel: "blocked",
      },
    };
  }
  return {
    id: stepId(input.taskId, 3, "read"),
    kind: CURRENT_SELECTION_PATTERN.test(input.draft.input) ? "read_context" : "blocked_action",
    title: resolved.title,
    description: resolved.reason,
    status: "blocked",
    target: { type: "policy", name: resolved.title },
    action: { type: "blocked", reason: resolved.reason, riskLevel: "unknown" },
  };
}

function appendEvidenceAndReportSteps(taskId: string, steps: AgentPlanStep[], startIndex: number): void {
  steps.push({
    id: stepId(taskId, startIndex, "evidence"),
    kind: "record_evidence",
    title: "Record evidence",
    description: "Normalize the observation into an auditable evidence record.",
    status: "pending",
    target: { type: "report", name: "Evidence" },
  });
  steps.push({
    id: stepId(taskId, startIndex + 1, "report"),
    kind: "report",
    title: "Create Agent report",
    description: "Create the deterministic final report for the task.",
    status: "pending",
    target: { type: "report", name: "Agent report" },
    action: { type: "noop_report" },
  });
}

function stepId(taskId: string, index: number, label: string): string {
  return `${taskId}-agent-step-${index.toString().padStart(2, "0")}-${label}`;
}

function normalizeGoal(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  return normalized || "Untitled Agent task";
}

function findLikelyToolName(discovery: McpDiscoverySnapshot | null): string | undefined {
  return discovery?.tools[0]?.name;
}
