> **r14 current status:** `NativeOperationReview` is mounted in run-history and inspector views for read-only review of stored operation parameters and results. It does not restore approvals or establish current external effects. Statements below about an unmounted UI describe the earlier standalone module. See [r14](../../../../../docs/releases/r14.md).

# T16 operation review

An isolated review component. No App/store/root export registration, native/provider calls, file opening, persistence, or execution authority is installed.

## Integration contract

Import `OperationReview` and the display adapters from this directory. Mount inside the existing `I18nProvider` and desktop theme styles. It follows the existing locale store (Chinese by default; English via `setLocale("en")`) and CSS semantic tokens. The component owns only disclosure/submission UI state.

Provide a validated `OperationReviewDocument`: immutable `id`, `revision`, `title`, source, preview/result mode, integrity, and target items. Change the revision whenever the reviewed payload or ownership changes. A callback resolving does not change mode, item status, or counts; supply a new authoritative result document to update them. Missing, mismatched, duplicate, or unknown receipts cannot produce a successful item.

- T13 semantic adapter: the current pickup-template create preview and its four typed parameter changes. It takes the display data only; preview tokens/host permits are excluded. Arbitrary Blueprint graph diff and semantic execution receipts are not implemented here.
- T10 files: validated `BuildRepairPreview` with optional `BuildRepairApplyResult`. Uses sanitized `displayDiff` only. An empty value is labelled "No displayable diff", distinct from missing records, without claiming a redaction reason or falling back to raw text. Completion requires an approved matching receipt and before/after identity/hash fields. Missing receipts remain unknown. Text diffs are folded; long diffs have an explicit full-view control and separate line/character clipping explanations.
- T14 scene: validated `SceneBatchPlan` with optional `SceneBatchData`. Counts come from per-object receipts, not `appliedCount`. Object paths include the map object name; geometry uses the existing T14 parser comparison through a pure direct-module helper, with unchanged 0.001 location/scale and whole-orientation tolerances. No runtime root export or registration is added. Displays mesh, material, location, rotation and scale. Completion means a matching current-world object receipt; saving is separate. Cancellation never means rollback.
- T18 effects: `EffectRecordDisplay` is a limited camel-case projection of the existing Rust DTO, not an IPC registration. A past `lastVerifiedOutcome` alone cannot establish success. Completion needs the latest quiet, exact, operation-bound observation and no manual review requirement. Target counts describe affected targets, not operations.

These adapters display already validated host data. They are not parsers for arbitrary native JSON or replacements for current owner/lease/project verification.

## Actions

Default `environment` is `development-preview`; it visibly labels the UI and its simulated actions. Use `environment="host"` only after real host integration. No callback is installed by default, and the approval button remains disabled.

An explicit `approval` or `inspection` prop must contain `enabled: true`, the exact document `reviewId` and `revision`, and `onRequest`. Approval requires a complete nonempty preview. Inspection is available only for unknown result items. The callback receives a frozen `{ reviewId, revision }` description. This description is not a grant, native permit, payload, or persisted authorization. The host must revalidate the current exact payload, owner, lease and native approval at its existing execution boundary.

One submission is allowed per mounted document. Double clicks are ignored; a rejected callback permits an explicit retry and shows a fixed localized error without exposing raw error text. Late callbacks from replaced documents are ignored. The component never promotes a preview or unknown state after submission.

## Checks and limits

`OperationReview.test.tsx` uses synthetic DTO-shaped fixtures and the real locale provider. Fixtures are development/test data, not production sample registration. Scene fixtures are accepted by the actual parseSceneBatchPlan/createSceneSessionFromVerifiedHost/parseSceneResult functions under synthetic in-memory identities; this is contract validation and confers no native permission. Focused tests cover conservative receipt mapping, default disabled approval, revision binding, duplicate submission, error text, late callbacks, locale changes, full diffs, large lists and escaped text.

A temporary isolated Vite harness was used for local Chrome checks and screenshots; it imports no App/native/provider entry point. Native details were tested with Enter/Space, named region/buttons were checked, Chinese/English and dark/light themes inspected, and narrow layout checked for horizontal overflow. Evidence is under `E:\Codex\UAgent\2026-10-29\evidence\t16-operation-review`; screenshots under the worktree's ignored `output\playwright`.

Production App/store/IPC integration, actual approval execution, native evidence acquisition, real UE operations and full application regression are unverified and outside this change.
