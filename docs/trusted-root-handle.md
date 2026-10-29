# Windows trusted root handle

Independent native module `apps/desktop/src-tauri/src/trusted_root_handle.rs` and its `trusted_root_handle/` backend/tests. It has no dependencies beyond Rust std and Windows system DLLs, registers no IPC and changes no existing root entrypoint, approval system or UE permission. Add `mod trusted_root_handle;` manually at the main integration point after review.

## API and ownership

- `TrustedRootHandle::open_from_host_selection(&Path)`: call at trusted project selection, before approving work. Retain the live instance in the native registry. Its root and ancestor handles bind the actual objects, with a 64-bit volume serial number plus 128-bit file ID. `identity().observation_key()` is diagnostic data, never a grant or a way to restore a dropped lease.
- `scope_from_verified_host(Vec<ReadRule>)`: exact files or explicit directory subtrees, at most 32 rules; each anchor is opened and pinned. No empty/whole-volume rule or automatic scope expansion. Caller must already have the user's corresponding read authority.
- `ScopedReader::open_file(relative)` returns an opaque `BoundReadFile`; `read_bounded(limit)` returns bytes and root/file identity observations through that same handle. Limit is 1 byte to 16 MiB; oversized data fails instead of truncating. `pin_directory(relative)` retains a checked directory for a path-based consumer.
- `check_current()` verifies held identities/attributes and a fresh handle-relative lookup of every path component. `revoke()` invalidates the root, all clones, scopes and prepared files. Reads check again after collecting bytes and discard them on revocation/change. The host still owns expiry, run/session generations, atomic dispatch gates and resource locks.

Only local fixed NTFS volumes are accepted in this slice. UNC, verbatim/device paths, volume roots, traversal, ADS, Win32 reserved names, trailing dot/space, 8.3-style tilde names and excessive depth fail closed. Policy scope spelling is case-exact. Every component is opened relative to its held parent using `NtOpenFile`, `OBJ_DONT_REPARSE` and `FILE_OPEN_REPARSE_POINT`; reparse/recall/offline entries, volume changes, pending deletion, wrong types, zero/unavailable identity and multiply-linked files are rejected. There is no path-read fallback.

[Microsoft FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info) documents the identity pair; [NtOpenFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntopenfile) and [CreateFile sharing](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) describe the underlying open/share contracts. The module does not change ACLs or enable privileges.

## Minimal migration

Replace the main Windows creation-time-only root binding with an opaque registry entry containing this live handle. Keep existing project IDs and peer wire root keys as UI/lookup/contract IDs; the new observation-key string is not a drop-in replacement for those formats. Independently verify any peer assertion against the owned process/project binding. bind approvals/source observations to the native entry, its identity and current generation. Retire old entries and grants on revocation or project changes; do not deserialize a root ID into authority or re-open a path later to silently renew approval.

For the project reader, resolve the native grant to a `ScopedReader`, open its requested relative file, and consume `ReadObservation.bytes` for decoding/hash/source checks. Retain the bound file/reader through the relevant native source-check/dispatch gates; caller rechecks run expiry/revocation and outbound consent. Returning `path_hint()` then calling `std::fs::read` defeats the handle-bound read contract.

For the existing build profile, the narrow bridge is:

```rust
let root = trusted_registry_live_handle; // existing verified native grant lookup
let reader = root.scope_from_verified_host(vec![
    ReadRule::exact_file("UAgentBuildLab.uproject")?,
    ReadRule::subtree("Source")?,
])?;
let project = reader.open_file("UAgentBuildLab.uproject")?;
let target = reader.open_file("Source/UAgentBuildLabEditor.Target.cs")?;
let source = reader.pin_directory("Source")?;
let prepared = prepare_ue_build(&profile, root.path_hint())?;
root.check_current()?; project.check_current()?; target.check_current()?; source.check_current()?;
// Keep all guards alive through the existing executor. Host owns approval, owner and build lock.
```

Those names illustrate an exact chosen profile, not production hardcoded Lab permission. Engine-root/executable binding needs its own host-owned lease. Existing `prepare_ue_build`/executor still reopen paths; importing this module does not automatically change them or establish complete source/script/DLL binding. No production write switch or Lab permission is changed.

## Verification and remaining limits

Run only `scripts/test-trusted-root-native.ps1` after the E/G environment helper. It uses a std-only offline crate and explicit E/G fixture parent, retains its fixtures/logs, starts no UE and performs no ACL/CIM/global-environment operation. Test-only `cmd.exe /d /c mklink /J` creates controlled junctions with a hidden child window; it is absent from product code. Failed fixture attempts are retained rather than described as module acceptance.

The final local Windows run passed 14/14 focused tests and covers actual FileIdInfo, same-creation-time replacement with a different file ID, held root/ancestor/target rename and replacement rejection, scoped bytes/limits, junctions at root/ancestor/anchor/target, hardlink rejection and final-gate revocation. Main/Provider/UE integration and non-Windows behavior were not exercised. The selected T14 review fix and its UE evidence are separate from this module.

Directory and file handles conservatively omit write/delete sharing. They can obstruct directory moves involving held ancestors; exact-file rules also prevent ordinary content writes until the scope is released. Release all scope/file/root guards before an independently approved write and obtain new observations afterward. This compatibility cost must be integrated deliberately; do not silently weaken sharing when a busy path fails. Unknown file systems or identity failures remain unsupported.

This is not proof that every Windows namespace TOCTOU is eliminated. Initial user selection, drive-letter/object-manager changes, privileged/kernel interference, attribute-only mutation, writable mappings, path-based build/UE code and unlisted dependencies are not an atomic whole-operation transaction. OS object IDs are meaningful with their live handles, not permanent approval credentials. The host must still enforce its own final lease/approval/source gate and reconcile uncertain effects.
