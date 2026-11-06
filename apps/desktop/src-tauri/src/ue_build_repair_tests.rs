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
            diagnostic: snapshot.diagnostic, task: snapshot.task,
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

#[test]
fn production_liveness_revoked_during_durable_backup_prevents_source_write() {
    let f=Fixture::new();let mut session=f.session();let p=preview(&mut session,"live-backup");
    let flag=Arc::new(AtomicBool::new(true));let live=flag.clone();
    let mut grant=NativeRepairGrant::from_verified_host_approval(&p,60000).unwrap().with_liveness(Arc::new(move||live.load(Ordering::SeqCst)));
    struct Revoking { inner:DirectoryRepairJournal,flag:Arc<AtomicBool> }
    impl RepairJournal for Revoking {fn persist_before(&mut self,b:&RepairRecoveryBundle)->Result<String,String>{let result=self.inner.persist_before(b)?;self.flag.store(false,Ordering::SeqCst);Ok(result)}}
    let mut journal=Revoking{inner:f.journal(),flag};
    let receipt=session.apply_approved("host",&p.preview.preview_id,&mut grant,&mut journal,&AtomicBool::new(false)).unwrap();
    assert_eq!(receipt.status,"not_started");assert!(receipt.recovery_record.is_some());assert!(grant.consumed());
    assert_eq!(f.read("Source/Fixture/A.cpp"),"int value = 1;\n");
    assert!(session.hold_applied_inputs_for_build("host",&p.preview.preview_id).is_err());
    assert!(session.apply_approved("host",&p.preview.preview_id,&mut grant,&mut journal,&AtomicBool::new(false)).is_err());
}
#[test]
fn production_liveness_panic_fails_before_any_backup_or_write() {
    let f=Fixture::new();let mut session=f.session();let p=preview(&mut session,"live-panic");
    let mut grant=NativeRepairGrant::from_verified_host_approval(&p,60000).unwrap().with_liveness(Arc::new(||panic!("synthetic document unavailable")));
    struct Never;impl RepairJournal for Never {fn persist_before(&mut self,_:&RepairRecoveryBundle)->Result<String,String>{panic!("must not back up")}}
    assert!(session.apply_approved("host",&p.preview.preview_id,&mut grant,&mut Never,&AtomicBool::new(false)).is_err());
    assert_eq!(f.read("Source/Fixture/A.cpp"),"int value = 1;\n");
}

fn batch_replacements_preview(s:&mut RepairSession,label:&str)->NativeRepairPreview{
    let snapshot=s.read_snapshots("host").unwrap();
    let replacements=snapshot.files.iter().map(|f|(f.path.clone(),format!("{}// batch repair\n",f.content))).collect();
    s.prepare_replacements("host",&snapshot.snapshot_id,io::hash(label.as_bytes()),replacements).unwrap()
}
#[test]
fn batch_replacements_apply_back_up_both_and_require_new_grant(){
    let f=Fixture::new();let mut s=f.session();let p=batch_replacements_preview(&mut s,"batch-success");
    let mut grant=NativeRepairGrant::from_verified_host_approval(&p,60000).unwrap();let mut journal=f.journal();
    let result=s.apply_approved("host",&p.preview.preview_id,&mut grant,&mut journal,&AtomicBool::new(false)).unwrap();
    assert_eq!(result.status,"applied");assert_eq!(result.effects.len(),2);
    let saved:serde_json::Value=serde_json::from_slice(&fs::read(f.base.join("Recovery/records").join(result.recovery_record.unwrap())).unwrap()).unwrap();
    for file in &p.preview.files{assert_eq!(f.read(&file.path),file.after);assert!(saved["preview"]["preview"]["files"].as_array().unwrap().iter().any(|v|v["path"]==file.path&&v["before"]==file.before));}
    assert!(s.apply_approved("host",&p.preview.preview_id,&mut grant,&mut journal,&AtomicBool::new(false)).is_err());
    assert!(s.hold_applied_inputs_for_build("host",&p.preview.preview_id).is_ok());
}
#[test]
fn batch_replacements_reject_stale_unread_duplicate_and_unchanged_input(){
    let f=Fixture::new();let mut s=f.session();let snap=s.read_snapshots("host").unwrap();let a=&snap.files[0];
    for (i,(snapshot,files)) in [
        ("0".repeat(64),vec![(a.path.clone(),"changed".into())]),
        (snap.snapshot_id.clone(),vec![("Source/Unread.cpp".into(),"changed".into())]),
        (snap.snapshot_id.clone(),vec![(a.path.clone(),"first".into()),(a.path.clone(),"second".into())]),
        (snap.snapshot_id.clone(),vec![(a.path.clone(),a.content.clone())]),
    ].into_iter().enumerate(){assert!(s.prepare_replacements("host",&snapshot,io::hash(format!("bad-{i}").as_bytes()),files).is_err());}
    for file in snap.files{assert_eq!(f.read(&file.path),file.content);}
}
#[test]
fn batch_replacements_second_file_conflict_leaves_first_untouched(){
    let f=Fixture::new();let mut s=f.session();let p=batch_replacements_preview(&mut s,"batch-conflict");
    fs::write(f.root.join(&p.preview.files[1].path),"// outside edit\n").unwrap();
    let mut grant=NativeRepairGrant::from_verified_host_approval(&p,60000).unwrap();
    let result=s.apply_approved("host",&p.preview.preview_id,&mut grant,&mut f.journal(),&AtomicBool::new(false)).unwrap();
    assert_eq!(result.status,"conflict");assert_eq!(f.read(&p.preview.files[0].path),p.preview.files[0].before);assert_eq!(f.read(&p.preview.files[1].path),"// outside edit\n");
}
#[test]
fn batch_replacements_partial_preserves_backup_and_blocks_rebuild(){
    let f=Fixture::new();let mut s=f.session();let p=batch_replacements_preview(&mut s,"batch-partial");
    let mut grant=NativeRepairGrant::from_verified_host_approval(&p,60000).unwrap();let flag=AtomicBool::new(false);
    let result=s.apply_with_after_item_hook("host",&p.preview.preview_id,&mut grant,&mut f.journal(),&flag,|n|{if n==1{flag.store(true,Ordering::Release);}}).unwrap();
    assert_eq!(result.status,"partial");assert_eq!(result.effects[0].status,"applied");assert_eq!(result.effects[1].status,"not_started");
    assert!(f.base.join("Recovery/records").join(result.recovery_record.unwrap()).is_file());
    assert_eq!(f.read(&p.preview.files[0].path),p.preview.files[0].after);assert_eq!(f.read(&p.preview.files[1].path),p.preview.files[1].before);
    assert!(s.hold_applied_inputs_for_build("host",&p.preview.preview_id).is_err());
}

fn restart_inspection_evidence()->(Fixture,Vec<u8>,Vec<u8>){
 let f=Fixture::new();let mut s=f.session();let p=batch_replacements_preview(&mut s,"restart-partial");let mut grant=NativeRepairGrant::from_verified_host_approval(&p,60000).unwrap();let flag=AtomicBool::new(false);
 let mut receipt=s.apply_with_after_item_hook("host",&p.preview.preview_id,&mut grant,&mut f.journal(),&flag,|n|{if n==1{flag.store(true,Ordering::Release);}}).unwrap();
 let backup=fs::read(f.base.join("Recovery/records").join(receipt.recovery_record.as_ref().unwrap())).unwrap();
 // StoreRepairJournal uses the artifact digest as the recovery reference; this synthetic directory journal uses a filename.
 receipt.recovery_record=Some(io::hash(&backup));let result=serde_json::to_vec(&receipt).unwrap();drop(s);
 (f,backup,result)
}
#[test]
fn restart_inspection_reopens_root_and_compares_partial_effects_without_restoring_authority(){
 let(f,b,r)=restart_inspection_evidence();let root=TrustedRootHandle::open_from_host_selection(&f.root).unwrap();
 let report=crate::ue_repair_recovery::inspect(&root,"Fixture","history-run",&b,Some(&r),&AtomicBool::new(false),Instant::now()+Duration::from_secs(10)).unwrap();
 assert_eq!(report.restore_candidates.len(),1);assert_eq!(report.restore_candidates[0].before_hash,report.files[0].current_sha256.clone().unwrap());assert_eq!(report.restore_candidates[0].after,"int value = 1;\n");assert_eq!(report.files[0].state,"matches_after");assert!(report.files[0].known_applied_match);assert_eq!(report.files[1].state,"matches_before");assert!(!report.restore_available);assert_eq!(report.restore_blocker,"original_execution_settlement_required");
}
#[test]
fn restart_inspection_detects_external_content_and_rejects_different_root(){
 let(f,b,r)=restart_inspection_evidence();fs::write(f.root.join("Source/Fixture/A.cpp"),"// outside edit\n").unwrap();let root=TrustedRootHandle::open_from_host_selection(&f.root).unwrap();
 let report=crate::ue_repair_recovery::inspect(&root,"Fixture","history-run",&b,Some(&r),&AtomicBool::new(false),Instant::now()+Duration::from_secs(10)).unwrap();assert!(report.restore_candidates.is_empty());assert_eq!(report.files[0].state,"diverged");assert!(!report.files[0].known_applied_match);assert_eq!(f.read("Source/Fixture/A.cpp"),"// outside edit\n");
 let other=Fixture::new();let other_root=TrustedRootHandle::open_from_host_selection(&other.root).unwrap();assert!(crate::ue_repair_recovery::inspect(&other_root,"Fixture","history-run",&b,Some(&r),&AtomicBool::new(false),Instant::now()+Duration::from_secs(10)).is_err());
}
#[test]
fn restart_inspection_missing_receipt_does_not_infer_success(){
 let(f,b,_)=restart_inspection_evidence();let root=TrustedRootHandle::open_from_host_selection(&f.root).unwrap();let report=crate::ue_repair_recovery::inspect(&root,"Fixture","history-run",&b,None,&AtomicBool::new(false),Instant::now()+Duration::from_secs(10)).unwrap();assert!(!report.result_present);assert!(report.restore_candidates.is_empty());assert_eq!(report.files[0].state,"matches_after");assert_eq!(report.files[0].saved_effect,"unrecorded");assert!(!report.files[0].known_applied_match);assert!(!report.restore_available);
}
#[test]
fn restart_inspection_rejects_corrupt_backup_receipt_and_cancelled_read(){
 let(f,b,r)=restart_inspection_evidence();let root=TrustedRootHandle::open_from_host_selection(&f.root).unwrap();let mut bad:serde_json::Value=serde_json::from_slice(&b).unwrap();bad["preview"]["preview"]["files"][0]["before"]="corrupt".into();
 assert!(crate::ue_repair_recovery::inspect(&root,"Fixture","history-run",&serde_json::to_vec(&bad).unwrap(),Some(&r),&AtomicBool::new(false),Instant::now()+Duration::from_secs(10)).is_err());
 let mut receipt:serde_json::Value=serde_json::from_slice(&r).unwrap();receipt["previewId"]="wrong".into();assert!(crate::ue_repair_recovery::inspect(&root,"Fixture","history-run",&b,Some(&serde_json::to_vec(&receipt).unwrap()),&AtomicBool::new(false),Instant::now()+Duration::from_secs(10)).is_err());
 let mut wrong_diagnostic:serde_json::Value=serde_json::from_slice(&r).unwrap();wrong_diagnostic["diagnostic"]["diagnosticId"]="wrong".into();assert!(crate::ue_repair_recovery::inspect(&root,"Fixture","history-run",&b,Some(&serde_json::to_vec(&wrong_diagnostic).unwrap()),&AtomicBool::new(false),Instant::now()+Duration::from_secs(10)).is_err());
 assert!(crate::ue_repair_recovery::inspect(&root,"Fixture","history-run",&b,Some(&r),&AtomicBool::new(true),Instant::now()+Duration::from_secs(10)).is_err());
}

#[test]
fn restart_inspection_dispatch_records_never_become_a_stop_proof(){
 use crate::local_run_store::effect_reconciliation::{OperationOwner,DispatchPhase,DispatchGateSnapshot,EffectState,runtime_host_catalog_reader::{DurableEffectBarrier,BarrierReason}};
 let owner=OperationOwner{scope_id:"scope".into(),run_id:"history".into(),project_id:"p".into(),root_ref:"root".into(),conversation_id:"c".into(),provider_id:"native-ue-repair".into(),model_id:"none".into(),step_id:"repair".into(),execution_id:"opaque".into(),host_generation:"generation".into()};
 let mut barrier=DurableEffectBarrier{project_id:"p".into(),operation_id:"op".into(),owner,root_object_id:"root".into(),resources:vec![],intent_digest:"a".repeat(64),revision:3,state:EffectState::ResultUnknown,dispatch:DispatchGateSnapshot{phase:DispatchPhase::InCallback,epoch:2},reason:BarrierReason::HandoffUnsettled};
 for phase in [DispatchPhase::InCallback,DispatchPhase::Settled,DispatchPhase::Closed]{barrier.dispatch.phase=phase;let report=crate::ue_repair_recovery::describe_execution(&[barrier.clone()],"p","history","root");assert_eq!(report.status,"recorded_barrier");assert_eq!(report.recorded_phase,Some(phase));assert!(!report.stopped_proven);}
 assert_eq!(crate::ue_repair_recovery::describe_execution(&[barrier.clone()],"other","history","root").status,"no_matching_barrier");
 assert_eq!(crate::ue_repair_recovery::describe_execution(&[barrier.clone()],"p","history","other-root").status,"root_mismatch");
 assert_eq!(crate::ue_repair_recovery::describe_execution(&[barrier.clone(),barrier],"p","history","root").status,"ambiguous");
}

#[test]
fn goal_source_change_requires_exact_task_origin_and_preserves_backup_and_restore() {
    let f=Fixture::new();
    let root=TrustedRootHandle::open_from_host_selection(&f.root).unwrap();
    let binding=RepairBinding{host_session_id:"host".into(),project_id:"Fixture".into(),root_object_id:root.identity().observation_key(),run_id:"goal-run".into(),profile_fingerprint:"e".repeat(64)};
    let task=SourceTaskRef{run_id:"goal-run".into(),scope_id:"goal-scope".into(),plan_version:1};
    let mut session=RepairSession::from_verified_task(root,binding,task.clone(),vec!["Source/Fixture/A.cpp".into()]).unwrap();
    let snapshot=session.read_snapshots("host").unwrap();
    assert!(snapshot.diagnostic.is_none());assert_eq!(snapshot.task,Some(task.clone()));
    let prepared=session.prepare_replacements("host",&snapshot.snapshot_id,io::hash(b"goal-preview"),vec![("Source/Fixture/A.cpp".into(),"int value = 2;\n".into())]).unwrap();
    let encoded=serde_json::to_value(&prepared.preview).unwrap();
    assert!(encoded.get("diagnostic").is_none());assert_eq!(encoded["task"]["runId"],"goal-run");
    let mut forged=prepared.preview.clone();forged.task.as_mut().unwrap().plan_version=2;
    assert!(session.prepare_preview("host",forged).is_err());
    let mut grant=NativeRepairGrant::from_verified_host_approval(&prepared,15000).unwrap();
    let receipt=session.apply_approved("host",&prepared.preview.preview_id,&mut grant,&mut f.journal(),&AtomicBool::new(false)).unwrap();
    assert_eq!(receipt.status,"applied");assert_eq!(receipt.task,Some(task));assert!(receipt.diagnostic.is_none());
    assert_eq!(f.read("Source/Fixture/A.cpp"),"int value = 2;\n");
    let reverse=session.prepare_restore("host",&prepared.preview.preview_id,io::hash(b"goal-restore")).unwrap();
    let mut reverse_grant=NativeRepairGrant::from_verified_host_approval(&reverse,15000).unwrap();
    assert_eq!(session.apply_approved("host",&reverse.preview.preview_id,&mut reverse_grant,&mut f.journal(),&AtomicBool::new(false)).unwrap().status,"applied");
    assert_eq!(f.read("Source/Fixture/A.cpp"),"int value = 1;\n");
}
#[test]
fn build_source_preview_keeps_legacy_wire_format_without_task_field() {
    let f=Fixture::new();let mut session=f.session();let prepared=preview(&mut session,"legacy-wire");
    let value=serde_json::to_value(&prepared.preview).unwrap();
    assert!(value.get("task").is_none());assert!(value["diagnostic"]["buildOwner"].is_object());
    let restored:RepairPreviewInput=serde_json::from_value(value.clone()).unwrap();
    assert!(restored.task.is_none());assert!(restored.diagnostic.is_some());
    assert_eq!(serde_json::to_value(restored).unwrap(),value);
    assert_eq!(io::hash(&serde_json::to_vec(&prepared.preview).unwrap()),prepared.native_plan_digest);
}
