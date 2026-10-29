//! Private Windows I/O for the exact approved repair plan. No paths are reopened by Win32 text.
#![cfg(windows)]
use crate::trusted_root_handle::{PinnedDirectory, ReadRule};
use sha2::{Digest, Sha256};
use std::{
    ffi::c_void,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle},
    ptr::null_mut,
};
type Handle = *mut c_void;
#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}
#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root: Handle,
    name: *mut UnicodeString,
    attributes: u32,
    security: *mut c_void,
    qos: *mut c_void,
}
#[repr(C)]
struct IoStatus {
    status: usize,
    information: usize,
}
#[repr(C)]
#[derive(Default)]
struct IdInfo {
    volume: u64,
    id: [u8; 16],
}
#[repr(C)]
#[derive(Default)]
struct TagInfo {
    attributes: u32,
    tag: u32,
}
#[repr(C)]
#[derive(Default)]
struct StandardInfo {
    allocation: i64,
    size: i64,
    links: u32,
    delete_pending: u8,
    directory: u8,
}
#[link(name = "ntdll")]
extern "system" {
    fn NtCreateFile(
        file: *mut Handle,
        access: u32,
        attributes: *mut ObjectAttributes,
        io: *mut IoStatus,
        allocation: *mut i64,
        file_attributes: u32,
        share: u32,
        disposition: u32,
        options: u32,
        ea: *mut c_void,
        ea_length: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}
#[link(name = "kernel32")]
extern "system" {
    fn GetFileInformationByHandleEx(
        file: Handle,
        class: u32,
        info: *mut c_void,
        length: u32,
    ) -> i32;
    fn GetFileType(file: Handle) -> u32;
}
pub(crate) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn info<T: Default>(file: &File, class: u32) -> Result<T, String> {
    let mut v = T::default();
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            class,
            (&mut v as *mut T).cast(),
            size_of::<T>() as u32,
        )
    } == 0
    {
        return Err("repair_handle_information_unavailable".into());
    }
    Ok(v)
}
fn identity(file: &File) -> Result<String, String> {
    if unsafe { GetFileType(file.as_raw_handle()) } != 1 {
        return Err("repair_not_disk_file".into());
    }
    let t: TagInfo = info(file, 9)?;
    let s: StandardInfo = info(file, 1)?;
    let i: IdInfo = info(file, 18)?;
    if t.attributes & (0x10 | 0x400 | 0x1000 | 0x40000 | 0x400000) != 0
        || t.tag != 0
        || s.links != 1
        || s.directory != 0
        || s.delete_pending != 0
        || s.size < 0
        || i.volume == 0
        || i.id == [0; 16]
    {
        return Err("repair_file_identity_or_type_rejected".into());
    }
    Ok(format!(
        "windows-fileid128:v1:{:016x}:{}",
        i.volume,
        i.id.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ))
}
fn open(
    directory: &PinnedDirectory,
    leaf: &str,
    create: bool,
    identity_only: bool,
) -> Result<File, String> {
    ReadRule::exact_file(leaf).map_err(|e| e.to_string())?;
    if leaf.contains(['/', '\\']) {
        return Err("repair_leaf_required".into());
    }
    let guard = directory
        .borrow_verified_handle()
        .map_err(|e| e.to_string())?;
    let mut w: Vec<u16> = leaf.encode_utf16().collect();
    let mut name = UnicodeString {
        length: (w.len() * 2) as u16,
        maximum_length: (w.len() * 2) as u16,
        buffer: w.as_mut_ptr(),
    };
    let mut attrs = ObjectAttributes {
        length: size_of::<ObjectAttributes>() as u32,
        root: guard.as_raw_handle(),
        name: &mut name,
        attributes: 0x40 | 0x1000,
        security: null_mut(),
        qos: null_mut(),
    };
    let mut io = IoStatus {
        status: 0,
        information: 0,
    };
    let mut h: Handle = null_mut();
    // Existing source only (FILE_OPEN), recovery records only new exclusive FILE_CREATE.
    // No share rights: all selected targets are opened and preflighted before the first write.
    let status = unsafe {
        NtCreateFile(
            &mut h,
            if identity_only {
                0x0010_0080
            } else {
                0x0012_019f
            },
            &mut attrs,
            &mut io,
            null_mut(),
            0x80,
            if identity_only { 7 } else { 0 },
            if create { 2 } else { 1 },
            0x40 | 0x20 | 0x20_0000,
            null_mut(),
            0,
        )
    };
    if status != 0 {
        if !h.is_null() && h as isize != -1 {
            drop(unsafe { File::from_raw_handle(h) });
        }
        return Err(format!("repair_relative_open_failed:{}", unsafe {
            RtlNtStatusToDosError(status)
        }));
    }
    if h.is_null() || h as isize == -1 {
        return Err("repair_missing_file_handle".into());
    }
    let file = unsafe { File::from_raw_handle(h) };
    identity(&file)?;
    directory.check_current().map_err(|e| e.to_string())?;
    Ok(file)
}
/// Keeps the old file object alive without data read/write/delete access. This prevents ID
/// recycling while allowing user edits/replacement to be detected at exclusive apply preflight.
pub(crate) struct IdentityPin {
    file: File,
    pub identity: String,
}
impl IdentityPin {
    pub fn open(directory: &PinnedDirectory, leaf: &str) -> Result<Self, String> {
        let file = open(directory, leaf, false, true)?;
        let identity = identity(&file)?;
        Ok(Self { file, identity })
    }
    pub fn check(&self) -> Result<(), String> {
        if identity(&self.file)? != self.identity {
            return Err("repair_pinned_object_changed".into());
        }
        Ok(())
    }
}
pub(crate) struct ExclusiveFile {
    file: File,
    pub identity: String,
}
impl ExclusiveFile {
    pub fn open(directory: &PinnedDirectory, leaf: &str) -> Result<Self, String> {
        let file = open(directory, leaf, false, false)?;
        let identity = identity(&file)?;
        Ok(Self { file, identity })
    }
    pub fn read(&mut self, limit: usize) -> Result<Vec<u8>, String> {
        let before = identity(&self.file)?;
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|_| "repair_seek_failed")?;
        let mut b = Vec::new();
        (&mut self.file)
            .take(limit as u64 + 1)
            .read_to_end(&mut b)
            .map_err(|_| "repair_read_failed")?;
        if b.len() > limit || identity(&self.file)? != before || before != self.identity {
            return Err("repair_bound_read_changed_or_oversize".into());
        }
        Ok(b)
    }
    pub fn overwrite(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|_| "repair_seek_failed")?;
        self.file
            .write_all(bytes)
            .map_err(|_| "repair_write_possible_partial")?;
        self.file
            .set_len(bytes.len() as u64)
            .map_err(|_| "repair_length_possible_partial")?;
        self.file
            .sync_all()
            .map_err(|_| "repair_flush_possible_partial")?;
        if self.read(bytes.len().max(1))? != bytes {
            return Err("repair_write_readback_mismatch".into());
        }
        Ok(())
    }
}
pub(crate) fn create_recovery_record(
    directory: &PinnedDirectory,
    leaf: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let mut file = open(directory, leaf, true, false)?;
    file.write_all(bytes)
        .map_err(|_| "repair_recovery_write_failed")?;
    file.sync_all()
        .map_err(|_| "repair_recovery_flush_failed")?;
    directory.check_current().map_err(|e| e.to_string())
}
