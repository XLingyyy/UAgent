use super::*;
use std::{path::Path,sync::atomic::{AtomicBool,Ordering},time::Instant};
#[link(name="winsqlite3",kind="raw-dylib")]
extern "C"{fn sqlite3_next_stmt(db:*mut c_void,current:*mut c_void)->*mut c_void;}
const SCAN:&str="WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) SELECT sum(x) FROM n";
fn fixture()->Db{
    let db=Db::open(Path::new(":memory:")).unwrap();
    db.execute("CREATE TABLE sample(id INTEGER PRIMARY KEY,body TEXT)",&[]).unwrap();
    db.execute("INSERT INTO sample VALUES(1,'before')",&[]).unwrap();db
}
fn assert_restored(db:&Db,length:c_int){
    assert!(unsafe{sqlite3_next_stmt(db.0,ptr::null_mut())}.is_null());
    assert_eq!(unsafe{sqlite3_get_autocommit(db.0)},1);
    assert_eq!(db.query("PRAGMA busy_timeout",&[]).unwrap()[0][0].int().unwrap(),5000);
    assert_eq!(unsafe{sqlite3_limit(db.0,SQLITE_LIMIT_LENGTH,-1)},length);
    assert_eq!(db.query(SCAN,&[]).unwrap()[0][0].int().unwrap(),500500);
    assert_eq!(db.query("SELECT body FROM sample",&[]).unwrap()[0][0].text().unwrap(),"before");
}
#[test]
fn vm_interrupt_rolls_back_partial_write_and_restores_statement_handlers_and_limits(){
    let db=fixture();let cancelled=AtomicBool::new(false);
    let length=unsafe{sqlite3_limit(db.0,SQLITE_LIMIT_LENGTH,-1)};
    let execution=MemoryExecution::for_test(&cancelled,Instant::now()+Duration::from_secs(2),300);
    let error=db.with_project_memory_budget(&execution,true,||{
        db.execute("UPDATE sample SET body='after' WHERE id=1",&[])?;
        db.query(SCAN,&[])
    }).unwrap_err();
    assert_eq!(error.kind,"projectMemoryBudget");assert_restored(&db,length);
}
#[test]
fn active_cancellation_rolls_back_and_leaves_connection_reusable(){
    let db=fixture();let cancelled=AtomicBool::new(false);
    let length=unsafe{sqlite3_limit(db.0,SQLITE_LIMIT_LENGTH,-1)};
    let execution=MemoryExecution::for_test(&cancelled,Instant::now()+Duration::from_secs(2),250000);
    let error=db.with_project_memory_budget(&execution,true,||{
        db.execute("UPDATE sample SET body='after' WHERE id=1",&[])?;
        cancelled.store(true,Ordering::Release);
        db.query(SCAN,&[])
    }).unwrap_err();
    assert_eq!(error.kind,"projectMemoryCancelled");assert_restored(&db,length);
}
#[test]
fn expired_deadline_does_not_enter_work_or_leave_a_handler(){
    let db=fixture();let cancelled=AtomicBool::new(false);let entered=Cell::new(false);
    let length=unsafe{sqlite3_limit(db.0,SQLITE_LIMIT_LENGTH,-1)};
    let execution=MemoryExecution::for_test(&cancelled,Instant::now(),250000);
    let error=db.with_project_memory_budget(&execution,false,||{entered.set(true);db.query(SCAN,&[])}).unwrap_err();
    assert_eq!(error.kind,"projectMemoryDeadline");assert!(!entered.get());assert_restored(&db,length);
}
#[test]
fn panic_after_write_detaches_before_rollback_and_restores_connection(){
    let db=fixture();let cancelled=AtomicBool::new(false);
    let length=unsafe{sqlite3_limit(db.0,SQLITE_LIMIT_LENGTH,-1)};
    let execution=MemoryExecution::for_test(&cancelled,Instant::now()+Duration::from_secs(2),250000);
    let panic=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let _:Result<()>=db.with_project_memory_budget(&execution,true,||{
            db.execute("UPDATE sample SET body='after' WHERE id=1",&[])?;
            panic!("synthetic memory callback");
        });
    }));
    assert!(panic.is_err());assert_restored(&db,length);
}
#[test]
fn same_connection_nested_budgets_are_rejected_without_overwriting_outer_handler(){
    let db=fixture();let cancelled=AtomicBool::new(false);
    let execution=MemoryExecution::for_test(&cancelled,Instant::now()+Duration::from_secs(2),250000);
    let result=db.with_project_memory_budget(&execution,false,||{
        assert_eq!(db.with_project_memory_budget(&execution,false,||Ok(())).unwrap_err().kind,"busy");
        db.query(SCAN,&[])
    }).unwrap();
    assert_eq!(result[0][0].int().unwrap(),500500);
}
#[test]
fn other_feature_budget_must_share_the_same_connection_lease(){
    // This intentionally requires the supplied central installer-lease patch.
    let db=fixture();let cancelled=AtomicBool::new(false);
    let execution=MemoryExecution::for_test(&cancelled,Instant::now()+Duration::from_secs(2),250000);
    db.with_project_memory_budget(&execution,false,||{
        let other=crate::local_run_store::session_catalog::control::CatalogControl::for_test(250000,Duration::from_secs(2));
        assert_eq!(db.with_session_catalog_budget(&other,false,||Ok(())).unwrap_err().kind,"busy");
        assert_eq!(db.with_runtime_host_scan_budget(&cancelled,Duration::from_secs(2),||Ok(())).unwrap_err().kind,"busy");
        Ok(())
    }).unwrap();
}
#[test]
fn busy_callback_observes_the_actual_worker_cancel_flag_and_deadline(){
    let cancelled=AtomicBool::new(true);
    let execution=MemoryExecution::for_test(&cancelled,Instant::now()+Duration::from_secs(2),250000);
    let state=State{execution,remaining:Cell::new(250000),busy_retries:Cell::new(MAX_BUSY_RETRIES),stopped:Cell::new(None)};
    assert_eq!(unsafe{busy((&state as *const State<'_>).cast_mut().cast(),0)},0);
    assert_eq!(state.busy_retries.get(),MAX_BUSY_RETRIES);
    cancelled.store(false,Ordering::Release);
    let expired=State{execution:MemoryExecution::for_test(&cancelled,Instant::now(),250000),remaining:Cell::new(250000),busy_retries:Cell::new(MAX_BUSY_RETRIES),stopped:Cell::new(None)};
    assert_eq!(unsafe{busy((&expired as *const State<'_>).cast_mut().cast(),0)},0);
}

#[link(name="winsqlite3",kind="raw-dylib")]
extern "C"{
    fn sqlite3_set_authorizer(
        db:*mut c_void,
        callback:Option<unsafe extern "C" fn(*mut c_void,c_int,*const std::ffi::c_char,*const std::ffi::c_char,*const std::ffi::c_char,*const std::ffi::c_char)->c_int>,
        context:*mut c_void,
    )->c_int;
}
struct RollbackFaultState{remaining_denials:Cell<u32>,attempts:Cell<u32>,denied:Cell<u32>}
unsafe extern "C" fn reject_initial_rollback(
    context:*mut c_void,action:c_int,first:*const std::ffi::c_char,
    _second:*const std::ffi::c_char,_database:*const std::ffi::c_char,_trigger:*const std::ffi::c_char,
)->c_int{
    // SQLite's authorizer action SQLITE_TRANSACTION=22; SQLITE_DENY=1.
    if action!=22||first.is_null()||std::ffi::CStr::from_ptr(first).to_bytes()!=b"ROLLBACK"{return 0;}
    let state=&*(context as *const RollbackFaultState);
    state.attempts.set(state.attempts.get().saturating_add(1));
    let remaining=state.remaining_denials.get();
    if remaining==0{return 0;}
    state.remaining_denials.set(remaining-1);state.denied.set(state.denied.get().saturating_add(1));1
}
struct InitialRollbackFault<'a>{db:&'a Db,state:Box<RollbackFaultState>}
impl<'a> InitialRollbackFault<'a>{
    fn install(db:&'a Db)->Self{
        let fault=Self{db,state:Box::new(RollbackFaultState{remaining_denials:Cell::new(1),attempts:Cell::new(0),denied:Cell::new(0)})};
        assert_eq!(unsafe{sqlite3_set_authorizer(db.0,Some(reject_initial_rollback),(&*fault.state as *const RollbackFaultState).cast_mut().cast())},0);
        fault
    }
}
impl Drop for InitialRollbackFault<'_>{
    fn drop(&mut self){assert_eq!(unsafe{sqlite3_set_authorizer(self.db.0,None,ptr::null_mut())},0);}
}
#[test]
fn panic_with_initial_rollback_failure_retries_and_confirms_before_connection_reuse(){
    let db=fixture();let cancelled=AtomicBool::new(false);
    let length=unsafe{sqlite3_limit(db.0,SQLITE_LIMIT_LENGTH,-1)};
    let fault=InitialRollbackFault::install(&db);
    let execution=MemoryExecution::for_test(&cancelled,Instant::now()+Duration::from_secs(2),250000);
    let panic=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let _:Result<()>=db.with_project_memory_budget(&execution,true,||{
            db.execute("UPDATE sample SET body='after' WHERE id=1",&[])?;
            panic!("synthetic panic with rejected first rollback");
        });
    }));
    assert!(panic.is_err());
    assert_eq!(fault.state.denied.get(),1);
    assert_eq!(fault.state.attempts.get(),2);
    // Both statement ownership and transaction state must be safe before reuse.
    assert_restored(&db,length);
    db.with_project_memory_budget(&execution,false,||{
        assert_eq!(db.query("SELECT body FROM sample",&[])?[0][0].text()?,"before");
        Ok(())
    }).unwrap();
}

#[test]
fn cancellation_after_real_commit_and_cleanup_cannot_return_a_successful_value() {
    let db=fixture();
    let cancelled=std::sync::Arc::new(AtomicBool::new(false));
    let late=cancelled.clone();
    AFTER_CONFIRMED_CLEANUP.with(|slot| {
        assert!(slot.borrow_mut().replace(Box::new(move || {
            late.store(true,Ordering::Release);
        })).is_none());
    });
    let execution=MemoryExecution::for_test(&cancelled,Instant::now()+Duration::from_secs(2),250000);
    let error=db.with_project_memory_budget(&execution,true,||{
        db.execute("UPDATE sample SET body='committed' WHERE id=1",&[])?;
        Ok(123)
    }).unwrap_err();
    assert_eq!(error.kind,"projectMemoryCancelled");
    assert_eq!(unsafe{sqlite3_get_autocommit(db.0)},1);
    // The mutation genuinely committed before the deterministic cancellation;
    // the late error must not be mislabeled as a rollback or successful permit.
    assert_eq!(db.query("SELECT body FROM sample",&[]).unwrap()[0][0].text().unwrap(),"committed");
    assert!(unsafe{sqlite3_next_stmt(db.0,ptr::null_mut())}.is_null());
}
