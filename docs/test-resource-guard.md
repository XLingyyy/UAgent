# Bounded Windows test execution (static draft)

This is test-only fault containment, not a product permission or sandbox feature.
The implementation is not validated yet. Do not run the failed review probe or
resume builds on the strength of this document.

## Launch boundary

The runner uses Python's standard library and Win32 ctypes. It does not compile
C#, Rust or Node code to establish protection. Start it with the existing
E-drive interpreter in isolated, no-bytecode mode:

    . E:\Codex\UAgent\2026-10-29\tools\use-e-drive.ps1
    E:\anaconda\python.exe -I -B scripts\test-resource-guard.py E:\path\spec.json

A bounded 16KiB spec has exactly schemaVersion, profile, executable, args, cwd
and outputDir. The working/output paths must be E:/G:, local and non-reparse;
outputDir must be new. The executable must be an existing absolute .exe path.
No raw arguments or environment values are logged. Only an allowlist of system
and compiler environment variables is inherited; API keys/tokens are not copied.

Before starting a payload, the runner:

1. Establishes an outer Job Object for itself and every descendant.
2. Acquires the single shared exclusive file gate at
   E:\Codex\UAgent\2026-10-29\test-resource-guard\serial.lock. An inherited
   gate handle keeps the lock alive in the watchdog. All three exact previous
   token jobs must be absent or have zero active processes and complete empty PID
   lists. Coherent completion proof or a bound cleanup-only receipt is also
   required. There is no wait/retry.
3. Reads GetPerformanceInfo. WMI is never used. A failure or invalid counters
   refuse execution; there is no alternate permission path.
4. Configures and reads back process/tree commit limits, process-count limits,
   KILL_ON_JOB_CLOSE and no breakaway/silent-breakaway flags.
5. Starts a separate 96MiB watchdog in its own limited job. It acknowledges
   readiness before a payload can be created.
6. Creates the payload suspended, explicitly inherits only its three stdio
   handles, assigns and verifies its exact job, then resumes its primary thread.

The watcher is outside the payload job and uses its own monotonic deadline.
It receives duplicated handles to the original guardian process, payload job,
outer control job, observer job, stop event and gate. PID plus process creation
time and exact job memberships are verified before destructive authority is used.
The original process handle prevents PID reuse from redirecting termination.

The watcher remains alive through the controller's stream close, report writes,
stdout flush and actual process exit. Timeout or an observer exception first
revokes the owned payload, then terminates the verified controller if it remains
alive. It records bounded exit observations. A failure to confirm any exit stays
cleanup_unconfirmed; a last-resort own-control-job termination is recorded as a
plan, not as confirmed cleanup. TerminateJobObject/TerminateProcess are requests:
no strict seconds-level OS completion or kernel-I/O recovery is promised.

The observer holds its own and the outer job handles, so killing the controller
does not kill the observer before its final failure report. The serial gate stays
held during this work. An absent previous named job without a matching cleanup
proof is no longer assumed safe to replace.

Internal workload/recovery/verification controllers return75 for a prepared
operation and keep verifiedSuccess=false. The public command now has the fixed
native outer closer described below. It returns0 only after a protected final
checker succeeds and original worker/controller/observer handles confirm actual
exits0/75/0, checked-close and complete own-stage rundown. A user does not issue
verify-of-verify commands. Intermediate operation files retain provisional
semantics and never rewrite an original failed run.

Shared checks cover matching original controller/observer identities, root exit0,
final sampled watchdog proof, exact limits, readiness and gate ownership, and
all three token jobs absent or active0 with complete empty PID lists and checked
CloseHandle. No old PID is opened. A failed/unconfirmed cleanup cannot become a
successful original run merely because a named job is gone. A root leaving
children behind is cleaned up and remains a failed run.

## Fixed limits

All sizes below are private committed-memory limits, not working-set claims.

| Profile | Per process | Payload tree | Processes | External timeout |
| --- | ---: | ---: | ---: | ---: |
| micro (normal exit first) | 48 MiB | 64 MiB | 3 | 5 seconds |
| micro-process | 48 MiB | 96 MiB | 3 | 5 seconds |
| micro-tree | 96 MiB | 96 MiB | 3 | 5 seconds |
| check | 512 MiB | 768 MiB | 8 | 60 seconds |
| types | 768 MiB | 1024 MiB | 8 | 120 seconds |
| build | 2048 MiB | 3072 MiB | 16 | 360 seconds |

The outer cap additionally reserves 160MiB for the controller and 96MiB for the
watchdog. Before launch, available RAM must exceed 4GiB plus that entire budget;
commit headroom must exceed 8GiB plus that budget. Every 100ms the controller
checks the fixed 4GiB RAM and 8GiB commit floors. A violation terminates the owned
payload job. Thresholds cannot be weakened through the spec.

Node old-space is a supplementary 32/256/512/1024MiB setting; Windows Job Object
limits remain authoritative. Cargo is offline with one build worker. Temporary,
Cargo and Vite directories are fixed to the approved E-drive task roots.
Stdout and stderr are binary streams, each capped at 1MiB; overflow fails the run.
Metadata is bounded to 16KiB per file. No DOM/log pretty printer is in the runner.

## Proposed low-resource verification; not executed

First run only the normal fixed exit under micro, after this revision's independent
static review. Check limit readback, membership, provisional controller exit75,
post-exit watchdog proof and zero processes before considering another case.
Each later case is separately allowed, serial and uses a fresh outputDir. No real
credential, API, production database or user's window is involved.

- Process-only case uses micro-process (48MiB/process, 128MiB/tree): a single
  process makes a 48MiB request plus its existing commit. That exceeds its process
  limit, while aggregate demand remains below 96MiB and cannot hit the 128MiB tree
  or the outer limits. One 1MiB successful control is required before and after.
  Exactly three calls request at most 50MiB in total.
- Tree-only case uses micro-tree (96MiB/process, 96MiB/tree): the parent holds
  48MiB while its child makes one 48MiB request. Each baseline must be positive and
  below48MiB, keeping each process below96MiB; combined demand exceeds96MiB. Parent
  and child controls must succeed. Exactly six calls request at most100MiB total.
- Both cases read their immediate job limits and active-process count. NULL alone
  is not proof. GetLastError is captured immediately. Only quota-specific1816
  with successful controls and healthy system headroom currently qualifies;
  generic8/1455 and all other errors are inconclusive failures. Microsoft's limit
  documentation does not promise one universal allocation error code, so a local
  different result must be investigated rather than counted as a pass.
- These allocations do not touch pages, but still consume commit. Unexpected
  success is freed immediately and fails; no allocation-growth/retry loop exists.
- Eight-second fixed sleep: expect the independent five-second deadline to kill
  the owned tree, including an intentionally lingering child case.
- Breakaway attempt: expect Windows denial and no escaped child.
- A second guardian while one fixed sleeper runs: expect serial refusal before
  any second payload. Never run two test payloads concurrently.
- At most 1MiB+4KiB of fixed output: expect bounded log failure and owned cleanup.

System-floor decisions should also be checked with tiny pure arithmetic fixtures;
do not force the machine into low memory to test the monitor. A process-wide
inherited error mode suppresses child OS error dialogs only; it changes no system
or user setting. Job configuration/assignment denial is a blocker, never a reason
to fall back to an ordinary process.

## run-01 control-rundown diagnosis and static revision

run-01 remains failed. Its watchdog recorded controllerExitConfirmed=true,
payload activeZero=true and controlOnlyObserver=false, but no actual control
count or PID list. Therefore the historical numeric count and exact runtime
cause cannot be recovered from this record. Absence of the three known PIDs is
not evidence that every possible process exited.

The ready path had already verified observer membership in both control and
observer jobs. Nested accounting includes child jobs; expecting the observer in
the outer job is justified. The old ordering made an immediate,
one-shot active==1 check while still holding the original exited-controller
process handle. This is a candidate explanation, not a proven historical cause. Wait-signalled and accounting convergence are separate evidence;
the retained reference and asynchronous rundown were not distinguished.

This revision releases that process handle only after original-handle exit and
exit-code confirmation. It records one reference-held snapshot, then at most
eight reference-released snapshots and seven100ms waits. The criterion is
stronger, never active<=1 or active<=2: both control and observer jobs must have
active==1, complete one-entry PID lists containing the original observer, current
observer memberships must match, and payload active must be zero. Every sample
includes elapsed/epoch milliseconds, handle-held state and actual accounting.

Job PID-list buffers have a fixed32-entry capacity. Truncation, inconsistent list
counts, query error or denied access fail closed without a larger allocation or
permission workaround. Unknown IDs are recorded numerically only: no new
OpenProcess or terminate-by-PID path is added. Existing cleanup stays restricted
to inherited verified own job/creator handles.

Native limits and startup memberships are now preserved in the final record.
The post-exit verifier and prior-lease check require the coherent sampled proof,
not only the summary boolean. run-01 and its old lease are not rewritten or
automatically declared safe; that old unconfirmed lease still blocks execution.

See [nested job accounting](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs),
[active-process accounting](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information)
and [nested PID lists](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list).
These definitions support the revised evidence model; they do not prove what
run-01's unrecorded count was. A new run is not authorized by this static change.

## Protected failed-lease cleanup and verification (r2 static; NOT executed)

The inner controllers for `--recover-lease REQUEST.json` and `--verify OUTPUT` use fixed internal
metadata modes of the existing controller. They cannot select an arbitrary
executable, arguments or profile. The metadata worker is96MiB/process and96MiB/tree,
active limit1, with a separate96MiB observer in a sibling job. The coordinator
lives in the outer job, with active limit3 and352MiB total budget including the
existing160MiB controller reserve. The worker never tries to spawn an observer
from a one-process self-containing job. All spawned processes are suspended,
assigned/verified and only then resumed using the existing native launcher.

Coordinator and observer both precheck RAM>=4GiB+the whole352MiB budget and
commit headroom>=8GiB+that budget. The independent observer enforces the fixed
10-second metadata deadline and checks the original4GiB/8GiB running floors
at100ms intervals, even while request reads, fsync/rename, proof reads, receipt
writes, result writes or stdout flush block the coordinator/worker. The worker
also checks the floors before reading files. Native rejection stays a refusal.
The tiny trusted bootstrap before self-assignment and OS termination timing
remain the documented limitations; no strict seconds-level completion is promised.

The metadata observer verifies its inherited original controller identity, exact
job limits, sibling boundary and memberships, then signals a native ready event.
It performs no request, gate or evidence-file I/O before readiness. The coordinator
waits on that event and the original observer handle; only after readiness does
it acquire the same existing share0 serial.lock, with OPEN_EXISTING. It duplicates
that exact gate handle into the original creation-time/membership-verified observer
and sends only the resulting8-byte handle value through a fixed anonymous pipe.
No PID search is used. The observer retains its gate handle through actual OS exit,
including its final report and Python shutdown. The worker inherits the same gate;
it does not acquire another lock. Missing gate, failed transfer, denied query or
partial data are failures, not reasons to recreate a lock or retry.

The worker verifies all inherited handles, original controller/observer identities,
live observer, ready event, exact limits and memberships before reading a request
or evidence. The observer's termination rights cover only this new operation's
worker job and original coordinator/control handles. It receives no old-job handle.
The recovery core can only OpenJobObjectW(JOB_OBJECT_QUERY) for the old token's
control/payload/watchdog jobs; no old PID is opened and no old-name job is created.
Only missing2 or active0 with complete empty fixed32-entry PID lists qualifies.
All three query handles must close successfully; denial, activity, truncation,
inconsistency or a changed lease/evidence binding stops the operation.

The historical pre-attempt request schema was schemaVersion1, lease:{path,token,sha256}
and2–5 evidence:{path,sha256} entries within16KiB. Original result and watchdog
result are mandatory; ready/spec/summary are the only optional evidence files
at the original output directory/parent locations allowed by the code. Hashes
cover raw bytes. The r1 prepared request is preserved history, not current-schema input or authorization
to invoke it. All run-01 originals and legacy last-lease.json remain unchanged.

A schemaVersion2 cleanup-only receipt is appended exclusively at the original
TOKEN/LEASE_SHA256 path. It permanently says provisional:true,
cleanupNowConfirmed:false and doesNotVerifyOriginalRun:true, and binds protectedBy
operation token/output and original controller/observer/worker identities. The
worker's operation-result.json binds the receipt's exact SHA256; the coordinator
result binds that operation-result SHA256. The final observer proof is produced
only after actual coordinator exit and sampled control rundown. No receipt or
old run is rewritten to claim success.

Admission accepts that provisional receipt only after the shared finished_domain
checks validate its entire recovery domain: matching result/proof/operation-result
identities and hashes, successful worker0, controller75, ready/gate proof,
exact native limits/headroom, coherent original-handle exit/release, exact
observer-only sampled rundown and the three recovery jobs currently absent/empty.
It also rehashes the original bound evidence and rechecks the three old jobs.
A failed recovery domain, missing/partial proof, stale receipt or later failed
lease stays blocked. Receipt presence or worker exit0 alone never suffices.

The same success_records_valid/finished_domain standards are used for a normally
successful prior lease and for verification targets. Result and watchdog must
agree on token and positive original PID/creation-time fields; the result must
name all three exact token jobs, and a lease must match guardianPid/output. Native empty-job checks
and checked-close behavior are shared, rather than a separate control-count-only
verifier. This is a stricter new proof format; old incomplete records fail closed.

Normal workload admission and register_lease now run only after its independent
watchdog is ready. Thus evidence reads, immutable lease fsync, pending-head fsync
and atomic head replacement are protected before any subject creation. Every
registration repeats admission under the still-held same gate. New leases retain
the existing immutable leases/TOKEN.json predecessor chain and atomic small
current-lease index; legacy last-lease, previous records, receipts and evidence
are preserved. Missing/corrupt ledger heads never fall back to the legacy lease.
File flushes do not claim power-loss durability.

Static review must cover ready failure, sibling assignment denial, gate contention
and transfer failure, identity/name/hash mismatch, partial receipt/head/proof,
watchdog exception, blocked worker/coordinator I/O, memory-floor refusal, active
or incomplete old jobs, stale receipts and changed evidence between admission
and registration. No syntax/native-layout/behavior check, recovery, verify,
normal micro, Node probe, product test or build has been executed for r2.
All five owned probes remain unconditionally paused.

References: [DuplicateHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle),
[IsProcessInJob access](https://learn.microsoft.com/en-us/windows/win32/api/jobapi/nf-jobapi-isprocessinjob),
[WriteFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile),
[OpenJobObjectW](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-openjobobjectw)
and [job PID lists](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list).

## Finite original-handle command closure (r3 static; NOT executed)

The public one-spec command currently accepts only the normal micro profile.
Public --recover-lease and --verify use the existing fixed metadata profile.
Other declared workload profiles remain paused; this narrow closer does not
silently raise its caps to run them. No invocation is authorized by this draft.

A fixed outer process owns a96MiB/process,448MiB/tree,active6 KILL_ON_CLOSE family
job with no breakaway. Each of at most two sequential stages has a fresh owned
96MiB/process,352MiB/tree,active5 stage job; its controller is created suspended,
assigned and verified before resume. Normal micro and metadata retain all r2
inner worker/observer limits, readiness, gate and strict proof rules. The outer
process is outside the stage job, so it may revoke a failed stage without killing
itself. It is the sole owner of the outer-family handle, retained until OS exit;
its crash/exit closes that last handle and requests cleanup of its own descendants.
No old process or job receives destructive access.

The outer prechecks the unchanged4GiB RAM/8GiB commit floors plus its full448MiB
budget, and monitors both floors every100ms while waiting. Its stage deadline is
15s for micro and20s for metadata, including startup and inner file/proof work.
There are at most two stages: micro -> one final verify, recovery -> one final
verify, or public verify -> that one verify stage. Each stage has at most1s of
fixed-PID accounting rundown; a failed stage requests termination of that owned
stage only and waits at most3s on known original handles. Failed queries, malformed
IPC, timeout, floor violation, bad exit code, incomplete PID list or any checked
close failure yields nonzero. Failed explicit closes are not retried. There is
no process-name search, PID termination, lock bypass, larger-buffer retry, next
stage after failure, or supervisor-of-supervisor recursion.

The outer performs only native job/process/anonymous-pipe/NUL operations and
bounded primitive state handling. It does not read/stat project files, parse or
hash JSON/evidence, query old named jobs, print or flush a result, or interpret
proof files. Those tasks stay in the existing independently watched controller
and metadata worker. The fixed2104-byte native-layout IPC packet carries only
operation token, output locator and duplicates of original creation handles plus
PID/creation times. Its layout is checked, and its identities, token, actual
stage memberships and distinct processes are checked natively. The locator is
only forwarded to the protected verifier; the outer performs no filesystem
validation of it.

The outer retains the original suspended-created controller process handle.
Before resuming the subject/worker, that controller duplicates its original
observer and subject/worker creation handles into the original outer process
handle, with query/wait access, and publishes their values and identities once.
The outer opens no child PID. Each original handle remains held until actual
exit is observed, its exact exit code is checked, and CloseHandle is checked.
Worker0, controller75 and observer0 are required independently. Each exited
original is released promptly, rather than retaining an exited controller while
waiting for observer rundown. Only after all three checked releases does the
outer require active0 and a complete empty fixed32-entry PID list for its stage,
then checked-close the stage handle. Native scheduling/accounting may still fail
to converge inside the fixed bounds; that remains failure, never relaxed success.

For micro/recovery the first target stage must finish completely before a second
stage is created. That second stage is exactly one existing protected verify
worker. It receives the first stage's outer-generated token as expected target;
finished_domain must match it, so the forwarded locator cannot switch the target.
For public --verify, the one protected worker checks the requested target path.
Its original worker0/controller75/observer0 and complete own-stage exit are then
observed directly by the native closer. No additional verifier is created to
prove the verifier. Public exit0 is the final command verdict; intermediate
controller75 or worker0 alone remains insufficient.

For recovery, the final protected checker additionally compares the exact
receipt bytes/hash against the target operation result, matches the current
lease, and invokes the existing strict receipt/domain/evidence/old3-job admission
checks. This finite call path uses finished_domain records; it never invokes the
public CLI again. Receipt mutation, a changed current lease or any missing final
proof blocks exit0. The old run/lease and provisional receipt are not rewritten.

The trusted native closer itself has no further external supervisor. Its work is
fixed-size native waiting/IPC plus independent child revocation and a self/family
commit cap. Bootstrap before assignment, OS scheduler delays, synchronous native
API stalls and OS cleanup completion remain explicit limitations; no strict
seconds-level guarantee is claimed. No file/JSON/hash/proof operation was moved
into this unsupervised layer. No syntax/layout/native/runtime test has run for r3.

## Fixed identity/lifecycle diagnostics (static only; NOT executed)

The failed recovery4c00cd... retained exact complete member lists but did not
persist outer identity, ClosurePacket reception or outer close events. PID24132
therefore remains unclassified. This instrumentation adds witnesses; it does not
change observer-only, receipt/admission, exit-code, caps, floor or serial rules,
and does not claim a root-cause fix or authorize a retry.

The native outer closer allocates exactly16KiB of anonymous pagefile-backed
shared memory under its existing cap, without changing pagefile settings or
creating a disk file. It contains two8192-byte stage banks. Each Win64 bank has
fixed8016-byte content: published/received ClosurePacket records and four actor
lanes. Each lane has the creator-handle PID/creation time, actual creator PID/time,
a fixed16-event array, sequence and overflow flags. No array or native buffer
is enlarged or retried. These layout values remain untested static expectations.

The outer writes only native shared-memory fields and continues its bounded
native waiting. It adds no JSON/file/proof I/O. Explicit inherited mapping handles
connect the existing controller, observer and metadata worker. A creator records
CreateProcess PROCESS_INFORMATION.pid/tid and original process/thread handles
before Resume. Each executing actor separately records its own GetCurrentProcess
identity. Creator/self mismatches are diagnostic data; they cannot relax any
existing original-handle identity check. The parent tuple identifies the actual
API caller, without querying a system parent-process list.

The shared trace records packet publication, bounded raw packet reception even
before acceptance, packet acceptance, actual original-handle exit observations,
CloseHandle BOOL/error, thread closes and relevant failure/prepared markers.
Known process/thread handle references are tracked in a fixed maximum16-entry
local map. Close error state is captured immediately and restored after tracing;
checked-close behavior and no-retry semantics remain intact. The observer's
deadline starts before its additional startup diagnostic queries.

Only already-held original handles are queried for identities/memberships.
Full fixed32-entry PID lists and accounting snapshots are taken for the three
new owned jobs; a matrix compares known outer/controller/observer/worker handles
where available. Missing or already-closed originals are explicitly marked.
Unknown numeric PID entries are recorded without OpenProcess, image lookup,
parent lookup or termination. PID matches alone are never promoted into
creation-time-authenticated identities or a reason to ignore a member.

The worker writes diagnostic-worker-start.json after the existing native ready,
identity, membership, cap and floor checks, before request/evidence work. On a
successful core it also writes diagnostic-worker-finish.json. The observer
captures its startup job matrix into bounded local data after native ready,
and writes diagnostic-observer-final.json during the existing protected final
report path. Every diagnostic file is exclusive, primitive JSON capped32KiB.
There are at most three per stage/six per command. No new process, workload,
allocation fixture, CLI mode, real key, environment dump or network call is added.
Diagnostic output failure fails the enclosing operation rather than opening a
bypass. All output is local in the fresh operation directory on E:.

A reader takes exactly two fixed-size copies, records even-sequence/stable-byte
status, and preserves overflow/unavailable flags. This is diagnostic evidence,
not a globally atomic transaction or a success proof. Final observer/outer exit
and closes after the last protected recorder has exited cannot be retroactively
written by that recorder; a second stage can preserve prior-stage shared events.
Failure before any protected recorder is ready may leave no diagnostic file.
No naked fallback writer or extra unbounded supervisor is introduced.

Worker/observer reports include bounded sys.executable/_base_executable, prefixes,
flags and the current process's own GetModuleFileNameW(NULL) path (512WCHAR fixed
buffer, truncation/error flags, no growth). This is not an image query on an
unknown PID. It helps compare Python creator and executing identities without
assuming that Python/conda wrappers caused the historical extra member.

Read-only startup inspection found local python.exe version3.13.5 and the strings
Py_Main/python313.dll; it did not find direct CreateProcess/venv-redirector strings
in that small executable. Four installed .pth bodies were inspected. Those facts
are not a full binary/runtime trace and do not identify24132. Python -I does not
imply -S; site startup is still possible. Launch flags are deliberately unchanged.
A separate startup-inspection.json records exact files/hashes and limitations.

The earlier single low-resource diagnostic plan was supplied for independent
review only. The current attempt protocol below supersedes its receipt-path blocker. The existing failed provisional
receipt87A638... is preserved at the deterministic receipt path, so the unchanged
recovery core will reject it with recovery_receipt_exists after worker-start
logging. A successful normal recovery diagnostic is blocked until a separately
reviewed attempt-specific receipt policy/request preserves that history without
allowing the failed receipt to clear admission. This instrumentation does not
implement that policy, delete an old receipt, change gate roots or auto-retry.

References: [current-process module path](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-getmodulefilenamew),
[Python command-line isolation](https://docs.python.org/3.13/using/cmdline.html#cmdoption-I),
[CPython3.13.5 main](https://github.com/python/cpython/blob/v3.13.5/Programs/python.c)
and [venv redirector source](https://github.com/python/cpython/blob/v3.13.5/PC/venvlauncher.c).

## Current per-lease attempt recovery (static only; NOT executed)

This section supersedes the old fixed-receipt entry/admission paragraphs for new
recovery commands. Existing fixed lease/receipt/execution01 and every failed
operation remain immutable history. No process, workload, supervision layer or
history-search mechanism is added. Shared diagnostic packet tokens now retain
exact32-byte hex, replacement-text and a validity flag; unverified non-ASCII/NUL
packet data cannot abort diagnostic decoding. Native packet acceptance remains
strict and unchanged.

Requests now have exactly schemaVersion2, lease:{path,token,sha256}, attemptId,
expectedPreviousAttempt and evidence. attemptId is lowercase32hex. No attempt,
receipt, pointer, final-proof or caller-receipt path is supplied by the request.
Paths derive only from the current strict lease token/hash and attemptId:

    test-resource-guard/recovery-attempts/LEASE_TOKEN-LEASE_SHA256/
      current-attempt.json
      ATTEMPT_ID/attempt.json
      ATTEMPT_ID/receipt.json
      ATTEMPT_ID/final-binding.json
      ATTEMPT_ID/command-exit.json

The current pointer is a small exact lease/reference record. Its selected
attempt.json must match the raw file hash and canonical derived directory.
Missing/corrupt head or record refuses operation. The code never enumerates,
sorts, globs or walks prior attempts to locate a success. A direct predecessor
reference is either null for a lease with no history, exact attemptId/hash, or
the pinned legacy receipt87A638... plus execution01 B0E9F9... hashes. The known
legacy b0c860... lease requires that exact legacy reference; unrecognized fixed
receipts cannot be ignored. Legacy files and the known recovery-domain token
are checked, and its control/payload/watchdog must be absent2 or complete empty.

Under the same inherited exclusive gate, one current predecessor is validated.
For an attempt predecessor, only its recorded recovery token and, if registered,
unique final-verifier token are queried for complete native3-job emptiness. No
success verdict is inferred from that retirement check. Denial, activity,
incomplete lists, wrong expectedPreviousAttempt or malformed binding stops the
new attempt. No unknown PID is opened and no old job is terminated or recreated.

Before the cleanup body, the worker exclusively creates the attempt directory
and attempt.json. That immutable record binds lease, request/source SHA256,
canonical public command and its hash, predecessor and the new recovery token.
The worker rechecks lease/predecessor, then atomically publishes the small pointer
from a flushed exclusive pending file. Cleanup/evidence rechecks and provisional
receipt creation follow. After publication every failure remains the selected
current attempt. There is no rollback to a former successful attempt. An
interrupted first registration without a valid head is pending/blocked; orphan
pre-publication directories are retained and never scanned for admission.

The new schema3 receipt lives only in that attempt directory and binds the
attempt record hash, source/request/command hashes, original evidence and actual
recovery identity/domain. It remains provisional:true, cleanupNowConfirmed:false
and doesNotVerifyOriginalRun:true. No old receipt or failed run is rewritten.

The automatic second-stage verifier, identified by the existing native closer's
expected target token, binds final-binding.json once under the same gate before
its final-body checks. The binding includes the exact attempt, receipt hash,
target recovery token, unique verifier token/identity and source/request/command
hashes. A repeated binding attempt refuses even if the token is the same. The
verifier result binds that file hash, attempt, receipt hash and target report/
watchdog hashes. Its own strict domain proof must later complete. Ordinary public
verify is read-only for attempt state and cannot create/change this binding or
substitute its own verifier domain for the bound one.

The guard and native closer never write command-exit.json. The separately
reviewable invoke-attempt-once.ps1 is the caller flow: it checks expected frozen
hashes, invokes the existing public recovery command once, captures actual
LASTEXITCODE, checks registered attempt/actual argv/source/request bindings and
exclusively writes that bounded receipt. It neither creates attempt state nor
writes the pointer nor retries. Its receipt binds attemptId/record hash, lease,
canonical actual command, source/request/command hashes, one invocation and real
public exit code. If the command failed before registration, no attempt receipt
is fabricated. If recording fails, absence/partial data stays blocked.

Admission always selects current-attempt first when one exists, even if an old
workload or older attempt had success evidence. Missing public-exit receipt is
pending; exact exit1/other nonzero is failure. Only exact integer exit0 with all
bindings permits further checks: strict recovery proof, immutable receipt,
unique bound final verifier's complete strict proof and result hashes, original
request/evidence hashes and current native empty states. The current head is
rechecked at the end. A new workload lease repeats the whole check immediately
before registration. Diagnostics, receipt presence, worker0, internal75 or an
older successful attempt cannot substitute for this clearance.

The supplied schema2 request names a fresh attempt and the exact legacy
predecessor, retaining the old schema1 request unchanged. The supplied caller
script and execution plan are review artifacts, not authorization to run them.
No current-attempt pointer/directory, new receipt, final binding or caller-exit
record has been created by target code in this static revision. No compile,
syntax/native-layout probe, recovery, normal micro, Node, product test or build
has run. Resource caps, floor thresholds, global gate and observer-only criterion
are unchanged.

## Limits and remaining work

This controls cooperating test launches through this runner. Other user programs
can still consume memory. Job commit limits do not hard-cap GPU/driver allocations
or file-cache residency, and periodic RAM monitoring is an extra precaution, not
a guarantee of zero desktop disturbance. Same-user hostile code is outside this
fault-containment claim. This does not authenticate project permissions.

The Python bootstrap before self-assignment is a small trusted standard-library
path, not restricted from process birth; do not describe it as already inside the
job. Native API/assignment failure refuses payload creation. Controller-stall and
observer-exception runtime fault checks still need separately reviewed tiny cases;
no real disk stall or low-memory pressure may be manufactured for them.

Static review, bounded syntax/native-layout checks, normal micro exit, individually
approved later fixtures and independent review must finish before any credential
candidate check or build. A few basic cases are not proof of complete protection.
Reference: [QueryInformationJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject)
defines the immediate job for NULL queries; [job memory limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)
define independent committed-memory process and tree limits.

The known failed probes.cjs is not approved for retry. No new EXE has been built
during this protection work; the credential candidate remains 9017eab.


## Four-case fixed verification contract (2026-10-31; static, not executed)

The current source now permits only micro and two exact fixture-only quota profiles:
micro-process48/96MiB and micro-tree96/96MiB. check/types/build remain rejected.
Quota fixtures receive query-only handles to their owned control/stage,
record conservative committed-memory peaks and reject an ambiguous limit cause.
The tree child explicitly uses DETACHED_PROCESS and an explicit inherited handle list.

The fixed --serial-owner command reserves a fresh640MiB combined budget, records
an exclusive pre-Resume launch, and waits at most120*25ms for a source/token-bound
release after the contender's real exit. --gate-entry is a branch of the existing
native closer: only root plus controller,192MiB total/two processes, no payload,
observer or lease registration. A single same-gate sharing32/33 refusal is required.
Public73 additionally requires original controller exit73, checked-close and a
complete empty child stage. The root performs only fixed native/packet work.
The caller writes a separate exclusive real-exit receipt; controller files alone
remain provisional. The owner consumes that bound receipt before normal exit.

--timeout-check accepts only the exact fixed micro timeout-sleep fixture. It saves
immutable launch.json before Resume, the fixture writes entered.json bound to
token/source/fixture/launch hash and original subject identity, then sleeps8seconds.
After matching entry the controller pauses8seconds. The unchanged independent
five-second watchdog must revoke both. For this fixed case only, the original
closer waits for subject124/controller124/observer124 and checks every original
release and complete empty stage before starting its single existing metadata final.
That protected worker checks strict observer-only/native limits/headroom,
original-handle diagnostic witnesses and current complete three-job emptiness.
Its own domain must still exit worker0/controller75/observer0 and become empty.
Only then does the public command return74. Normal success predicates are unchanged.

timeout-check.json remains provisional until actual public74. The caller exclusively
writes command-exit.json with exactly schemaVersion1, token, sourceSha256,
launchSha256, watchdogSha256, timeoutCheckSha256, publicExitCode74, invocations1,
checkPassed:true, operationSucceeded:false, cleanupVerified:true.
Only the existing cleanup-only schema2 attempt protocol may then clear admission,
with exactly launch.json, entered.json, watchdog-result.json, timeout-check.json
and command-exit.json as its five hash-bound evidence files. No original result
or lease is rewritten and the timeout workload remains failed. General exit1,
missing evidence, an unexpected code or incomplete cleanup stops later cases.

The batch is fixed: two quota commands0; serial owner0 and contender73; timeout74;
one cleanup-only recovery0. At most six public calls, no retries or verify recursion.
No other fault case, Node/product probe, build, real key/API or production data
is enabled here. Static source changes and this contract need independent review
before any of these commands runs; no syntax or runtime check has yet executed.

The outer retains the sole family handle so crash KILL_ON_JOB_CLOSE is preserved.
Family commit is conservatively bounded by stage peak plus the outer96MiB hard
process cap; that bound plus48MiB must remain below448MiB. No family handle is
inherited. Diagnostic event15 records controller entry into the fixed timeout
pause; the protected negative checker requires it. The watchdog records its own
source hash, which must match launch/entry/caller bindings. All are static only.
