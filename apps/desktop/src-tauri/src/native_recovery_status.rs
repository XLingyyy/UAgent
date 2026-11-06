//! Observation only: no store opener, owner creation, scan or execution.
#![cfg(windows)]
use crate::{managed_run_store::ManagedRunStoreState, runtime_host_recovery_catalog::PersistentRecoveryCatalog};
use std::sync::Arc;
#[path="recovery_observation.rs"]
mod observation;
use observation::{RecoveryStatusInput,RecoveryStatus};
#[tauri::command]
pub(crate) fn read_native_recovery_status(window:tauri::WebviewWindow,
    store:tauri::State<'_,ManagedRunStoreState>,
    catalog:tauri::State<'_,Arc<PersistentRecoveryCatalog>>,input:RecoveryStatusInput
)->Result<RecoveryStatus,&'static str>{
    let valid=|v:&str| !v.is_empty() && v.len()<=256 && !v.chars().any(char::is_control);
    if input.schema_version!=1 || !valid(&input.project_id) || !valid(&input.run_id){return Err("recovery_status_invalid");}
    let grant=store.capture_window_grant(&window).map_err(|_|"recovery_status_unavailable")?;
    if !grant.is_current(){return Err("recovery_status_unavailable");}
    let report=catalog.report().map_err(|_|"recovery_status_unavailable")?;
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .ok().and_then(|v|u64::try_from(v.as_millis()).ok()).filter(|v|*v<=9_007_199_254_740_991)
        .ok_or("recovery_status_unavailable")?;
    let result=observation::project(input,now,report.scan_complete,report.status,report.native_writer_fence_installed,
        report.persistent_effect_barriers.iter().map(|v|v.project_id.as_str()),
        report.legacy_unknown.iter().map(|v|v.project_id.as_str()))?;
    if !grant.is_current(){return Err("recovery_status_unavailable");}
    Ok(result)
}
