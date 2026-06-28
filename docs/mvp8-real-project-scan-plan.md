# MVP8 Real Project Scan Plan

## Scanner Design

The real project scanner performs a deterministic breadth-first traversal of a trusted project root directory, constrained by policy limits.

## Traversal Rules

- **Order**: Directories and files are sorted alphabetically, case-insensitively
- **Ignored dirs**: `.git`, `Intermediate`, `Saved`, `DerivedDataCache`, `Binaries`, `node_modules`, `.vs`, `Build`
- **Max depth**: Configurable via policy (default 10)
- **Max nodes**: Configurable via policy (default 5000)
- **Max files**: Configurable via policy (default 2000)

## File Classification

Extensions are classified into:
- `map`: `.umap`
- `blueprint`: Blueprint assets
- `material`: `.uasset` with `m_` prefix
- `config`: `.ini`
- `source`: `.cpp`, `.h`, `.hpp`, `.cs`
- `project`: `.uproject`
- `binary_asset`: other `.uasset` files
- `unknown`: all other

## Error Handling

- Permission denied: log warning, skip file, continue scan
- Missing `.uproject`: root validation fails
- Malformed `.uproject`: parsed with warnings, scan continues
- Symlink: canonicalized; escape blocked with warning
- Binary file: detected by NUL bytes in header; preview blocked

## Determinism

Same directory structure always produces the same scan order, classification, and counts. No random or time-based variation in output.
