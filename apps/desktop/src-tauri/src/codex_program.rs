//! Resolve an installation entry point before approval, then retain the actual
//! program and its unchanged strict directory lease through process execution.
use std::{fs::{File,OpenOptions},path::{Path,PathBuf}};
use std::os::windows::fs::{MetadataExt,OpenOptionsExt};
use crate::trusted_root_handle::TrustedRootHandle;

pub(crate) fn resolve(selected:&Path)->Result<PathBuf,&'static str>{
 if !selected.is_absolute()||selected.file_name().and_then(|s|s.to_str())!=Some("codex.exe"){
  return Err("codex_select_executable");
 }
 // Official installations may expose bin through an update-managed junction.
 // Resolve it once; approval and subsequent spawn both use this physical path.
 let canonical=std::fs::canonicalize(selected).map_err(|_|"codex_executable_unavailable")?;
 let value=canonical.to_str().ok_or("codex_select_executable")?;
 let value=value.strip_prefix(r"\\?\").unwrap_or(value);
 let b=value.as_bytes();
 if b.len()<4||!b[0].is_ascii_alphabetic()||b[1]!=b':'||b[2]!=b'\\'{return Err("codex_select_executable");}
 let resolved=PathBuf::from(value);
 if resolved.file_name().and_then(|s|s.to_str())!=Some("codex.exe"){return Err("codex_select_executable");}
 Ok(resolved)
}

pub(crate) fn pin(resolved:&Path)->Result<(File,TrustedRootHandle),&'static str>{
 let directory=TrustedRootHandle::open_from_host_selection(resolved.parent().ok_or("codex_program_parent")?)
  .map_err(|_|"codex_program_directory_unavailable")?;
 let file=OpenOptions::new().read(true).share_mode(1).custom_flags(0x00200000).open(resolved)
  .map_err(|_|"codex_executable_unavailable")?;
 let metadata=file.metadata().map_err(|_|"codex_executable_unavailable")?;
 if !metadata.is_file()||metadata.file_attributes()&0x400!=0{return Err("codex_executable_unavailable");}
 directory.check_current().map_err(|_|"codex_program_changed")?;
 Ok((file,directory))
}
