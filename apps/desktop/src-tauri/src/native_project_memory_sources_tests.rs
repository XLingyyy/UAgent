//! No live grant fixture. These test source helpers return DATA ONLY and never
//! construct NativeMemorySources, MemoryBatch, a run grant or a transport permit.
//! Every file is synthetic under the dedicated E: evidence fixture directory;
//! no Drop cleanup/deletion is performed.
use super::*;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn fixture_root() -> PathBuf {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let root = PathBuf::from("E:/Codex/UAgent/2026-10-29/evidence/project-memory-dispatch-B-20261101/fixtures")
        .join(format!("{}-{nonce}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("synthetic.txt"), b"Synthetic fixture data only.\n").unwrap();
    root
}

#[test]
fn exact_file_path_parser_rejects_noncanonical_or_unbounded_paths() {
    assert!(exact_file_path("notes/synthetic.txt"));
    for invalid in ["", "../private.txt", "notes//a.txt", "notes/./a.txt", "notes\\a.txt", "E:/a.txt", "/a.txt", "notes/a.txt.", "notes/a.txt ", "notes/%2e%2e/a", "notes/~alias/a"] {
        assert!(!exact_file_path(invalid), "{invalid}");
    }
    assert!(!exact_file_path(&"a".repeat(1025)));
}

#[test]
fn metadata_stamp_uses_retained_handle_and_excludes_conflicting_writer() {
    let directory = fixture_root();
    let root = Arc::new(TrustedRootHandle::open_from_host_selection(&directory).unwrap());
    let reader = root.scope_from_verified_host(vec![ReadRule::exact_file("synthetic.txt").unwrap()]).unwrap();
    let file = reader.open_file("synthetic.txt").unwrap();
    let original_identity = file.identity();
    let first = bound_file_metadata_version(&file).unwrap();
    let source = MemorySource {
        project_id: "project-fixture-data".into(), path: "synthetic.txt".into(),
        kind: "file_preview".into(), version: first.clone(), freshness: Some(first.clone()),
    };
    let original = source.clone();
    assert!(validate_source_reference(&source, "project-fixture-data").is_ok());
    assert!(verify_bound_source(&source, &file).is_ok());
    assert_eq!(source, original);
    assert!(first.starts_with("meta-v1:"));
    assert_eq!(first, bound_file_metadata_version(&file).unwrap());
    assert_eq!(original_identity, file.identity());
    assert!(OpenOptions::new().write(true).open(directory.join("synthetic.txt")).is_err());
    root.revoke();
    assert!(bound_file_metadata_version(&file).is_err());
    assert!(verify_bound_source(&source, &file).is_err());
}

#[test]
fn freshness_alias_shape_supports_ui_contract_but_rejects_unknown_semantics() {
    let original = MemorySource {
        project_id: "project-fixture-data".into(), path: "synthetic.txt".into(),
        kind: "file_preview".into(), version: "meta-v1:synthetic".into(),
        freshness: Some("meta-v1:synthetic".into()),
    };
    assert!(validate_source_reference(&original, "project-fixture-data").is_ok());
    let mut no_freshness = original.clone(); no_freshness.freshness = None;
    assert!(validate_source_reference(&no_freshness, "project-fixture-data").is_ok());
    for value in ["different-stamp", "", "meta-v1:synthetic "] {
        let mut changed = original.clone(); changed.freshness = Some(value.into());
        assert!(validate_source_reference(&changed, "project-fixture-data").is_err());
    }
    for kind in ["project_index", "index_query", "tool", "unknown"] {
        let mut changed = original.clone(); changed.kind = kind.into();
        assert!(validate_source_reference(&changed, "project-fixture-data").is_err());
    }
    assert_eq!(original.freshness.as_deref(), Some(original.version.as_str()));
    // Passing a shape check returns data only, not a NativeMemorySources grant.
}

#[test]
fn equal_freshness_fields_cannot_refresh_an_old_original_handle_stamp() {
    let directory = fixture_root();
    let root = TrustedRootHandle::open_from_host_selection(&directory).unwrap();
    let reader = root.scope_from_verified_host(vec![ReadRule::exact_file("synthetic.txt").unwrap()]).unwrap();
    let file = reader.open_file("synthetic.txt").unwrap();
    let stamp = bound_file_metadata_version(&file).unwrap();
    let original = MemorySource {
        project_id: "project-fixture-data".into(), path: "synthetic.txt".into(),
        kind: "file_preview".into(), version: stamp.clone(), freshness: Some(stamp),
    };
    assert!(verify_bound_source(&original, &file).is_ok());
    let mut different_freshness = original.clone();
    different_freshness.freshness = Some("meta-v1:unproved".into());
    assert!(verify_bound_source(&different_freshness, &file).is_err());
    // The guard excludes writers. Release only the synthetic fixture handles,
    // change that synthetic file, then prove the OLD source is not refreshed.
    drop(file); drop(reader);
    let mut writer = OpenOptions::new().write(true).truncate(true).open(directory.join("synthetic.txt")).unwrap();
    writer.write_all(b"Changed synthetic fixture with a deliberately different length.\n").unwrap();
    drop(writer);
    let reader = root.scope_from_verified_host(vec![ReadRule::exact_file("synthetic.txt").unwrap()]).unwrap();
    let current_file = reader.open_file("synthetic.txt").unwrap();
    assert_ne!(bound_file_metadata_version(&current_file).unwrap(), original.version);
    assert!(validate_source_reference(&original, "project-fixture-data").is_ok());
    assert!(verify_bound_source(&original, &current_file).is_err());
}

#[test]
fn hard_link_source_cannot_become_a_bound_memory_file() {
    let directory = fixture_root();
    fs::hard_link(directory.join("synthetic.txt"), directory.join("synthetic-alias.txt")).unwrap();
    let root = TrustedRootHandle::open_from_host_selection(&directory).unwrap();
    assert!(root.scope_from_verified_host(vec![ReadRule::exact_file("synthetic.txt").unwrap()]).is_err());
}
