//! OS process observation for newly persisted synchronous native source repairs.
//! A stopped observation is NOT a recovery admission or a write grant.
use serde::{Deserialize,Serialize};
use std::ffi::c_void;
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ExecutionIdentity {
 pub schema_version:u32, pub pid:u32, pub created_at_100ns:u64,
 pub database_volume:u64,pub database_file_id:[u8;16],
 pub project_id:String,pub run_id:String,pub operation_id:String,pub intent_digest:String,
}
#[derive(Debug,PartialEq,Eq)]
pub(crate) enum ProcessObservation { Running, Ended }
#[repr(C)]#[derive(Default)]struct FileTime {low:u32,high:u32}
#[link(name="kernel32")]extern "system" {
 fn GetCurrentProcess()->*mut c_void;
 fn GetProcessTimes(h:*mut c_void,creation:*mut FileTime,exit:*mut FileTime,kernel:*mut FileTime,user:*mut FileTime)->i32;
 fn OpenProcess(access:u32,inherit:i32,pid:u32)->*mut c_void;
 fn WaitForSingleObject(h:*mut c_void,ms:u32)->u32;
 fn GetLastError()->u32;
 fn CloseHandle(h:*mut c_void)->i32;
}
fn creation(h:*mut c_void)->Result<u64,&'static str>{
 let(mut c,mut e,mut k,mut u)=(FileTime::default(),FileTime::default(),FileTime::default(),FileTime::default());
 if unsafe{GetProcessTimes(h,&mut c,&mut e,&mut k,&mut u)}==0{return Err("repair_process_identity_unavailable");}
 let t=((c.high as u64)<<32)|c.low as u64;if t==0{return Err("repair_process_identity_invalid");}Ok(t)
}
impl ExecutionIdentity {
 pub(crate) fn capture(database:(u64,[u8;16]),project:&str,run:&str,operation:&str,digest:&str)->Result<Self,&'static str>{
  Ok(Self{schema_version:1,pid:std::process::id(),created_at_100ns:creation(unsafe{GetCurrentProcess()})?,database_volume:database.0,database_file_id:database.1,project_id:project.into(),run_id:run.into(),operation_id:operation.into(),intent_digest:digest.into()})
 }
 pub(crate) fn observe(&self,database:(u64,[u8;16]),project:&str,run:&str,operation:&str,digest:&str)->Result<ProcessObservation,&'static str>{
  if self.schema_version!=1||self.pid==0||self.created_at_100ns==0||(self.database_volume,self.database_file_id)!=database||self.project_id!=project||self.run_id!=run||self.operation_id!=operation||self.intent_digest!=digest||digest.len()!=64||!digest.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()) {return Err("repair_execution_binding_changed");}
  let h=unsafe{OpenProcess(0x1000|0x00100000,0,self.pid)};
  if h.is_null(){return if unsafe{GetLastError()}==87{Ok(ProcessObservation::Ended)}else{Err("repair_process_observation_unavailable")};}
  // Retain the exact process handle while comparing creation time and exit state.
  let observed=(||{let time=creation(h)?;if time!=self.created_at_100ns{return Ok(ProcessObservation::Ended);}
   match unsafe{WaitForSingleObject(h,0)}{0=>Ok(ProcessObservation::Ended),258=>Ok(ProcessObservation::Running),_=>Err("repair_process_observation_unavailable")}})();
  unsafe{CloseHandle(h);};observed
 }
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn current_process_is_running_and_bindings_fail_closed(){
  let db=(17,[3;16]);let digest="a".repeat(64);let value=ExecutionIdentity::capture(db,"p","r","o",&digest).unwrap();
  assert_eq!(value.observe(db,"p","r","o",&digest).unwrap(),ProcessObservation::Running);
  assert!(value.observe((18,[3;16]),"p","r","o",&digest).is_err());assert!(value.observe(db,"p","r","other",&digest).is_err());
  assert!(serde_json::from_str::<ExecutionIdentity>("{}").is_err());
 }
 #[test]fn ended_synthetic_process_is_observed_using_its_real_creation_time(){
  use std::os::windows::{process::CommandExt,io::AsRawHandle};
  let mut child=std::process::Command::new(std::env::var("COMSPEC").unwrap()).args(["/d","/c","exit","0"]).creation_flags(0x08000000).spawn().unwrap();
  let db=(17,[3;16]);let digest="a".repeat(64);let mut value=ExecutionIdentity::capture(db,"p","r","o",&digest).unwrap();
  value.pid=child.id();value.created_at_100ns=creation(child.as_raw_handle()).unwrap();
  child.wait().unwrap();assert_eq!(value.observe(db,"p","r","o",&digest).unwrap(),ProcessObservation::Ended);
 }
}
