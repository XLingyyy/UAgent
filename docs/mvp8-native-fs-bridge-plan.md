# MVP8 Native Read-Only Filesystem Bridge Plan

## Overview

The Native FS Bridge provides a controlled, read-only interface between the Tauri 2 native layer and the TypeScript runtime. It replaces MVP7's fixture-only project index operations with real filesystem access while preserving all safety boundaries.

## Architecture

```
UI (React) -> ProjectStoreActions -> NativeProjectAdapter -> Tauri invoke() -> Rust commands -> real FS
                                                                        \-> fixture fallback (non-Tauri)
```

## Rust Commands

| Command | Input | Output | Description |
|---------|-------|--------|-------------|
| `validate_native_project_root` | rootRef: string | `{ok, reason, displayRoot, projectName, engine}` | Validate path exists, is a directory, contains .uproject, not dangerous |
| `trust_native_project_root` | rootRef: string | `{rootId, displayRoot, trustState}` | Record trust decision (in-memory) |
| `scan_native_project_index` | rootRef, policy | `{id, projectId, status, nodes, files, assets, summary}` | Recursive scan with policy limits |
| `cancel_native_project_scan` | scanId: string | `{id, status, lastStableSnapshot}` | Cancel in-progress scan |
| `preview_native_project_file` | rootRef, path, limits | `{status, content, truncation, redaction}` | Read file with preview policy |

## Safety

- All commands are read-only; no write/delete/rename/mkdir commands are registered
- Path normalization blocks tilde, relative paths, dangerous roots, network paths, symlink escapes
- Preview content is redacted for secrets and home paths before returning to JS
- No raw absolute paths are returned to UI; display paths are `[project-root]/relative`
- Native error messages are redacted before propagation
- Root validation requires explicit user trust before scan
- Scan respects ignoredDirs, maxDepth, maxNodes, maxFileBytes
