use super::*;
use crate::local_run_store::{schema,sqlite::Db,Project,StoreOptions};
use std::path::{Path,PathBuf};
fn execution()->MemoryExecution<'static>{
    static CANCELLED:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
    MemoryExecution::new(&CANCELLED,std::time::Instant::now()+std::time::Duration::from_secs(2))
}
fn synthetic_store() -> RunStore {
    let db=Db::open(Path::new(":memory:")).unwrap();
    db.execute("PRAGMA foreign_keys=ON",&[]).unwrap();
    schema::migrate(&db).unwrap();
    let store=RunStore{db,root:PathBuf::new(),options:StoreOptions::default()};
    projects(&store);store
}
fn projects(store:&RunStore) {
    for project in ["A","B"] {
        store.create_project(&Project{id:project.into(),root:format!("E:\\synthetic\\{project}"),label:project.into(),created_at:1}).unwrap();
    }
}
fn content()->MemoryContent{
    MemoryContent{kind:"fact".into(),body:"Synthetic fact 中文".into(),source_refs:vec![MemorySource{project_id:"A".into(),path:"Source/Main.cpp".into(),version:"v1".into(),freshness:Some("stamp1".into()),kind:"file_preview".into()}],share_paths:vec!["Source".into()],priority:"constraint".into(),visibility:"project".into(),origin:MemoryOrigin{kind:"model".into(),session_id:None,message_id:None},read_at:1}
}
#[test]
fn project_memory_isolation_pending_confirmation_and_revision_conflict(){
    let store=synthetic_store();
    let created=store.create_project_memory(&execution(),"A","m1",content()).unwrap();
    assert_eq!(created.validity,"pending");assert!(created.confirmation.is_none());
    assert!(store.project_memory(&execution(),"B","m1").is_err());
    assert!(store.project_memories(&execution(),"B",None,30).unwrap().memories.is_empty());
    assert!(store.create_project_memory(&execution(),"A","m1",content()).is_err());
    let confirmed=store.update_project_memory(&execution(),"A","m1",1,MemoryMutation::Confirm,2).unwrap();
    assert_eq!(confirmed.validity,"valid");assert_eq!(confirmed.revision,2);
    assert_eq!(store.update_project_memory(&execution(),"A","m1",1,MemoryMutation::Retire,3).unwrap_err().kind,"conflict");
    let edited=store.update_project_memory(&execution(),"A","m1",2,MemoryMutation::Replace{content:content()},3).unwrap();
    assert_eq!(edited.validity,"pending");assert!(edited.confirmation.is_none());
    let retired=store.update_project_memory(&execution(),"A","m1",3,MemoryMutation::Retire,4).unwrap();
    assert_eq!(retired.validity,"retired");
    assert!(store.update_project_memory(&execution(),"A","m1",4,MemoryMutation::Confirm,5).is_err());
}
#[test]
fn project_memory_source_requirement_and_keyset_paging(){
    let store=synthetic_store();
    let mut missing=content();missing.source_refs.clear();
    store.create_project_memory(&execution(),"A","missing",missing).unwrap();
    assert_eq!(store.update_project_memory(&execution(),"A","missing",1,MemoryMutation::Confirm,2).unwrap_err().kind,"missingSource");
    store.create_project_memory(&execution(),"A","a",content()).unwrap();store.create_project_memory(&execution(),"A","b",content()).unwrap();
    let first=store.project_memories(&execution(),"A",None,1).unwrap();
    assert_eq!(first.memories[0].id,"a");assert_eq!(first.next_after_id.as_deref(),Some("a"));
    let second=store.project_memories(&execution(),"A",first.next_after_id.as_deref(),1).unwrap();
    assert_eq!(second.memories[0].id,"b");
    assert!(store.project_memories(&execution(),"A",None,51).is_err());
    let mut crossed=content();crossed.source_refs[0].project_id="B".into();
    assert!(store.create_project_memory(&execution(),"A","crossed",crossed).is_err());
}
#[test]
fn project_memory_synthetic_v2_migration_and_reopen_preserve_existing_records(){
    // Central supplies a disposable E:/G: fixture root. Retain it as evidence; no deletion.
    let base=std::env::var_os("UAGENT_MEMORY_TEST_ROOT").expect("central must set an E:/G: synthetic fixture root");
    let base=PathBuf::from(base);
    let text=base.to_string_lossy().to_ascii_uppercase();
    assert!(text.starts_with("E:\\")||text.starts_with("G:\\"));
    let unique=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root=base.join(format!("project-memory-v2-{}-{unique}",std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let db=Db::open(&root.join("runs.sqlite3")).unwrap();
    db.transaction(||{
        for sql in schema::V1 {db.execute(sql,&[])?;}
        // Representative existing v2 checkpoint row must survive migration byte-for-byte.
        db.execute("CREATE TABLE checkpoints (project_id TEXT NOT NULL, run_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), payload TEXT NOT NULL, PRIMARY KEY(project_id,run_id,revision))",&[])?;
        db.execute("INSERT INTO checkpoints VALUES('A','old-run',1,'synthetic-v2-checkpoint')",&[])?;
        db.execute("PRAGMA user_version=2",&[])?;
        Ok(())
    }).unwrap();
    drop(db);
    {
        let store=RunStore::open(&root).unwrap();
        assert_eq!(store.schema_version().unwrap(),3);projects(&store);
        assert_eq!(store.db.query("SELECT payload FROM checkpoints",&[]).unwrap()[0][0].text().unwrap(),"synthetic-v2-checkpoint");
        store.create_project_memory(&execution(),"A","persisted",content()).unwrap();
        store.update_project_memory(&execution(),"A","persisted",1,MemoryMutation::Confirm,2).unwrap();
    }
    let reopened=RunStore::open(&root).unwrap();
    let record=reopened.project_memory(&execution(),"A","persisted").unwrap();
    assert_eq!(record.validity,"valid");assert_eq!(record.revision,2);
    assert_eq!(record.body,"Synthetic fact 中文");
    assert!(reopened.project_memories(&execution(),"B",None,30).unwrap().memories.is_empty());
}

#[test]
fn project_memory_stale_cas_and_retirement_preserve_the_record() {
    let store=synthetic_store();
    store.create_project_memory(&execution(),"A","m1",content()).unwrap();
    store.update_project_memory(&execution(),"A","m1",1,MemoryMutation::Confirm,2).unwrap();
    let mut replacement=content();replacement.body="New synthetic user edit".into();
    let edited=store.update_project_memory(&execution(),"A","m1",2,MemoryMutation::Replace{content:replacement},3).unwrap();
    assert_eq!(store.update_project_memory(&execution(),"A","m1",2,MemoryMutation::MarkStale,4).unwrap_err().kind,"conflict");
    assert_eq!(store.project_memory(&execution(),"A","m1").unwrap(),edited);
    let stale=store.update_project_memory(&execution(),"A","m1",3,MemoryMutation::MarkStale,4).unwrap();
    assert_eq!(stale.body,edited.body);assert_eq!(stale.source_refs,edited.source_refs);
    let retired=store.update_project_memory(&execution(),"A","m1",4,MemoryMutation::Retire,5).unwrap();
    assert_eq!(retired.body,edited.body);assert_eq!(retired.source_refs,edited.source_refs);
    assert_eq!(retired.validity,"retired");
    let page=store.project_memories(&execution(),"A",None,30).unwrap();
    assert_eq!(page.memories.len(),1);assert_eq!(page.memories[0],retired);
}
#[test]
fn project_memory_page_interrupt_is_not_a_partial_success_and_connection_can_be_reused(){
    let store=synthetic_store();
    for index in 0..32{
        store.create_project_memory(&execution(),"A",&format!("m{index:02}"),content()).unwrap();
    }
    let cancelled=std::sync::atomic::AtomicBool::new(false);
    let tiny=MemoryExecution::for_test(&cancelled,std::time::Instant::now()+std::time::Duration::from_secs(2),100);
    assert_eq!(store.project_memories(&tiny,"A",None,30).unwrap_err().kind,"projectMemoryBudget");
    let page=store.project_memories(&execution(),"A",None,30).unwrap();
    assert_eq!(page.memories.len(),30);assert_eq!(page.next_after_id.as_deref(),Some("m29"));
    assert_eq!(store.project_memory(&execution(),"A","m00").unwrap().body,"Synthetic fact 中文");
}