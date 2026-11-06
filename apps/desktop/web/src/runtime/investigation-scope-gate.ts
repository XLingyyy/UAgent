import { RunScopeAuthority, normalizeRunPath, type RunScopeLease } from "@uagent/runtime";
import type { TaskRunScope, CollaborationMembers } from "@uagent/shared";
import { defaultInvestigationLimits, PROJECT_READ_TOOL_IDS } from "./project-read-tools";
export interface InvestigationScopeProposal {
  projectId: string;
  projectName: string;
  rootRef: string;
  conversationId: string;
  runId: string;
  providerId: string;
  modelId: string;
  endpoint: string;
  goal: string;
  collaboration?: "independent_review" | "dynamic_delegation";
  collaborationMembers?: CollaborationMembers;
  sessionExpiresAt: number;
}
export interface PendingInvestigationScope {
  id: number;
  proposal: Readonly<InvestigationScopeProposal>;
}
export function createInvestigationScopeGate() {
  const authority = new RunScopeAuthority(),
    listeners = new Set<() => void>();
  let pending: PendingInvestigationScope | null = null,
    id = 0,
    current: (() => boolean) | null = null;
  let resolveLease: ((lease: RunScopeLease) => void) | null = null,
    rejectLease: ((e: Error) => void) | null = null;
  const notify = () => listeners.forEach((fn) => fn());
  function cancel() {
    authority.invalidate();
    rejectLease?.(Error("scope_review_cancelled"));
    pending = null;
    resolveLease = null;
    rejectLease = null;
    current = null;
    notify();
  }
  return {
    getPending: () => pending,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    invalidate: cancel,
    claim: (scopeId: string) => authority.claim(scopeId),
    review(proposal: InvestigationScopeProposal, isCurrent: () => boolean): Promise<RunScopeLease> {
      cancel();
      if (!isCurrent()) return Promise.reject(Error("scope_review_stale"));
      pending = Object.freeze({ id: ++id, proposal: Object.freeze(JSON.parse(JSON.stringify(proposal)) as InvestigationScopeProposal) });
      current = isCurrent;
      return new Promise((resolve, reject) => {
        resolveLease = resolve;
        rejectLease = reject;
        notify();
      });
    },
    approve(
      reviewId: number,
      choice: { prefixes: string[]; shareResults: boolean; maxToolCalls: number },
    ): boolean {
      if (!pending || pending.id !== reviewId || !current || !current()) {
        cancel();
        return false;
      }
      try {
        const p = pending.proposal,
          owner = current,
          prefixes = [...new Set(choice.prefixes.map((path) => normalizeRunPath(path, true)))];
        if (
          !prefixes.length ||
          !Number.isInteger(choice.maxToolCalls) ||
          choice.maxToolCalls < (p.collaboration?Object.keys(p.collaborationMembers??{investigator:null,reviewer:null}).length:1) ||
          choice.maxToolCalls > 30
        )
          throw Error("invalid_scope");
        const limits = {
          ...defaultInvestigationLimits(),
          maxToolCalls: choice.maxToolCalls,
          maxModelRequests: Math.min(31,choice.maxToolCalls + (p.collaboration?Object.keys(p.collaborationMembers??{investigator:null,reviewer:null}).length+(p.collaboration==="dynamic_delegation"?2:1):1)),
        };
        const scope: TaskRunScope = {
          id: crypto.randomUUID(),
          runId: p.runId,
          projectId: p.projectId,
          conversationId: p.conversationId,
          rootRef: p.rootRef,
          providerId: p.providerId,
          modelId: p.modelId,
          endpoint: p.endpoint,
          mode: "read_only",
          ...(p.collaboration?{collaboration:p.collaboration}:{}),
          ...(p.collaborationMembers?{collaborationMembers:p.collaborationMembers}:{}),
          readPrefixes: prefixes,
          sharePrefixes: choice.shareResults ? prefixes : [],
          toolIds: [...PROJECT_READ_TOOL_IDS],
          limits,
          expiresAt: Math.min(p.sessionExpiresAt, Date.now() + limits.maxDurationMs),
        };
        const lease = authority.approve(scope, owner),
          resolve = resolveLease;
        pending = null;
        resolveLease = null;
        rejectLease = null;
        current = null;
        notify();
        resolve?.(lease);
        return true;
      } catch {
        return false;
      }
    },
  };
}
export const investigationScopeGate = createInvestigationScopeGate();
