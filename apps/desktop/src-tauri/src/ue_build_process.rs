//! Blocking, owned UE process execution. Host should run this on a blocking worker.
//! A private Windows Job owns the suspended child before its first instruction runs.
use crate::ue_build_profile::PreparedUEBuild;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UEBuildOwner {
    pub run_id: String,
    pub step_id: String,
    pub fingerprint: String,
}

/// Keep this in the host's execution registry. No PID-based cancellation API exists.
#[derive(Debug, PartialEq, Eq)]
enum BuildStartState {
    Pending,
    Started,
    Cancelled,
}

#[derive(Clone)]
pub struct UEBuildCancellation {
    owner: UEBuildOwner,
    requested: Arc<AtomicBool>,
    start_gate: Arc<Mutex<BuildStartState>>,
    liveness: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
}
impl UEBuildCancellation {
    pub fn new(owner: UEBuildOwner) -> Self {
        Self {
            owner,
            requested: Arc::new(AtomicBool::new(false)),
            start_gate: Arc::new(Mutex::new(BuildStartState::Pending)),
            liveness: None,
        }
    }
    pub(crate) fn with_liveness(owner:UEBuildOwner, live:Arc<dyn Fn()->bool+Send+Sync>)->Self {
        let mut value=Self::new(owner);value.liveness=Some(live);value
    }
    fn is_requested(&self)->bool {
        if self.liveness.as_ref().is_some_and(|live| !std::panic::catch_unwind(std::panic::AssertUnwindSafe(||live())).unwrap_or(false)) {
            self.requested.store(true,Ordering::SeqCst);
        }
        self.requested.load(Ordering::SeqCst)
    }
    pub fn cancel(&self, owner: &UEBuildOwner) -> Result<(), String> {
        if &self.owner != owner {
            return Err("build_owner_mismatch".into());
        }
        let mut gate = self
            .start_gate
            .lock()
            .map_err(|_| "build_start_gate_unavailable")?;
        self.requested.store(true, Ordering::SeqCst);
        if *gate == BuildStartState::Pending {
            *gate = BuildStartState::Cancelled;
        }
        Ok(())
    }

    #[cfg(any(windows, test))]
    fn resume_pending(&self, resume: impl FnOnce() -> Result<(), ()>) -> Result<bool, ()> {
        let mut gate = self.start_gate.lock().map_err(|_| ())?;
        if *gate == BuildStartState::Cancelled || self.is_requested() {
            return Ok(false);
        }
        if *gate != BuildStartState::Pending {
            return Err(());
        }
        // Cancellation and ResumeThread have a single linearization order under this gate.
        resume()?;
        *gate = BuildStartState::Started;
        Ok(true)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UEBuildExecutionResult {
    pub owner: UEBuildOwner,
    pub status: String,
    pub reason: String,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub tree_stopped: bool,
    pub stdout: String,
    pub stderr: String,
    pub output_truncated: bool,
    pub output_complete: bool,
    pub effects: String,
}

fn not_started(owner: UEBuildOwner, reason: &str) -> UEBuildExecutionResult {
    UEBuildExecutionResult {
        owner,
        status: "not_started".into(),
        reason: reason.into(),
        pid: None,
        exit_code: None,
        duration_ms: 0,
        tree_stopped: true,
        stdout: String::new(),
        stderr: String::new(),
        output_truncated: false,
        output_complete: true,
        effects: "not_started".into(),
    }
}

/// Caller must consume a separate one-use host grant bound to root object identity and owner.
/// A matching fingerprint is public plan data, not proof of approval.
pub fn execute_ue_build(
    build: &PreparedUEBuild,
    owner: UEBuildOwner,
    cancel: &UEBuildCancellation,
) -> UEBuildExecutionResult {
    if owner.run_id.is_empty()
        || owner.step_id.is_empty()
        || owner != cancel.owner
        || owner.fingerprint != build.preview().fingerprint
    {
        return not_started(owner, "build_owner_or_approval_mismatch");
    }
    if cancel.is_requested() {
        let mut result = not_started(owner, "cancelled_before_start");
        result.status = "cancelled".into();
        return result;
    }
    let _binding_guards = match build.revalidate_and_hold() {
        Ok(guards) => guards,
        Err(reason) => return not_started(owner, &reason),
    };
    if cancel.is_requested() {
        let mut result = not_started(owner, "cancelled_before_start");
        result.status = "cancelled".into();
        return result;
    }
    let mut command = Command::new(build.program());
    command
        .current_dir(build.cwd())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Avoid ambient command injection through CL, _CL_, LINK, shell startup, or credential variables.
    // Only documented process/SDK discovery locations survive. No generic environment override input.
    command.env_clear();
    for key in [
        "SystemRoot",
        "WINDIR",
        "PATH",
        "TEMP",
        "TMP",
        "COMSPEC",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "LOCALAPPDATA",
        "APPDATA",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
        "PROCESSOR_IDENTIFIER",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    if let Some(root) = build.dotnet_root() {
        command
            .env("DOTNET_ROOT", root)
            .env("DOTNET_MULTILEVEL_LOOKUP", "0")
            .env("DOTNET_ROLL_FORWARD", "LatestMajor");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Some(line) = build.batch_line() {
            command.args(["/d", "/v:off", "/s", "/c"]).raw_arg(line);
        } else {
            command.args(build.arguments());
        }
    }
    #[cfg(not(windows))]
    {
        command.args(build.arguments());
    }
    execute_owned(
        command,
        owner,
        cancel,
        Duration::from_millis(build.preview().timeout_ms),
    )
}

struct Captured {
    bytes: Vec<u8>,
    truncated: bool,
    complete: bool,
}
fn capture(reader: impl Read + Send + 'static) -> mpsc::Receiver<Captured> {
    let (send, recv) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 16_384];
        let mut truncated = false;
        let mut complete = true;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let remaining = 1_048_576usize.saturating_sub(bytes.len());
                    bytes.extend_from_slice(&buffer[..n.min(remaining)]);
                    truncated |= n > remaining;
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => {
                    complete = false;
                    break;
                }
            }
        }
        let _ = send.send(Captured {
            bytes,
            truncated,
            complete,
        });
    });
    recv
}

#[cfg(not(windows))]
use self::execute_unsupported as execute_owned;

#[cfg(any(not(windows), test))]
fn execute_unsupported(
    _command: Command,
    owner: UEBuildOwner,
    _cancel: &UEBuildCancellation,
    _timeout: Duration,
) -> UEBuildExecutionResult {
    not_started(owner, "unsupported_host_process_tree")
}

#[cfg(windows)]
fn execute_owned(
    command: Command,
    owner: UEBuildOwner,
    cancel: &UEBuildCancellation,
    timeout: Duration,
) -> UEBuildExecutionResult {
    execute_owned_before_resume(command, owner, cancel, timeout, || {})
}

#[cfg(windows)]
fn execute_owned_before_resume(
    mut command: Command,
    owner: UEBuildOwner,
    cancel: &UEBuildCancellation,
    timeout: Duration,
    before_resume: impl FnOnce(),
) -> UEBuildExecutionResult {
    use std::os::windows::process::CommandExt;
    let started = Instant::now();
    let job = match windows_job::OwnedJob::new() {
        Ok(job) => job,
        Err(_) => return not_started(owner, "process_job_unavailable"),
    };
    // CREATE_SUSPENDED closes the spawn/assign race: no UBT child can escape before job assignment.
    command.creation_flags(0x00000004 | 0x08000000);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return not_started(owner, "build_spawn_failed"),
    };
    let pid = child.id();
    let resumed = job.assign(&child).and_then(|_| {
        before_resume();
        cancel.resume_pending(|| job.resume(&child))
    });
    if resumed != Ok(true) {
        let _ = child.kill();
        let deadline = Instant::now() + Duration::from_secs(2);
        let stopped = loop {
            match child.try_wait() {
                Ok(Some(_)) => break true,
                Err(_) => break false,
                Ok(None) => {}
            }
            if Instant::now() >= deadline {
                break false;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let cancelled = resumed == Ok(false);
        let mut result = not_started(
            owner,
            if cancelled {
                "cancelled_before_start"
            } else {
                "process_ownership_setup_failed"
            },
        );
        if cancelled {
            result.status = "cancelled".into();
        }
        result.pid = Some(pid);
        result.tree_stopped = stopped;
        if !stopped {
            result.status = "termination_unknown".into();
        }
        return result;
    }
    let stdout = capture(child.stdout.take().expect("piped stdout"));
    let stderr = capture(child.stderr.take().expect("piped stderr"));
    let (mut status, mut reason, exit_code) = loop {
        // Observe a completed process first; cancellation requested after completion does not rewrite history.
        match child.try_wait() {
            Ok(Some(exit)) => {
                break (
                    if exit.success() {
                        "succeeded"
                    } else {
                        "failed"
                    }
                    .to_string(),
                    "process_exited".to_string(),
                    exit.code(),
                )
            }
            Err(_) => {
                break (
                    "termination_unknown".into(),
                    "process_wait_failed".into(),
                    None,
                )
            }
            Ok(None) => {}
        }
        if cancel.is_requested() {
            break ("cancelled".into(), "cancel_requested".into(), None);
        }
        if started.elapsed() >= timeout {
            break ("timed_out".into(), "build_timeout".into(), None);
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let mut exit_code = exit_code;
    let mut active = job.active();
    if status == "succeeded" || status == "failed" {
        // A signalled process handle can precede the Job accounting update. Also allow
        // short-lived owned descendants to finish naturally, within the same build deadline.
        let grace = Instant::now() + Duration::from_millis(200);
        while active != Ok(0)
            && Instant::now() < grace
            && started.elapsed() < timeout
            && !cancel.is_requested()
        {
            std::thread::sleep(Duration::from_millis(10));
            active = job.active();
        }
    }
    if active != Ok(0) {
        if status == "succeeded" || status == "failed" {
            if cancel.is_requested() {
                status = "cancelled".into();
                reason = "cancel_requested".into();
            } else if started.elapsed() >= timeout {
                status = "timed_out".into();
                reason = "build_timeout".into();
            } else {
                status = "failed".into();
                reason = "root_exited_with_live_or_unknown_descendants".into();
            }
        }
        let _ = job.terminate();
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    let tree_stopped = loop {
        if job.active() == Ok(0) {
            break true;
        }
        if Instant::now() >= deadline {
            break false;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    if let Ok(Some(exit)) = child.try_wait() {
        exit_code = exit.code();
    }
    // Close also kills on failure; do not report that fallback as confirmed termination.
    drop(job);
    if !tree_stopped {
        status = "termination_unknown".into();
    }
    let missing = || Captured {
        bytes: Vec::new(),
        truncated: true,
        complete: false,
    };
    let out = stdout
        .recv_timeout(Duration::from_millis(500))
        .unwrap_or_else(|_| missing());
    let err = stderr
        .recv_timeout(Duration::from_millis(500))
        .unwrap_or_else(|_| missing());
    let output_complete = out.complete && err.complete;
    if !output_complete && status == "succeeded" {
        status = "failed".into();
        reason = "build_output_incomplete".into();
    }
    UEBuildExecutionResult {
        owner,
        status,
        reason,
        pid: Some(pid),
        exit_code,
        duration_ms: started.elapsed().as_millis() as u64,
        tree_stopped,
        stdout: String::from_utf8_lossy(&out.bytes).into_owned(),
        stderr: String::from_utf8_lossy(&err.bytes).into_owned(),
        output_truncated: out.truncated || err.truncated,
        output_complete,
        effects: "possible".into(),
    }
}

#[cfg(windows)]
pub(crate) mod windows_job {
    use super::Child;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    type Handle = *mut c_void;
    #[repr(C)]
    struct ThreadEntry {
        size: u32,
        usage: u32,
        thread_id: u32,
        process_id: u32,
        base_priority: i32,
        delta_priority: i32,
        flags: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working_set: usize,
        max_working_set: usize,
        active_process_limit: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_ops: u64,
        write_ops: u64,
        other_ops: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io: IoCounters,
        process_memory: usize,
        job_memory: usize,
        peak_process: usize,
        peak_job: usize,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Accounting {
        user: i64,
        kernel: i64,
        period_user: i64,
        period_kernel: i64,
        faults: u32,
        total: u32,
        active: u32,
        terminated: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, data: *const c_void, size: u32) -> i32;
        fn QueryInformationJobObject(
            job: Handle,
            class: i32,
            data: *mut c_void,
            size: u32,
            returned: *mut u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> Handle;
        fn Thread32First(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn Thread32Next(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn OpenThread(access: u32, inherit: i32, thread_id: u32) -> Handle;
        fn ResumeThread(thread: Handle) -> u32;
    }
    pub(crate) struct OwnedJob(Handle);
    impl OwnedJob {
        pub(crate) fn new() -> Result<Self, ()> {
            let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if raw.is_null() {
                return Err(());
            }
            let job = Self(raw);
            let mut limits = ExtendedLimits::default();
            limits.basic.flags = 0x00002000; // KILL_ON_JOB_CLOSE; no breakaway
            if unsafe {
                SetInformationJobObject(
                    job.0,
                    9,
                    &limits as *const _ as *const c_void,
                    size_of::<ExtendedLimits>() as u32,
                )
            } == 0
            {
                return Err(());
            }
            Ok(job)
        }
        pub(crate) fn assign(&self, child: &Child) -> Result<(), ()> {
            if unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) } == 0 {
                Err(())
            } else {
                Ok(())
            }
        }
        pub(crate) fn resume(&self, child: &Child) -> Result<(), ()> {
            // std::process closes the initial thread handle. Find the suspended primary thread
            // using the supported Win32 snapshot API; only threads owned by this child are resumed.
            let snapshot = unsafe { CreateToolhelp32Snapshot(0x00000004, 0) }; // TH32CS_SNAPTHREAD
            if snapshot as isize == -1 {
                return Err(());
            }
            let mut entry = ThreadEntry {
                size: size_of::<ThreadEntry>() as u32,
                usage: 0,
                thread_id: 0,
                process_id: 0,
                base_priority: 0,
                delta_priority: 0,
                flags: 0,
            };
            let mut found = unsafe { Thread32First(snapshot, &mut entry) } != 0;
            let mut resumed = false;
            while found {
                if entry.process_id == child.id() {
                    let thread = unsafe { OpenThread(0x0002, 0, entry.thread_id) }; // THREAD_SUSPEND_RESUME
                    if !thread.is_null() {
                        let result = unsafe { ResumeThread(thread) };
                        unsafe {
                            CloseHandle(thread);
                        }
                        resumed = result == 1;
                    }
                    break;
                }
                entry.size = size_of::<ThreadEntry>() as u32;
                found = unsafe { Thread32Next(snapshot, &mut entry) } != 0;
            }
            unsafe {
                CloseHandle(snapshot);
            }
            if resumed {
                Ok(())
            } else {
                Err(())
            }
        }
        pub(crate) fn active(&self) -> Result<u32, ()> {
            let mut accounting = Accounting::default();
            if unsafe {
                QueryInformationJobObject(
                    self.0,
                    1,
                    &mut accounting as *mut _ as *mut c_void,
                    size_of::<Accounting>() as u32,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return Err(());
            }
            Ok(accounting.active)
        }
        pub(crate) fn terminate(&self) -> Result<(), ()> {
            if unsafe { TerminateJobObject(self.0, 0xC000013A) } == 0 {
                Err(())
            } else {
                Ok(())
            }
        }
    }
    impl Drop for OwnedJob {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    fn owner() -> UEBuildOwner {
        UEBuildOwner {
            run_id: "test_run".into(),
            step_id: "test_step".into(),
            fingerprint: "fixture".into(),
        }
    }
    fn fixture_command(scenario: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "ue_build_process::tests::safe_child_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("UAGENT_BUILD_FIXTURE", scenario)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }
    #[test]
    #[ignore = "safe subprocess fixture, invoked only by module tests"]
    fn safe_child_fixture() {
        match std::env::var("UAGENT_BUILD_FIXTURE").as_deref() {
            Ok("fail") => {
                eprintln!("Source/Foo.cpp(7,2): error C2065: 'Missing': undeclared identifier");
                std::process::exit(7);
            }
            Ok("wait") => {
                println!("fixture waiting");
                std::thread::sleep(Duration::from_secs(30));
            }
            Ok("tree") => {
                let mut child = fixture_command("wait").spawn().unwrap();
                println!("descendant={}", child.id());
                let _ = child.wait();
            }
            Ok("flood") => {
                for _ in 0..20_000 {
                    println!("{}", "x".repeat(100));
                }
            }
            Ok("orphan") => {
                let _child = fixture_command("wait")
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap();
            }
            Ok("ok") => {
                println!("safe fixture complete");
            }
            _ => panic!("fixture scenario required"),
        }
    }
    #[test]
    fn preserves_exit_code_and_drains_bounded_output() {
        for (scenario, expected, code) in [
            ("ok", "succeeded", 0),
            ("fail", "failed", 7),
            ("flood", "succeeded", 0),
        ] {
            let owner = owner();
            let cancel = UEBuildCancellation::new(owner.clone());
            let result = execute_owned(
                fixture_command(scenario),
                owner,
                &cancel,
                Duration::from_secs(5),
            );
            assert_eq!(result.status, expected, "{result:?}");
            assert_eq!(result.exit_code, Some(code));
            assert!(result.tree_stopped);
            assert!(result.output_complete);
            assert!(result.stdout.len() <= 1_048_576);
            if scenario == "flood" {
                assert!(result.output_truncated);
            }
        }
    }
    #[test]
    fn immediate_exits_do_not_race_job_accounting() {
        for _ in 0..12 {
            let owner = owner();
            let cancel = UEBuildCancellation::new(owner.clone());
            let result = execute_owned(
                fixture_command("ok"),
                owner,
                &cancel,
                Duration::from_secs(5),
            );
            assert_eq!(result.status, "succeeded", "{result:?}");
            assert!(result.tree_stopped);
        }
    }
    #[test]
    fn cancellation_after_spawn_before_resume_never_runs_child() {
        let owner = owner();
        let cancel = UEBuildCancellation::new(owner.clone());
        let result = execute_owned_before_resume(
            fixture_command("ok"),
            owner.clone(),
            &cancel,
            Duration::from_secs(5),
            || cancel.cancel(&owner).unwrap(),
        );
        assert_eq!(result.status, "cancelled", "{result:?}");
        assert_eq!(result.effects, "not_started");
        assert!(result.tree_stopped);
        assert!(result.stdout.is_empty());
    }
    #[test]
    fn timeout_stops_descendants_and_never_reports_success() {
        let owner = owner();
        let cancel = UEBuildCancellation::new(owner.clone());
        let result = execute_owned(
            fixture_command("tree"),
            owner,
            &cancel,
            Duration::from_millis(150),
        );
        assert_eq!(result.status, "timed_out", "{result:?}");
        assert!(result.tree_stopped);
        assert!(result.stdout.contains("descendant="));
        assert_ne!(result.exit_code, Some(0));
    }
    #[test]
    fn cancellation_requires_exact_owner_and_kills_tree() {
        let owner = owner();
        let cancel = UEBuildCancellation::new(owner.clone());
        let mut wrong = owner.clone();
        wrong.step_id = "other".into();
        assert_eq!(cancel.cancel(&wrong).unwrap_err(), "build_owner_mismatch");
        let thread_cancel = cancel.clone();
        let thread_owner = owner.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            thread_cancel.cancel(&thread_owner).unwrap();
        });
        let result = execute_owned(
            fixture_command("tree"),
            owner,
            &cancel,
            Duration::from_secs(5),
        );
        handle.join().unwrap();
        assert_eq!(result.status, "cancelled", "{result:?}");
        assert!(result.tree_stopped);
    }
    #[test]
    fn orphaned_descendant_is_cleaned_and_not_successful() {
        let owner = owner();
        let cancel = UEBuildCancellation::new(owner.clone());
        let result = execute_owned(
            fixture_command("orphan"),
            owner,
            &cancel,
            Duration::from_secs(5),
        );
        assert_eq!(result.status, "failed", "{result:?}");
        assert_eq!(
            result.reason,
            "root_exited_with_live_or_unknown_descendants"
        );
        assert!(result.tree_stopped);
    }
}

#[cfg(test)]
mod portable_tests {
    use super::*;
    fn owner() -> UEBuildOwner {
        UEBuildOwner {
            run_id: "portable-run".into(),
            step_id: "portable-step".into(),
            fingerprint: "plan".into(),
        }
    }
    #[test]
    fn unsupported_host_branch_returns_a_typed_non_execution_result() {
        let owner = owner();
        let cancel = UEBuildCancellation::new(owner.clone());
        let result = execute_unsupported(
            Command::new("never-spawned"),
            owner,
            &cancel,
            Duration::from_secs(1),
        );
        assert_eq!(result.status, "not_started");
        assert_eq!(result.reason, "unsupported_host_process_tree");
        assert!(result.pid.is_none());
    }
    #[test]
    fn cancellation_winning_start_gate_prevents_the_resume_callback() {
        let owner = owner();
        let cancel = UEBuildCancellation::new(owner.clone());
        cancel.cancel(&owner).unwrap();
        let mut resumed = false;
        assert_eq!(
            cancel.resume_pending(|| {
                resumed = true;
                Ok(())
            }),
            Ok(false)
        );
        assert!(!resumed);
    }
}

#[cfg(test)]
mod native_liveness_tests {
    use super::*;
    fn owner()->UEBuildOwner{UEBuildOwner{run_id:"synthetic".into(),step_id:"build".into(),fingerprint:"a".repeat(64)}}
    #[test]
    fn revoked_native_liveness_prevents_resume_without_process(){
        let alive=Arc::new(AtomicBool::new(true));let live=alive.clone();
        let cancel=UEBuildCancellation::with_liveness(owner(),Arc::new(move||live.load(Ordering::SeqCst)));
        alive.store(false,Ordering::SeqCst);
        assert!(!cancel.resume_pending(||panic!("revoked process must never resume")).unwrap());
    }
    #[test]
    fn panicking_native_liveness_fails_closed_without_process(){
        let cancel=UEBuildCancellation::with_liveness(owner(),Arc::new(||panic!("synthetic native owner fault")));
        assert!(!cancel.resume_pending(||panic!("process must never resume")).unwrap());
    }
}
