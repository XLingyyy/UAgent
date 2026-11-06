//! Native-only ownership of the TypeScript coordinator process and its private pipes.
//! Broker messages are requests, never tool grants. No renderer command accepts them.
#![cfg(windows)]
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc::{self, Receiver, SyncSender},
    thread,
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, &'static str>;
const MAX_FRAME: u64 = 1024 * 1024;

#[derive(Clone, Copy)]
pub(crate) enum HostCommand { Hello, Start, Snapshot, Pause, Resume, Cancel, Revoke, Shutdown }
impl HostCommand {
    fn method(self) -> &'static str {
        match self {
            Self::Hello => "hello", Self::Start => "start", Self::Snapshot => "snapshot",
            Self::Pause => "pause", Self::Resume => "resume", Self::Cancel => "cancel",
            Self::Revoke => "revoke", Self::Shutdown => "shutdown",
        }
    }
}
enum Control {
    Command(HostCommand, Value, SyncSender<Result<Value>>),
    BrokerReply(u64, bool, Value),
}

pub(crate) struct RuntimeSidecar {
    control: SyncSender<Control>,
    exited: Receiver<Result<()>>,
}
impl RuntimeSidecar {
    pub(crate) fn start_bundled(app: &tauri::AppHandle, events: SyncSender<Value>) -> Result<Self> {
        use tauri::Manager;
        let resources = app.path().resource_dir().map_err(|_| "runtime_sidecar_missing")?;
        Self::start_from_resources(resources, events)
    }

    fn start_from_resources(resources: PathBuf, events: SyncSender<Value>) -> Result<Self> {
        let directory = resources.join("runtime-host");
        Self::start(directory.join("node.exe"), directory.join("runtime-host.cjs"), events)
    }

    /// Paths are selected by the native application, not supplied by a webview.
    pub(crate) fn start(node: PathBuf, entry: PathBuf, events: SyncSender<Value>) -> Result<Self> {
        let node = node_path(node)?;
        let entry = node_path(entry)?;
        if !node.is_absolute() || !entry.is_absolute() || !node.is_file() || !entry.is_file() {
            return Err("runtime_sidecar_missing");
        }
        let (control, commands) = mpsc::sync_channel(64);
        let (started, ready) = mpsc::sync_channel(1);
        let (finished, exited) = mpsc::sync_channel(1);
        thread::Builder::new().name("uagent-runtime-host".into()).spawn(move || {
            let result = supervise(node, entry, commands, events, started);
            let _ = finished.send(result);
        }).map_err(|_| "runtime_sidecar_thread_failed")?;
        ready.recv_timeout(Duration::from_secs(10)).map_err(|_| "runtime_sidecar_start_timeout")??;
        let host = Self { control, exited };
        let hello = host.request(HostCommand::Hello, json!({}), Duration::from_secs(10))?;
        if hello["protocolVersion"] != 1 || hello["engine"] != "RunCoordinator" {
            return Err("runtime_sidecar_protocol_mismatch");
        }
        Ok(host)
    }

    pub(crate) fn request(&self, command: HostCommand, input: Value, timeout: Duration) -> Result<Value> {
        let (reply, result) = mpsc::sync_channel(1);
        self.control.try_send(Control::Command(command, input, reply))
            .map_err(|_| "runtime_sidecar_unavailable")?;
        result.recv_timeout(timeout).map_err(|_| "runtime_sidecar_reply_unconfirmed")?
    }

    pub(crate) fn broker_reply(&self, id: u64, ok: bool, value: Value) -> Result<()> {
        self.control.try_send(Control::BrokerReply(id, ok, value))
            .map_err(|_| "runtime_sidecar_unavailable")
    }

    pub(crate) fn wait_for_exit(&self, timeout: Duration) -> Result<()> {
        self.exited.recv_timeout(timeout).map_err(|_| "runtime_sidecar_exit_unconfirmed")?
    }
}

fn node_path(path: PathBuf) -> Result<PathBuf> {
    // Rust canonicalize returns verbatim Windows paths; Node's CJS loader rejects
    // those entry/cwd spellings with EISDIR before reading the application script.
    let text = path.to_str().ok_or("runtime_sidecar_path_invalid")?;
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") { return Ok(PathBuf::from(format!(r"\\{rest}"))); }
    Ok(PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(text)))
}

fn frame(value: Value) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec(&value).map_err(|_| "runtime_sidecar_encode_failed")?;
    if bytes.len() as u64 > MAX_FRAME { return Err("runtime_sidecar_frame_too_large"); }
    bytes.push(b'\n');
    Ok(bytes)
}

fn supervise(node: PathBuf, entry: PathBuf, controls: Receiver<Control>, events: SyncSender<Value>,
    started: SyncSender<Result<()>>) -> Result<()> {
    use std::os::windows::process::CommandExt;
    let job = crate::ue_build_process::windows_job::OwnedJob::new()
        .map_err(|_| "runtime_sidecar_job_failed")?;
    // Start suspended: the child cannot run before it belongs to the parent's kill-on-close job.
    let mut child = Command::new(node).arg(&entry).current_dir(entry.parent().ok_or("runtime_sidecar_missing")?)
        // Node/OpenSSL needs SystemRoot to initialize the Windows random provider.
        // Inherit no credentials, Node loader flags or other parent environment values.
        .env_clear().env("SystemRoot", std::env::var_os("SystemRoot").ok_or("runtime_sidecar_system_root_missing")?)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .creation_flags(0x08000004).spawn().map_err(|_| "runtime_sidecar_start_failed")?;
    if job.assign(&child).and_then(|_| job.resume(&child)).is_err() {
        let _ = child.kill(); let _ = child.wait();
        return Err("runtime_sidecar_job_failed");
    }
    let mut stdin = child.stdin.take().ok_or("runtime_sidecar_stdin_missing")?;
    let stdout = child.stdout.take().ok_or("runtime_sidecar_stdout_missing")?;
    let (write, outgoing) = mpsc::sync_channel::<Vec<u8>>(64);
    let writer = thread::spawn(move || {
        while let Ok(bytes) = outgoing.recv() {
            if stdin.write_all(&bytes).and_then(|_| stdin.flush()).is_err() { break; }
        }
    });
    let (read, incoming) = mpsc::sync_channel::<Result<Value>>(64);
    let reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            let result = match reader.by_ref().take(MAX_FRAME + 1).read_line(&mut line) {
                Ok(0) => break,
                Ok(_) if line.len() as u64 <= MAX_FRAME && line.ends_with('\n') =>
                    serde_json::from_str(&line).map_err(|_| "runtime_sidecar_invalid_frame"),
                _ => Err("runtime_sidecar_invalid_frame"),
            };
            let failed = result.is_err();
            if read.send(result).is_err() || failed { break; }
        }
    });
    let _ = started.send(Ok(()));
    let mut sequence = 0u64;
    let mut pending = HashMap::<u64, SyncSender<Result<Value>>>::new();
    let mut stop_at = None;
    let mut pipe_closed = false;
    let result = (|| -> Result<()> {
        loop {
            if pipe_closed {
                if let Some(status) = child.try_wait().map_err(|_| "runtime_sidecar_wait_failed")? {
                    return if status.success() { Ok(()) } else { Err("runtime_sidecar_process_failed") };
                }
            }
            if stop_at.is_some_and(|deadline| Instant::now() >= deadline) {
                return Err("runtime_sidecar_shutdown_unconfirmed");
            }
            match controls.recv_timeout(Duration::from_millis(10)) {
                Ok(Control::Command(command, input, reply)) => {
                    sequence += 1;
                    let message = frame(json!({"kind":"command","id":sequence,"method":command.method(),"input":input}))?;
                    write.try_send(message).map_err(|_| "runtime_sidecar_write_unavailable")?;
                    pending.insert(sequence, reply);
                    if matches!(command, HostCommand::Shutdown) { stop_at = Some(Instant::now() + Duration::from_secs(30)); }
                }
                Ok(Control::BrokerReply(id, ok, value)) => {
                    write.try_send(frame(json!({"kind":"broker_reply","id":id,"ok":ok,"value":value}))?)
                        .map_err(|_| "runtime_sidecar_write_unavailable")?;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err("runtime_sidecar_owner_closed"),
                Err(mpsc::RecvTimeoutError::Timeout) => {},
            }
            loop {
                let value = match incoming.try_recv() {
                    Ok(value) => value,
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        pipe_closed = true;
                        stop_at.get_or_insert(Instant::now() + Duration::from_secs(1));
                        break;
                    }
                };
                let value = value?;
                match value["kind"].as_str() {
                    Some("reply") => {
                        let id = value["id"].as_u64().ok_or("runtime_sidecar_invalid_reply")?;
                        if let Some(reply) = pending.remove(&id) {
                            let result = match value["ok"].as_bool() {
                                Some(true) => Ok(value["value"].clone()),
                                Some(false) => Err("runtime_sidecar_command_rejected"),
                                None => return Err("runtime_sidecar_invalid_reply"),
                            };
                            let _ = reply.send(result);
                        }
                    }
                    Some("broker_request" | "broker_cancel" | "settled" | "run_error") =>
                        events.try_send(value).map_err(|_| "runtime_sidecar_broker_unavailable")?,
                    _ => return Err("runtime_sidecar_invalid_event"),
                }
            }
        }
    })();
    for (_, reply) in pending { let _ = reply.send(Err("runtime_sidecar_process_ended")); }
    // Drop/timeout never asserts that an external native operation has settled.
    let _ = job.terminate();
    drop(job);
    let _ = child.wait();
    drop(write);
    drop(incoming);
    let _ = writer.join();
    let _ = reader.join();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_node_resource_handshake_and_shutdown() {
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        assert!(resources.join("runtime-host/NODE-LICENSE.txt").is_file());
        let (events, _receiver) = mpsc::sync_channel(64);
        let host = RuntimeSidecar::start_from_resources(resources, events).unwrap();
        let result = host.request(HostCommand::Shutdown, json!({}), Duration::from_secs(2)).unwrap();
        assert_eq!(result["checkpointed"], true);
        host.wait_for_exit(Duration::from_secs(2)).unwrap();
    }

    #[test]
    fn managed_node_handshake_and_shutdown() {
        let node = PathBuf::from(std::env::var_os("UAGENT_RUNTIME_HOST_TEST_NODE")
            .expect("Set the test Node executable explicitly"));
        let entry = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../apps/runtime-host/dist/runtime-host.cjs").canonicalize().unwrap();
        let (events, _receiver) = mpsc::sync_channel(64);
        let host = RuntimeSidecar::start(node, entry, events).unwrap();
        assert!(host.request(HostCommand::Snapshot, json!({"runId":"missing"}), Duration::from_secs(2)).is_err());
        let result = host.request(HostCommand::Shutdown, json!({}), Duration::from_secs(2)).unwrap();
        assert_eq!(result["checkpointed"], true);
        host.wait_for_exit(Duration::from_secs(2)).unwrap();
    }
}
