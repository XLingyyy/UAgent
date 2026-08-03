# UAgentAssetTools Build Manifest Contract

## Status

Final Source/Tooling Rework 7 is the historical/current predecessor `PARTIAL`;
its supervisor verdict was `NEEDS_FIX`, and no checkpoint was created. Final
Source/Tooling Rework 8 source implementation is `IMPLEMENTED, awaiting
supervisor checkpoint` in a
dirty pre-checkpoint tree. The build wrapper and native/runtime
consumers use manifest v3 and identity v2 with independent engine version
`5.8.1`, engine changelist `56057345`, compatible changelist `55116800`, and
module BuildId `55116800`. G14 is `IMPLEMENTED`; G15 is `IN_PROGRESS`; G16 is
`PARTIAL`; D13 / 15A is `BLOCKED`; D14 / 15B and D15 / 15C remain `PLANNED`;
D16 is `IN_PROGRESS`; real UE 5.8.1 compatibility and overall acceptance
remain `PARTIAL`; Ready is `NO`.

The compiled pre-checkpoint identity uses
`uagent.mvp15d.production-source-boundary.v2`: 335 production files discovered
from 14 roots plus 28 exact files, 9 exclusion classes, 126 excluded entries,
and 356 source/Git watches. It includes the companion source, resources,
descriptor, and build inputs along with the transitive desktop and final-tooling
inputs. New production files and tracked production deletion cannot remain
unhashed.

The v3 source contract invokes the validated caller-supplied `RunUAT.bat` with
the exact ordered `BuildPlugin`, absolute plugin/package,
`-TargetPlatforms=Win64`, and `-Rocket` arguments. Its fingerprint binds the
launcher bytes, ordered-argument hash, detached-clean source commit/tree,
physical fixture bytes, descriptor, package output identity, UE/BuildId,
compiler, SDK, platform, and configuration. Live results retain redacted source
transcripts and fail closed on missing toolchain evidence, nonzero exit, or
partial output.

Manifest v3 recomputes every shipped artifact, rejects source/Intermediate/
HostProject/extra/link/reparse/case-colliding/secret-bearing entries, and emits
distinct canonical self and manifest-file hashes. Installed verification
requires one complete project copy and rejects Engine/user shadow copies.
Structural loaded-module verification reports
`installed_loaded_structural_verified` with
`productionLaunchAuthorityVerified: false`; it cannot establish production
launch ownership. Final Source/Tooling Rework 8 preserves the sole owned live
publisher after explicit PID/creation equality and independent derivation of
source, project, manifest, package, install, executable, producer/helper/
observer, and Job facts. Exported/CLI verification rehashes the ledger and
cross-binds all artifacts, exact modules, event/report, and zero Job residue,
but it remains persisted consistency with launch authority false. Only the
same-process fixed non-injected launch can consume the private receipt and
return owned-launch authority. A coherent hand-authored chain may satisfy
persisted consistency but cannot acquire that receipt. The historical
Rework 2 UE 5.8.1 BuildPlugin run passed.
BuildPlugin omitted `UnrealEditor.modules`; the wrapper creates or validates the
deterministic module index against the independently read engine module BuildId.
No Final Source/Tooling Rework 4/5/6/7/8 live build or clean current manifest was
created. The
release-binary capability handshakes bind the compiled source commit and record
zero MCP/network/asset operations; they do not supply clean-package provenance.

The retained historical Source Checkpoint Rework 7 task-only build/source/manifest bundle is
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

`BLOCKED_BY_EVIDENCE_RETENTION` remains closed for historical Source Checkpoint Rework 7.
`BLOCKED_BY_PLUGIN_PROVENANCE` and `BLOCKED_BY_SOURCE_BYTE_IDENTITY` describe
historical live-evidence gaps; the current source implementation closes the
authority-meaning and transitive-boundary defects pending supervisor checkpoint.
`BLOCKED_BY_BUILD_ENVIRONMENT` remains open until a
compliant live build passes.

The unsafe Rework 2 evidence root was invalidated and removed for
`TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`. It is not manifest or compatibility
evidence, and no Final Source/Tooling Rework 4/5/6/7/8 task created a replacement
live root.

Historical (Rework 5 era): the retained task-only pre-checkpoint manifest
used SHA-256
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

The canonical build helper rejects a dirty worktree with `SOURCE_TREE_DIRTY`,
but clean Git status alone did not protect physical checkout bytes from
`core.autocrlf` conversion. Final provenance must validate physical source bytes
and the exact command, compiler, SDK, UE, module set, manifest self hash, and
manifest file hash.

## Review-only snapshots are not final manifests

Historical Rework 5-era review-only source snapshots may describe planned files
or validation inputs, but they must not be named or represented as
`UAgentAssetTools.build.json`, a clean package, installed/loaded identity
proof, or D0 evidence. Only the future 15A flow below may create the final
manifest from a clean, supervisor-approved source commit/tree.

## Required manifest

`UAgentAssetTools.build.json` must validate against
`integrations/unreal/UAgentAssetTools/Resources/uagent-companion-build-manifest.schema.json`
and contain:

- plugin id/version and independent `mvp15d.asset-tools.v1` contract version;
- 40-lower-hex `sourceCommit`, 64-lower-hex `sourceTreeSha256`, and literal
  `dirty: false`;
- engine `5.8.1`, engine changelist `56057345`, compatible changelist
  `55116800`, module BuildId `55116800`, Win64 Development configuration, and
  non-sensitive compiler/Windows SDK/build-command fingerprint;
- `UAgentAssetTools.uplugin`, contract schema, and every packaged module's
  basename, byte size, and SHA-256;
- ordered exact-six tool names, generated timestamp, non-sensitive builder
  identity, and `manifestSelfSha256`.

The self-hash rule is canonical UTF-8 JSON with lexicographically sorted object
keys, preserved array order, no insignificant whitespace, and the
`manifestSha256` property omitted while hashing. The final hash is not hashed
again. Paths, binaries, PDBs, logs, credentials, and machine-local absolute
paths do not belong in the manifest. Final-package repository documentation
uses stable evidence identifiers; the current implementation verification and
status ledgers may retain task-owned D0/UE evidence roots required for
checkpoint review.

## Required post-checkpoint 15A reproducible flow

1. Supervisor reviews, commits, backfills, and publishes this source checkpoint.
2. Create a fresh no-hardlink clone with deterministic physical bytes and prove
   both Git cleanliness and fixed fixture hashes.
3. Run the exact official UE 5.8 command through the wrapper:

   ```text
   RunUAT.bat BuildPlugin -Plugin=<clean-source>/integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin -Package=<task-owned-package> -TargetPlatforms=Win64 -Rocket
   ```

4. Generate the manifest only after a complete sealed build; supply the retained
   `build-command.json` and `build-result.json` so the helper recomputes real
   compiler/SDK/UE/module facts and both manifest self/file hashes.
5. Run `scripts/mvp15d-manifest.mjs verify` against the real package
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

No clean current manifest, installed/loaded equality proof, or live exact-six
fingerprint exists. Those facts must be produced from the supervisor-published
Final Source/Tooling Rework 8 checkpoint in the separate clean-commit
read-only task.
