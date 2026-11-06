//! Fixed-target, cancellable Windows Responses transport. WinHTTP performs TLS
//! certificate/hostname/chain validation; no ignored-certificate flags are used.
//! Async request-owned buffers live until HANDLE_CLOSING, including cancellation.
//! No cookies, automatic authentication, proxy lookup, redirects or auto replay.
#![cfg(windows)]
use crate::native_provider_transport::{
    CredentialBytes, DispatchSignal, RequestView, ResponseBuffer, Transport, TransportFailure,
    WriteReceipt, WriteStatus,
};
use std::{
    cell::UnsafeCell,
    ffi::c_void,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
        Arc,
    },
    time::{Duration, Instant},
};

const ENDPOINT: &str = "https://api.openai.com/v1/responses";
#[derive(Clone, Copy)]
enum FixedTarget {
    Responses,
    DeepSeek,
    Anthropic,
}
impl FixedTarget {
    fn endpoint(self) -> &'static str {
        match self {
            Self::Responses => ENDPOINT,
            Self::DeepSeek => "https://api.deepseek.com/chat/completions",
            Self::Anthropic => "https://api.anthropic.com/v1/messages",
        }
    }
    fn host(self) -> &'static str {
        match self {
            Self::Responses => "api.openai.com",
            Self::DeepSeek => "api.deepseek.com",
            Self::Anthropic => "api.anthropic.com",
        }
    }
    fn path(self) -> &'static str {
        match self {
            Self::Responses => "/v1/responses",
            Self::DeepSeek => "/chat/completions",
            Self::Anthropic => "/v1/messages",
        }
    }
}
const READ_BYTES: usize = 8192;
const MAX_REQUEST_BYTES: usize = 1_048_576;
const TOTAL_TIMEOUT: Duration = Duration::from_secs(120);
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const STATUS_HANDLE_CLOSING: u32 = 0x0000_0800;
const STATUS_SECURE_FAILURE: u32 = 0x0001_0000;
const STATUS_HEADERS_AVAILABLE: u32 = 0x0002_0000;
const STATUS_DATA_AVAILABLE: u32 = 0x0004_0000;
const STATUS_READ_COMPLETE: u32 = 0x0008_0000;
const STATUS_REQUEST_ERROR: u32 = 0x0020_0000;
const STATUS_SEND_COMPLETE: u32 = 0x0040_0000;
const CALLBACK_FLAGS: u32 = STATUS_HANDLE_CLOSING
    | STATUS_SECURE_FAILURE
    | STATUS_HEADERS_AVAILABLE
    | STATUS_DATA_AVAILABLE
    | STATUS_READ_COMPLETE
    | STATUS_REQUEST_ERROR
    | STATUS_SEND_COMPLETE;

type Internet = *mut c_void;
type Callback = unsafe extern "system" fn(Internet, usize, u32, *mut c_void, u32);

#[link(name = "winhttp")]
extern "system" {
    fn WinHttpOpen(
        agent: *const u16,
        access: u32,
        proxy: *const u16,
        bypass: *const u16,
        flags: u32,
    ) -> Internet;
    fn WinHttpConnect(session: Internet, server: *const u16, port: u16, reserved: u32) -> Internet;
    fn WinHttpOpenRequest(
        connection: Internet,
        verb: *const u16,
        path: *const u16,
        version: *const u16,
        referer: *const u16,
        accept: *const *const u16,
        flags: u32,
    ) -> Internet;
    fn WinHttpCloseHandle(handle: Internet) -> i32;
    fn WinHttpSetOption(handle: Internet, option: u32, buffer: *const c_void, len: u32) -> i32;
    fn WinHttpSetTimeouts(
        handle: Internet,
        resolve: i32,
        connect: i32,
        send: i32,
        receive: i32,
    ) -> i32;
    fn WinHttpSetStatusCallback(
        handle: Internet,
        callback: Option<Callback>,
        flags: u32,
        reserved: usize,
    ) -> isize;
    fn WinHttpSendRequest(
        handle: Internet,
        headers: *const u16,
        header_len: u32,
        body: *const c_void,
        body_len: u32,
        total_len: u32,
        context: usize,
    ) -> i32;
    fn WinHttpReceiveResponse(handle: Internet, reserved: *mut c_void) -> i32;
    fn WinHttpQueryHeaders(
        handle: Internet,
        info: u32,
        name: *const u16,
        buffer: *mut c_void,
        len: *mut u32,
        index: *mut u32,
    ) -> i32;
    fn WinHttpQueryDataAvailable(handle: Internet, available: *mut u32) -> i32;
    fn WinHttpReadData(handle: Internet, buffer: *mut c_void, len: u32, read: *mut u32) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn GetLastError() -> u32;
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn fail(write: WriteStatus) -> TransportFailure {
    // OS errors, response bodies and headers are deliberately not formatted.
    TransportFailure::new(write, "native_https_transport_failed".into())
}
fn started(result: i32) -> bool {
    result != 0 || unsafe { GetLastError() } == 997 // ERROR_IO_PENDING
}
struct Handle(Internet);
impl Handle {
    fn checked(value: Internet) -> Result<Self, TransportFailure> {
        if value.is_null() {
            Err(fail(WriteStatus::MayHaveWritten))
        } else {
            Ok(Self(value))
        }
    }
    fn option<T>(&self, name: u32, value: &T) -> Result<(), TransportFailure> {
        let okay = unsafe {
            WinHttpSetOption(
                self.0,
                name,
                (value as *const T).cast(),
                std::mem::size_of::<T>() as u32,
            )
        };
        if okay == 0 {
            Err(fail(WriteStatus::MayHaveWritten))
        } else {
            Ok(())
        }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                WinHttpCloseHandle(self.0);
            }
        }
    }
}
enum Event {
    Sent,
    Headers,
    Available(u32),
    Read(Vec<u8>),
    Failed,
}
struct Context {
    sender: SyncSender<Event>,
    invalid: AtomicBool,
    // WinHTTP may still reference these after cancellation returns.
    body: Vec<u8>,
    read: UnsafeCell<[u8; READ_BYTES]>,
}
// Only one ReadData is outstanding. Worker never touches the buffer while it is
// pending; READ_COMPLETE copies it before publishing the completion. Allocation
// and body are immutable and kept alive through HANDLE_CLOSING.
unsafe impl Sync for Context {}

unsafe extern "system" fn status_callback(
    _: Internet,
    context: usize,
    status: u32,
    information: *mut c_void,
    information_len: u32,
) {
    if context == 0 {
        return;
    }
    let raw = context as *const Context;
    // The request owns one raw Arc ref until its LAST (closing) callback.
    Arc::increment_strong_count(raw);
    let state = Arc::from_raw(raw);
    if status == STATUS_HANDLE_CLOSING {
        drop(Arc::from_raw(raw));
        return;
    }
    let event = match status {
        STATUS_SEND_COMPLETE => Event::Sent,
        STATUS_HEADERS_AVAILABLE => Event::Headers,
        STATUS_REQUEST_ERROR | STATUS_SECURE_FAILURE => Event::Failed,
        STATUS_DATA_AVAILABLE => {
            if information.is_null() || information_len != std::mem::size_of::<u32>() as u32 {
                state.invalid.store(true, Ordering::Release);
                Event::Failed
            } else {
                Event::Available(ptr::read_unaligned(information.cast::<u32>()))
            }
        }
        STATUS_READ_COMPLETE => {
            let length = information_len as usize;
            if length > READ_BYTES || (length > 0 && information != state.read.get().cast()) {
                state.invalid.store(true, Ordering::Release);
                Event::Failed
            } else if length == 0 {
                Event::Read(Vec::new())
            } else {
                Event::Read(std::slice::from_raw_parts(information.cast::<u8>(), length).to_vec())
            }
        }
        _ => return,
    };
    // Never block/re-enter WinHTTP from the callback. Only one operation is
    // pending; queue overflow means protocol/state failure, not silent dropping.
    if state.sender.try_send(event).is_err() {
        state.invalid.store(true, Ordering::Release);
    }
}
struct RequestHandle {
    handle: Handle,
    context: Arc<Context>,
}
impl RequestHandle {
    fn new(handle: Handle, body: &[u8]) -> Result<(Self, Receiver<Event>), TransportFailure> {
        let (sender, receiver) = mpsc::sync_channel(4);
        let context = Arc::new(Context {
            sender,
            invalid: AtomicBool::new(false),
            body: body.to_vec(),
            read: UnsafeCell::new([0; READ_BYTES]),
        });
        let raw = Arc::into_raw(context.clone()) as usize;
        let result = Self { handle, context };
        // No request was sent and no callback is installed on failure here.
        if result.handle.option(45, &raw).is_err() {
            unsafe {
                drop(Arc::from_raw(raw as *const Context));
            }
            return Err(fail(WriteStatus::MayHaveWritten));
        }
        let previous = unsafe {
            WinHttpSetStatusCallback(result.handle.0, Some(status_callback), CALLBACK_FLAGS, 0)
        };
        if previous == -1 {
            unsafe {
                drop(Arc::from_raw(raw as *const Context));
            }
            return Err(fail(WriteStatus::MayHaveWritten));
        }
        Ok((result, receiver))
    }
}
impl Drop for RequestHandle {
    fn drop(&mut self) {
        // No other thread calls WinHTTP on this handle. On cancellation this is
        // an ASYNC request: CloseHandle cancels it; callbacks may still run.
        // The raw Arc keeps all buffers valid until HANDLE_CLOSING. If the OS
        // cannot close a corrupted handle, retaining that ref is safer than UAF.
        if !self.handle.0.is_null() {
            unsafe {
                WinHttpCloseHandle(self.handle.0);
            }
            self.handle.0 = ptr::null_mut();
        }
    }
}
struct Authorization(Vec<u16>);
impl Drop for Authorization {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

/// Receives bounded untrusted response bytes. The protocol parser must validate
/// them before any content/tool call is delivered. A sink failure aborts, and no
/// final response is returned by the preparation core after revocation.
pub(crate) type ChunkSink = Arc<dyn Fn(&[u8]) -> Result<(), ()> + Send + Sync>;
pub(crate) type HeadSink = Arc<dyn Fn(u16, &str) -> Result<(), ()> + Send + Sync>;
pub(crate) struct WinHttpResponsesTransport {
    target: FixedTarget,
    sink: Option<ChunkSink>,
    head_sink: Option<HeadSink>,
    #[cfg(test)]
    fixture_port: Option<u16>,
}
impl WinHttpResponsesTransport {
    pub(crate) fn new() -> Self {
        Self {
            target: FixedTarget::Responses,
            sink: None,
            head_sink: None,
            #[cfg(test)]
            fixture_port: None,
        }
    }
    pub(crate) fn with_chunk_sink(sink: ChunkSink) -> Self {
        Self {
            target: FixedTarget::Responses,
            sink: Some(sink),
            head_sink: None,
            #[cfg(test)]
            fixture_port: None,
        }
    }
    pub(crate) fn deepseek(sink: ChunkSink) -> Self {
        let mut transport = Self::with_chunk_sink(sink);
        transport.target = FixedTarget::DeepSeek;
        transport
    }
    pub(crate) fn anthropic(sink: ChunkSink) -> Self {
        let mut transport = Self::with_chunk_sink(sink);
        transport.target = FixedTarget::Anthropic;
        transport
    }
    pub(crate) fn with_head_sink(mut self, sink: HeadSink) -> Self {
        self.head_sink = Some(sink);
        self
    }
    #[cfg(test)]
    fn fixture(port: u16, sink: Option<ChunkSink>) -> Self {
        Self {
            target: FixedTarget::Responses,
            sink,
            head_sink: None,
            fixture_port: Some(port),
        }
    }
    fn wait(
        receiver: &Receiver<Event>,
        context: &Context,
        signal: &DispatchSignal<'_>,
        deadline: Instant,
        write: WriteStatus,
    ) -> Result<Event, TransportFailure> {
        loop {
            if signal.is_cancelled()
                || Instant::now() >= deadline
                || context.invalid.load(Ordering::Acquire)
            {
                return Err(fail(write));
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(POLL_INTERVAL.min(remaining)) {
                Ok(Event::Failed) => return Err(fail(write)),
                Ok(event) => {
                    if signal.is_cancelled() || Instant::now() >= deadline {
                        return Err(fail(write));
                    }
                    return Ok(event);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return Err(fail(write)),
            }
        }
    }
    fn check_request(&self, request: RequestView<'_>) -> Result<(), TransportFailure> {
        if request.endpoint != self.target.endpoint()
            || request.body.is_empty()
            || request.body.len() > MAX_REQUEST_BYTES
            || std::str::from_utf8(request.body).is_err()
        {
            return Err(fail(WriteStatus::MayHaveWritten));
        }
        Ok(())
    }
}
impl Transport for WinHttpResponsesTransport {
    fn before_dispatch(&mut self, request: RequestView<'_>) -> Result<(), TransportFailure> {
        // Parsing/bounds only: not even a WinHTTP session or socket is opened.
        self.check_request(request)
    }
    fn dispatch(
        &mut self,
        request: RequestView<'_>,
        credential: CredentialBytes<'_>,
        signal: DispatchSignal<'_>,
        response: &mut ResponseBuffer,
    ) -> Result<WriteReceipt, TransportFailure> {
        self.check_request(request)?;
        if credential.bytes().is_empty()
            || credential.bytes().len() > 16_384
            || credential
                .bytes()
                .iter()
                .any(|b| !(0x21..=0x7e).contains(b))
            || signal.is_cancelled()
        {
            return Err(fail(WriteStatus::MayHaveWritten));
        }
        let deadline = Instant::now() + TOTAL_TIMEOUT;
        let agent = wide("UAgent/0.0.1");
        // NO_PROXY deliberately avoids proxy auto-discovery and local identity.
        let session = Handle::checked(unsafe {
            WinHttpOpen(agent.as_ptr(), 1, ptr::null(), ptr::null(), 0x1000_0000)
        })?;
        // TLS 1.2/1.3 only. Certificate/hostname/chain verification stays on.
        session.option(84, &0x0000_2800u32)?;
        session.option(4, &0u32)?; // No automatic connection retries.
        if unsafe { WinHttpSetTimeouts(session.0, 10_000, 10_000, 30_000, 30_000) } == 0 {
            return Err(fail(WriteStatus::MayHaveWritten));
        }
        let (host, port, secure) = (self.target.host(), 443, true);
        #[cfg(test)]
        let (host, port, secure) = match self.fixture_port {
            Some(port) => ("127.0.0.1", port, false),
            None => (host, port, secure),
        };
        let host = wide(host);
        let connection =
            Handle::checked(unsafe { WinHttpConnect(session.0, host.as_ptr(), port, 0) })?;
        let method = wide("POST");
        let path = wide(self.target.path());
        let opened = Handle::checked(unsafe {
            WinHttpOpenRequest(
                connection.0,
                method.as_ptr(),
                path.as_ptr(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                if secure { 0x0080_0000 } else { 0 },
            )
        })?;
        // Disable cookies, redirect following, integrated/automatic credentials.
        opened.option(63, &7u32)?;
        opened.option(77, &2u32)?; // Never default logon credentials.
        opened.option(88, &0u32)?; // Never follow Location.
        if secure {
            opened.option(79, &1u32)?;
        } // Certificate revocation check.
        let (request_handle, receiver) = RequestHandle::new(opened, request.body)?;
        // Avoid an intermediate formatted String containing the credential.
        let mut header_units = wide(match self.target {
            FixedTarget::Anthropic => "Content-Type: application/json\r\nAccept: text/event-stream, application/json\r\nanthropic-version: 2023-06-01\r\nx-api-key: ",
            _ => "Content-Type: application/json\r\nAccept: text/event-stream, application/json\r\nAuthorization: Bearer ",
        });
        header_units.pop();
        header_units.extend(credential.bytes().iter().map(|byte| u16::from(*byte)));
        header_units.extend(wide("\r\nCache-Control: no-store\r\n"));
        let headers = Authorization(header_units);
        if signal.is_cancelled() || Instant::now() >= deadline {
            return Err(fail(WriteStatus::MayHaveWritten));
        }
        let body = &request_handle.context.body;
        let result = unsafe {
            WinHttpSendRequest(
                request_handle.handle.0,
                headers.0.as_ptr(),
                (headers.0.len() - 1) as u32,
                body.as_ptr().cast(),
                body.len() as u32,
                body.len() as u32,
                Arc::as_ptr(&request_handle.context) as usize,
            )
        };
        if !started(result) {
            return Err(fail(WriteStatus::MayHaveWritten));
        }
        match Self::wait(
            &receiver,
            &request_handle.context,
            &signal,
            deadline,
            WriteStatus::MayHaveWritten,
        )? {
            Event::Sent => {}
            _ => return Err(fail(WriteStatus::MayHaveWritten)),
        }
        let write = WriteStatus::Complete;
        if signal.is_cancelled() {
            return Err(fail(write));
        }
        if !started(unsafe { WinHttpReceiveResponse(request_handle.handle.0, ptr::null_mut()) }) {
            return Err(fail(write));
        }
        match Self::wait(&receiver, &request_handle.context, &signal, deadline, write)? {
            Event::Headers => {}
            _ => return Err(fail(write)),
        }
        let mut status = 0u32;
        let mut length = std::mem::size_of::<u32>() as u32;
        let queried = unsafe {
            WinHttpQueryHeaders(
                request_handle.handle.0,
                19 | 0x2000_0000,
                ptr::null(),
                (&mut status as *mut u32).cast(),
                &mut length,
                ptr::null_mut(),
            )
        };
        // Failure bodies, including credential echoes, are never forwarded.
        if queried == 0 {
            return Err(fail(write));
        }
        if status != 200 {
            // Disclose only a numeric rejection status and our own MIME value.
            // Never read or forward error bodies, headers, auth challenges or redirects.
            if (400..=599).contains(&status) && !signal.is_cancelled() {
                if let Some(sink) = &self.head_sink {
                    sink(status as u16, "application/json").map_err(|_| fail(write))?;
                }
            }
            return Err(fail(write));
        }
        // Only this bounded, normalized protocol header is disclosed. Never pass
        // arbitrary response headers, cookies or authentication challenges to IPC.
        let mut content_type = [0u16; 128];
        let mut header_length = std::mem::size_of_val(&content_type) as u32;
        let queried = unsafe {
            WinHttpQueryHeaders(
                request_handle.handle.0,
                1,
                ptr::null(),
                content_type.as_mut_ptr().cast(),
                &mut header_length,
                ptr::null_mut(),
            )
        };
        if queried == 0 || header_length as usize > std::mem::size_of_val(&content_type) {
            return Err(fail(write));
        }
        let end = content_type
            .iter()
            .position(|value| *value == 0)
            .ok_or_else(|| fail(write))?;
        let header = String::from_utf16(&content_type[..end]).map_err(|_| fail(write))?;
        let mime = header.split(';').next().unwrap_or("").trim();
        let mime = if mime.eq_ignore_ascii_case("text/event-stream") {
            "text/event-stream"
        } else if mime.eq_ignore_ascii_case("application/json") {
            "application/json"
        } else {
            return Err(fail(write));
        };
        if signal.is_cancelled() {
            return Err(fail(write));
        }
        if let Some(sink) = &self.head_sink {
            sink(status as u16, mime).map_err(|_| fail(write))?;
        }
        loop {
            if signal.is_cancelled() || Instant::now() >= deadline {
                return Err(fail(write));
            }
            // Asking for an 8KiB read directly can hold small SSE deltas until
            // the buffer fills. Query current availability, then read that exact
            // bounded amount so each available delta can flow immediately.
            if !started(unsafe {
                WinHttpQueryDataAvailable(request_handle.handle.0, ptr::null_mut())
            }) {
                return Err(fail(write));
            }
            let available =
                match Self::wait(&receiver, &request_handle.context, &signal, deadline, write)? {
                    Event::Available(0) => break,
                    Event::Available(size) => (size as usize).min(READ_BYTES) as u32,
                    _ => return Err(fail(write)),
                };
            let read_started = unsafe {
                WinHttpReadData(
                    request_handle.handle.0,
                    request_handle.context.read.get().cast(),
                    available,
                    ptr::null_mut(),
                )
            };
            if !started(read_started) {
                return Err(fail(write));
            }
            match Self::wait(&receiver, &request_handle.context, &signal, deadline, write)? {
                Event::Read(bytes) if bytes.is_empty() => break,
                Event::Read(bytes) => {
                    response.push(&bytes).map_err(|_| fail(write))?;
                    if signal.is_cancelled() {
                        return Err(fail(write));
                    }
                    if let Some(sink) = &self.sink {
                        sink(&bytes).map_err(|_| fail(write))?;
                    }
                    if signal.is_cancelled() {
                        return Err(fail(write));
                    }
                }
                _ => return Err(fail(write)),
            }
        }
        Ok(WriteReceipt { write })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_provider_transport::{
        ConfigVersion, DispatchStatus, FailureCode, MonotonicClock, NativeSession, Owner,
        SourceCheckFailure, SourceChecker, SourcePhase, SourceSnapshot,
    };
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::Mutex,
        thread,
    };
    const KEY: &[u8] = b"synthetic-winhttp-fixture-key-only";
    const BODY: &[u8] =
        "{\"model\":\"fixture-model\",\"stream\":true,\"input\":\"中文\"}".as_bytes();
    struct Source;
    impl SourceChecker for Source {
        fn check(
            &self,
            captured: &SourceSnapshot,
            _: SourcePhase,
        ) -> Result<SourceSnapshot, SourceCheckFailure> {
            Ok(captured.clone())
        }
    }
    fn setup() -> NativeSession {
        let session = NativeSession::new(
            Owner {
                project: "p".into(),
                epoch: 1,
                run: "r".into(),
                conversation: "c".into(),
                provider: "provider".into(),
                model: "fixture-model".into(),
            },
            ConfigVersion {
                generation: "g".into(),
                revision: 1,
            },
            [1; 32],
            Arc::new(MonotonicClock::new()),
        );
        session.install_credential(KEY.to_vec(), 60_000).unwrap();
        session
    }
    fn receive(stream: &mut TcpStream) -> Vec<u8> {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut block = [0; 4096];
        loop {
            let count = stream.read(&mut block).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&block[..count]);
            if let Some(header_end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = std::str::from_utf8(&bytes[..header_end]).unwrap();
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                if bytes.len() >= header_end + 4 + length {
                    return bytes;
                }
            }
        }
    }
    fn perform(
        session: &NativeSession,
        engine: &mut WinHttpResponsesTransport,
    ) -> crate::native_provider_transport::DispatchOutcome {
        let lease = session.capture_lease(30_000).unwrap();
        let prepared = session
            .prepare(&lease, "https://api.openai.com/v1", BODY.to_vec(), &Source)
            .unwrap();
        let approved = session.approve(&prepared, &lease, &Source).unwrap();
        session.dispatch(&prepared, &lease, &approved, &Source, engine)
    }
    #[test]
    fn real_winhttp_loopback_preserves_exact_body_and_streams_bounded_bytes() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let expected = b"event: response.output_text.delta\ndata: {\"delta\":\"hi\"}\n\nevent: response.completed\ndata: {}\n\n";
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let received = receive(&mut stream);
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",expected.len()).unwrap();
            stream.write_all(&expected[..50]).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(70));
            stream.write_all(&expected[50..]).unwrap();
            received
        });
        let chunks = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let observed = chunks.clone();
        let sink: ChunkSink = Arc::new(move |bytes| {
            observed.lock().unwrap().push(bytes.to_vec());
            Ok(())
        });
        let heads = Arc::new(Mutex::new(Vec::new()));
        let header_output = heads.clone();
        let head_sink: HeadSink = Arc::new(move |status, mime| {
            header_output
                .lock()
                .unwrap()
                .push((status, mime.to_owned()));
            Ok(())
        });
        let result = perform(
            &setup(),
            &mut WinHttpResponsesTransport::fixture(port, Some(sink)).with_head_sink(head_sink),
        );
        assert_eq!(
            &*heads.lock().unwrap(),
            &[(200, "text/event-stream".to_owned())]
        );
        assert_eq!(result.status, DispatchStatus::Sent);
        assert_eq!(result.error, None);
        assert_eq!(result.response.unwrap().bytes(), expected);
        let chunks = chunks.lock().unwrap();
        assert!(chunks.len() >= 2);
        assert_eq!(chunks.concat(), expected);
        let received = server.join().unwrap();
        let header_end = received.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        assert_eq!(&received[header_end + 4..], BODY);
        let headers = String::from_utf8(received[..header_end].to_vec()).unwrap();
        assert!(headers.starts_with("POST /v1/responses HTTP/1.1"));
        assert!(headers.contains("Authorization: Bearer synthetic-winhttp-fixture-key-only"));
        assert!(!headers.to_ascii_lowercase().contains("cookie:"));
    }
    #[test]
    fn cancellation_while_headers_pending_is_bounded_and_not_unsent() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (ready_tx, ready_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            receive(&mut stream);
            ready_tx.send(()).unwrap();
            thread::sleep(Duration::from_millis(300));
        });
        let session = setup();
        let revoke = session.clone();
        let cancelling = thread::spawn(move || {
            ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            revoke.revoke_all().unwrap();
        });
        let start = Instant::now();
        let result = perform(
            &session,
            &mut WinHttpResponsesTransport::fixture(port, None),
        );
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_ne!(result.status, DispatchStatus::NotDispatched);
        assert_eq!(result.error, Some(FailureCode::IdentityChanged));
        assert!(result.response.is_none());
        cancelling.join().unwrap();
        server.join().unwrap();
    }
    #[test]
    fn in_flight_source_change_discards_final_reply_and_stops_chunks() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            receive(&mut stream);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 100\r\nConnection: close\r\n\r\nfirst",
                )
                .unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(150));
            let _ = stream.write_all(b"should-not-be-delivered");
        });
        let session = setup();
        let source = session.source_authority();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let output = seen.clone();
        let sink: ChunkSink = Arc::new(move |bytes| {
            output.lock().unwrap().extend_from_slice(bytes);
            source.advance([2; 32]).unwrap();
            Ok(())
        });
        let result = perform(
            &session,
            &mut WinHttpResponsesTransport::fixture(port, Some(sink)),
        );
        assert_eq!(result.status, DispatchStatus::Sent);
        assert!(result.error.is_some());
        assert!(result.response.is_none());
        assert_eq!(&*seen.lock().unwrap(), b"first");
        server.join().unwrap();
    }
    #[test]
    fn rejection_status_is_numeric_only_and_never_forwards_body_or_headers() {
        for status in [400, 401, 403, 429, 503] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                receive(&mut stream);
                write!(stream,"HTTP/1.1 {status} Rejected\r\nContent-Type: text/html\r\nX-Secret: {}\r\nWWW-Authenticate: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",String::from_utf8_lossy(KEY),String::from_utf8_lossy(KEY),KEY.len(),String::from_utf8_lossy(KEY)).unwrap();
            });
            let chunks = Arc::new(Mutex::new(Vec::new()));
            let observed = chunks.clone();
            let sink: ChunkSink = Arc::new(move |bytes| {
                observed.lock().unwrap().extend_from_slice(bytes);
                Ok(())
            });
            let heads = Arc::new(Mutex::new(Vec::new()));
            let observed = heads.clone();
            let head: HeadSink = Arc::new(move |code, mime| {
                observed.lock().unwrap().push((code, mime.to_string()));
                Ok(())
            });
            let result = perform(
                &setup(),
                &mut WinHttpResponsesTransport::fixture(port, Some(sink)).with_head_sink(head),
            );
            assert_eq!(result.status, DispatchStatus::Sent);
            assert_eq!(result.error, Some(FailureCode::TransportFailed));
            assert!(result.response.is_none());
            assert!(chunks.lock().unwrap().is_empty());
            assert_eq!(
                &*heads.lock().unwrap(),
                &[(status as u16, "application/json".to_owned())]
            );
            server.join().unwrap();
        }
    }
    #[test]
    fn redirects_are_not_followed_and_error_body_is_not_streamed() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let redirected = TcpListener::bind("127.0.0.1:0").unwrap();
        let target = redirected.local_addr().unwrap().port();
        redirected.set_nonblocking(true).unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            receive(&mut stream);
            write!(stream,"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{target}/stolen\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",KEY.len(),String::from_utf8_lossy(KEY)).unwrap();
        });
        let seen = Arc::new(Mutex::new(Vec::new()));
        let output = seen.clone();
        let sink: ChunkSink = Arc::new(move |bytes| {
            output.lock().unwrap().extend_from_slice(bytes);
            Ok(())
        });
        let result = perform(
            &setup(),
            &mut WinHttpResponsesTransport::fixture(port, Some(sink)),
        );
        assert_eq!(result.status, DispatchStatus::Sent);
        assert_eq!(result.error, Some(FailureCode::TransportFailed));
        assert!(result.response.is_none());
        assert!(seen.lock().unwrap().is_empty());
        server.join().unwrap();
        assert!(matches!(redirected.accept(),Err(e) if e.kind()==std::io::ErrorKind::WouldBlock));
    }
    #[test]
    fn cancelled_lease_does_not_open_a_loopback_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let session = setup();
        let lease = session.capture_lease(30_000).unwrap();
        let prepared = session
            .prepare(&lease, "https://api.openai.com/v1", BODY.to_vec(), &Source)
            .unwrap();
        let approved = session.approve(&prepared, &lease, &Source).unwrap();
        lease.revoke().unwrap();
        let result = session.dispatch(
            &prepared,
            &lease,
            &approved,
            &Source,
            &mut WinHttpResponsesTransport::fixture(port, None),
        );
        assert_eq!(result.status, DispatchStatus::NotDispatched);
        assert!(result.response.is_none());
        assert!(matches!(listener.accept(),Err(e) if e.kind()==std::io::ErrorKind::WouldBlock));
    }
    #[test]
    fn sink_failure_aborts_without_returning_a_successful_reply() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            receive(&mut stream);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntext")
                .unwrap();
        });
        let sink: ChunkSink = Arc::new(|_| Err(()));
        let result = perform(
            &setup(),
            &mut WinHttpResponsesTransport::fixture(port, Some(sink)),
        );
        assert_eq!(result.status, DispatchStatus::Sent);
        assert_eq!(result.error, Some(FailureCode::TransportFailed));
        assert!(result.response.is_none());
        server.join().unwrap();
    }

    #[test]
    fn invalid_or_missing_content_type_never_reaches_header_or_body_sinks() {
        for mime in [Some("text/html"), None] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                receive(&mut stream);
                let header = mime
                    .map(|value| format!("Content-Type: {value}\r\n"))
                    .unwrap_or_default();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\n{header}Content-Length: 4\r\nConnection: close\r\n\r\ntext"
                )
                .unwrap();
            });
            let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let body_count = count.clone();
            let head_count = count.clone();
            let sink: ChunkSink = Arc::new(move |_| {
                body_count.fetch_add(1, Ordering::Relaxed);
                Ok(())
            });
            let head: HeadSink = Arc::new(move |_, _| {
                head_count.fetch_add(1, Ordering::Relaxed);
                Ok(())
            });
            let result = perform(
                &setup(),
                &mut WinHttpResponsesTransport::fixture(port, Some(sink)).with_head_sink(head),
            );
            assert_eq!(result.status, DispatchStatus::Sent);
            assert_eq!(result.error, Some(FailureCode::TransportFailed));
            assert!(result.response.is_none());
            assert_eq!(count.load(Ordering::Relaxed), 0);
            server.join().unwrap();
        }
    }
    #[test]
    fn revocation_in_header_sink_prevents_all_body_delivery() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            receive(&mut stream);
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntext").unwrap();
        });
        let session = setup();
        let source = session.source_authority();
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = count.clone();
        let sink: ChunkSink = Arc::new(move |_| {
            observed.fetch_add(1, Ordering::Relaxed);
            Ok(())
        });
        let head: HeadSink = Arc::new(move |status, mime| {
            assert_eq!(status, 200);
            assert_eq!(mime, "application/json");
            source.advance([3; 32]).unwrap();
            Ok(())
        });
        let result = perform(
            &session,
            &mut WinHttpResponsesTransport::fixture(port, Some(sink)).with_head_sink(head),
        );
        assert_eq!(result.status, DispatchStatus::Sent);
        assert_eq!(result.error, Some(FailureCode::SourceChanged));
        assert!(result.response.is_none());
        assert_eq!(count.load(Ordering::Relaxed), 0);
        server.join().unwrap();
    }

    #[test]
    fn real_winhttp_deepseek_loopback_uses_fixed_chat_path_and_exact_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let expected = b"data: {\"choices\":[{\"delta\":{\"content\":\"local\"}}]}\n\n";
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let received = receive(&mut stream);
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",expected.len()).unwrap();
            stream.write_all(expected).unwrap();
            received
        });
        let session = setup();
        let lease = session.capture_lease(30_000).unwrap();
        let body=b"{\"model\":\"fixture-model\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"local synthetic goal\"}]}";
        let prepared = session
            .prepare_chat_completions(&lease, "https://api.deepseek.com", body.to_vec(), &Source)
            .unwrap();
        let approved = session.approve(&prepared, &lease, &Source).unwrap();
        let mut engine = WinHttpResponsesTransport::fixture(port, None);
        engine.target = FixedTarget::DeepSeek;
        let result = session.dispatch(&prepared, &lease, &approved, &Source, &mut engine);
        assert_eq!(result.status, DispatchStatus::Sent);
        assert_eq!(result.error, None);
        assert_eq!(result.response.unwrap().bytes(), expected);
        let received = server.join().unwrap();
        let end = received.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        assert_eq!(&received[end + 4..], body);
        let headers = String::from_utf8(received[..end].to_vec()).unwrap();
        assert!(headers.starts_with("POST /chat/completions HTTP/1.1"));
        assert!(headers.contains("Authorization: Bearer synthetic-winhttp-fixture-key-only"));
        assert!(!headers.to_ascii_lowercase().contains("cookie:"));
    }

    #[test]
    fn real_winhttp_anthropic_loopback_uses_messages_headers_and_exact_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let expected = b"data: {\"choices\":[{\"delta\":{\"content\":\"local\"}}]}\n\n";
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let received = receive(&mut stream);
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",expected.len()).unwrap();
            stream.write_all(expected).unwrap();
            received
        });
        let session = setup();
        let lease = session.capture_lease(30_000).unwrap();
        let body=b"{\"model\":\"fixture-model\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"local synthetic goal\"}]}";
        let prepared = session
            .prepare_anthropic(&lease, "https://api.anthropic.com/v1", body.to_vec(), &Source)
            .unwrap();
        let approved = session.approve(&prepared, &lease, &Source).unwrap();
        let mut engine = WinHttpResponsesTransport::fixture(port, None);
        engine.target = FixedTarget::Anthropic;
        let result = session.dispatch(&prepared, &lease, &approved, &Source, &mut engine);
        assert_eq!(result.status, DispatchStatus::Sent);
        assert_eq!(result.error, None);
        assert_eq!(result.response.unwrap().bytes(), expected);
        let received = server.join().unwrap();
        let end = received.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        assert_eq!(&received[end + 4..], body);
        let headers = String::from_utf8(received[..end].to_vec()).unwrap();
        assert!(headers.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(headers.contains("x-api-key: synthetic-winhttp-fixture-key-only"));
        assert!(headers.contains("anthropic-version: 2023-06-01"));
        assert!(!headers.to_ascii_lowercase().contains("authorization:"));
        assert!(!headers.to_ascii_lowercase().contains("cookie:"));
    }

    #[test]
    fn preflight_rejects_any_noncanonical_endpoint_without_network() {
        let owner = Owner {
            project: "p".into(),
            epoch: 1,
            run: "r".into(),
            conversation: "c".into(),
            provider: "p".into(),
            model: "m".into(),
        };
        for endpoint in [
            "http://127.0.0.1:3/v1/responses",
            "https://api.openai.com.evil.invalid/v1/responses",
            "https://api.openai.com/v1/responses?x=1",
        ] {
            let request = RequestView {
                endpoint,
                model: "m",
                owner: &owner,
                body: BODY,
            };
            assert!(WinHttpResponsesTransport::new()
                .before_dispatch(request)
                .is_err());
        }
    }
}
