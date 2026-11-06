//! Mandatory connection ownership for every copy of sqlite.rs in this process.
//! All cooperating UAgent processes in the Windows session use one reentrant gate.
//! SQLite still owns its physical transaction locks. This is NOT recovery/dispatch admission.
use std::{cell::RefCell, ffi::c_void, fs::{File,OpenOptions}, marker::PhantomData,
    os::windows::{fs::{MetadataExt,OpenOptionsExt},io::AsRawHandle}, path::{Component,Path,Prefix},
    ptr,rc::Rc,sync::{Arc,atomic::{AtomicBool,Ordering}},time::Instant};

static CLOSED:AtomicBool=AtomicBool::new(false);
static QUARANTINED:AtomicBool=AtomicBool::new(false);
#[derive(Clone)]
struct Operation{cancelled:Arc<AtomicBool>,deadline:Instant}
thread_local!{static OPERATION:RefCell<Option<Operation>>=const{RefCell::new(None)};}
/// Thread-local operation authority, native-only and never serializable.
pub(crate) struct OperationScope{_thread:PhantomData<Rc<()>>}
impl OperationScope{
    pub(crate) fn enter(cancelled:Arc<AtomicBool>,deadline:Instant)->Result<Self,&'static str>{
        OPERATION.with(|slot|{
            let mut active=slot.borrow_mut();
            if active.is_some(){return Err("nestedStoreOperation");}
            *active=Some(Operation{cancelled,deadline});Ok(Self{_thread:PhantomData})
        })
    }
}
impl Drop for OperationScope{fn drop(&mut self){OPERATION.with(|slot|{slot.replace(None);});}}
pub(crate) fn close(){CLOSED.store(true,Ordering::Release);}
pub(crate) fn quarantine(){QUARANTINED.store(true,Ordering::Release);}
pub(crate) fn available()->bool{!CLOSED.load(Ordering::Acquire)&&!QUARANTINED.load(Ordering::Acquire)}
fn check(operation:Option<&Operation>)->Result<(),&'static str>{
    if !available(){return Err("unavailable");}
    if operation.is_some_and(|value|value.cancelled.load(Ordering::Acquire)||Instant::now()>=value.deadline){return Err("cancelled");}
    Ok(())
}

#[link(name="kernel32")]
extern "system"{
    fn CreateMutexW(attributes:*const c_void,owned:i32,name:*const u16)->*mut c_void;
    fn WaitForSingleObject(handle:*mut c_void,milliseconds:u32)->u32;
    fn ReleaseMutex(handle:*mut c_void)->i32;
    fn CloseHandle(handle:*mut c_void)->i32;
    fn GetFileInformationByHandle(handle:*mut c_void,information:*mut Information)->i32;
    fn GetFileInformationByHandleEx(handle:*mut c_void,class:i32,information:*mut c_void,bytes:u32)->i32;
}
#[repr(C)]#[derive(Default)]struct FileTime{low:u32,high:u32}
#[repr(C)]#[derive(Default)]struct Information{
    attributes:u32,creation:FileTime,access:FileTime,write:FileTime,volume:u32,
    size_high:u32,size_low:u32,links:u32,index_high:u32,index_low:u32,
}
#[repr(C)]
#[derive(Default,PartialEq,Eq)]
struct DatabaseFileId { volume:u64, id:[u8;16] }
/// A retained original file handle, not a path/hash/data_version descriptor.
/// Constructed only from the SAME native ConnectionLease pin with no reopening.
pub(crate) struct NativeDatabasePin { _held:File, identity:DatabaseFileId }
impl NativeDatabasePin {
    pub(crate) fn same_original_database(&self,other:&Self)->bool { self.identity==other.identity }
    /// Lookup coordinates only; authority still requires both original held pins.
    pub(crate) fn lookup_key(&self)->(u64,[u8;16]) {(self.identity.volume,self.identity.id)}
}
struct Gate{handle:*mut c_void,_thread:PhantomData<Rc<()>>}
impl Gate{
    fn acquire(operation:Option<&Operation>)->Result<Self,&'static str>{
        check(operation)?;
        let name:Vec<u16>="Local\\UAgent.ManagedSQLite.v1".encode_utf16().chain(Some(0)).collect();
        let handle=unsafe{CreateMutexW(ptr::null(),0,name.as_ptr())};
        if handle.is_null(){return Err("unavailable");}
        let started=Instant::now();
        loop{
            if let Err(error)=check(operation){unsafe{CloseHandle(handle);};return Err(error);}
            match unsafe{WaitForSingleObject(handle,25)}{
                0=>{
                    let gate=Self{handle,_thread:PhantomData};
                    check(operation)?;
                    return Ok(gate);
                }
                0x80=>{
                    // Abandonment grants the mutex, but does not prove persistent consistency.
                    // Quarantine this process; do not silently reopen after an uncertain owner.
                    QUARANTINED.store(true,Ordering::Release);
                    unsafe{ReleaseMutex(handle);CloseHandle(handle);}
                    return Err("ownerRecoveryRequired");
                }
                0x102 if started.elapsed().as_secs()<5=>{}
                0x102=>{unsafe{CloseHandle(handle);};return Err("busy");}
                _=>{unsafe{CloseHandle(handle);};return Err("unavailable");}
            }
        }
    }
}
impl Drop for Gate{fn drop(&mut self){unsafe{
    if ReleaseMutex(self.handle)==0{QUARANTINED.store(true,Ordering::Release);}
    if CloseHandle(self.handle)==0{QUARANTINED.store(true,Ordering::Release);}
}}}

/// Kept until sqlite3_close_v2 has run on the original owning thread.
/// Rc marker prevents moving a Windows thread-owned mutex to another worker.
pub(crate) struct ConnectionLease{
    _pins:Vec<File>,operation:Option<Operation>,_thread:PhantomData<Rc<()>>,_gate:Gate,
}
impl ConnectionLease{
    pub(crate) fn acquire(path:&Path)->Result<Self,&'static str>{
        let operation=OPERATION.with(|slot|slot.borrow().clone());
        let gate=Gate::acquire(operation.as_ref())?;
        #[cfg(test)]
        if path==Path::new(":memory:"){
            return Ok(Self{_gate:gate,_pins:Vec::new(),operation,_thread:PhantomData});
        }
        if !path.is_absolute()||!matches!(path.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_)|Prefix::VerbatimDisk(_))){return Err("invalid");}
        let parent=path.parent().ok_or("invalid")?;
        let mut pins=Vec::new();
        // Open every ancestor itself, deny DELETE sharing, and reject reparse objects.
        // Once a child is checked, already-held ancestor pins prevent path replacement.
        let mut ancestors:Vec<_>=parent.ancestors().collect();ancestors.reverse();
        for ancestor in ancestors{
            if ancestor.as_os_str().is_empty(){continue;}
            let pin=OpenOptions::new().access_mode(0x80).share_mode(3)
                .custom_flags(0x0220_0000).open(ancestor).map_err(|_|"unavailable")?;
            let meta=pin.metadata().map_err(|_|"unavailable")?;
            if !meta.is_dir()||meta.file_attributes()&0x400!=0{return Err("invalid");}
            pins.push(pin);
        }
        // Creating an absent DB never truncates an existing object. SQLite opens this
        // same pinned, non-reparse name afterwards. Journal files remain SQLite-owned.
        let pin=OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .share_mode(3).custom_flags(0x0020_0000).open(path).map_err(|_|"unavailable")?;
        let meta=pin.metadata().map_err(|_|"unavailable")?;
        let mut info=Information::default();
        if !meta.is_file()||meta.file_attributes()&0x400!=0
            ||unsafe{GetFileInformationByHandle(pin.as_raw_handle(),&mut info)}==0
            ||info.links!=1{return Err("invalid");}
        pins.push(pin);
        check(operation.as_ref())?;
        Ok(Self{_gate:gate,_pins:pins,operation,_thread:PhantomData})
    }
    pub(crate) fn pin_original_database(&self)->Result<Arc<NativeDatabasePin>,&'static str>{
        self.check()?;
        let original=self._pins.last().ok_or("physicalStoreRequired")?;
        let held=original.try_clone().map_err(|_|"unavailable")?;
        let mut identity=DatabaseFileId::default();
        // Same existing FileIdInfo ABI used by trusted_root_handle/windows.rs.
        if unsafe{GetFileInformationByHandleEx(held.as_raw_handle(),18,
            (&mut identity as *mut DatabaseFileId).cast(),std::mem::size_of::<DatabaseFileId>() as u32)}==0 {
            return Err("unavailable");
        }
        self.check()?;
        Ok(Arc::new(NativeDatabasePin{_held:held,identity}))
    }
    pub(crate) fn check(&self)->Result<(),&'static str>{check(self.operation.as_ref())}
    pub(crate) fn quarantine(&self){QUARANTINED.store(true,Ordering::Release);}
}

/// Lifetime pins for the native-selected app-data store, shared with the worker.
/// Creating the directory never opens or inspects provider secrets or archived bodies.
pub(crate) struct RootPins{pub(crate) root:std::path::PathBuf,_pins:Vec<File>}
impl RootPins{
    pub(crate) fn acquire(root:&Path)->Result<Self,&'static str>{
        if !available()||!root.is_absolute()
            ||!matches!(root.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_)|Prefix::VerbatimDisk(_))){return Err("invalid");}
        let _gate=Gate::acquire(None)?;
        // Validate existing ancestors before creation, then pin the complete final chain.
        for path in root.ancestors(){
            if let Ok(meta)=std::fs::symlink_metadata(path){
                if !meta.is_dir()||meta.file_attributes()&0x400!=0{return Err("invalid");}
            }
        }
        std::fs::create_dir_all(root).map_err(|_|"unavailable")?;
        let mut ancestors:Vec<_>=root.ancestors().collect();ancestors.reverse();
        let mut pins=Vec::new();
        for path in ancestors{
            if path.as_os_str().is_empty(){continue;}
            let file=OpenOptions::new().access_mode(0x80).share_mode(3)
                .custom_flags(0x0220_0000).open(path).map_err(|_|"unavailable")?;
            let meta=file.metadata().map_err(|_|"unavailable")?;
            if !meta.is_dir()||meta.file_attributes()&0x400!=0{return Err("invalid");}
            pins.push(file);
        }
        let root=std::fs::canonicalize(root).map_err(|_|"unavailable")?;
        // Retain the original DB object even while the worker is idle. Directory
        // pins alone would still permit swapping runs.sqlite3 between operations.
        let database=OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .share_mode(3).custom_flags(0x0020_0000).open(root.join("runs.sqlite3")).map_err(|_|"unavailable")?;
        let meta=database.metadata().map_err(|_|"unavailable")?;
        let mut info=Information::default();
        if !meta.is_file()||meta.file_attributes()&0x400!=0
            ||unsafe{GetFileInformationByHandle(database.as_raw_handle(),&mut info)}==0
            ||info.links!=1{return Err("invalid");}
        pins.push(database);
        Ok(Self{root,_pins:pins})
    }
}


#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn same_thread_nested_gate_keeps_other_workers_out_until_every_owner_drops(){
        let outer=Gate::acquire(None).expect("outer gate");
        let inner=Gate::acquire(None).expect("same-thread reentrant gate");
        drop(inner);
        let cancelled=Arc::new(AtomicBool::new(false));let other=cancelled.clone();
        let (started,ready)=std::sync::mpsc::sync_channel(1);
        let worker=std::thread::spawn(move||{
            let operation=Operation{cancelled:other,deadline:Instant::now()+std::time::Duration::from_secs(2)};
            started.send(()).unwrap();
            match Gate::acquire(Some(&operation)){Ok(_)=>"incorrectlyAcquired",Err(error)=>error}
        });
        ready.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        cancelled.store(true,Ordering::Release);
        assert_eq!(worker.join().unwrap(),"cancelled");
        drop(outer);
        assert!(Gate::acquire(None).is_ok());
    }
    #[test]
    fn expired_operation_is_rejected_before_a_database_file_can_be_opened(){
        let cancelled=Arc::new(AtomicBool::new(false));
        let _scope=OperationScope::enter(cancelled,Instant::now()).unwrap();
        assert!(matches!(ConnectionLease::acquire(Path::new(":memory:")),Err("cancelled")));
        assert!(matches!(OperationScope::enter(Arc::new(AtomicBool::new(false)),Instant::now()+std::time::Duration::from_secs(1)),Err("nestedStoreOperation")));
    }
    #[test]
    fn revoked_operation_cannot_commit_but_can_roll_back_on_its_original_connection(){
        let cancelled=Arc::new(AtomicBool::new(false));
        let _scope=OperationScope::enter(cancelled.clone(),Instant::now()+std::time::Duration::from_secs(2)).unwrap();
        let db=super::super::sqlite::Db::open(Path::new(":memory:")).unwrap();
        db.execute("CREATE TABLE cancellation_probe(id INTEGER)",&[]).unwrap();
        db.execute("BEGIN IMMEDIATE",&[]).unwrap();
        db.execute("INSERT INTO cancellation_probe VALUES(1)",&[]).unwrap();
        cancelled.store(true,Ordering::Release);
        assert_eq!(db.execute("COMMIT",&[]).unwrap_err().kind,"cancelled");
        db.execute("ROLLBACK",&[]).unwrap();
        // Only synthetic verification clears the flag; production grants are one-way.
        cancelled.store(false,Ordering::Release);
        assert_eq!(db.query("SELECT count(*) FROM cancellation_probe",&[]).unwrap()[0][0].int().unwrap(),0);
    }
}
