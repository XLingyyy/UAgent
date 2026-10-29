//! Append-only, fail-closed accounting for the single CNY 10 Flash campaign.
//! No credentials or prompt/response content are accepted by this module.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}};
use tauri::Manager;

const CAMPAIGN: &str = "uagent-flash-validation-20261026";
const LIMIT: u64 = 10_000_000;
const MAX_JOURNAL: u64 = 262_144;
const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BudgetRecord {
    campaign: String, limit_micros: u64, reserved_micros: u64, requests: u64,
    input_tokens: u64, output_tokens: u64, uncertain_requests: u64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
enum Event {
    Initialized { campaign: String, limit: u64 },
    Reserved { id: String, maximum: u64 },
    Usage { id: String, input: u64, output: u64 },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry { sequence: u64, previous: String, event: Event, checksum: String }
struct Journal { state: BudgetRecord, entries: u64, last_hash: String, reservations: BTreeMap<String, Option<(u64,u64)>> }

fn error(reason: &str) -> String { format!("provider_budget_{reason}") }
fn checksum(sequence: u64, previous: &str, event: &Event) -> Result<String,String> {
    let bytes = serde_json::to_vec(&(sequence, previous, event)).map_err(|_| error("encode"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
pub(crate) fn safe_metadata(path: &Path, directory: bool) -> Result<(),String> {
    let meta = fs::symlink_metadata(path).map_err(|_| error("missing_or_inaccessible"))?;
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return Err(error("link_rejected")); }
    }
    if meta.file_type().is_symlink() || (directory && !meta.is_dir()) || (!directory && !meta.is_file()) { return Err(error("identity_invalid")); }
    Ok(())
}
pub(crate) fn open_file(path: &Path, create: bool, append: bool) -> Result<File,String> {
    if path.exists() { safe_metadata(path, false)?; }
    let mut options = OpenOptions::new();
    options.read(true).write(create || append).create_new(create).append(append);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0).custom_flags(0x00200000); // OPEN_REPARSE_POINT; do not follow file links.
    }
    options.open(path).map_err(|_| error("file_unavailable"))
}
/// Exclusive Windows file share mode is released by the OS on process death.
/// Keep the lock file: unlinking a lock permits another process to lock a new inode.
pub(crate) fn lock(root: &Path) -> Result<File,String> {
    safe_metadata(root, true)?;
    let path = root.join("campaign.lock");
    if path.exists() { safe_metadata(&path, false)?; }
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .share_mode(0).custom_flags(0x00200000).open(path).map_err(|_| error("busy_or_inaccessible"))
    }
    #[cfg(not(windows))] { Err(error("platform_lock_unavailable")) }
}
fn load(root: &Path) -> Result<Journal,String> {
    safe_metadata(&root.join("campaign.created"), false)?;
    let file = open_file(&root.join("campaign.jsonl"), false, false)?;
    if file.metadata().map_err(|_| error("read"))?.len() > MAX_JOURNAL { return Err(error("too_large")); }
    let mut text = String::new();
    file.take(MAX_JOURNAL + 1).read_to_string(&mut text).map_err(|_| error("read"))?;
    if text.len() as u64 > MAX_JOURNAL || !text.ends_with('\n') { return Err(error("incomplete_journal")); }
    let mut result = Journal { state: BudgetRecord { campaign: CAMPAIGN.into(), limit_micros: LIMIT, reserved_micros: 0, requests: 0, input_tokens: 0, output_tokens: 0, uncertain_requests: 0 }, entries: 0, last_hash: ZERO_HASH.into(), reservations: BTreeMap::new() };
    for line in text.lines() {
        let entry: Entry = serde_json::from_str(line).map_err(|_| error("corrupt_journal"))?;
        if entry.sequence != result.entries || entry.previous != result.last_hash || entry.checksum != checksum(entry.sequence, &entry.previous, &entry.event)? { return Err(error("corrupt_journal")); }
        match &entry.event {
            Event::Initialized { campaign, limit } if result.entries == 0 && campaign == CAMPAIGN && *limit == LIMIT => {},
            Event::Reserved { id, maximum } if result.entries > 0 && id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) && *maximum > 0 && *maximum <= LIMIT && !result.reservations.contains_key(id) => {
                result.state.reserved_micros = result.state.reserved_micros.checked_add(*maximum).ok_or_else(|| error("corrupt_journal"))?;
                result.state.requests += 1; result.state.uncertain_requests += 1;
                if result.state.reserved_micros > LIMIT || result.state.requests > 100 { return Err(error("corrupt_journal")); }
                result.reservations.insert(id.clone(), None);
            },
            Event::Usage { id, input, output } if result.reservations.get(id) == Some(&None) && *input <= 100_000 && *output <= 1024 => {
                result.state.input_tokens += input; result.state.output_tokens += output; result.state.uncertain_requests -= 1;
                result.reservations.insert(id.clone(), Some((*input,*output)));
            },
            _ => return Err(error("corrupt_journal")),
        }
        result.entries += 1; result.last_hash = entry.checksum;
    }
    if result.entries == 0 { return Err(error("missing_journal")); }
    Ok(result)
}
fn append(root: &Path, sequence: u64, previous: &str, event: Event, create: bool) -> Result<(),String> {
    let entry = Entry { sequence, previous: previous.into(), checksum: checksum(sequence, previous, &event)?, event };
    let mut bytes = serde_json::to_vec(&entry).map_err(|_| error("encode"))?; bytes.push(b'\n');
    let mut file = open_file(&root.join("campaign.jsonl"), create, !create)?;
    let length = file.metadata().map_err(|_| error("read"))?.len();
    if length + bytes.len() as u64 > MAX_JOURNAL { return Err(error("too_large")); }
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| error("persist_failed"))
}
fn initialize(root: &Path) -> Result<BudgetRecord,String> {
    if !root.exists() { fs::create_dir_all(root).map_err(|_| error("create"))?; }
    let _lock = lock(root)?;
    if root.join("campaign.created").exists() { return Ok(load(root)?.state); }
    // An orphan ledger is never overwritten or treated as a fresh allowance.
    if root.join("campaign.jsonl").exists() { return Err(error("orphan_journal")); }
    let mut marker = open_file(&root.join("campaign.created"), true, false)?;
    marker.write_all(CAMPAIGN.as_bytes()).and_then(|_| marker.sync_all()).map_err(|_| error("persist_failed"))?;
    drop(marker);
    append(root, 0, ZERO_HASH, Event::Initialized { campaign: CAMPAIGN.into(), limit: LIMIT }, true)?;
    Ok(load(root)?.state)
}
fn read(root: &Path) -> Result<BudgetRecord,String> { let _lock = lock(root)?; Ok(load(root)?.state) }
fn reserve(root: &Path, maximum: u64) -> Result<String,String> {
    let _lock = lock(root)?; let journal = load(root)?;
    if maximum == 0 || maximum > LIMIT || journal.state.reserved_micros + maximum > LIMIT || journal.state.requests >= 100 { return Err(error("exhausted")); }
    let mut random = [0u8; 16]; getrandom::getrandom(&mut random).map_err(|_| error("random_unavailable"))?;
    let id = random.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    append(root, journal.entries, &journal.last_hash, Event::Reserved { id: id.clone(), maximum }, false)?;
    Ok(id)
}
fn usage(root: &Path, id: &str, input: u64, output: u64) -> Result<(),String> {
    let _lock = lock(root)?; let journal = load(root)?;
    if input > 100_000 || output > 1024 { return Err(error("usage_invalid")); }
    match journal.reservations.get(id) {
        Some(Some(existing)) if *existing == (input,output) => return Ok(()), // Idempotent acknowledgement.
        Some(None) => {},
        _ => return Err(error("reservation_invalid")),
    }
    append(root, journal.entries, &journal.last_hash, Event::Usage { id: id.into(), input, output }, false)
}
fn app_root(app: &tauri::AppHandle) -> Result<PathBuf,String> {
    Ok(app.path().app_data_dir().map_err(|_| error("app_data_unavailable"))?.join("flash-budget-v1"))
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ReserveInput { maximum_micros: u64 }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct UsageInput { reservation_id: String, input_tokens: u64, output_tokens: u64 }
#[tauri::command]
pub fn initialize_provider_budget(app: tauri::AppHandle) -> Result<BudgetRecord,String> { initialize(&app_root(&app)?) }
#[tauri::command]
pub fn read_provider_budget(app: tauri::AppHandle) -> Result<BudgetRecord,String> { read(&app_root(&app)?) }
#[tauri::command]
pub fn reserve_provider_budget(app: tauri::AppHandle, input: ReserveInput) -> Result<String,String> { reserve(&app_root(&app)?, input.maximum_micros) }
#[tauri::command]
pub fn record_provider_usage(app: tauri::AppHandle, input: UsageInput) -> Result<(),String> { usage(&app_root(&app)?, &input.reservation_id, input.input_tokens, input.output_tokens) }

#[cfg(all(test,windows))]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture { fn new() -> Self { let mut bytes=[0u8;8]; getrandom::getrandom(&mut bytes).unwrap(); let suffix=bytes.iter().map(|b|format!("{b:02x}")).collect::<String>(); Self(std::env::temp_dir().join(format!("uagent-provider-budget-test-{suffix}"))) } }
    impl Drop for Fixture { fn drop(&mut self) { if self.0.parent()==Some(std::env::temp_dir().as_path()) && self.0.file_name().unwrap().to_string_lossy().starts_with("uagent-provider-budget-test-") { let _=fs::remove_dir_all(&self.0); } } }
    #[test] fn provider_budget_reopen_preserves_reservations_and_usage() {
        let f=Fixture::new(); initialize(&f.0).unwrap();
        let id=reserve(&f.0,4_000_000).unwrap(); usage(&f.0,&id,10,20).unwrap(); usage(&f.0,&id,10,20).unwrap();
        let again=initialize(&f.0).unwrap(); assert_eq!(again.reserved_micros,4_000_000); assert_eq!(again.requests,1); assert_eq!(again.input_tokens,10); assert_eq!(again.uncertain_requests,0);
        assert!(usage(&f.0,&id,11,20).is_err()); assert!(reserve(&f.0,6_000_001).is_err());
    }
    #[test] fn provider_budget_cancel_failure_never_refunds() {
        let f=Fixture::new(); initialize(&f.0).unwrap(); reserve(&f.0,LIMIT).unwrap();
        assert_eq!(read(&f.0).unwrap().uncertain_requests,1); assert!(reserve(&f.0,1).is_err()); assert_eq!(initialize(&f.0).unwrap().reserved_micros,LIMIT);
    }
    #[test] fn provider_budget_missing_and_torn_journal_fail_closed() {
        let f=Fixture::new(); initialize(&f.0).unwrap(); reserve(&f.0,100).unwrap();
        OpenOptions::new().append(true).open(f.0.join("campaign.jsonl")).unwrap().write_all(b"{partial").unwrap();
        assert!(read(&f.0).is_err()); assert!(initialize(&f.0).is_err()); assert!(reserve(&f.0,1).is_err());
        fs::remove_file(f.0.join("campaign.jsonl")).unwrap(); assert!(initialize(&f.0).is_err());
    }
    #[test] fn provider_budget_concurrent_reservation_cannot_overspend() {
        let f=Fixture::new(); initialize(&f.0).unwrap();
        let barrier=std::sync::Arc::new(std::sync::Barrier::new(3)); let mut workers=vec![];
        for _ in 0..2 { let path=f.0.clone(); let barrier=barrier.clone(); workers.push(std::thread::spawn(move||{barrier.wait();reserve(&path,6_000_000)})); }
        barrier.wait(); let successes=workers.into_iter().filter_map(|w|w.join().unwrap().ok()).count();
        assert_eq!(successes,1); assert_eq!(read(&f.0).unwrap().reserved_micros,6_000_000);
    }
    #[test] fn provider_budget_child_crash_helper() {
        if let Some(path)=std::env::var_os("UAGENT_PROVIDER_BUDGET_TEST_ROOT") {
            let root=PathBuf::from(path); let _lock=lock(&root).unwrap(); let j=load(&root).unwrap();
            append(&root,j.entries,&j.last_hash,Event::Reserved { id:"1234567890abcdef1234567890abcdef".into(), maximum:3_000_000 },false).unwrap();
            std::process::exit(23); // No Drop: exercise OS lock release after process death.
        }
    }
    #[test] fn provider_budget_process_crash_releases_lock_without_reset() {
        let f=Fixture::new(); initialize(&f.0).unwrap();
        let status=std::process::Command::new(std::env::current_exe().unwrap()).args(["provider_budget::tests::provider_budget_child_crash_helper","--exact","--nocapture"])
            .env("UAGENT_PROVIDER_BUDGET_TEST_ROOT",&f.0).status().unwrap();
        assert_eq!(status.code(),Some(23)); assert_eq!(read(&f.0).unwrap().reserved_micros,3_000_000); reserve(&f.0,7_000_000).unwrap(); assert!(reserve(&f.0,1).is_err());
    }
}
