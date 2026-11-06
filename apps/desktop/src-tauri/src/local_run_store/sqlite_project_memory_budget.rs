//! Include only as a child of sqlite.rs; no raw connection escapes the owning worker.
//! Central must make every other scoped progress/busy installer claim the same
//! ScopedSqlBudgetLease below; otherwise cross-feature handler ownership is unproven.
use super::{c_int,c_void,ptr,sqlite3_busy_timeout,sqlite3_extended_errcode,Db,Result,StoreError};
use super::super::project_memory::MemoryExecution;
use std::{cell::{Cell,RefCell},collections::HashSet,marker::PhantomData,rc::Rc,time::Duration};

const INTERVAL:c_int=100;
const SQLITE_LIMIT_LENGTH:c_int=0;
const VALUE_LIMIT:c_int=64*1024;
const MAX_BUSY_RETRIES:u32=25;
#[link(name="winsqlite3",kind="raw-dylib")]
extern "C"{
    fn sqlite3_progress_handler(db:*mut c_void,interval:c_int,callback:Option<unsafe extern "C" fn(*mut c_void)->c_int>,context:*mut c_void);
    fn sqlite3_busy_handler(db:*mut c_void,callback:Option<unsafe extern "C" fn(*mut c_void,c_int)->c_int>,context:*mut c_void)->c_int;
    fn sqlite3_limit(db:*mut c_void,category:c_int,value:c_int)->c_int;
    fn sqlite3_get_autocommit(db:*mut c_void)->c_int;
}
thread_local! {
    static ACTIVE: RefCell<HashSet<usize>> = RefCell::new(HashSet::new());
    static IMMEDIATE: RefCell<HashSet<usize>> = RefCell::new(HashSet::new());
}
/// Established only after this budget's actual BEGIN IMMEDIATE has succeeded.
/// Removed before COMMIT/ROLLBACK; an idle/cached scan can never satisfy it.
struct ImmediateMemoryTransaction(usize);
impl Drop for ImmediateMemoryTransaction {
    fn drop(&mut self) { IMMEDIATE.with(|active| { active.borrow_mut().remove(&self.0); }); }
}
/// Common connection-local lease; !Send prevents a TLS lease from changing workers.
pub(super) struct ScopedSqlBudgetLease{key:usize,_not_send:PhantomData<Rc<()>>}
impl Drop for ScopedSqlBudgetLease{
    fn drop(&mut self){ACTIVE.with(|active|{active.borrow_mut().remove(&self.key);});}
}
impl Db{
    /// Native reader only. No new budget/transaction may be installed by it.
    pub(in crate::local_run_store) fn require_project_memory_write_transaction(&self) -> Result<()> {
        let key = self.0 as usize;
        let active = ACTIVE.with(|set| set.borrow().contains(&key))
            && IMMEDIATE.with(|set| set.borrow().contains(&key));
        if !active || unsafe { sqlite3_get_autocommit(self.0) } != 0 {
            return Err(StoreError::new("memoryRecoveryTransactionRequired",
                "recovery admission requires the original live memory write transaction"));
        }
        self.check_owner()
    }
    pub(super) fn claim_scoped_sql_budget(&self)->Result<ScopedSqlBudgetLease>{
        let key=self.0 as usize;
        let inserted=ACTIVE.with(|active|active.borrow_mut().insert(key));
        if !inserted{return Err(StoreError::new("busy","this SQLite connection already has a scoped execution budget"));}
        Ok(ScopedSqlBudgetLease{key,_not_send:PhantomData})
    }
}
struct State<'a>{execution:MemoryExecution<'a>,remaining:Cell<u64>,busy_retries:Cell<u32>,stopped:Cell<Option<&'static str>>}
impl State<'_>{
    // Callbacks use only this nonallocating path; errors are built after SQLite returns.
    fn stop_reason(&self)->Option<&'static str>{
        let reason=self.stopped.get().or_else(||self.execution.stop_reason()).or_else(||if self.remaining.get()==0{Some("projectMemoryBudget")}else{None});
        if let Some(kind)=reason{self.stopped.set(Some(kind));}
        reason
    }
    fn check(&self)->Result<()>{
        if let Some(kind)=self.stop_reason(){Err(StoreError::new(kind,"project memory SQL execution was interrupted"))}else{Ok(())}
    }
}
unsafe extern "C" fn progress(context:*mut c_void)->c_int{
    let state=&*(context as *const State<'_>);
    if state.stop_reason().is_some(){return 1;}
    let next=state.remaining.get().saturating_sub(INTERVAL as u64);state.remaining.set(next);
    if next==0{state.stopped.set(Some("projectMemoryBudget"));1}else{0}
}
unsafe extern "C" fn busy(context:*mut c_void,_prior:c_int)->c_int{
    let state=&*(context as *const State<'_>);
    if state.stop_reason().is_some(){return 0;}
    let remaining=state.busy_retries.get();
    if remaining==0{state.stopped.set(Some("projectMemoryBusy"));return 0;}
    state.busy_retries.set(remaining-1);
    // At most 25 one-millisecond waits for the entire operation, with the real
    // worker cancellation/deadline checked both before and after each wait.
    std::thread::sleep(Duration::from_millis(1));
    if state.stop_reason().is_some(){0}else{1}
}
struct Guard<'db,'cancel>{
    db:&'db Db,state:Box<State<'cancel>>,previous_busy:c_int,previous_length:c_int,
    attached:Cell<bool>,_lease:ScopedSqlBudgetLease,
}
impl<'db,'cancel> Guard<'db,'cancel>{
    fn install(db:&'db Db,execution:&MemoryExecution<'cancel>)->Result<Self>{
        execution.check()?;
        let lease=db.claim_scoped_sql_budget()?;
        if unsafe{sqlite3_get_autocommit(db.0)}==0{return Err(StoreError::new("busy","project memory cannot nest inside an existing transaction"));}
        let busy=db.query("PRAGMA busy_timeout",&[])?;
        let previous_busy=c_int::try_from(busy[0][0].int()?).map_err(|_|StoreError::corrupt())?;
        let previous_length=unsafe{sqlite3_limit(db.0,SQLITE_LIMIT_LENGTH,-1)};
        if previous_busy<0||previous_length<1{return Err(StoreError::corrupt());}
        let state=Box::new(State{execution:*execution,remaining:Cell::new(execution.max_vm_instructions),busy_retries:Cell::new(MAX_BUSY_RETRIES.min(previous_busy as u32)),stopped:Cell::new(None)});
        state.check()?;
        let guard=Self{db,state,previous_busy,previous_length,attached:Cell::new(false),_lease:lease};
        unsafe{sqlite3_limit(db.0,SQLITE_LIMIT_LENGTH,previous_length.min(VALUE_LIMIT));}
        let context=(&*guard.state as *const State<'_>).cast_mut().cast();
        db.check(unsafe{sqlite3_busy_handler(db.0,Some(self::busy),context)})?;
        unsafe{sqlite3_progress_handler(db.0,INTERVAL,Some(progress),context);}
        guard.attached.set(true);
        guard.state.check()?;
        Ok(guard)
    }
    fn detach_for_transaction_end(&self){
        if self.attached.replace(false){
            unsafe{
                sqlite3_progress_handler(self.db.0,0,None,ptr::null_mut());
                // Cancellation/VM callbacks must not interrupt COMMIT/ROLLBACK.
                // Cleanup must not inherit an unbounded lock wait.
                sqlite3_busy_timeout(self.db.0,0);
            }
        }
    }
    fn result<T>(&self,result:Result<T>)->Result<T>{
        self.state.check()?;
        result.map_err(|error|{
            if unsafe{sqlite3_extended_errcode(self.db.0)}&255==18{StoreError::new("projectMemoryCapacity","project memory SQL value exceeds its byte budget")}else{error}
        })
    }
}
impl Drop for Guard<'_,'_>{
    fn drop(&mut self){
        self.detach_for_transaction_end();
        unsafe{
            sqlite3_limit(self.db.0,SQLITE_LIMIT_LENGTH,self.previous_length);
            sqlite3_busy_timeout(self.db.0,self.previous_busy);
        }
        // The common connection lease drops only after handlers/settings restore.
    }
}
struct BeforeTransactionEnd<'a,'db,'cancel>(&'a Guard<'db,'cancel>);
impl Drop for BeforeTransactionEnd<'_,'_,'_>{fn drop(&mut self){self.0.detach_for_transaction_end();}}
impl Db{
    pub(crate) fn with_project_memory_budget<T>(&self,execution:&MemoryExecution<'_>,write:bool,work:impl FnOnce()->Result<T>)->Result<T>{
        let guard=Guard::install(self,execution)?;
        // Keep this outer guard alive while the transaction's own Rollback::Drop
        // finishes. A panic must not skip the same confirmation used for errors.
        let outcome=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
            if write{
                self.transaction(||{
                    let _finish=BeforeTransactionEnd(&guard);
                    let key = self.0 as usize;
                    if !IMMEDIATE.with(|set| set.borrow_mut().insert(key)) {
                        return Err(StoreError::new("busy", "memory write transaction already registered"));
                    }
                    let _physical_transaction = ImmediateMemoryTransaction(key);
                    guard.state.check()?;
                    guard.result(work())
                })
            }else{guard.result(work())}
        }));
        guard.detach_for_transaction_end();
        // The inner rollback has already completed (or failed) before this point.
        // Cleanup runs on the original worker, without cancellation callbacks.
        let rollback_check=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
            if unsafe{sqlite3_get_autocommit(self.0)}!=0{return true;}
            let rollback=self.execute("ROLLBACK",&[]);
            rollback.is_ok()&&unsafe{sqlite3_get_autocommit(self.0)}!=0
        }));
        // Retain a cleanup panic payload until after the poison marker is set.
        let confirmed=match &rollback_check{Ok(value)=>*value,Err(_)=>false};
        if !confirmed{
            // Poison BEFORE releasing the scoped budget/connection gate and
            // BEFORE dropping a possibly panicking original panic payload.
            // The real ConnectionLease's one-way marker denies every later ordinary
            // operation even if an outer catch maps this error to unavailable.
            self.1.quarantine();
            return Err(StoreError::new("projectMemoryRollback","rollback was not confirmed; the native connection owner has been quarantined"));
        }
        match outcome{
            Ok(result)=>if result.is_err(){guard.result(result)}else{
                // COMMIT/ROLLBACK ran with cancellation callbacks detached. A
                // success must still observe cancellation/deadline AFTER native
                // autocommit was confirmed; it cannot export a stale permit.
                #[cfg(test)]
                AFTER_CONFIRMED_CLEANUP.with(|slot| {
                    let hook=slot.borrow_mut().take();
                    if let Some(hook)=hook { hook(); }
                });
                execution.check()?;
                result
            },
            // Preserve the original panic only after native autocommit is confirmed.
            Err(payload)=>std::panic::resume_unwind(payload),
        }
    }
}
#[cfg(test)]
#[path="sqlite_project_memory_budget_tests.rs"]
mod tests;


// A single deterministic fault point after real transaction cleanup, not a
// production callback or permission source.
#[cfg(test)]
thread_local! {
    static AFTER_CONFIRMED_CLEANUP: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
}
