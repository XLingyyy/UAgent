//! Synthetic, native SQLite tests only. No credentials, Provider, or UE process.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
static NEXT: AtomicU64 = AtomicU64::new(1);
struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "uagent-local-run-store-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self { root }
    }
    fn store(&self) -> RunStore {
        RunStore::open(self.root.join("store")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Only delete this absolute, uniquely named fixture beneath the temp root.
        if self.root.parent() == Some(std::env::temp_dir().as_path())
            && self
                .root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("uagent-local-run-store-")
        {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}
fn setup(store: &RunStore, project: &str) {
    store
        .create_project(&Project {
            id: project.into(),
            root: format!("G:/Synthetic/{project}"),
            label: format!("Synthetic {project}"),
            created_at: 1,
        })
        .unwrap();
    store
        .create_session(&Session {
            project_id: project.into(),
            id: "session".into(),
            title: "Synthetic session".into(),
            created_at: 1,
            archived: false,
            parent_id: None,
            origin: Origin::Native,
        })
        .unwrap();
    store
        .start_run(
            project,
            &NewRun {
                id: "run".into(),
                session_id: "session".into(),
                goal: "Synthetic read only investigation".into(),
                created_at: 1,
            },
        )
        .unwrap();
}
fn batch(status: RunStatus) -> CheckpointBatch {
    CheckpointBatch {
        status,
        checkpoint: Checkpoint {
            next_step_id: None,
            reason: "syntheticCheckpoint".into(),
            summary: "Synthetic progress".into(),
            captured_at: 2,
        },
        messages: vec![],
        steps: vec![],
        tool_calls: vec![],
        events: vec![],
        changesets: vec![],
        artifacts: vec![],
    }
}
fn message(id: &str, body: &str) -> NewMessage {
    NewMessage {
        id: id.into(),
        role: Role::Assistant,
        body: body.into(),
        created_at: 2,
    }
}
fn event(id: &str) -> RunEvent {
    RunEvent {
        id: id.into(),
        kind: "syntheticObservation".into(),
        created_at: 2,
        data: serde_json::json!({"observed":true}),
    }
}
fn step() -> Step {
    Step {
        id: "step".into(),
        title: "Read synthetic file".into(),
        status: ActionStatus::InFlight,
        depends_on: vec![],
    }
}
fn call(result: Option<serde_json::Value>) -> ToolCall {
    ToolCall {
        id: "call".into(),
        step_id: "step".into(),
        tool_name: "project.readFile".into(),
        arguments: serde_json::json!({"path":"Source/Synthetic.cpp"}),
        result,
        status: ActionStatus::InFlight,
    }
}

#[test]
fn local_run_store_long_unicode_messages_tool_results_events_survive_reopen() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    let long = "完整记录🙂\0 synthetic payload\n".repeat(60000);
    assert!(long.len() > 2_000_000);
    let mut data = batch(RunStatus::Paused);
    data.messages = vec![message("long-message", &long)];
    data.steps = vec![step()];
    data.tool_calls = vec![call(Some(serde_json::json!({"content":long})))];
    data.events = vec![RunEvent {
        id: "long-event".into(),
        kind: "toolResult".into(),
        created_at: 2,
        data: serde_json::json!({"content":long}),
    }];
    data.changesets = vec![ChangeSet {
        id: "change".into(),
        status: ActionStatus::Prepared,
        target_paths: vec!["Source/Synthetic.cpp".into()],
        summary: "Synthetic diff".into(),
        diff: long.clone(),
    }];
    assert_eq!(store.commit_checkpoint("A", "run", 0, &data).unwrap(), 1);
    drop(store);
    let reopened = fixture.store();
    assert_eq!(
        reopened.messages("A", "session", 0, 10).unwrap()[0].body,
        long
    );
    let snapshot = reopened.snapshot("A", "run").unwrap();
    assert_eq!(snapshot.run.status, RunStatus::Paused);
    assert_eq!(
        snapshot.tool_calls[0].result.as_ref().unwrap()["content"],
        long
    );
    assert_eq!(snapshot.changesets[0].diff, long);
    assert_eq!(
        reopened.events("A", "run", 0, 10).unwrap()[0].event.data["content"],
        long
    );
    assert!(snapshot.requires_fresh_authorization);
    assert!(snapshot.has_unknown_external_effects);
    assert_eq!(snapshot.checkpoint, Some(data.checkpoint));
}

#[test]
fn local_run_store_real_v1_to_v2_migration_preserves_records_and_is_idempotent() {
    let fixture = Fixture::new();
    let root = fixture.root.join("store");
    fs::create_dir(&root).unwrap();
    let db = Db::open(&root.join("runs.sqlite3")).unwrap();
    db.execute("PRAGMA foreign_keys=ON", &[]).unwrap();
    db.transaction(|| {
        for sql in schema::V1 {
            db.execute(sql, &[])?;
        }
        Ok(())
    })
    .unwrap();
    db.execute(
        "INSERT INTO projects VALUES('A','G:/Synthetic/A','Synthetic A',1)",
        &[],
    )
    .unwrap();
    db.execute(
        "INSERT INTO sessions VALUES('A','session','Migrated',1,0,NULL,'native')",
        &[],
    )
    .unwrap();
    db.execute("INSERT INTO messages VALUES('A','session','old-message',1,'user','Keep this exact text',1,'native')",&[]).unwrap();
    db.execute(
        "INSERT INTO runs VALUES('A','run','session','Migrated run','created',0,1,1)",
        &[],
    )
    .unwrap();
    drop(db);
    for _ in 0..3 {
        let store = fixture.store();
        assert_eq!(store.schema_version().unwrap(), 2);
        assert_eq!(
            store.messages("A", "session", 0, 10).unwrap()[0].body,
            "Keep this exact text"
        );
        assert_eq!(store.sessions("A", true, 10, 0).unwrap().len(), 1);
    }
    fixture
        .store()
        .commit_checkpoint("A", "run", 0, &batch(RunStatus::Paused))
        .unwrap();
}

#[test]
fn local_run_store_newer_schema_refused_without_migration() {
    let fixture = Fixture::new();
    let root = fixture.root.join("future");
    fs::create_dir(&root).unwrap();
    let db = Db::open(&root.join("runs.sqlite3")).unwrap();
    db.execute("PRAGMA user_version=900", &[]).unwrap();
    drop(db);
    assert_eq!(RunStore::open(&root).err().unwrap().kind, "newerSchema");
    assert_eq!(
        Db::open(&root.join("runs.sqlite3"))
            .unwrap()
            .query("PRAGMA user_version", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        900
    );
}

#[test]
fn local_run_store_project_isolation_applies_to_records_search_events_and_artifacts() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    setup(&store, "B");
    store
        .append_messages("A", "session", &[message("same-id", "A-only needle")])
        .unwrap();
    store
        .append_messages("B", "session", &[message("same-id", "B-only needle")])
        .unwrap();
    assert_eq!(
        store.messages("A", "session", 0, 10).unwrap()[0].body,
        "A-only needle"
    );
    assert_eq!(
        store.search_messages("A", "B-only", 10, 0).unwrap().len(),
        0
    );
    assert_eq!(
        store.search_messages("B", "A-only", 10, 0).unwrap().len(),
        0
    );
    let blob = store
        .put_artifact("A", b"A private synthetic bytes")
        .unwrap();
    let reference = ArtifactRef {
        id: "artifact".into(),
        sha256: blob.sha256,
        media_type: "text/plain".into(),
        label: "Synthetic".into(),
    };
    let mut a = batch(RunStatus::Paused);
    a.artifacts.push(reference.clone());
    a.events.push(event("A-event"));
    store.commit_checkpoint("A", "run", 0, &a).unwrap();
    let mut b = batch(RunStatus::Paused);
    b.artifacts.push(reference);
    assert_eq!(
        store.commit_checkpoint("B", "run", 0, &b).unwrap_err().kind,
        "constraint"
    );
    assert_eq!(store.run("B", "run").unwrap().revision, 0);
    assert!(store.read_artifact("B", "run", "artifact").is_err());
    assert_eq!(
        store.read_artifact("A", "run", "artifact").unwrap(),
        b"A private synthetic bytes"
    );
    assert!(store.events("B", "run", 0, 10).unwrap().is_empty());
    assert!(store.run("C", "run").is_err());
}

#[test]
fn local_run_store_late_transaction_failure_rolls_back_all_records_and_sequence() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    let mut data = batch(RunStatus::Running);
    data.messages.push(message("m", "Must roll back"));
    data.steps.push(step());
    data.tool_calls.push(call(None));
    data.events = vec![event("duplicate"), event("duplicate")];
    assert_eq!(
        store
            .commit_checkpoint("A", "run", 0, &data)
            .unwrap_err()
            .kind,
        "constraint"
    );
    let snapshot = store.snapshot("A", "run").unwrap();
    assert_eq!(snapshot.run.revision, 0);
    assert!(snapshot.checkpoint.is_none());
    assert!(snapshot.steps.is_empty());
    assert!(snapshot.tool_calls.is_empty());
    assert!(store.messages("A", "session", 0, 10).unwrap().is_empty());
    assert!(store.events("A", "run", 0, 10).unwrap().is_empty());
    data.events.pop();
    store.commit_checkpoint("A", "run", 0, &data).unwrap();
    assert_eq!(store.events("A", "run", 0, 10).unwrap()[0].sequence, 1);
}

#[test]
fn local_run_store_concurrent_connections_reject_stale_writer_and_terminal_mutation() {
    let fixture = Fixture::new();
    let first = fixture.store();
    setup(&first, "A");
    let second = fixture.store();
    assert_eq!(second.run("A", "run").unwrap().revision, 0);
    first
        .commit_checkpoint("A", "run", 0, &batch(RunStatus::Paused))
        .unwrap();
    assert_eq!(
        second
            .commit_checkpoint("A", "run", 0, &batch(RunStatus::Paused))
            .unwrap_err()
            .kind,
        "conflict"
    );
    let mut done = batch(RunStatus::Succeeded);
    done.checkpoint.captured_at = 3;
    second.commit_checkpoint("A", "run", 1, &done).unwrap();
    assert_eq!(
        first
            .commit_checkpoint("A", "run", 2, &done)
            .unwrap_err()
            .kind,
        "terminalRun"
    );
}

#[test]
fn local_run_store_checkpoint_history_preserves_prior_results_and_call_identity() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    let mut first = batch(RunStatus::Running);
    first.steps.push(step());
    first.tool_calls.push(call(None));
    store.commit_checkpoint("A", "run", 0, &first).unwrap();
    let mut second = batch(RunStatus::Paused);
    second.checkpoint.captured_at = 3;
    let mut observed = call(Some(
        serde_json::json!({"content":"Complete synthetic observation"}),
    ));
    observed.status = ActionStatus::Succeeded;
    second.tool_calls.push(observed);
    store.commit_checkpoint("A", "run", 1, &second).unwrap();
    assert_eq!(store.checkpoint_batch("A", "run", 1).unwrap(), Some(first));
    assert_eq!(
        store.checkpoint_batch("A", "run", 2).unwrap(),
        Some(second.clone())
    );
    assert!(store.checkpoint_batch("B", "run", 1).unwrap().is_none());
    let latest = store.snapshot("A", "run").unwrap();
    assert!(!latest.has_unknown_external_effects);
    assert_eq!(latest.tool_calls[0].status, ActionStatus::Succeeded);
    second.checkpoint.captured_at = 4;
    second.tool_calls[0].arguments = serde_json::json!({"path":"DifferentTarget.cpp"});
    assert_eq!(
        store
            .commit_checkpoint("A", "run", 2, &second)
            .unwrap_err()
            .kind,
        "invalid"
    );
    assert_eq!(store.run("A", "run").unwrap().revision, 2);
}

#[test]
fn local_run_store_parallel_connections_commit_one_revision_without_lost_messages() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    drop(store);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let mut workers = Vec::new();
    for index in 0..2 {
        let root = fixture.root.join("store");
        let barrier = barrier.clone();
        workers.push(std::thread::spawn(move || {
            let store = RunStore::open(root).unwrap();
            let mut data = batch(RunStatus::Paused);
            data.messages.push(message(
                &format!("parallel-{index}"),
                &format!("Synthetic writer {index}"),
            ));
            barrier.wait();
            store.commit_checkpoint("A", "run", 0, &data)
        }));
    }
    let outcomes: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
    assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        outcomes
            .iter()
            .filter_map(|r| r.as_ref().err())
            .next()
            .unwrap()
            .kind,
        "conflict"
    );
    let store = fixture.store();
    assert_eq!(store.run("A", "run").unwrap().revision, 1);
    assert_eq!(store.messages("A", "session", 0, 10).unwrap().len(), 1);
}

#[test]
fn local_run_store_native_payloads_cannot_store_credential_or_authority_fields() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    for key in [
        "apiKey",
        "authorization",
        "execution_token",
        "approvalToken",
        "refreshToken",
    ] {
        let mut data = batch(RunStatus::Running);
        data.steps.push(step());
        let mut c = call(None);
        c.arguments = serde_json::json!({"nested":[{key:"synthetic-forbidden-value"}]});
        data.tool_calls.push(c);
        assert_eq!(
            store
                .commit_checkpoint("A", "run", 0, &data)
                .unwrap_err()
                .kind,
            "invalid"
        );
        assert_eq!(store.run("A", "run").unwrap().revision, 0);
    }
    let mut value = serde_json::to_value(batch(RunStatus::Running)).unwrap();
    value["executionToken"] = serde_json::json!("synthetic");
    assert!(serde_json::from_value::<CheckpointBatch>(value).is_err());
}

fn write_legacy(path: &Path, body: &str, extra: bool) {
    let mut previous = "0".repeat(64);
    let mut output = String::new();
    for revision in 1..=2 {
        let data = serde_json::json!({"revision":revision,"workspace":{"schemaVersion":1,"theme":"dark","projectRoots":["G:/Synthetic/OLD"],"selectedProjectRoot":"G:/Synthetic/OLD","deepseekConfigured":true,"chats":[{"id":"legacy-chat","title":"Synthetic history","projectLabel":"Do not infer target project","createdAt":1,"archived":false,"messages":[{"role":"user","text":if revision==1 {"Previous snapshot"}else{body}}]}]}});
        // Deserialize through the exact historic struct ordering for its checksum.
        let typed: legacy::VersionedWorkspace = serde_json::from_value(data).unwrap();
        let checksum = hash(&serde_json::to_vec(&(&previous, &typed)).unwrap());
        let mut line = serde_json::json!({"previous":previous,"data":typed,"checksum":checksum});
        if extra {
            line["data"]["workspace"]["approvalToken"] =
                serde_json::json!("synthetic-forbidden-value");
        }
        output.push_str(&serde_json::to_string(&line).unwrap());
        output.push('\n');
        previous = checksum;
    }
    fs::write(path, output).unwrap();
}

#[test]
fn local_run_store_legacy_import_is_explicit_read_only_idempotent_and_has_no_run_state() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    let source = fixture.root.join("workspace.jsonl");
    let legacy_text = "Synthetic legacy text ".repeat(20000);
    write_legacy(&source, &legacy_text, false);
    let before = fs::read(&source).unwrap();
    assert!(store.import_legacy_jsonl("A", &source, &[]).is_err());
    let selected = [LegacySelection {
        chat_id: "legacy-chat".into(),
    }];
    let report = store.import_legacy_jsonl("A", &source, &selected).unwrap();
    assert_eq!(report.source_revision, 2);
    assert_eq!(report.prior_truncation, "unknownCannotRecover");
    let session = &report.imported_session_ids[0];
    let messages = store.messages("A", session, 0, 10).unwrap();
    assert_eq!(messages[0].body, legacy_text);
    assert_eq!(messages[0].origin, Origin::HistoricalTextCopy);
    assert_eq!(
        store
            .import_provenance("A", session)
            .unwrap()
            .unwrap()
            .prior_truncation,
        "unknownCannotRecover"
    );
    assert!(store.runs("A", session, 10, 0).unwrap().is_empty());
    assert_eq!(
        store
            .append_messages("A", session, &[message("new", "Cannot alter history")])
            .unwrap_err()
            .kind,
        "readOnlyHistory"
    );
    assert!(store
        .update_session("A", session, "changed", false)
        .is_err());
    assert!(store
        .start_run(
            "A",
            &NewRun {
                id: "bad".into(),
                session_id: session.clone(),
                goal: "No historical authority".into(),
                created_at: 2
            }
        )
        .is_err());
    let repeated = store.import_legacy_jsonl("A", &source, &selected).unwrap();
    assert!(repeated.imported_session_ids.is_empty());
    assert_eq!(repeated.already_imported_session_ids, vec![session.clone()]);
    store
        .branch_session(
            "A",
            session,
            1,
            "continued",
            "Continue history with fresh authority",
            3,
        )
        .unwrap();
    assert_eq!(
        store.messages("A", "continued", 0, 10).unwrap()[0].origin,
        Origin::HistoricalTextCopy
    );
    store
        .append_messages("A", "continued", &[message("new", "Fresh native message")])
        .unwrap();
    assert_eq!(fs::read(&source).unwrap(), before);
}

#[test]
fn local_run_store_legacy_rejects_unknown_authority_sensitive_text_and_corrupt_chain() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    let source = fixture.root.join("workspace.jsonl");
    let selected = [LegacySelection {
        chat_id: "legacy-chat".into(),
    }];
    write_legacy(&source, "Synthetic text", true);
    assert_eq!(
        store
            .import_legacy_jsonl("A", &source, &selected)
            .unwrap_err()
            .kind,
        "legacyIntegrity"
    );
    write_legacy(&source, "Bearer synthetic-never-a-real-key", false);
    assert_eq!(
        store
            .import_legacy_jsonl("A", &source, &selected)
            .unwrap_err()
            .kind,
        "legacySensitiveText"
    );
    write_legacy(&source, "Synthetic text", false);
    let valid = fs::read(&source).unwrap();
    let invalid = String::from_utf8(valid.clone())
        .unwrap()
        .replace("Synthetic text", "Tampered text");
    fs::write(&source, invalid).unwrap();
    assert_eq!(
        store
            .import_legacy_jsonl("A", &source, &selected)
            .unwrap_err()
            .kind,
        "legacyIntegrity"
    );
    fs::write(&source, &valid[..valid.len() - 1]).unwrap();
    assert_eq!(
        store
            .import_legacy_jsonl("A", &source, &selected)
            .unwrap_err()
            .kind,
        "legacyIntegrity"
    );
    assert_eq!(store.sessions("A", true, 100, 0).unwrap().len(), 1);
}

#[test]
fn local_run_store_database_full_rolls_back_instead_of_clipping_and_remains_usable() {
    let fixture = Fixture::new();
    let store = RunStore::open_with_options(
        fixture.root.join("store"),
        StoreOptions {
            max_database_bytes: 128 * 1024,
            max_artifact_bytes: 1024,
        },
    )
    .unwrap();
    setup(&store, "A");
    let mut oversized = batch(RunStatus::Running);
    oversized
        .messages
        .push(message("too-big", &"x".repeat(2_000_000)));
    assert_eq!(
        store
            .commit_checkpoint("A", "run", 0, &oversized)
            .unwrap_err()
            .kind,
        "capacity"
    );
    assert_eq!(store.run("A", "run").unwrap().revision, 0);
    assert!(store.messages("A", "session", 0, 10).unwrap().is_empty());
    let mut small = batch(RunStatus::Paused);
    small
        .messages
        .push(message("small", "Complete small record"));
    store.commit_checkpoint("A", "run", 0, &small).unwrap();
    assert_eq!(
        store.messages("A", "session", 0, 10).unwrap()[0].body,
        "Complete small record"
    );
}

#[test]
fn local_run_store_artifact_quota_integrity_and_backup_include_committed_wal_records() {
    let fixture = Fixture::new();
    let store = RunStore::open_with_options(
        fixture.root.join("store"),
        StoreOptions {
            max_database_bytes: 4 * 1024 * 1024,
            max_artifact_bytes: 32,
        },
    )
    .unwrap();
    setup(&store, "A");
    let blob = store.put_artifact("A", b"Synthetic artifact").unwrap();
    assert_eq!(
        store.put_artifact("A", b"Synthetic artifact").unwrap(),
        blob
    );
    assert_eq!(
        store.put_artifact("A", &[b'x'; 40]).unwrap_err().kind,
        "capacity"
    );
    assert_eq!(store.usage().unwrap().artifact_bytes, 18);
    // Controlled one-connection fixture only: verify the backup API also includes
    // WAL pages. Production open() uses DELETE on the OS-provided SQLite runtime.
    store.db.execute("PRAGMA journal_mode=WAL", &[]).unwrap();
    let mut data = batch(RunStatus::Paused);
    data.artifacts.push(ArtifactRef {
        id: "artifact".into(),
        sha256: blob.sha256.clone(),
        media_type: "text/plain".into(),
        label: "Synthetic log".into(),
    });
    data.messages.push(message(
        "wal-message",
        "Committed while connection stays open",
    ));
    store.commit_checkpoint("A", "run", 0, &data).unwrap();
    assert!(store.usage().unwrap().wal_bytes > 0);
    let backup = fixture.root.join("backup");
    store.backup(&backup).unwrap();
    assert!(backup.join("backup.complete.json").is_file());
    assert!(store.backup(&backup).is_err());
    let restored = RunStore::open(&backup).unwrap();
    assert_eq!(
        restored.messages("A", "session", 0, 10).unwrap()[0].body,
        "Committed while connection stays open"
    );
    assert_eq!(
        restored.read_artifact("A", "run", "artifact").unwrap(),
        b"Synthetic artifact"
    );
    fs::write(
        store.blob_path("A", &blob.sha256).unwrap(),
        b"Tampered artifact!",
    )
    .unwrap();
    assert_eq!(
        store
            .read_artifact("A", "run", "artifact")
            .unwrap_err()
            .kind,
        "corruptArtifact"
    );
}

#[test]
fn local_run_store_project_export_preserves_complete_bodies_and_excludes_other_projects() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    setup(&store, "B");
    let text = "Synthetic export line\n\"quotes\" and 🙂 ".repeat(20000);
    store
        .append_messages("A", "session", &[message("a-message", &text)])
        .unwrap();
    store
        .append_messages(
            "B",
            "session",
            &[message("b-message", "B-only private synthetic text")],
        )
        .unwrap();
    let export = fixture.root.join("A.jsonl");
    store.export_project_jsonl("A", &export).unwrap();
    assert!(store.export_project_jsonl("A", &export).is_err());
    let contents = fs::read_to_string(export).unwrap();
    assert!(!contents.contains("B-only private synthetic text"));
    let rows: Vec<serde_json::Value> = contents
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(
        rows.iter().find(|r| r["table"] == "messages").unwrap()["record"]["body"],
        text
    );
    assert_eq!(rows.last().unwrap()["exportComplete"], true);
}

#[test]
fn local_run_store_path_classification_rechecks_canonical_prefixes_without_io() {
    // Supplied path strings only: this test creates no share, mapping or directory.
    for (path, drive) in [
        (r"E:\source", b'E'),
        (r"e:\source", b'E'),
        (r"\\?\E:\source", b'E'),
        (r"Z:\artifacts\backup-new", b'Z'),
    ] {
        assert_eq!(local_disk_prefix(Path::new(path)).unwrap(), drive, "{path}");
    }
    for path in [
        r"\\localhost\E$\source",
        r"\\?\UNC\localhost\E$\source",
        r"\\.\E:\source",
        r"\\?\GLOBALROOT\Device\HarddiskVolume1\source",
        r"\\?\Volume{00000000-0000-0000-0000-000000000000}\source",
        r"E:source",
        r"\source",
        r"relative\source",
    ] {
        assert_eq!(
            local_disk_prefix(Path::new(path)).unwrap_err().kind,
            "invalid",
            "{path}"
        );
    }
    // A drive-looking input is not proof of a local canonical parent. This is a
    // synthetic canonical result, not a real mapped-drive acceptance test.
    let caller_input = Path::new(r"Z:\artifacts\backup-new");
    let canonical_parent = Path::new(r"\\?\UNC\localhost\E$\source\artifacts");
    assert!(local_disk_prefix(caller_input).is_ok());
    assert_eq!(
        local_disk_prefix(canonical_parent).unwrap_err().kind,
        "invalid"
    );
}
#[test]
fn local_run_store_destination_rejects_managed_paths_and_windows_aliases_without_side_effects() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    store
        .put_artifact("A", b"Synthetic original artifact")
        .unwrap();
    let source = fixture.root.join("store");
    let before_usage = store.usage().unwrap();
    let before_database = fs::read(source.join("runs.sqlite3")).unwrap();
    let before_artifacts: Vec<_> = fs::read_dir(source.join("artifacts"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    let targets = [
        source.join("artifacts").join("backup-new"),
        source.join("backup-new"),
        source
            .join("missing-parent")
            .join("deeper")
            .join("backup-new"),
        source
            .join("artifacts")
            .join("missing-parent")
            .join("deeper")
            .join("export.jsonl"),
        fixture
            .root
            .join("StOrE")
            .join("ArTiFaCtS")
            .join("backup-new"),
        PathBuf::from(source.to_string_lossy().to_ascii_uppercase())
            .join("ARTIFACTS")
            .join("backup-new"),
        store.root.join("artifacts").join("backup-verbatim"),
        source
            .join("missing-parent")
            .join("..")
            .join("artifacts")
            .join("backup-dot-parent"),
        fixture
            .root
            .join("store.")
            .join("artifacts")
            .join("backup-trimmed-name"),
        source.join("artifacts ").join("export-trimmed-name.jsonl"),
        source.clone(),
    ];
    for target in targets {
        assert_eq!(
            store.backup(&target).unwrap_err().kind,
            "invalid",
            "backup target: {}",
            target.display()
        );
        assert_eq!(
            store.export_project_jsonl("A", &target).unwrap_err().kind,
            "invalid",
            "export target: {}",
            target.display()
        );
    }
    assert_eq!(store.usage().unwrap(), before_usage);
    assert_eq!(
        fs::read(source.join("runs.sqlite3")).unwrap(),
        before_database
    );
    let after_artifacts: Vec<_> = fs::read_dir(source.join("artifacts"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(after_artifacts, before_artifacts);
    assert!(!source.join("backup-new").exists());
    assert!(!source.join("missing-parent").exists());
    assert_eq!(fs::read_dir(source.join("artifacts")).unwrap().count(), 1);

    // The rejected operations leave both artifact staging and normal run writes usable.
    store
        .put_artifact("A", b"Synthetic subsequent artifact")
        .unwrap();
    let mut data = batch(RunStatus::Paused);
    data.messages.push(message(
        "after-rejection",
        "The source store is still usable",
    ));
    store.commit_checkpoint("A", "run", 0, &data).unwrap();
    assert_eq!(store.run("A", "run").unwrap().revision, 1);
    assert_eq!(
        store.messages("A", "session", 0, 10).unwrap()[0].body,
        "The source store is still usable"
    );
    assert!(store.usage().unwrap().artifact_bytes > before_usage.artifact_bytes);
}

#[test]
fn local_run_store_destination_accepts_external_aliases_and_component_prefix_siblings() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    store
        .append_messages(
            "A",
            "session",
            &[message(
                "source-message",
                "Complete external destination fixture",
            )],
        )
        .unwrap();
    // `store-backup` shares a string prefix with the source; it is a different component.
    let backup = fixture.root.join("store-backup");
    let aliased_backup = fixture.root.join("StOrE").join("..").join("store-backup");
    store.backup(&aliased_backup).unwrap();
    assert!(backup.join("backup.complete.json").is_file());
    let restored = RunStore::open(&backup).unwrap();
    assert_eq!(
        restored.messages("A", "session", 0, 10).unwrap()[0].body,
        "Complete external destination fixture"
    );

    let export = fixture.root.join("store-export.jsonl");
    let aliased_export = fixture
        .root
        .join("store")
        .join("artifacts")
        .join("..")
        .join("..")
        .join("store-export.jsonl");
    store.export_project_jsonl("A", &aliased_export).unwrap();
    assert!(fs::read_to_string(export)
        .unwrap()
        .contains("Complete external destination fixture"));
    assert_eq!(store.usage().unwrap().artifact_bytes, 0);
    store
        .put_artifact("A", b"Still usable after external backup")
        .unwrap();
}

#[test]
fn local_run_store_message_pagination_session_archive_branch_and_literal_search() {
    let fixture = Fixture::new();
    let store = fixture.store();
    setup(&store, "A");
    store
        .append_messages(
            "A",
            "session",
            &[
                message("1", "100% literal _ % ' ; DROP TABLE"),
                message("2", "second"),
                message("3", "third"),
            ],
        )
        .unwrap();
    assert_eq!(
        store.messages("A", "session", 1, 1).unwrap()[0].body,
        "second"
    );
    assert_eq!(store.search_messages("A", "% ' ;", 10, 0).unwrap().len(), 1);
    store
        .update_session("A", "session", "Renamed", true)
        .unwrap();
    assert!(store.sessions("A", false, 10, 0).unwrap().is_empty());
    store
        .branch_session("A", "session", 2, "branch", "Branch", 3)
        .unwrap();
    assert_eq!(store.messages("A", "branch", 0, 10).unwrap().len(), 2);
    assert!(store.runs("A", "branch", 10, 0).unwrap().is_empty());
    assert_eq!(
        store.messages("A", "session", 0, 0).unwrap_err().kind,
        "invalid"
    );
}
