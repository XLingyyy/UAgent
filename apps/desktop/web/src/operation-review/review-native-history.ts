import type { NativeHistoryActionStatus, NativeRunArchive } from "../runtime/native-run-history";

export interface NativeHistoryReviewDocument {
  readonly reviewId: string;
  readonly revision: string;
  readonly identity: {
    readonly projectId: string;
    readonly sessionId: string;
    readonly runId: string;
    readonly runRevision: number;
  };
  readonly title: string;
  readonly runStatus: NativeRunArchive["descriptor"]["status"];
  readonly complete: boolean;
  readonly hasUnresolvedHistory: boolean;
  readonly currentExternalEffects: "unverified";
  readonly requiresFreshAuthorization: true;
  readonly tools: readonly {
    readonly id: string;
    readonly stepId: string;
    readonly toolName: string;
    readonly recordedStatus: NativeHistoryActionStatus;
    readonly argumentsText: string;
    readonly resultText: string | null;
  }[];
}
/** Display projection of an archive already validated by createNativeRunHistory().
 * Historical success describes the saved tool record, never current external state.
 * reviewId/revision identify this display and are never an execution permit.
 */
export function reviewNativeHistory(archive: NativeRunArchive): NativeHistoryReviewDocument {
  const saved = archive.descriptor, snapshot = archive.snapshot, run = snapshot.run;
  if (archive.schemaVersion !== 1 || saved.projectId !== run.projectId || saved.sessionId !== run.sessionId || saved.runId !== run.id || saved.goal !== run.goal || saved.status !== run.status || !Number.isSafeInteger(run.revision) || run.revision < 0 || snapshot.requiresFreshAuthorization !== true) {
    throw new Error("native_history_review_invalid_identity");
  }
  const uniqueSteps = new Set(snapshot.steps.map((step) => step.id));
  const uniqueTools = new Set(snapshot.toolCalls.map((tool) => tool.id));
  const complete = archive.completeness.complete && uniqueSteps.size === snapshot.steps.length && uniqueTools.size === snapshot.toolCalls.length && snapshot.toolCalls.every((tool) => uniqueSteps.has(tool.stepId));
  return Object.freeze({
    reviewId: JSON.stringify(["native-run-archive", run.projectId, run.sessionId, run.id]),
    revision: String(run.revision),
    identity: Object.freeze({ projectId: run.projectId, sessionId: run.sessionId, runId: run.id, runRevision: run.revision }),
    title: saved.goal,
    runStatus: saved.status,
    complete,
    hasUnresolvedHistory: saved.hasUnresolvedEffects || snapshot.hasUnknownExternalEffects || snapshot.toolCalls.some((call) => call.status === "unknown" || call.status === "inFlight") || snapshot.steps.some((step) => step.status === "unknown" || step.status === "inFlight"),
    currentExternalEffects: "unverified",
    requiresFreshAuthorization: true,
    tools: Object.freeze(snapshot.toolCalls.map((tool) => Object.freeze({
      id: tool.id, stepId: tool.stepId, toolName: tool.toolName, recordedStatus: tool.status,
      argumentsText: JSON.stringify(tool.arguments, null, 2),
      resultText: tool.result === null ? null : JSON.stringify(tool.result, null, 2),
    }))),
  });
}
