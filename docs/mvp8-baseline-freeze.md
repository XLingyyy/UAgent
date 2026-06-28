# MVP8 Baseline Freeze

## Frozen Baselines

The following baselines are frozen for the MVP8 phase and may not be modified without explicit supervisor approval:

- **Project Index Model**: `ProjectProfile`, `ProjectIndexSnapshot`, `ProjectDirectoryEntry`, `ProjectFileEntry`, `AssetIndexEntry`, `IndexScanSummary` from `packages/shared/src/project.ts`
- **Capability Bridge**: `CapabilityRequest`, `CapabilityDecision`, `CapabilityResult`, `CapabilityRuntimeEvent`, `CapabilityMode`, `CapabilityKind`
- **Safe File Preview**: `SafeFilePreviewRequest`, `SafeFilePreviewResult`, `PreviewStatus`, `PreviewTruncation`, `ContentRedactionSummary`
- **Evidence Model**: `EvidenceRecord`, `EvidenceKind`, `EvidenceSource`
- **Audit Model**: `AuditEvent`, `AuditEventType`, `AuditProjection`, `AuditActor`
- **Session Model**: `SessionSummary`, `TaskHistoryEntry`, `ReplaySummary`, `ReplayCursor`
- **Approval Model**: `ApprovalRequest`, `ApprovalDecision`, `ApprovalState`
- **Sandbox Model**: `SandboxPolicy`, `SandboxExecutionRequest`, `SandboxExecutionResult`
- **UI Architecture**: Slice-store pattern, `UIProvider`, `UIShellState`, component hierarchy
- **Runtime Flow**: `Composer -> TaskDraft -> RuntimeClient.submitTask() -> AgentLoopRuntime -> TaskEvent -> RuntimeSnapshot -> UI`
- **Secret Redaction**: `redactString`, `recursiveRedactValue`, `redactSecret` in `packages/runtime/src/secrets/`
- **Path Redaction**: `redactPathForUi`, `normalizeProjectPath`, `isInsideProjectRoot`, `shouldIgnoreProjectPath`
- **MCP Read-Only Policy**: `classifyMcpToolRisk`, `isRiskAllowed`, `buildToolPolicyPack`

## MVP8 New Baselines

- **Native Root Contracts**: `NativeProjectRoot`, `NativeRootTrustRecord`, `NativeRootRef`, `NativeRootKind`
- **Read-Only Filesystem Policy**: `ReadOnlyFilesystemPolicy` with allowedRoots, ignoredDirs, maxDepth, maxNodes, maxBytes, previewAllowlist
- **Native Command Contracts**: validate, scan, preview, cancel request/response types
- **Scan Progress Events**: `project_index_progress` payload with visitedNodes, indexedFiles, ignoredCount, elapsedMs, status
- **Safe Preview Policy**: extension allowlist, binary detection, line/byte limits, redaction levels
- **Evidence Kinds**: native_root_validation, native_scan_summary, native_preview_summary, native_policy_block
- **Capability Mode Extension**: Files mode extended with `native_read_only`

## Non-Goals (MVP8)

- Real filesystem writes, deletes, renames, moves, or permission changes
- Terminal execution beyond command proposals and fixture results
- Browser automation or external navigation
- Screenshot capture or screen recording
- UE Editor launch or AssetRegistry mutation
- Default live provider network access
- Automatic file watchers or incremental rescan
- Raw absolute path or raw secret leakage into UI/DOM/audit/tests
