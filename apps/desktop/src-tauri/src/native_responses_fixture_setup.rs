//! Explicit local fixture creation, only inside the already pinned isolated profile.
#![cfg(windows)]
use serde::Serialize;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};
fn pin(path: &Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .access_mode(0x80)
        .share_mode(0x1 | 0x2)
        .custom_flags(0x02000000 | 0x00200000)
        .open(path)
        .map_err(|_| "fixture_directory_unavailable")?;
    let metadata = file
        .metadata()
        .map_err(|_| "fixture_directory_unavailable")?;
    if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 {
        return Err("fixture_directory_blocked".into());
    }
    Ok(file)
}
fn write_known(path: &Path, content: &[u8]) -> Result<(), String> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(0x00200000)
        .open(path)
    {
        Ok(mut file) => {
            file.write_all(content)
                .map_err(|_| "fixture_write_failed")?;
            file.sync_all().map_err(|_| "fixture_write_failed")?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let file = OpenOptions::new()
                .read(true)
                .share_mode(0x1)
                .custom_flags(0x00200000)
                .open(path)
                .map_err(|_| "fixture_file_blocked")?;
            let metadata = file.metadata().map_err(|_| "fixture_file_blocked")?;
            if !metadata.is_file()
                || metadata.file_attributes() & 0x400 != 0
                || metadata.len() != content.len() as u64
            {
                return Err("fixture_existing_file_changed".into());
            }
            let mut bytes = Vec::new();
            file.take(content.len() as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "fixture_file_blocked")?;
            if bytes != content {
                return Err("fixture_existing_file_changed".into());
            }
            Ok(())
        }
        Err(_) => Err("fixture_write_failed".into()),
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FixtureDescriptor {
    root_ref: String,
    provider_id: &'static str,
    model_id: &'static str,
}
#[tauri::command]
pub(crate) async fn prepare_native_responses_fixture() -> Result<FixtureDescriptor, String> {
    tauri::async_runtime::spawn_blocking(||{
   let root=crate::app_profile::responses_fixture_root()?;
   let parent=root.parent().ok_or("fixture_profile_unavailable")?;
   let _parent=pin(parent)?;
   match fs::create_dir(&root){Ok(())=>{},Err(e)if e.kind()==std::io::ErrorKind::AlreadyExists=>{},Err(_)=>return Err("fixture_directory_unavailable".into())}
   let _root=pin(&root)?;
   let source=root.join("Source");
   match fs::create_dir(&source){Ok(())=>{},Err(e)if e.kind()==std::io::ErrorKind::AlreadyExists=>{},Err(_)=>return Err("fixture_directory_unavailable".into())}
   let _source=pin(&source)?;
   write_known(&root.join("ResponsesLab.uproject"),br#"{"FileVersion":3,"EngineAssociation":"5.8","Category":"UAgent fixture","Description":"Local synthetic Responses fixture"}"#)?;
   write_known(&source.join("Main.cpp"),b"// UAgent local Responses fixture.\nint MainValue() { return 42; }\n")?;
   write_known(&source.join("Notes.md"),b"Local fixture only. Model responses are synthetic. Native project reads and storage are real.\n")?;
   Ok(FixtureDescriptor{root_ref:root.to_string_lossy().into(),provider_id:"responses-local-fixture",model_id:"fixture-responses"})
 }).await.map_err(|_|"fixture_worker_failed".to_string())?
}
