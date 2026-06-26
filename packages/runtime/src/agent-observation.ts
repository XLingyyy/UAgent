import {
  createEvidenceId,
  type AgentObservation,
  type AgentObservationSource,
  type AgentPlanStep,
  type EvidenceRecord,
} from "@uagent/shared";

export interface NormalizeObservationInput {
  taskId: string;
  step: AgentPlanStep;
  source: AgentObservationSource;
  result: unknown;
  createdAt: number;
  sequence: number;
}

export function normalizeObservation(input: NormalizeObservationInput): AgentObservation {
  const payload = sanitizePayload(input.result);
  return {
    id: `observation-${input.sequence.toString().padStart(4, "0")}`,
    taskId: input.taskId,
    stepId: input.step.id,
    source: input.source,
    summary: summarizePayload(payload),
    payload,
    createdAt: input.createdAt,
  };
}

export function createEvidenceFromObservation(
  observation: AgentObservation,
  sequence: number,
): EvidenceRecord {
  return {
    id: createEvidenceId(sequence),
    taskId: observation.taskId,
    kind: observation.source === "policy" ? "diagnostic" : "tool_result",
    title: observation.source === "policy" ? "Policy evidence" : "Agent observation evidence",
    summary: observation.summary,
    source: observation.source,
    createdAt: observation.createdAt,
    payload: {
      observationId: observation.id,
      stepId: observation.stepId,
      payload: observation.payload,
    },
  };
}

export function summarizePayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.slice(0, 240);
  }
  if (payload && typeof payload === "object") {
    if ("text" in payload && typeof payload.text === "string") {
      return payload.text.slice(0, 240);
    }
    if ("reason" in payload && typeof payload.reason === "string") {
      return payload.reason.slice(0, 240);
    }
  }
  try {
    return JSON.stringify(payload).slice(0, 240);
  } catch {
    return "Observation payload could not be serialized.";
  }
}

function sanitizePayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map(sanitizePayload);
  }
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : sanitizePayload(value),
    ]),
  );
}

function isSensitiveKey(key: string): boolean {
  return /authorization|token|secret|credential/i.test(key);
}
