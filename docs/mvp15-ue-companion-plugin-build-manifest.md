# UAgentAssetTools Build Manifest Contract

## Status

This document separates current MVP15D D2 source-contract work from later final
15A packaging. Rework 7 is `NEEDS_FIX` because repository documentation/report
facts were inconsistent, while code and retained evidence validation passed.
Rework 8 is `IN_PROGRESS`, source-checkpoint acceptance is `BLOCKED`, Ready is
`NO`, and the current blocker is `PENDING_SUPERVISOR_CHECKPOINT`.
Previous/current task IDs are
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-7` and
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-8`.

The retained Rework 7 task-only build/source/manifest bundle is
`external/mvp15d-rework7-build-20260726_203000`. It contains 60 files total (59
inventory-tracked payload files plus `inventory.json`) and has bundle SHA-256
`ef86e59c05068f9610050a2afa44bf3237d3fd78e82262cf6d3be6660223420b`,
inventory self/file hashes
`096e92b42f28eda7c227efde9747c33dd7c3c2f8d1e08988af77588f09b83303` /
`e8c05405d6feb9759b13e1856c338c9cdcaf7edee7a9acad6528a57e340c09b4`,
manifest file/self hashes
`236f1da71961fd697e81ad0a6d9f53f82076b71019e74400eed8b95f0d69ac84` /
`def7a4a9a08ec54827721ad6b600e8f6bf20f03dead001e277cc33505c9becc1`,
source-tree SHA-256
`0501df66863e1ca3b09d69ab82363279501e8238fa3ccfec77e80cc059b5cefe`,
and byte-equal source-bundle SHA-256
`93b3bb310ef17b18adb85b413360890648a9ab614301cedbf19ba81fb42146f6`.
The v1 manifest retains its all-zero task-only `sourceCommit`; it is not final
15A clean provenance. Descriptor, schemas, canonical vector, module index,
runtime/test DLL bytes, logs, ledgers, and source snapshots remain independently
recomputable. Content stayed empty at
`926acba71ebeb9e598c2c5219019667a8685f0c444f13761ea8ffc37dfe5466d`;
process/port/marker residuals are zero. The fresh build and incremental rebuild
both exited 0 with one local action and no low-memory reschedule. The retained
Job ledgers disclose 41 membership events, 29 complete identities, 12
short-lived incomplete identities, 40 explicit exit events, one exit closed by
`ACTIVE_PROCESS_ZERO`, and zero residual process.

`BLOCKED_BY_EVIDENCE_RETENTION` is closed. D13, 15A, 15B, and 15C remain
prohibited.

The retained Rework 5 source run used a task-only pre-checkpoint manifest
with SHA-256
`9ef28df58bea41d14d78cf6591eba3c0f9d8da8d5e41a5e7dc49c9fbae1d83f9`,
source-tree SHA-256
`26585ddc64e874e72ff0ab46f8f85b3902366fd1324de52dd083b4fa79b30275`,
and plugin/test module SHA-256 values
`4d2ad698849e3a5d513a71fa227fd1243bca51eadf8bf7a25a7a921446ae46aa`
and `c9b01899259e19eadbaa899cc39095aae8a2ae225d1ecce5e1a7f5a206e2e01d`.
Its all-zero `sourceCommit` is an explicit task-only marker; it is not the final
15A clean-package manifest.

Historical Rework 3 source work added inverse, native observation, probe, and
test code, and current-source `BuildPlugin` compilation was recorded as compile
evidence. Its historical supervisor verdict was `NEEDS_FIX`: actual
product-adapter D0, the full UE matrix, complete ownership, partial-effect
recovery, completion-ordered revocation, and positive loaded-module integration
remained open.

The canonical build helper rejects a dirty worktree with `SOURCE_TREE_DIRTY`.
That is correct for a final 15A package, but it does not block Rework 5 source
integration history or Rework 7 review evidence. No final manifest, installed/loaded identity proof,
or 15A result exists. The retained Rework 5 D0 evidence is a separate historical
source-checkpoint artifact and is not a final build manifest. Rework 7 durable
D0/build/UE evidence closes the retention defect; it does not create the later
clean 15A manifest.

## Review-only snapshots are not final manifests

A historical Rework 5 review-only source snapshot may describe planned files or validation inputs,
but it must not be named or represented as `UAgentAssetTools.build.json`, a clean
package, installed/loaded identity proof, or D0 evidence. Only the future 15A
flow below may create the final manifest from a clean, supervisor-approved source
commit/tree.

## Required manifest

`UAgentAssetTools.build.json` must validate against
`integrations/unreal/UAgentAssetTools/Resources/uagent-companion-build-manifest.schema.json`
and contain:

- plugin id/version and independent `mvp15d.asset-tools.v1` contract version;
- 40-lower-hex `sourceCommit`, 64-lower-hex `sourceTreeSha256`, and literal
  `dirty: false`;
- UE `5.8.0`, BuildId `55116800`, Win64 Development configuration, non-sensitive
  compiler/Windows SDK/build-command fingerprint;
- `UAgentAssetTools.uplugin`, contract schema, and every packaged module's
  basename, byte size, and SHA-256;
- ordered exact-six tool names, generated timestamp, non-sensitive builder
  identity, and `manifestSha256`.

The self-hash rule is canonical UTF-8 JSON with lexicographically sorted object
keys, preserved array order, no insignificant whitespace, and the
`manifestSha256` property omitted while hashing. The final hash is not hashed
again. Paths, binaries, PDBs, logs, credentials, and machine-local absolute
paths do not belong in the manifest. Final-package repository documentation
uses stable evidence identifiers; the current implementation verification and
status ledgers may retain task-owned D0/UE evidence roots required for
checkpoint review.

## Future 15A reproducible flow (not authorized during Rework 7)

1. Supervisor reviews and commits the source checkpoint. The commit SHA is the
   only valid `sourceCommit` for final packaging.
2. Create a task-owned clean archive/snapshot from that commit. Do not package
   the dirty implementation worktree.
3. Run the official UE 5.8 command:

   ```text
   RunUAT.bat BuildPlugin -Plugin=<clean-source>/integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin -Package=<task-owned-package> -TargetPlatforms=Win64
   ```

4. Only after the source checkpoint is accepted and 15A is separately authorized,
   generate the manifest with `scripts/mvp15d-manifest.mjs create`; the helper
   itself must verify the commit/tree/clean snapshot rather than trusting
   caller-declared `dirty: false`.
5. Run the repaired `scripts/mvp15d-manifest.mjs verify` against the real package
   root so it rehashes every declared artifact, rejects extra/unlisted modules,
   and compare installed and loaded
   module basenames, sizes, and hashes with the manifest inside a new
   task-owned disposable UE project. A duplicate companion copy or an extra
   module fails closed.
6. Only after 15A passes may the real desktop adapter produce the live
   identity/fingerprint evidence required by 15B, followed by the fresh UI
   lifecycle in 15C.

## Failure mapping

- source/dirty/manifest/module mismatch: `BLOCKED_BY_PLUGIN_PROVENANCE`;
- live descriptor identity mismatch: `BLOCKED_BY_PLUGIN_IDENTITY`;
- incomplete exact-six contract: `BLOCKED_BY_MCP_SCHEMA`;
- initialize/discovery failure: `BLOCKED_BY_MCP_TRANSPORT`;
- UE/native/session/root/gate failure: `BLOCKED_BY_ENVIRONMENT`.

No manifest, installed module, loaded module, or live fingerprint result in this
source checkpoint should be interpreted as a final acceptance result.
