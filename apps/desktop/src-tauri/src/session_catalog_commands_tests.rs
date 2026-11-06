//! Synthetic, offline tests. Fixtures are intentionally retained: no file/data deletion.
use super::*;
use crate::local_run_store::{NewMessage, Project, Role};
use crate::session_catalog_commands::{self as commands, BranchInput, CancelInput, ListInput, ReadInput, UpdateInput};
use std::path::{Component, PathBuf, Prefix};

fn fixture(label: &str) -> (PathBuf, RunStore) {
    let base = std::fs::canonicalize(std::env::var_os("UAGENT_SESSION_CATALOG_TEST_ROOT")
        .expect("set UAGENT_SESSION_CATALOG_TEST_ROOT to an existing E:/G: synthetic evidence directory")).unwrap();
    assert!(matches!(base.components().next(), Some(Component::Prefix(prefix))
        if matches!(prefix.kind(), Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) if matches!(drive.to_ascii_uppercase(), b'E' | b'G'))));
    let root = base.join(format!("session-catalog-{label}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir(&root).unwrap();
    let store = RunStore::open(root.join("store")).unwrap();
    for project in ["A", "B"] { store.create_project(&Project { id: project.into(), root: format!("G:/Synthetic/{project}"), label: project.into(), created_at: 1 }).unwrap(); }
    store.create_session(&Session { project_id: "A".into(), id: "source".into(), title: "Alpha".into(), created_at: 1, archived: false, parent_id: None, origin: Origin::Native }).unwrap();
    (root, store)
}
fn request_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!("synthetic-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}
fn branch_input(target: &str, through: i64) -> BranchInput {
    BranchInput { schema_version: 1, project_id: "A".into(), request_id: request_id(), session_id: "source".into(), through_ordinal: through, new_session_id: target.into(), title: "Branch".into() }
}
fn page(archived: bool, limit: usize, offset: usize) -> ListInput { ListInput { title_query:String::new(), schema_version: 1, project_id: "A".into(), request_id: request_id(), include_archived: archived, offset, limit } }
fn rename(project: &str, session: &str, title: &str, expected: &str) -> UpdateInput { UpdateInput { schema_version: 1, project_id: project.into(), request_id: request_id(), session_id: session.into(), patch: SessionPatch::Rename { title: title.into(), expected_title: expected.into() } } }
fn archive(session: &str, archived: bool, expected: bool) -> UpdateInput { UpdateInput { schema_version: 1, project_id: "A".into(), request_id: request_id(), session_id: session.into(), patch: SessionPatch::SetArchived { archived, expected_archived: expected } } }
fn message(id: &str, body: &str) -> NewMessage { NewMessage { id: id.into(), role: Role::User, body: body.into(), created_at: 2 } }

#[test]
fn rename_archive_and_reopen_use_existing_store() {
    let (root, store) = fixture("reopen");
    commands::update(&store, &rename("A", "source", "Renamed 中文", "Alpha")).unwrap();
    let result = commands::update(&store, &archive("source", true, false)).unwrap();
    assert_eq!(result.session.session.title, "Renamed 中文");
    assert!(result.requires_fresh_authorization);
    assert!(commands::list(&store, &page(false, 30, 0)).unwrap().sessions.is_empty());
    drop(store);
    let reopened = RunStore::open(root.join("store")).unwrap();
    let saved = commands::list(&reopened, &page(true, 30, 0)).unwrap();
    assert_eq!(saved.sessions.len(), 1);
    assert!(saved.sessions[0].session.archived);
    assert_eq!(saved.sessions[0].session.title, "Renamed 中文");
}
#[test]
fn project_mismatch_unknown_source_and_historical_updates_are_rejected() {
    let (_, store) = fixture("identity");
    assert_eq!(commands::update(&store, &rename("B", "source", "Wrong", "Alpha")).unwrap_err().kind, "notFound");
    let mut request = branch_input("new", 0); request.project_id = "B".into();
    assert_eq!(commands::branch(&store, &request, 2).unwrap_err().kind, "notFound");
    request.project_id = "A".into(); request.session_id = "missing".into(); request.request_id = request_id();
    assert_eq!(commands::branch(&store, &request, 2).unwrap_err().kind, "notFound");
    store.insert_session(&Session { project_id: "A".into(), id: "historic".into(), title: "Imported".into(), created_at: 1, archived: false, parent_id: None, origin: Origin::HistoricalTextCopy }).unwrap();
    assert_eq!(commands::update(&store, &rename("A", "historic", "Wrong", "Imported")).unwrap_err().kind, "readOnlyHistory");
    assert_eq!(store.session_catalog_entry("A", "historic").unwrap().session.title, "Imported");
}
#[test]
fn branch_preserves_only_selected_complete_text_and_provenance_and_never_duplicates() {
    let (_, store) = fixture("branch");
    let long = "中\0🙂 exact\n".repeat(10_000);
    store.append_messages("A", "source", &[message("m1", &long), message("m2", "second"), message("m3", "excluded")]).unwrap();
    let result = commands::branch(&store, &branch_input("branch", 2), 3).unwrap();
    assert_eq!(result.session.session.parent_id.as_deref(), Some("source"));
    assert_eq!(result.session.session.origin, Origin::Native);
    assert_eq!(result.session.last_ordinal, 2);
    assert_eq!(result.session.latest_run_id, None);
    let messages = store.messages("A", "branch", 0, 10).unwrap();
    assert_eq!(messages.len(), 2); assert_eq!(messages[0].body, long); assert_eq!(messages[1].body, "second");
    assert!(messages.iter().all(|m| m.origin == Origin::Native));
    assert_ne!(messages[0].id, "m1");
    assert_eq!(commands::branch(&store, &branch_input("branch", 2), 4).unwrap_err().kind, "alreadyExists");
    assert_eq!(store.messages("A", "branch", 0, 10).unwrap().len(), 2);
    commands::update(&store, &rename("A", "branch", "Independent", "Branch")).unwrap();
    commands::update(&store, &archive("branch", true, false)).unwrap();
    assert_eq!(store.session_catalog_entry("A", "source").unwrap().session.title, "Alpha");
    assert!(store.runs("A", "branch", 10, 0).unwrap().is_empty());
}
#[test]
fn imported_message_origin_survives_branch_without_importing_execution_state() {
    let (_, store) = fixture("origin");
    store.insert_session(&Session { project_id: "A".into(), id: "historic".into(), title: "Imported".into(), created_at: 1, archived: false, parent_id: None, origin: Origin::HistoricalTextCopy }).unwrap();
    store.db.execute("INSERT INTO messages(project_id,session_id,id,ordinal,role,body,created_at,origin) VALUES('A','historic','old',1,'user',?,1,'historicalTextCopy')", &["exact historical text".into()]).unwrap();
    let mut request = branch_input("native-copy", 1); request.session_id = "historic".into();
    let result = commands::branch(&store, &request, 3).unwrap();
    assert_eq!(result.session.session.origin, Origin::Native);
    let messages = store.messages("A", "native-copy", 0, 10).unwrap();
    assert_eq!(messages[0].origin, Origin::HistoricalTextCopy);
    assert_eq!(messages[0].body, "exact historical text");
    let text = serde_json::to_string(&result).unwrap();
    for forbidden in ["scope", "executionToken", "approval", "apiKey", "coordinatorState"] { assert!(!text.contains(forbidden)); }
}
#[test]
fn over_budget_and_invalid_prefix_leave_no_partial_branch() {
    let (_, store) = fixture("budget");
    store.append_messages("A", "source", &[message("oversized", &"x".repeat(256 * 1024 + 1))]).unwrap();
    assert_eq!(commands::branch(&store, &branch_input("too-large", 1), 3).unwrap_err().kind, "branchCapacity");
    assert!(store.session_catalog_entry("A", "too-large").is_err());
    assert!(commands::branch(&store, &branch_input("past-end", 2), 3).is_err());
    let empty = commands::branch(&store, &branch_input("empty", 0), 3).unwrap();
    assert_eq!(empty.session.message_count, 0);
    let (_, count_store) = fixture("count-budget");
    let many: Vec<_> = (0..513).map(|i| message(&format!("m{i}"), "small")).collect();
    count_store.append_messages("A", "source", &many).unwrap();
    assert_eq!(commands::branch(&count_store, &branch_input("too-many", 513), 3).unwrap_err().kind, "branchCapacity");
    assert!(count_store.session_catalog_entry("A", "too-many").is_err());
    let (_, total_store) = fixture("total-budget");
    let several: Vec<_> = (0..9).map(|i| message(&format!("m{i}"), &"x".repeat(128 * 1024))).collect();
    total_store.append_messages("A", "source", &several).unwrap();
    assert_eq!(commands::branch(&total_store, &branch_input("too-total", 9), 3).unwrap_err().kind, "branchCapacity");
}
#[test]
fn pagination_and_complete_prefix_read_have_explicit_boundaries() {
    let (_, store) = fixture("page-read");
    store.append_messages("A", "source", &[message("one", "whole \0 text"), message("two", "second")]).unwrap();
    commands::branch(&store, &branch_input("newer", 1), 3).unwrap();
    let first = commands::list(&store, &page(false, 1, 0)).unwrap();
    assert!(first.has_more); assert_eq!(first.sessions[0].session.id, "newer");
    let next = commands::list(&store, &page(false, 1, 1)).unwrap();
    assert!(!next.has_more); assert_eq!(next.sessions[0].session.id, "source");
    let read = commands::read(&store, &ReadInput { schema_version: 1, project_id: "A".into(), request_id: request_id(), session_id: "source".into(), through_ordinal: 1 }).unwrap();
    assert_eq!(read.messages.len(), 1); assert_eq!(read.messages[0].body, "whole \0 text"); assert!(read.requires_fresh_authorization);
    assert!(commands::list(&store, &page(false, 51, 0)).is_err());
    assert!(validate_title(&"中".repeat(342)).is_err());
}

#[test]
fn field_patches_preserve_interleaved_edits_and_reject_stale_same_field() {
    let (_, store) = fixture("field-conflicts");
    commands::update(&store, &archive("source", true, false)).unwrap();
    let renamed = commands::update(&store, &rename("A", "source", "Beta", "Alpha")).unwrap();
    assert!(renamed.session.session.archived); // A stale rename cannot unarchive.
    let unarchived = commands::update(&store, &archive("source", false, true)).unwrap();
    assert_eq!(unarchived.session.session.title, "Beta"); // A stale archive cannot rename.
    assert_eq!(commands::update(&store, &rename("A", "source", "Lost", "Alpha")).unwrap_err().kind, "conflict");
    assert_eq!(commands::update(&store, &archive("source", true, true)).unwrap_err().kind, "conflict");
    assert_eq!(store.session_catalog_entry("A", "source").unwrap().session.title, "Beta");
}
#[test]
fn sparse_prefix_returns_independent_actual_count_and_complete_rows() {
    let (_, store) = fixture("sparse-prefix");
    for ordinal in [2i64, 5, 9] {
        store.db.execute("INSERT INTO messages(project_id,session_id,id,ordinal,role,body,created_at,origin) VALUES('A','source',?,?,'user',?,1,'native')", &[format!("sparse-{ordinal}").into(),ordinal.into(),format!("message-{ordinal}").into()]).unwrap();
    }
    let read = commands::read(&store, &ReadInput { schema_version: 1, project_id: "A".into(), request_id: request_id(), session_id: "source".into(), through_ordinal: 5 }).unwrap();
    assert_eq!(read.prefix_message_count, 2); assert_eq!(read.messages.iter().map(|m| m.ordinal).collect::<Vec<_>>(), vec![2, 5]);
    let all = commands::read(&store, &ReadInput { schema_version: 1, project_id: "A".into(), request_id: request_id(), session_id: "source".into(), through_ordinal: 9 }).unwrap();
    assert_eq!(all.prefix_message_count as i64, all.session.message_count);
    assert_eq!(all.messages.len(), 3);
}
#[test]
fn vm_interrupt_rolls_back_and_restores_same_connection_handler_and_limits() {
    use super::control::CatalogControl;
    let (_, store) = fixture("vm-rollback");
    let before_busy = store.db.query("PRAGMA busy_timeout", &[]).unwrap()[0][0].int().unwrap();
    store.append_messages("A", "source", &[message("before-interrupt", "whole prefix")]).unwrap();
    let copied = std::cell::Cell::new(false);
    let control = CatalogControl::for_test(5000, std::time::Duration::from_millis(250));
    let result = store.session_catalog_controlled(&control, true, || {
        store.session_catalog_branch("A", "source", 1, "must-rollback", "Synthetic", 3)?;
        copied.set(true);
        store.db.query("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2000) SELECT MAX(x) FROM n", &[])?;
        Ok(())
    });
    assert_eq!(result.unwrap_err().kind, "catalogBudget");
    assert!(copied.get());
    assert!(store.session_catalog_entry("A", "must-rollback").is_err());
    assert_eq!(store.db.query("PRAGMA busy_timeout", &[]).unwrap()[0][0].int().unwrap(), before_busy);
    assert_eq!(store.db.query("SELECT ?", &["x".repeat(400 * 1024).into()]).unwrap().len(), 1);
    let fresh = CatalogControl::for_test(1000, std::time::Duration::from_millis(250));
    assert!(store.session_catalog_controlled(&fresh, true, || { store.db.query("SELECT 1", &[])?; Ok(()) }).is_ok());
    store.db.execute("BEGIN IMMEDIATE", &[]).unwrap(); store.db.execute("ROLLBACK", &[]).unwrap();
}
#[test]
fn cancellation_detaches_before_rollback_and_a_following_write_succeeds() {
    use super::control::CatalogControl;
    let (_, store) = fixture("cancel-rollback");
    let control = CatalogControl::for_test(10_000, std::time::Duration::from_millis(250));
    let result = store.session_catalog_controlled(&control, true, || {
        store.create_session(&Session { project_id: "A".into(), id: "cancelled-copy".into(), title: "Synthetic".into(), created_at: 3, archived: false, parent_id: None, origin: Origin::Native })?;
        control.cancel();
        store.db.query("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<200) SELECT MAX(x) FROM n", &[])?;
        Ok(())
    });
    assert_eq!(result.unwrap_err().kind, "catalogCancelled");
    assert!(store.session_catalog_entry("A", "cancelled-copy").is_err());
    assert!(commands::update(&store, &rename("A", "source", "After cancellation", "Alpha")).is_ok());
}
#[test]
fn cancel_before_dispatch_is_scoped_and_deadline_zero_never_starts_copy() {
    use super::control::CatalogControl;
    let (_, store) = fixture("pre-cancel");
    let request = branch_input("never-created", 0);
    let cancelled = commands::cancel(&CancelInput { schema_version: 1, project_id: "A".into(), request_id: request.request_id.clone() }).unwrap();
    assert!(cancelled.cancellation_requested);
    assert_eq!(commands::branch(&store, &request, 3).unwrap_err().kind, "catalogCancelled");
    assert!(store.session_catalog_entry("A", "never-created").is_err());
    let other = branch_input("project-scoped-copy", 0);
    commands::cancel(&CancelInput { schema_version: 1, project_id: "B".into(), request_id: other.request_id.clone() }).unwrap();
    assert!(commands::branch(&store, &other, 3).is_ok());
    assert!(!commands::cancel(&CancelInput { schema_version: 1, project_id: "A".into(), request_id: other.request_id.clone() }).unwrap().cancellation_requested);
    let control = CatalogControl::for_test(1000, std::time::Duration::ZERO);
    assert_eq!(store.session_catalog_controlled(&control, true, || Err::<(), _>(StoreError::invalid("expired operation unexpectedly started"))).unwrap_err().kind, "catalogDeadline");
    assert!(commands::list(&store, &page(false, 30, 0)).is_ok());
}

#[test]
fn title_search_finds_old_sessions_across_catalog_pages() {
    let (_,store)=fixture("title-pages");
    for n in 0..40 {store.create_session(&Session{project_id:"A".into(),id:format!("new-{n}"),title:format!("Other {n}"),created_at:10+n,archived:false,parent_id:None,origin:Origin::Native}).unwrap();}
    assert!(!commands::list(&store,&page(false,30,0)).unwrap().sessions.iter().any(|s|s.session.id=="source"));
    let mut q=page(false,1,0);q.title_query="aLpHa".into();let result=commands::list(&store,&q).unwrap();assert_eq!(result.title_query,"aLpHa");assert_eq!(result.sessions.len(),1);assert_eq!(result.sessions[0].session.id,"source");assert!(!result.has_more);
}
#[test]
fn title_search_literal_unicode_archived_and_project_scope() {
    let (_,store)=fixture("title-literals");
    for (project,id,title,archived) in [("A","one","测试 100%_Done",false),("A","two","测试 100xxDone",false),("A","hidden","测试 100%_Done archived",true),("B","other","测试 100%_Done",false)] {
        store.create_session(&Session{project_id:project.into(),id:id.into(),title:title.into(),created_at:2,archived,parent_id:None,origin:Origin::Native}).unwrap();
    }
    let mut q=page(false,1,0);q.title_query="测试 100%_done".into();let a=commands::list(&store,&q).unwrap();assert_eq!(a.sessions[0].session.id,"one");assert!(!a.has_more);
    q.request_id=request_id();q.include_archived=true;let a=commands::list(&store,&q).unwrap();assert!(a.has_more);assert_eq!(a.sessions[0].session.id,"one");
    q.request_id=request_id();q.offset=1;let b=commands::list(&store,&q).unwrap();assert_eq!(b.sessions[0].session.id,"hidden");assert!(!b.has_more);
    q.request_id=request_id();q.title_query="' OR 1=1 --".into();q.offset=0;assert!(commands::list(&store,&q).unwrap().sessions.is_empty());
}
#[test]
fn title_search_rejects_invalid_input_and_accepts_legacy_empty_query() {
    let (_,store)=fixture("title-invalid");let mut q=page(false,30,0);q.title_query="bad\nquery".into();assert_eq!(commands::list(&store,&q).unwrap_err().kind,"invalid");
    q.request_id=request_id();q.title_query="x".repeat(1025);assert!(commands::list(&store,&q).is_err());
    let legacy:ListInput=serde_json::from_value(serde_json::json!({"schemaVersion":1,"projectId":"A","requestId":request_id(),"includeArchived":false,"offset":0,"limit":30})).unwrap();assert_eq!(commands::list(&store,&legacy).unwrap().sessions.len(),1);
}
