export type CapabilityKind =
  | "files"
  | "terminal"
  | "browser"
  | "screenshot"
  | "provider_live";

export type CapabilityMode = "disabled" | "fixture" | "read_only" | "manual_live";

export type CapabilityDecisionStatus = "allow" | "requires_approval" | "blocked";

export interface CapabilityDecision {
  status: CapabilityDecisionStatus;
  reason:
    | "allowed_read_only"
    | "blocked"
    | "disabled"
    | "fixture_only"
    | "requires_approval"
    | "out_of_scope"
    | "limit_exceeded"
    | "missing_secret"
    | "manual_confirmation_required";
  riskLevel: "read_only" | "low_risk" | "medium_write" | "high_write" | "destructive";
  auditRequired: boolean;
  adapterMayRun: boolean;
}

export interface CapabilityRequest<TInput = Record<string, unknown>> {
  id: string;
  kind: CapabilityKind;
  mode: CapabilityMode;
  projectId: string | null;
  createdAt: number;
  input: TInput;
}

export interface CapabilityResult<TOutput = Record<string, unknown>> {
  id: string;
  requestId: string;
  kind: CapabilityKind;
  status: "completed" | "blocked" | "cancelled" | "timed_out";
  decision: CapabilityDecision;
  output: TOutput;
  createdAt: number;
}

export interface CapabilityRuntimeEvent {
  id: string;
  requestId: string;
  kind: CapabilityKind;
  status: "requested" | "blocked" | "completed" | "cancelled" | "timed_out";
  title: string;
  createdAt: number;
  payload: Record<string, unknown>;
}

export type PreviewStatus = "ready" | "blocked" | "truncated" | "missing";

export interface PreviewTruncation {
  truncated: boolean;
  byteLimit: number;
  lineLimit: number;
  originalBytes: number;
  originalLines: number;
}

export interface ContentRedactionSummary {
  replacedSecrets: number;
  replacedPaths: number;
  redacted: boolean;
}

export interface SafeFilePreviewRequest {
  id: string;
  projectId: string;
  rootRef: string;
  rootRelativePath: string;
  byteLimit: number;
  lineLimit: number;
}

export interface SafeFilePreviewResult {
  id: string;
  requestId: string;
  projectId: string;
  rootRelativePath: string;
  displayPath: string;
  status: PreviewStatus;
  reason: string;
  content: string;
  truncation: PreviewTruncation;
  redaction: ContentRedactionSummary;
  createdAt: number;
}
