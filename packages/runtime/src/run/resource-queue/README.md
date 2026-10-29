# T19: unregistered run resource queue

Scope: **one shared instance, in one JavaScript process/event loop**, used by
cooperating coordinators. It provides local admission and conflict ordering.
It is not an OS lock, a cross-process/cross-worker lock, native process ownership,
a global provider quota, or an access/approval authority. Creating multiple
instances bypasses any shared limit between those instances. The host must own
one instance and pass it to every cooperating run. T18 must separately verify
cross-process behavior, physical resource identities and the native boundary.
A host crash/restart loses queue memory while native children may survive. Absence
of an in-memory entry is never stopped proof; crash recovery remains a native/T18 concern.

Nothing in this directory is exported by the production runtime index or wired
to credentials, IPC, UI, model calls, UE, or a background service.

## Reuse and integration

The queue accepts the existing RunScopeLease from run-coordinator.ts, obtained
through the existing RunScopeAuthority in run-scope.ts. It snapshots the scope
owner and calls the original live isCurrent function. It does not implement a
second run coordinator, create a new approval authority, or recover authority
from serialized scopes. Owner/project/root/run/conversation/provider/model/scope
identity and scope expiry description cannot be swapped while queued/running.

The existing scope is read_only. Here it supplies **identity and freshness only**.
It does not authorize an Editor action, UBT launch, file write, outbound request
or cancellation of somebody else's process. Native roots, exact-plan approvals,
provider body approval, quotas and actual process ownership remain required
at their existing boundaries. Keep the existing coordinator's overall run budgets.

Future host integration:

1. Construct one RunResourceQueue at the runtime host, then submit individual
   model requests/fully consumed streams around the existing coordinator work.
   A callback must await all its owned work. Returning an iterator or launching
   detached work and immediately returning is not completion.
2. Supply the current lease, unique live job ID, finite queue/execution timeouts,
   execute callback and all conflict claims at enqueue. Call context.assertCurrent
   immediately before each actual dispatch and propagate its signal. Native and
   provider dispatch must still do their own final freshness/approval checks.
3. For UE/UBT and any operation whose local promise can settle while native work
   may continue, declare external mode with an observer captured for the exact
   existing native execution owner. Do not use a PID or a plan fingerprint alone.
   Map a verified UEBuildExecutionResult.treeStopped plus its owner/status (or the
   corresponding Editor operation observation) through the existing ownership
   adapter. An exception, abort request or transport close is not stopped proof.
4. On owner changes call queue.refresh immediately. While work remains under its
   execution deadline, an in-process timer also checks the live lease every
   100 ms by default. Expired/revoked work receives abort and retains occupied
   resources until quiescence is confirmed.
5. Retained work is inspected through its ticket, and ticket.reconcile makes a
   bounded read-only observation. This remains available after queue.close or
   lease revocation solely to release the same owner's confirmed quiet resources.
   It cannot execute work, terminate an editor, reopen a session, or grant access.

## Admission and conflicts

- Model concurrency defaults to 3 and can only be lowered to 1 or 2. A reserved
  model slot remains occupied after cancellation/timeout while its callback or
  external work is unresolved. Resource-only jobs do not consume model slots.
- All resource claims are acquired atomically. There are no partial acquisitions
  and no public release-by-ID/force-release API. Reconciliation uses the original
  ticket's entry, so a released ticket cannot unlock a newer job reusing its ID.
- UE Editor, UBT and file-write operations use a conservative whole-project lane:
  any claimed-resource jobs in the same project or canonical rootRef serialize,
  including writes to different files. Identical shared resource keys also
  conflict across projects and resource kinds. Independent projects/resources
  may run concurrently. Model/read jobs without resource claims do not take a
  project write lane.
- Resource keys/rootRefs must be canonical, opaque identities from the trusted
  host. This queue does not resolve paths, hard links, Windows case/path aliases,
  or filesystem identities. Do not use it as a substitute for native root guards.
- An older blocked conflicting waiter prevents a later conflicting job from
  jumping ahead; unrelated work can bypass it. Declare all claims up front.
  Nested waits for a conflicting child job are unsupported; locks are not reentrant.
- Outstanding entries default to 128 (configurable, maximum 1024), including
  retained entries. Capacity fails immediately. Finished entries are removed;
  a caller can retain its finished ticket without holding a queue slot.

## Decisions, cancellation and unknown work

ticket.result is the first **bounded decision**, not a promise that all native
effects have stopped. Its immutable status may be reconciling, cancelled,
timed_out or revoked with resources: retained. Use getSnapshot for current
lock/status state. A later reconciliation can update the snapshot to released
without rewriting the original notice.

Queued cancellation/expiry releases admission immediately and never dispatches.
Running cancellation, lease revocation or execution timeout requests abort and
settles the first decision while retaining all claims. An in-process job releases
only once its callback settles. An external job additionally needs its captured
observer to report quiescent. Local success/failure, silence, owner expiry,
unknown/active process status and observer failure never imply release.

Quiescent means the exact owned conflicting operation/process tree cannot
continue; a persistent Editor host may remain alive only when its specific
operation is independently confirmed finished. The queue cannot prove this fact;
the trusted native observation adapter must do so.

Observation is bounded (default 1000 ms, maximum 5000 ms). Concurrent reconciliation
calls share one observation. A timed-out observer's late answer is ignored; a new
explicit reconciliation is required for fresh proof. Unknown retained executions
continue lease/deadline monitoring until stopped/revoked/timed out, then no monitor
runs forever. Retained locks deliberately have no automatic TTL or force unlock.
Blocked waiters still receive their own finite queue timeout.

A callback/observer failure is represented without raw exception text. Public
snapshots are copies; callback owners are frozen. Completed/stopped execution
contexts cannot be reused. queue.close refuses new work and issues cancellation,
but does not discard unresolved resources.

The default clock is monotonic performance.now plus local timers, armed only
while needed. An injected clock must be monotonic, nonthrowing, and schedule
callbacks asynchronously after the requested delay. Callbacks must not block the
event loop; this module cannot preempt synchronous JavaScript or establish remote
server/process termination. No actual remote-model concurrency claim is made.

## Validation

Pure-memory tests use a manual clock and the real RunScopeAuthority. They cover
three-slot admission, project/root/shared-resource conflicts, atomic claims,
waiter fairness, cancellation, timeouts, revocation, callback/observer failures,
unknown process retention, bounded/late observations, duplicate reconciliation,
old-ticket isolation, close/cleanup, context freshness and reentrant cancellation.

No model, UE, UBT, file write, native IPC, real process, credentials, persistence,
cross-process test or whole-repository regression is executed here.
