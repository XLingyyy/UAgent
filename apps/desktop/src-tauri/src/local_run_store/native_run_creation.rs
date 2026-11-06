//! Native fresh-run creation provenance. Saved IDs/rows never construct this record.
use super::{database_owner,NewRun,Run,RunStatus,RunStore,Result,StoreError};
use std::{collections::HashMap,sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,Ordering}},time::Instant};

pub(crate) struct NativeDocumentIdentity {alive:AtomicBool,closed:Arc<AtomicBool>}
impl NativeDocumentIdentity {
    pub(crate) fn new(closed:Arc<AtomicBool>)->Arc<Self>{Arc::new(Self{alive:AtomicBool::new(true),closed})}
    pub(crate) fn revoke(&self){self.alive.store(false,Ordering::Release);}
    pub(crate) fn is_current(&self)->bool {
        self.alive.load(Ordering::Acquire)&&!self.closed.load(Ordering::Acquire)&&database_owner::available()
    }
}
struct NativeOwner {alive:Arc<AtomicBool>,deadline:Instant}
pub(crate) struct NativeRunCreation {
    document:Arc<NativeDocumentIdentity>,database:Arc<database_owner::NativeDatabasePin>,
    row:Mutex<Run>,project_id:String,run_id:String,provider:String,model:String,live:AtomicBool,owner:OnceLock<NativeOwner>,
}
pub(crate) enum NativeRunningClassification {Owned,Pending,Unknown}
fn unavailable()->StoreError{StoreError::new("nativeRunCreationRequired","the original native run creation and owner are required")}
type Key=(u64,[u8;16],String,String);
fn key(database:&database_owner::NativeDatabasePin,project:&str,run:&str)->Key {
    let (volume,file)=database.lookup_key();(volume,file,project.into(),run.into())
}
fn registry()->&'static Mutex<HashMap<Key,Arc<NativeRunCreation>>>{
    static REGISTRY:OnceLock<Mutex<HashMap<Key,Arc<NativeRunCreation>>>>=OnceLock::new();
    REGISTRY.get_or_init(||Mutex::new(HashMap::new()))
}
impl NativeRunCreation {
    pub(crate) fn run_id(&self)->&str {&self.run_id}
    pub(crate) fn invalidate(&self){
        self.live.store(false,Ordering::Release);
        if let Some(owner)=self.owner.get(){owner.alive.store(false,Ordering::Release);}
    }
    pub(crate) fn invalidate_for_owner(&self,alive:&Arc<AtomicBool>){
        if self.owner.get().is_some_and(|owner|Arc::ptr_eq(&owner.alive,alive)){self.invalidate();}
    }
    fn current(&self)->bool {self.live.load(Ordering::Acquire)&&self.document.is_current()}
    pub(crate) fn check_bound_liveness(&self)->Result<()> {
        let owner=self.owner.get().ok_or_else(unavailable)?;
        self.check_original_owner(&owner.alive)
    }
    pub(crate) fn bind_native_run(&self,document:&Arc<NativeDocumentIdentity>,alive:Arc<AtomicBool>,
        deadline:Instant,provider:&str,model:&str)->Result<()> {
        if !self.current()||!Arc::ptr_eq(document,&self.document)||self.provider!=provider||self.model!=model
            ||!alive.load(Ordering::Acquire)||Instant::now()>=deadline{return Err(unavailable());}
        self.owner.set(NativeOwner{alive,deadline}).map_err(|_|unavailable())
    }
    pub(crate) fn check_original_owner(&self,alive:&Arc<AtomicBool>)->Result<()> {
        let owner=self.owner.get().ok_or_else(unavailable)?;
        if !self.current()||!Arc::ptr_eq(alive,&owner.alive)||!owner.alive.load(Ordering::Acquire)
            ||Instant::now()>=owner.deadline{return Err(unavailable());}
        Ok(())
    }
    pub(crate) fn matches_original_row(&self,database:&database_owner::NativeDatabasePin,row:&Run)->Result<()> {
        if !self.current()||!self.database.same_original_database(database)
            ||row.status!=RunStatus::Running||*self.row.lock().map_err(|_|unavailable())?!=*row {
            return Err(unavailable());
        }
        Ok(())
    }
    fn classification(&self,database:&database_owner::NativeDatabasePin,row:&Run)->NativeRunningClassification {
        if self.matches_original_row(database,row).is_err(){return NativeRunningClassification::Unknown;}
        match self.owner.get() {
            None=>NativeRunningClassification::Pending,
            Some(owner) if owner.alive.load(Ordering::Acquire)&&Instant::now()<owner.deadline=>NativeRunningClassification::Owned,
            _=>NativeRunningClassification::Unknown,
        }
    }
    fn advance(&self,document:&Arc<NativeDocumentIdentity>,database:&database_owner::NativeDatabasePin,
        before:&Run,after:&Run,provider:&str,model:&str)->Result<()> {
        let mut expected=self.row.lock().map_err(|_|unavailable())?;
        // Revocation removes send authority before the coordinator persists its
        // stopping checkpoint. That same document may still record DATA ONLY.
        let stopping=matches!(after.status,RunStatus::Paused|RunStatus::Succeeded|RunStatus::Failed|RunStatus::Cancelled|RunStatus::NeedsReconciliation);
        if !self.document.is_current()||(!self.current()&&!stopping)
            ||!Arc::ptr_eq(&self.document,document)||!self.database.same_original_database(database)
            ||*expected!=*before||self.provider!=provider||self.model!=model
            ||after.project_id!=before.project_id||after.id!=before.id||after.session_id!=before.session_id
            ||after.goal!=before.goal||after.created_at!=before.created_at||before.revision.checked_add(1)!=Some(after.revision) {
            self.invalidate();return Err(unavailable());
        }
        *expected=after.clone();
        if matches!(after.status,RunStatus::Succeeded|RunStatus::Failed|RunStatus::Cancelled){self.invalidate();}
        Ok(())
    }
}
impl RunStore {
    /// Only a successful actual INSERT on this connection constructs an unpublished
    /// creation record. A constraint/existing row/checkpoint cannot take this path.
    pub(crate) fn start_run_for_native_document(&self,project:&str,run:&NewRun,
        document:Arc<NativeDocumentIdentity>,provider:&str,model:&str)->Result<Arc<NativeRunCreation>> {
        if !document.is_current(){return Err(unavailable());}
        self.start_run(project,run)?;
        let row=self.run(project,&run.id)?;
        if row.status!=RunStatus::Created||row.revision!=0{return Err(unavailable());}
        let database=self.db.pin_original_database()?;
        if !document.is_current(){return Err(unavailable());}
        Ok(Arc::new(NativeRunCreation{document,database,project_id:row.project_id.clone(),run_id:row.id.clone(),row:Mutex::new(row),provider:provider.into(),model:model.into(),
            live:AtomicBool::new(true),owner:OnceLock::new()}))
    }
    pub(crate) fn record_original_native_commit(&self,document:&Arc<NativeDocumentIdentity>,fresh:Option<Arc<NativeRunCreation>>,
        before:&Run,after:&Run,provider:&str,model:&str)->Result<()> {
        let database=self.db.pin_original_database()?;
        let key=key(&database,&after.project_id,&after.id);
        let previous=registry().lock().map_err(|_|unavailable())?.get(&key).cloned();
        if let Some(fresh)=fresh {
            if previous.is_some(){fresh.invalidate();return Err(unavailable());}
            fresh.advance(document,&database,before,after,provider,model)?;
            let mut all=registry().lock().map_err(|_|unavailable())?;
            // Terminal native rows need no exemption. Retiring their proof cannot
            // turn a later resurrected running row into an owned current run.
            all.retain(|_,proof|{
                let terminal=proof.row.lock().map(|row|matches!(row.status,RunStatus::Succeeded|RunStatus::Failed|RunStatus::Cancelled)).unwrap_or(false);
                if terminal {proof.invalidate();false}else{true}
            });
            if all.len()>=128||all.contains_key(&key){fresh.invalidate();return Err(unavailable());}
            if !matches!(after.status,RunStatus::Succeeded|RunStatus::Failed|RunStatus::Cancelled){all.insert(key,fresh);}
        }else if let Some(previous)=previous {
            previous.advance(document,&database,before,after,provider,model)?;
            if matches!(after.status,RunStatus::Succeeded|RunStatus::Failed|RunStatus::Cancelled){
                let mut all=registry().lock().map_err(|_|unavailable())?;
                if all.get(&key).is_some_and(|original|Arc::ptr_eq(original,&previous)){all.remove(&key);}
            }
        }
        // No fresh INSERT and no original native record: retain legacy status.
        Ok(())
    }
}
pub(crate) fn original_native_run_creation(project:&str,run:&str,document:&Arc<NativeDocumentIdentity>,
    database:&database_owner::NativeDatabasePin)->Result<Arc<NativeRunCreation>> {
    let value=registry().lock().map_err(|_|unavailable())?.get(&key(database,project,run)).cloned().ok_or_else(unavailable)?;
    if !value.current()||!Arc::ptr_eq(&value.document,document){return Err(unavailable());}
    Ok(value)
}
pub(crate) fn classify_running_native_row(database:&database_owner::NativeDatabasePin,row:&Run,
    current:Option<&Arc<NativeRunCreation>>)->NativeRunningClassification {
    let value=registry().lock().ok().and_then(|all|all.get(&key(database,&row.project_id,&row.id)).cloned());
    value.map_or(NativeRunningClassification::Unknown,|value|match value.classification(database,row){
        NativeRunningClassification::Owned if current.is_some_and(|original|Arc::ptr_eq(original,&value))=>NativeRunningClassification::Owned,
        // Other native live runs are transient blockers. Their out-of-SQL
        // revocation predicates are not retained/rechecked at THIS request's L.
        NativeRunningClassification::Owned=>NativeRunningClassification::Pending,
        classification=>classification,
    })
}
