import type { TaskRunScope } from "@uagent/shared";
import type { RunScopeLease } from "./run-coordinator.js";
import { normalizeRunPath } from "./tool-registry.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Ephemeral approval ownership. Serialized scopes cannot be used to reconstruct a lease. */
export class RunScopeAuthority {
  private epoch = 0;
  private entries = new Map<string, { lease: RunScopeLease; claimed: boolean }>();
  constructor(private now: () => number = Date.now) {}
  approve(input: TaskRunScope, isOwnerCurrent: () => boolean): RunScopeLease {
    const scope = JSON.parse(JSON.stringify(input)) as TaskRunScope,
      epoch = this.epoch;
    if (
      scope.mode !== "read_only" ||
      !scope.id ||
      !scope.runId ||
      !scope.projectId ||
      !scope.conversationId ||
      !scope.rootRef ||
      !scope.providerId ||
      !scope.modelId ||
      this.entries.has(scope.id) ||
      !isOwnerCurrent() ||
      !Number.isFinite(scope.expiresAt) ||
      scope.expiresAt <= this.now()
    )
      throw Error("invalid_run_scope");
    const endpoint = new URL(scope.endpoint);
    if (
      (endpoint.protocol !== "https:" && !(scope.providerId === "codex" && scope.endpoint === "codex://app-server" && scope.collaboration)) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw Error("invalid_run_endpoint");
    if (
      !scope.readPrefixes.length ||
      scope.readPrefixes.length > 8 ||
      scope.sharePrefixes.length > 8 ||
      !scope.toolIds.length ||
      scope.toolIds.length > 8
    )
      throw Error("invalid_run_scope");
    [...scope.readPrefixes, ...scope.sharePrefixes].forEach((path) => normalizeRunPath(path, true));
    for (const [key, value] of Object.entries(scope.limits))
      if (!Number.isSafeInteger(value) || value < 1) throw Error("invalid_run_limit_" + key);
    if (
      scope.limits.maxToolCalls > 30 ||
      scope.limits.maxModelRequests > 31 ||
      scope.limits.maxDurationMs > 3600000 ||
      scope.limits.maxAttemptsPerFailure > 2 ||
      scope.limits.maxToolResultBytes > 16384 ||
      scope.limits.maxContextBytes > 24576
    )
      throw Error("invalid_run_limits");
    freeze(scope);
    const lease: RunScopeLease = Object.freeze({
      scope,
      isCurrent: () => this.epoch === epoch && this.now() < scope.expiresAt && isOwnerCurrent(),
    });
    this.entries.set(scope.id, { lease, claimed: false });
    return lease;
  }
  claim(id: string): RunScopeLease | null {
    const entry = this.entries.get(id);
    if (!entry || entry.claimed || !entry.lease.isCurrent()) return null;
    entry.claimed = true;
    return entry.lease;
  }
  invalidate(): void {
    this.epoch++;
    this.entries.clear();
  }
}
