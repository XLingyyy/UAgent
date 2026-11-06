//! Source only in this authoring pass. Central alone runs the guarded fixture.
use super::*;
use crate::local_run_store::external_sqlite_writer_tests::{with_raw_writer,WriterPort};
use super::super::{MemoryContent, MemoryMutation, MemoryOrigin, MemorySource};
use crate::local_run_store::{schema, sqlite::Db, Project, StoreOptions};
use std::{cell::{Cell, RefCell}, path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Arc}, time::{Duration, Instant}};

// Deterministic test-only scheduling windows; no hooks exist in production.
thread_local! {
    static AFTER_ROW: RefCell<Option<Box<dyn FnMut(usize)>>> = RefCell::new(None);
    static AFTER_CLEANUP: RefCell<Option<Box<dyn FnOnce()>>> = RefCell::new(None);
}
pub(super) fn after_row_read(index: usize) {
    AFTER_ROW.with(|slot| { if let Some(hook) = slot.borrow_mut().as_mut() { hook(index); } });
}
pub(super) fn after_transaction_cleanup() {
    let hook = AFTER_CLEANUP.with(|slot| slot.borrow_mut().take());
    if let Some(hook) = hook { hook(); }
}
struct ResetHook(bool);
impl Drop for ResetHook {
    fn drop(&mut self) {
        if self.0 { AFTER_ROW.with(|slot| { slot.borrow_mut().take(); }); }
        else { AFTER_CLEANUP.with(|slot| { slot.borrow_mut().take(); }); }
    }
}
fn with_row_hook<T>(hook: impl FnMut(usize) + 'static, work: impl FnOnce() -> T) -> T {
    AFTER_ROW.with(|slot| assert!(slot.replace(Some(Box::new(hook))).is_none()));
    let _reset = ResetHook(true);
    work()
}
fn with_cleanup_hook<T>(hook: impl FnOnce() + 'static, work: impl FnOnce() -> T) -> T {
    AFTER_CLEANUP.with(|slot| assert!(slot.replace(Some(Box::new(hook))).is_none()));
    let _reset = ResetHook(false);
    work()
}

fn execution(cancelled: &AtomicBool) -> MemoryExecution<'_> {
    MemoryExecution::for_test(cancelled, Instant::now() + Duration::from_secs(2), 250_000)
}
fn scope<'a>(read: &'a [String], share: &'a [String]) -> MemoryDispatchScope<'a> {
    MemoryDispatchScope { project_id: "A", read_prefixes: read, share_prefixes: share, max_context_bytes: MAX_CONTEXT_BYTES }
}
fn content() -> MemoryContent {
    MemoryContent { kind: "fact".into(), body: "Synthetic complete fact".into(),
        source_refs: vec![MemorySource { project_id: "A".into(), path: "Source/Main.cpp".into(),
            version: "original-v1".into(), freshness: Some("original-stamp".into()), kind: "file_preview".into() }],
        share_paths: vec!["Source".into()], priority: "normal".into(), visibility: "project".into(),
        origin: MemoryOrigin { kind: "user".into(), session_id: None, message_id: None }, read_at: 1 }
}
fn store_from(db: Db, root: PathBuf) -> RunStore {
    db.execute("PRAGMA foreign_keys=ON", &[]).unwrap();
    schema::migrate(&db).unwrap();
    let store = RunStore { db, root, options: StoreOptions::default() };
    for project in ["A", "B"] {
        store.create_project(&Project { id: project.into(), root: format!("E:\\synthetic\\{project}"),
            label: project.into(), created_at: 1 }).unwrap();
    }
    store
}
fn memory_store() -> RunStore { store_from(Db::open(Path::new(":memory:")).unwrap(), PathBuf::new()) }
fn confirmed(store: &RunStore, id: &str, content: MemoryContent) -> ProjectMemory {
    let cancelled = AtomicBool::new(false);
    store.create_project_memory(&execution(&cancelled), "A", id, content).unwrap();
    store.update_project_memory(&execution(&cancelled), "A", id, 1, MemoryMutation::Confirm, 2).unwrap()
}
fn selections(records: &[ProjectMemory]) -> Vec<MemoryDispatchSelection<'_>> {
    records.iter().map(|record| MemoryDispatchSelection { id: &record.id, revision: record.revision }).collect()
}
fn rewrite(store: &RunStore, record: &ProjectMemory) {
    // Deliberately bypass the mutator to model an uncooperative writer, including
    // malformed payload/column state. Only the isolated synthetic DB is targeted.
    store.db.execute("UPDATE project_memories SET revision=?,validity=?,payload=? WHERE project_id=? AND id=?",
        &[record.revision.into(), record.validity.as_str().into(), serde_json::to_string(record).unwrap().into(),
          record.project_id.as_str().into(), record.id.as_str().into()]).unwrap();
}
struct PendingProbe(Arc<AtomicUsize>);
impl Drop for PendingProbe { fn drop(&mut self) { self.0.fetch_add(1, Ordering::AcqRel); } }

#[test]
fn complete_ordered_selection_enters_admission_once_and_only_borrows_the_originals() {
    let store = memory_store();
    let records = vec![confirmed(&store, "b", content()), confirmed(&store, "a", content())];
    let prefixes = vec!["Source".into()];
    let scope = scope(&prefixes, &prefixes);
    let cancelled = AtomicBool::new(false);
    let snapshot = store.project_memory_dispatch_snapshot(&execution(&cancelled), &scope, &selections(&records)).unwrap();
    assert_eq!(snapshot, records);
    let calls = Cell::new(0);
    let result = store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &snapshot, |verified| {
        verified.check_execution()?;
        assert_eq!(verified.project_id(), "A");
        assert!(std::ptr::eq(verified.original_records(), snapshot.as_slice()));
        assert_eq!(verified.current_records(), snapshot.as_slice());
        assert_eq!(verified.current_records()[0].id, "b");
        calls.set(calls.get() + 1);
        Ok(17)
    }).unwrap();
    assert_eq!(result, 17);
    assert_eq!(calls.get(), 1);
    assert_eq!(store.project_memory(&execution(&cancelled), "A", "a").unwrap(), records[1]);
}

#[test]
fn changed_full_contents_or_eligibility_never_yield_a_partial_batch() {
    let store = memory_store();
    let originals = vec![confirmed(&store, "a", content()), confirmed(&store, "b", content())];
    let prefixes = vec!["Source".into()];
    let scope = scope(&prefixes, &prefixes);
    let cancelled = AtomicBool::new(false);
    let cases: &[fn(&mut ProjectMemory)] = &[
        |record| record.revision += 1,
        |record| record.body.push_str(" changed"),
        |record| record.source_refs[0].version = "v2".into(),
        |record| record.source_refs[0].freshness = Some("new stamp".into()),
        |record| record.share_paths = vec!["Source/Main.cpp".into()],
        |record| record.priority = "constraint".into(),
        |record| record.read_at += 1,
        |record| record.origin.kind = "model".into(),
        |record| record.confirmation.as_mut().unwrap().confirmed_at += 1,
        |record| record.kind = "decision".into(),
        |record| record.visibility = "private".into(),
        |record| record.validity = "stale".into(),
        |record| record.validity = "pending".into(),
        |record| record.validity = "retired".into(),
        |record| record.confirmation = None,
        |record| record.source_refs.clear(),
    ];
    for change in cases {
        let mut changed = originals[1].clone();
        change(&mut changed);
        rewrite(&store, &changed);
        let calls = Cell::new(0);
        let result = store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &originals, |_| {
            calls.set(calls.get() + 1); Ok(())
        });
        assert!(result.is_err());
        assert_eq!(calls.get(), 0);
        rewrite(&store, &originals[1]);
    }
    // Cross-project coordinates and a missing member are rejected without any
    // file/data deletion, including when an earlier member already matched.
    let mut missing = originals.clone(); missing[1].id = "missing".into();
    let mut crossed = originals.clone(); crossed[1].project_id = "B".into();
    crossed[1].source_refs[0].project_id = "B".into();
    for records in [missing, crossed, vec![originals[0].clone(), originals[0].clone()]] {
        let calls = Cell::new(0);
        assert!(store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records, |_| {
            calls.set(calls.get() + 1); Ok(())
        }).is_err());
        assert_eq!(calls.get(), 0);
    }
}

#[test]
fn native_scope_limits_sources_and_component_boundaries_fail_closed() {
    let store = memory_store();
    let record = confirmed(&store, "a", content());
    let allowed = vec!["source".into()];
    let cancelled = AtomicBool::new(false);
    assert!(store.project_memory_dispatch_snapshot(&execution(&cancelled), &scope(&allowed, &allowed),
        &selections(std::slice::from_ref(&record))).is_ok());
    let private = vec!["SourcePrivate".into()];
    let malformed = vec!["".into(), "../Private".into()];
    for denied in [&private, &malformed] {
        assert!(store.with_verified_project_memory_batch(&execution(&cancelled), &scope(&allowed, denied),
            std::slice::from_ref(&record), |_| -> Result<()> { panic!("invalid scope admitted") }).is_err());
    }
    let mut tiny = scope(&allowed, &allowed); tiny.max_context_bytes = record.body.len() - 1;
    assert_eq!(store.project_memory_dispatch_snapshot(&execution(&cancelled), &tiny,
        &selections(std::slice::from_ref(&record))).err().unwrap().kind, "projectMemoryCapacity");
    let mut unsupported = record.clone(); unsupported.source_refs[0].kind = "index_query".into();
    rewrite(&store, &unsupported);
    assert_eq!(store.project_memory_dispatch_snapshot(&execution(&cancelled), &scope(&allowed, &allowed),
        &selections(std::slice::from_ref(&unsupported))).err().unwrap().kind, "memoryDispatchSourceUnsupported");
    let mut many = Vec::new();
    for index in 0..9 {
        let mut value = content(); value.source_refs = vec![value.source_refs[0].clone(); 8];
        many.push(confirmed(&store, &format!("many-{index}"), value));
    }
    assert_eq!(store.project_memory_dispatch_snapshot(&execution(&cancelled), &scope(&allowed, &allowed),
        &selections(&many)).err().unwrap().kind, "projectMemoryCapacity");
    let too_many: Vec<_> = (0..257).map(|_| MemoryDispatchSelection { id: "a", revision: 2 }).collect();
    assert!(store.project_memory_dispatch_snapshot(&execution(&cancelled), &scope(&allowed, &allowed), &too_many).is_err());
}

#[test]
fn cancellation_between_rows_and_inside_final_admission_cannot_return_a_pending_result() {
    let store = memory_store();
    let records = vec![confirmed(&store, "a", content()), confirmed(&store, "b", content())];
    let prefixes = vec!["Source".into()];
    let scope = scope(&prefixes, &prefixes);
    let cancelled = Arc::new(AtomicBool::new(false));
    let trip = cancelled.clone();
    let calls = Cell::new(0);
    let result = with_row_hook(move |index| { if index == 0 { trip.store(true, Ordering::Release); } }, || {
        store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records, |_| {
            calls.set(calls.get() + 1); Ok(())
        })
    });
    assert_eq!(result.err().unwrap().kind, "projectMemoryCancelled");
    assert_eq!(calls.get(), 0);
    // Clearing is fixture-only; real native request cancellation is one-way.
    cancelled.store(false, Ordering::Release);
    let result = store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records, |verified| {
        cancelled.store(true, Ordering::Release);
        verified.check_execution()?;
        Ok(())
    });
    assert_eq!(result.err().unwrap().kind, "projectMemoryCancelled");
    cancelled.store(false, Ordering::Release);
    let expired = MemoryExecution::for_test(&cancelled, Instant::now(), 250_000);
    assert_eq!(store.with_verified_project_memory_batch(&expired, &scope, &records,
        |_| -> Result<()> { panic!("expired operation admitted") }).err().unwrap().kind, "projectMemoryDeadline");
}

#[test]
fn post_cleanup_cancellation_drops_the_pending_value_and_preserves_the_original_error() {
    let store = memory_store();
    let records = vec![confirmed(&store, "a", content())];
    let prefixes = vec!["Source".into()];
    let scope = scope(&prefixes, &prefixes);
    let cancelled = Arc::new(AtomicBool::new(false));
    let dropped = Arc::new(AtomicUsize::new(0));
    let trip = cancelled.clone();
    let result = with_cleanup_hook(move || trip.store(true, Ordering::Release), || {
        store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records, |verified| {
            verified.check_execution()?;
            Ok(PendingProbe(dropped.clone()))
        })
    });
    assert_eq!(result.err().unwrap().kind, "projectMemoryCancelled");
    assert_eq!(dropped.load(Ordering::Acquire), 1);
    cancelled.store(false, Ordering::Release);
    let result: Result<()> = store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records, |_| {
        cancelled.store(true, Ordering::Release);
        Err(StoreError::new("syntheticAdmissionRejected", "fixture rejection"))
    });
    // The existing budget intentionally prioritizes an observed cancellation.
    // With no cancellation, an admission failure is retained without becoming a
    // success merely because rollback/autocommit confirmation succeeded.
    assert!(result.is_err());
    cancelled.store(false, Ordering::Release);
    let result: Result<()> = store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records,
        |_| Err(StoreError::new("syntheticAdmissionRejected", "fixture rejection")));
    assert_eq!(result.err().unwrap().kind, "syntheticAdmissionRejected");
}

#[test]
fn vm_interrupt_panic_and_failed_outer_commit_cannot_release_pending_values() {
    let store = memory_store();
    let records = vec![confirmed(&store, "a", content())];
    let prefixes = vec!["Source".into()];
    let scope = scope(&prefixes, &prefixes);
    let cancelled = AtomicBool::new(false);
    let dropped = Arc::new(AtomicUsize::new(0));
    let tiny = MemoryExecution::for_test(&cancelled, Instant::now() + Duration::from_secs(2), 1_000);
    let result: Result<PendingProbe> = store.with_verified_project_memory_batch(&tiny, &scope, &records, |_| {
        let pending = PendingProbe(dropped.clone());
        // A test-only SQL probe demonstrates that the ONE installed SQL budget
        // remains active through the callback. Production final-state admission
        // never executes SQL or calls this probe while holding its mutex.
        store.db.query("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) SELECT sum(x) FROM n", &[])?;
        Ok(pending)
    });
    assert_eq!(result.err().unwrap().kind, "projectMemoryBudget");
    assert_eq!(dropped.load(Ordering::Acquire), 1);
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _: Result<PendingProbe> = store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records, |_| {
            let _pending = PendingProbe(dropped.clone());
            panic!("synthetic admission panic");
        });
    }));
    assert!(panic.is_err());
    assert_eq!(dropped.load(Ordering::Acquire), 2);
    let result = store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records, |_| {
        let pending = PendingProbe(dropped.clone());
        // Force the REAL outer COMMIT to fail (transaction already ended).
        // This is not a substitute for central's authorizer/disk/quarantine tests.
        store.db.execute("ROLLBACK", &[])?;
        Ok(pending)
    });
    assert!(result.is_err());
    assert_eq!(dropped.load(Ordering::Acquire), 3);
    assert_eq!(store.project_memory(&execution(&cancelled), "A", "a").unwrap(), records[0]);
    assert!(store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &records, |_| Ok(())).is_ok());
}

fn update_sql(record: &ProjectMemory) -> String {
    let payload = serde_json::to_string(record).unwrap().replace('\'', "''");
    format!("UPDATE project_memories SET revision={},validity='{}',payload='{}' WHERE project_id='A' AND id='{}'",
        record.revision, record.validity, payload, record.id)
}
fn file_store() -> (RunStore, PathBuf) {
    let base = PathBuf::from(std::env::var_os("UAGENT_MEMORY_TEST_ROOT")
        .expect("central must set an isolated E:/G: fixture root"));
    let text = base.to_string_lossy().to_ascii_uppercase();
    assert!(base.is_absolute() && ["E:\\", "E:/", "G:\\", "G:/"].iter().any(|prefix| text.starts_with(prefix)));
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root = base.join(format!("memory-dispatch-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("runs.sqlite3");
    (store_from(Db::open(&path).unwrap(), root), path)
}

#[test]
fn actual_external_writer_cannot_interleave_rows_or_final_admission_but_can_commit_after_cleanup() {
    let (store, path) = file_store();
    let originals = vec![confirmed(&store, "a", content()), confirmed(&store, "b", content())];
    let prefixes = vec!["Source".into()];
    let scope = scope(&prefixes, &prefixes);
    let cancelled = AtomicBool::new(false);
    with_raw_writer(path, |writer| {
        let mut before = originals[1].clone(); before.body = "Changed before transaction".into(); before.revision += 1;
        assert_eq!(writer.execute(update_sql(&before)), 0);
        let calls = Cell::new(0);
        assert!(store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &originals, |_| {
            calls.set(calls.get() + 1); Ok(())
        }).is_err());
        assert_eq!(calls.get(), 0);
        let coordinates = vec![originals[0].clone(), before];
        let frozen = store.project_memory_dispatch_snapshot(&execution(&cancelled), &scope, &selections(&coordinates)).unwrap();
        let mut after_a = frozen[0].clone(); after_a.body = "Writer after A read".into(); after_a.revision += 1;
        let mut after_b = frozen[1].clone(); after_b.body = "Writer before B read".into(); after_b.revision += 1;
        let writer_at_row: WriterPort = writer.clone();
        let update_a = update_sql(&after_a); let update_b = update_sql(&after_b);
        let observed = Arc::new(AtomicUsize::new(0)); let row_observed = observed.clone();
        with_row_hook(move |index| {
            if index == 0 {
                // This SECOND connection bypasses the cooperating process gate.
                // SQLITE_BUSY=5 proves the real IMMEDIATE reservation blocks both
                // an already-read member and the not-yet-read member.
                assert_eq!(writer_at_row.execute(update_a.clone()), 5);
                assert_eq!(writer_at_row.execute(update_b.clone()), 5);
                row_observed.fetch_add(1, Ordering::AcqRel);
            }
        }, || {
            store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &frozen, |verified| {
                verified.check_execution()?;
                assert_eq!(writer.execute(update_sql(&after_a)), 5);
                calls.set(calls.get() + 1);
                Ok(())
            }).unwrap();
        });
        assert_eq!(observed.load(Ordering::Acquire), 1);
        assert_eq!(calls.get(), 1);
        // After the successful COMMIT/handler restoration the same external
        // writer can commit, although this thread still owns its RunStore gate.
        assert_eq!(writer.execute(update_sql(&after_a)), 0);
        assert!(store.with_verified_project_memory_batch(&execution(&cancelled), &scope, &frozen,
            |_| -> Result<()> { panic!("old reviewed batch admitted") }).is_err());
    });
    // Retain the synthetic fixture as evidence; never delete user files/data.
}

#[test]
fn memory_journal_bootstrap_is_idempotent_and_preserves_existing_version() {
    let store = memory_store();
    store.ensure_memory_effect_journal().unwrap();
    store.ensure_memory_effect_journal().unwrap();
    store.db.execute("UPDATE effect_journal_meta SET version=1", &[]).unwrap();
    store.ensure_memory_effect_journal().unwrap();
    assert_eq!(store.db.query("SELECT version FROM effect_journal_meta", &[]).unwrap()[0][0].int().unwrap(), 1);
    assert_eq!(store.open_effect_journal().err().unwrap().kind, "unfencedLegacySchema");
}
#[test]
fn memory_journal_bootstrap_refuses_partial_without_repair() {
    let store = memory_store();
    store.db.execute("CREATE TABLE effect_journal_meta(singleton INTEGER PRIMARY KEY,version INTEGER)", &[]).unwrap();
    assert_eq!(store.ensure_memory_effect_journal().unwrap_err().kind, "catalogJournalAbsentOrPartial");
    assert_eq!(store.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'effect_%'", &[]).unwrap().len(), 1);
}
