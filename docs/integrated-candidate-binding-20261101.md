# Bound integrated candidate review, 2026-11-01 r4

Status: static only; do not execute until independent review. No new build/test.
Review evidence: ../../../evidence/integrated-product-20261101-r4/review-manifest.json.
Main review files: scripts/test-resource-guard.py, invoke-integrated-build-once.py,
integrated-build-binding.py; r4 web-spec.json/native-spec.json; guard.diff/caller.diff.

G1: new fixed bound profiles write fresh web/native E-drive directories and keep
all earlier profiles, commands and outputs. The caller captures bounded frontend
source bytes BEFORE web launch and binds that inventory SHA in the suspended-root
invocation. After public build0 with original-handle exit, checked-close, Job-empty
and automatic verification, it requires unchanged source/current snapshot bytes,
copies actual frontend artifacts and publishes a binding to exact proof hashes.
Before ANY native root is created it rechecks that successful public proof,
source snapshot/current sources and artifact snapshot/current output all match.
It repeats those checks after native public success. Native candidate records
carry web assessment, original exit/invocation, spec, result/watchdog, input inventory,
artifact manifest and binding SHA256 values, plus the EXE SHA256. Missing/tampered/
stale files refuse candidate creation and are retained. The native output directory
must also be fresh. There is no fallback to r3 assets or a source-only ZIP.

Source boundary: web src/public, runtime/shared/mcp-client src and exact package,
lock and Vite/TS config files. Bounds:2048 files,512 directories per walked root,
8MiB/file,64MiB total,1MiB manifest,64KiB streaming buffer. No node_modules traversal,
credential/database read, .env file read or path outside E/G. Presence of .env files
in Vite-relevant root directories is refused without reading them. Dependency
implementation bytes are not copied; this binds lock/config and workspace inputs.
Before/after equality is not an adversarial atomic filesystem snapshot. Authors
must finish their assigned changes before a candidate build is frozen.

G2: r3 configured512MiB tree but recorded539226112 bytes,2355200 bytes (2.24609375MiB)
above its536870912 limit. The value comes directly from the x64 SIZE_T peak field
at offset136; the full structure is144 bytes. It is queried after payload active0
and before Job close. Correct limit flags/readback and protected build/cleanup0
remain evidence; neither those facts nor this peak alone explain the discrepancy.
No load was rerun to investigate. New r4 candidate publication conservatively
requires nonmissing process/tree peaks <= their configured limits. Original r3
success records are untouched; memory assurance is separately unresolved.

Microsoft documents [the peak fields and configured commit limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)
and [the hard memory-limit flags](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information).
Those definitions do not establish a cause for this particular recorded difference.
No allocation-attempt, rounding or race explanation is asserted as fact.

T11 static integration was also repaired: cfg-windows module, exact availability
command and inline MCP settings panel; actual semantic queries remain disabled.
The earlier r3 frontend bundle does not include this change and cannot supply r4
binding. The new pair requires a fresh frontend build after independent review.
RAM4GiB/commit8GiB floors and complete budgets remain unchanged. r4 profiles use
512/512MiB web and768/896MiB native, including the same independent watchdog,
original handles, no breakaway, serial gate and automatic closer/verifier.

Independent module assignments and offline acceptance requirements are in
parallel-native-provider-boundaries-20261101.md. Settings and RunStore share
runs.sqlite3, so both write paths must participate in writer ownership.
