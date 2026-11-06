//! Data-only command handlers. Use only the original managed worker/fence.
//! The actual worker's borrowed cancellation flag and deadline are mandatory.
//! No independent opener, UI-owner proof or transport batch seal is supplied here.
#![cfg(windows)]
use crate::local_run_store::{project_memory::{MemoryContent,MemoryExecution,MemoryMutation,MemoryPage,ProjectMemory},RunStore,StoreError};
use serde::Deserialize;
use std::{sync::atomic::AtomicBool,time::Instant};
const MAX_SAFE:i64=9_007_199_254_740_991;
#[derive(Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct MemoryListInput{pub schema_version:u32,pub project_id:String,pub after_id:Option<String>,pub limit:usize}
#[derive(Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct MemoryGetInput{pub schema_version:u32,pub project_id:String,pub id:String}
#[derive(Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct MemoryCreateInput{pub schema_version:u32,pub project_id:String,pub id:String,pub content:MemoryContent}
#[derive(Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct MemoryUpdateInput{pub schema_version:u32,pub project_id:String,pub id:String,pub expected_revision:i64,pub mutation:MemoryMutation}
fn version(value:u32)->Result<(),StoreError>{
    if value==1{Ok(())}else{Err(StoreError{kind:"invalid".into(),message:"unsupported project memory IPC version".into()})}
}
pub fn list_project_memories(store:&RunStore,input:MemoryListInput,cancelled:&AtomicBool,deadline:Instant)->Result<MemoryPage,StoreError>{
    version(input.schema_version)?;
    store.project_memories(&MemoryExecution::new(cancelled,deadline),&input.project_id,input.after_id.as_deref(),input.limit)
}
pub fn get_project_memory(store:&RunStore,input:MemoryGetInput,cancelled:&AtomicBool,deadline:Instant)->Result<ProjectMemory,StoreError>{
    version(input.schema_version)?;
    store.project_memory(&MemoryExecution::new(cancelled,deadline),&input.project_id,&input.id)
}
pub fn create_project_memory(store:&RunStore,input:MemoryCreateInput,cancelled:&AtomicBool,deadline:Instant)->Result<ProjectMemory,StoreError>{
    version(input.schema_version)?;
    store.create_project_memory(&MemoryExecution::new(cancelled,deadline),&input.project_id,&input.id,input.content)
}
pub fn update_project_memory(store:&RunStore,input:MemoryUpdateInput,cancelled:&AtomicBool,deadline:Instant)->Result<ProjectMemory,StoreError>{
    version(input.schema_version)?;
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .ok().and_then(|duration|i64::try_from(duration.as_millis()).ok()).filter(|value|*value<=MAX_SAFE)
        .ok_or_else(||StoreError{kind:"clock".into(),message:"system timestamp is unavailable".into()})?;
    store.update_project_memory(&MemoryExecution::new(cancelled,deadline),&input.project_id,&input.id,input.expected_revision,input.mutation,now)
}
