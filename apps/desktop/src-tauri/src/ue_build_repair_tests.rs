use super::*;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
struct Fixture {
    base: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let parent = PathBuf::from(
            std::env::var("UAGENT_REPAIR_TEST_DIR")
                .expect("explicit E/G fixture dir")
                .replace('/', "\\"),
        );
        let c = fs::canonicalize(&parent)
            .unwrap()
            .to_string_lossy()
            .to_ascii_uppercase();
        assert!(c.starts_with(r"\\?\E:\") || c.starts_with(r"\\?\G:\"));
        let base = parent.join(format!(
            "repair-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = base.join("Project");
        fs::create_dir_all(root.join("Source/Fixture")).unwrap();
        fs::create_dir_all(base.join("Recovery/records")).unwrap();
        fs::write(root.join("Source/Fixture/A.cpp"), "int value = 1;\n").unwrap();
        fs::write(
            root.join("Source/Fixture/Fixture.Build.cs"),
            "// original rules\n",
        )
        .unwrap();
        Self { base, root }
    }
    fn session(&self) -> RepairSession {
        let r = TrustedRootHandle::open_from_host_selection(&self.root).unwrap();
        let binding = RepairBinding {
            host_session_id: "host".into(),
            project_id: "Fixture".into(),
            root_object_id: r.identity().observation_key(),
            run_id: "run".into(),
            profile_fingerprint: "f".repeat(64),
        };
        let diagnostic = RepairDiagnosticRef {
            diagnostic_id: "d".repeat(64),
            build_owner: RepairBuildOwner {
                run_id: "run".into(),
                step_id: "failed-build".into(),
                fingerprint: "f".repeat(64),
            },
        };
        RepairSession::from_verified_host(
            r,
            binding,
            diagnostic,
            vec![
                "Source/Fixture/A.cpp".into(),
                "Source/Fixture/Fixture.Build.cs".into(),
            ],
        )
        .unwrap()
    }
    fn journal(&self) -> DirectoryRepairJournal {
        let r = TrustedRootHandle::open_from_host_selection(&self.base.join("Recovery")).unwrap();
        let s = r
            .scope_from_verified_host(vec![ReadRule::subtree("records").unwrap()])
            .unwrap();
        DirectoryRepairJournal::from_verified_host_directory(s.pin_directory("records").unwrap())
    }
    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.root.join(path)).unwrap()
    }
}
fn preview(s: &mut RepairSession, label: &str) -> NativeRepairPreview {
    let snapshot = s.read_snapshots("host").unwrap();
    let files = snapshot
        .files
        .iter()
        .map(|f| {
            let after = format!("{}// repaired\n", f.content);
            RepairFilePreview {
                path: f.path.clone(),
                before: f.content.clone(),
                after_hash: io::hash(after.as_bytes()),
                after,
                before_hash: f.sha256.clone(),
                before_object_identity: f.object_identity.clone(),
            }
        })
        .collect();
    s.prepare_preview(
        "host",
        RepairPreviewInput {
            binding: snapshot.binding,
            diagnostic: snapshot.diagnostic,
            snapshot_id: snapshot.snapshot_id,
            preview_id: io::hash(label.as_bytes()),
            files,
        },
    )
    .unwrap()
}
#[test]
fn two_file_apply_has_durable_before_bundle_and_one_use_grant() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "apply");
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    let mut j = f.journal();
    let result = s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut j,
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(result.status, "applied");
    assert!(g.consumed());
    assert_eq!(
        result
            .effects
            .iter()
            .filter(|e| e.status == "applied")
            .count(),
        2
    );
    let saved: serde_json::Value = serde_json::from_slice(
        &fs::read(
            f.base
                .join("Recovery/records")
                .join(result.recovery_record.unwrap()),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        saved["preview"]["preview"]["files"][0]["before"],
        p.preview.files[0].before
    );
    assert!(s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut j,
            &AtomicBool::new(false)
        )
        .is_err());
}
#[test]
fn second_file_conflict_prevents_first_file_write_and_preserves_outside_edit() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "conflict");
    let first = p.preview.files[0].clone();
    let second = p.preview.files[1].clone();
    fs::write(f.root.join(&second.path), "// user changed\n").unwrap();
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    let r = s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut f.journal(),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(r.status, "conflict");
    assert_eq!(f.read(&first.path), first.before);
    assert_eq!(f.read(&second.path), "// user changed\n");
    assert!(!g.consumed());
    assert!(r.recovery_record.is_none());
}
#[test]
fn preview_tamper_unread_path_hash_and_identity_are_rejected() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "safe");
    for n in 0..4 {
        let mut bad = p.preview.clone();
        bad.preview_id = io::hash(format!("bad{n}").as_bytes());
        match n {
            0 => bad.files[0].path = "Source/Fixture/Unread.cpp".into(),
            1 => bad.files[0].after_hash = "0".repeat(64),
            2 => bad.files[0].before_object_identity = "forged".into(),
            _ => bad.binding.run_id = "foreign".into(),
        };
        assert!(s.prepare_preview("host", bad).is_err());
    }
}
#[test]
fn cancelled_before_apply_never_consumes_grant_or_changes_files() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "cancel-before");
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    let r = s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut f.journal(),
            &AtomicBool::new(true),
        )
        .unwrap();
    assert_eq!(r.status, "not_started");
    assert!(!g.consumed());
    for e in p.preview.files {
        assert_eq!(f.read(&e.path), e.before);
    }
}
#[test]
fn cancel_after_first_is_partial_then_explicit_restore_recovers_only_known_effect() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "cancel-mid");
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    let flag = AtomicBool::new(false);
    let mut j = f.journal();
    let r = s
        .apply_with_after_item_hook(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut j,
            &flag,
            |count| {
                if count == 1 {
                    flag.store(true, Ordering::Release)
                }
            },
        )
        .unwrap();
    assert_eq!(r.status, "partial");
    assert_eq!(r.effects[0].status, "applied");
    assert_eq!(r.effects[1].status, "not_started");
    let q = s.query_recovery("host", &p.preview.preview_id).unwrap();
    assert_eq!(q.files[0].sha256, p.preview.files[0].after_hash);
    assert_eq!(q.files[1].sha256, p.preview.files[1].before_hash);
    let restore = s
        .prepare_restore("host", &p.preview.preview_id, io::hash(b"restore-mid"))
        .unwrap();
    assert_eq!(restore.preview.files.len(), 1);
    let mut restore_grant =
        NativeRepairGrant::from_verified_host_approval(&restore, 60_000).unwrap();
    let restored = s
        .apply_approved(
            "host",
            &restore.preview.preview_id,
            &mut restore_grant,
            &mut j,
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(restored.status, "applied");
    for e in p.preview.files {
        assert_eq!(f.read(&e.path), e.before);
    }
}
#[test]
fn grant_revocation_between_files_stops_further_writes() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "revoke-mid");
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    let revoker = g.revocation_handle();
    let r = s
        .apply_with_after_item_hook(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut f.journal(),
            &AtomicBool::new(false),
            |count| {
                if count == 1 {
                    revoker.revoke()
                }
            },
        )
        .unwrap();
    assert_eq!(r.status, "partial");
    assert_eq!(r.effects[1].status, "not_started");
    assert_eq!(f.read(&p.preview.files[1].path), p.preview.files[1].before);
}
#[test]
fn restore_refuses_post_apply_outside_change() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "outside");
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    s.apply_approved(
        "host",
        &p.preview.preview_id,
        &mut g,
        &mut f.journal(),
        &AtomicBool::new(false),
    )
    .unwrap();
    fs::write(
        f.root.join(&p.preview.files[0].path),
        "// later user edit\n",
    )
    .unwrap();
    assert!(s
        .prepare_restore("host", &p.preview.preview_id, io::hash(b"restore-outside"))
        .is_err());
    assert_eq!(f.read(&p.preview.files[0].path), "// later user edit\n");
}
struct FailingJournal;
impl RepairJournal for FailingJournal {
    fn persist_before(&mut self, _: &RepairRecoveryBundle) -> Result<String, String> {
        Err("controlled journal failure".into())
    }
}
#[test]
fn backup_failure_prevents_any_source_write_but_consumed_grant_cannot_replay() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "journal");
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    let r = s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut FailingJournal,
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(r.status, "not_started");
    assert_eq!(r.reason, "repair_durable_before_backup_failed");
    assert!(g.consumed());
    for e in &p.preview.files {
        assert_eq!(f.read(&e.path), e.before);
    }
    assert!(s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut f.journal(),
            &AtomicBool::new(false)
        )
        .is_err());
}
#[test]
fn root_and_host_revocation_fail_before_file_effects() {
    let f = Fixture::new();
    let mut s = f.session();
    assert!(s.read_snapshots("other-host").is_err());
    let p = preview(&mut s, "revoked");
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    s.root.revoke();
    assert!(s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut f.journal(),
            &AtomicBool::new(false)
        )
        .is_err());
    assert!(!g.consumed());
}
#[test]
fn revoked_or_mismatched_grants_cannot_apply() {
    let f = Fixture::new();
    let mut s = f.session();
    let p = preview(&mut s, "grant-one");
    let other = preview(&mut s, "grant-two");
    let mut g = NativeRepairGrant::from_verified_host_approval(&other, 60_000).unwrap();
    assert!(s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut f.journal(),
            &AtomicBool::new(false)
        )
        .is_err());
    assert!(!g.consumed());
    let mut g = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    g.revoke();
    assert!(s
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut g,
            &mut f.journal(),
            &AtomicBool::new(false)
        )
        .is_err());
    assert!(NativeRepairGrant::from_verified_host_approval(&p, 0).is_err());
}

#[test]
fn approval_rejects_mutated_display_dto_even_when_old_digest_is_retained() {
    let f = Fixture::new();
    let mut session = f.session();
    let original = preview(&mut session, "display-original");
    let mut shown = original.clone();
    shown.preview.files[0]
        .after
        .push_str("// different shown edit\n");
    shown.preview.files[0].after_hash = io::hash(shown.preview.files[0].after.as_bytes());
    assert!(NativeRepairGrant::from_verified_host_approval(&shown, 60_000).is_err());
    let mut shown = original.clone();
    shown.preview.binding.run_id = "different-shown-run".into();
    assert!(NativeRepairGrant::from_verified_host_approval(&shown, 60_000).is_err());
    assert_eq!(
        f.read(&original.preview.files[0].path),
        original.preview.files[0].before
    );
}
#[test]
fn old_prepared_identity_pin_survives_new_snapshot_and_allows_exclusive_apply() {
    let f = Fixture::new();
    let mut session = f.session();
    let old = preview(&mut session, "old-pinned-plan");
    let _new_snapshot = session.read_snapshots("host").unwrap();
    let mut grant = NativeRepairGrant::from_verified_host_approval(&old, 60_000).unwrap();
    let result = session
        .apply_approved(
            "host",
            &old.preview.preview_id,
            &mut grant,
            &mut f.journal(),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(result.status, "applied");
    for effect in result.effects {
        assert_eq!(
            effect.after_object_identity.as_ref(),
            Some(&effect.before_object_identity)
        );
    }
}

#[test]
fn build_inputs_reject_outside_after_edit_and_hold_verified_sources_through_dispatch() {
    let f = Fixture::new();
    let mut session = f.session();
    let p = preview(&mut session, "build-inputs");
    let mut grant = NativeRepairGrant::from_verified_host_approval(&p, 60_000).unwrap();
    session
        .apply_approved(
            "host",
            &p.preview.preview_id,
            &mut grant,
            &mut f.journal(),
            &AtomicBool::new(false),
        )
        .unwrap();
    let path = f.root.join(&p.preview.files[0].path);
    fs::write(&path, "// external after edit\n").unwrap();
    assert!(session
        .hold_applied_inputs_for_build("host", &p.preview.preview_id)
        .is_err());
    fs::write(&path, &p.preview.files[0].after).unwrap();
    let mut guard = session
        .hold_applied_inputs_for_build("host", &p.preview.preview_id)
        .unwrap();
    assert_eq!(guard.preview_id(), p.preview.preview_id);
    assert_eq!(guard.expected_sources().len(), 2);
    assert!(fs::write(&path, "// must be blocked\n").is_err());
    guard.check_current().unwrap();
    drop(guard);
    fs::write(&path, "// writable again after release\n").unwrap();
}
