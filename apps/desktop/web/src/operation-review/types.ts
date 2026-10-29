export type ReviewSource = "semantic" | "files" | "scene" | "effects";
export type ReviewState = "planned" | "completed" | "failed" | "unknown" | "not-started";
export type ReviewOperation = "create" | "modify" | "remove" | "inspect";
export interface ReviewChange {
  label: string;
  before: string | null;
  after: string | null;
}
export interface ReviewItem {
  id: string;
  kind: "file" | "object" | "effect";
  target: string;
  operation: ReviewOperation;
  state: ReviewState;
  changes?: readonly ReviewChange[];
  diff?: string;
  notes?: readonly string[];
}
export interface OperationReviewDocument {
  id: string;
  revision: string;
  title: string;
  source: ReviewSource;
  mode: "preview" | "result";
  integrity: "complete" | "incomplete";
  items: readonly ReviewItem[];
  notices?: readonly ("not-saved" | "cancelled-not-rollback" | "check-state" | "incomplete")[];
}
export interface ReviewIdentity {
  id: string;
  revision: string;
  title: string;
}
export interface ReviewDecision {
  readonly reviewId: string;
  readonly revision: string;
}
export interface ReviewAction {
  readonly reviewId: string;
  readonly revision: string;
  readonly enabled: boolean;
  readonly onRequest: (decision: ReviewDecision) => void | Promise<void>;
}
