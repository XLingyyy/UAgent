# MVP7 Project Index Plan

## Architecture

The MVP7 project path is `ProjectRegistry -> ProjectIndexer -> ProjectIndexSnapshot -> UI projections`. Runtime owns all validation, indexing, preview, event, audit, and redaction decisions. React receives redacted profiles, index snapshots, and preview results through the existing UIProvider project slice.

## Project Registry

- Default registry is empty.
- Registering a project stores `ProjectProfile.id`, `name`, `rootRef`, redacted `displayRoot`, trust state, index status, and engine summary.
- Removing a project removes only the registry entry and never deletes files.
- Roots must be explicit, non-empty, non-relative, non-root, non-home/system-wide, and recognizable by `.uproject` or fixture structure.

## Path Policy

Path helpers normalize separators, keep fixture URI schemes stable, block traversal/root escape, apply ignored directories, enforce text-preview extension and size caps, and redact home paths for UI display.

Default ignored dirs: `.git`, `Intermediate`, `Saved`, `DerivedDataCache`, `Binaries`, `node_modules`, `.vs`.

## Project Indexer

The deterministic MVP7 fixture indexer emits stable directory entries, file entries, asset entries, scan summaries, warnings, and limit reasons. It models Lyra-like folders under `Content`, `Config`, `Source`, and `Plugins`.

The indexer does not parse `.uasset` binary content. `.uproject` parsing is JSON text only and malformed JSON becomes a warning rather than a crash.

## Asset Index

Asset classification is path and extension based:

- `.umap` -> map
- `.uasset` -> material or binary asset by naming/path hints
- `.ini` -> config
- `.cpp`, `.h`, `.hpp`, `.cs` -> source
- `.uproject` -> project

## Safe Preview

Safe preview accepts only registered project roots, root-relative paths inside the root, allowlisted text extensions, and size/line limits. Binary, traversal, symlink escape, missing file, and large file conditions return blocked or truncated results with redaction summaries.

## UI Projection

The sidebar Asset Browser shows a fixture fallback before scan and an index-backed tree after scan. Filtering is UI-only against the current snapshot and never triggers a new scan.

## Audit and Evidence

Project validation, scan start/complete/cancel/fail, preview request/block/complete, and limit summaries map to redacted TaskEvent, AuditEvent, Session replay, and Evidence records.
