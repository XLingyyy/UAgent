#[cfg(windows)]
mod windows {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc::{self, Receiver, Sender},
            Arc, Mutex, MutexGuard,
        },
        thread::{self, ThreadId},
        time::{Duration, Instant},
    };

    use tauri::{Manager, RunEvent, WindowEvent};

    const MAIN_LABEL: &str = "main";
    const TEST_TIMEOUT: Duration = Duration::from_secs(30);

    const INITIAL_TITLE: &str = "uagent-ordering-initial";
    const ILLEGAL_TITLE: &str = "uagent-ordering-illegal-same-task";
    const SUCCESSOR_TITLE: &str = "uagent-ordering-successor";
    const REPLACEMENT_PREDECESSOR_TITLE: &str = "uagent-ordering-replacement-predecessor";
    const REPLACEMENT_TITLE: &str = "uagent-ordering-replacement";

    type TestAppHandle = tauri::AppHandle<tauri::Wry>;
    type TestWindow = tauri::WebviewWindow<tauri::Wry>;
    type Shared = Arc<Mutex<Observations>>;

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct WindowIdentity {
        title: String,
        hwnd: isize,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Phase {
        Booting,
        AwaitingInitialDestroyed,
        AwaitingSuccessorDestroyed,
        AwaitingReplacementPredecessorDestroyed,
        AwaitingReplacementContinuation,
        AwaitingReplacementDestroyed,
        Complete,
        Failed,
    }

    #[derive(Debug)]
    struct Observations {
        phase: Phase,
        failure: Option<String>,
        events: Vec<&'static str>,
        worker_was_off_main: bool,
        initial_hwnd: Option<isize>,
        successor_hwnd: Option<isize>,
        manager_retained_after_destroy_call: bool,
        legacy_same_task_label_exists: bool,
        initial_listener_saw_manager_removed: bool,
        initial_listener_build_count: Option<usize>,
        successor_build_count: usize,
        successor_listener_saw_manager_removed: bool,
        replacement_callback_saw_manager_removed: bool,
        replacement_identity: Option<WindowIdentity>,
        replacement_listener_saw_replacement: bool,
        third_window_build_count: usize,
        queued_continuation_preserved_replacement: bool,
        replacement_listener_saw_manager_removed: bool,
    }

    impl Default for Observations {
        fn default() -> Self {
            Self {
                phase: Phase::Booting,
                failure: None,
                events: Vec::new(),
                worker_was_off_main: false,
                initial_hwnd: None,
                successor_hwnd: None,
                manager_retained_after_destroy_call: false,
                legacy_same_task_label_exists: false,
                initial_listener_saw_manager_removed: false,
                initial_listener_build_count: None,
                successor_build_count: 0,
                successor_listener_saw_manager_removed: false,
                replacement_callback_saw_manager_removed: false,
                replacement_identity: None,
                replacement_listener_saw_replacement: false,
                third_window_build_count: 0,
                queued_continuation_preserved_replacement: false,
                replacement_listener_saw_manager_removed: false,
            }
        }
    }

    #[derive(Debug)]
    struct ListenerSnapshot {
        manager: Result<Option<WindowIdentity>, String>,
        build_count: usize,
    }

    #[derive(Debug)]
    enum Signal {
        InitialDestroyed(ListenerSnapshot),
        SuccessorDestroyed(ListenerSnapshot),
        ReplacementPredecessorDestroyed(ListenerSnapshot),
        ReplacementDestroyed(ListenerSnapshot),
        Failure(String),
    }

    fn lock_state(state: &Shared) -> MutexGuard<'_, Observations> {
        state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn record_failure(state: &Shared, error: impl Into<String>) {
        let mut observations = lock_state(state);
        if observations.failure.is_none() {
            observations.failure = Some(error.into());
            observations.phase = Phase::Failed;
            observations.events.push("failed");
        }
    }

    fn abort_from_main(
        app: &TestAppHandle,
        state: &Shared,
        signal_tx: &Sender<Signal>,
        error: impl Into<String>,
    ) {
        let error = error.into();
        record_failure(state, error.clone());
        let _ = signal_tx.send(Signal::Failure(error));
        app.exit(125);
    }

    fn build_hidden_main(
        app: &TestAppHandle,
        title: &'static str,
    ) -> Result<TestWindow, tauri::Error> {
        tauri::WebviewWindowBuilder::new(
            app,
            MAIN_LABEL,
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title(title)
        .visible(false)
        .focused(false)
        .focusable(false)
        .skip_taskbar(true)
        .build()
    }

    fn window_identity(window: &TestWindow) -> Result<WindowIdentity, String> {
        let title = window
            .title()
            .map_err(|error| format!("read window title: {error}"))?;
        let hwnd = window
            .hwnd()
            .map_err(|error| format!("read HWND: {error}"))?
            .0 as isize;
        Ok(WindowIdentity { title, hwnd })
    }

    fn main_identity(app: &TestAppHandle) -> Result<Option<WindowIdentity>, String> {
        app.get_webview_window(MAIN_LABEL)
            .map(|window| window_identity(&window))
            .transpose()
    }

    fn on_destroyed_once<F>(window: &TestWindow, callback: F)
    where
        F: Fn() + Send + 'static,
    {
        let fired = AtomicBool::new(false);
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) && !fired.swap(true, Ordering::AcqRel) {
                callback();
            }
        });
    }

    fn remaining(deadline: Instant, stage: &str) -> Result<Duration, String> {
        deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or_else(|| format!("timed out waiting for {stage}"))
    }

    fn recv_before<T>(receiver: &Receiver<T>, deadline: Instant, stage: &str) -> Result<T, String> {
        receiver
            .recv_timeout(remaining(deadline, stage)?)
            .map_err(|error| format!("failed waiting for {stage}: {error}"))
    }

    fn recv_signal(
        receiver: &Receiver<Signal>,
        deadline: Instant,
        stage: &str,
    ) -> Result<Signal, String> {
        match recv_before(receiver, deadline, stage)? {
            Signal::Failure(error) => Err(error),
            signal => Ok(signal),
        }
    }

    fn queue_main<F>(app: &TestAppHandle, stage: &str, task: F) -> Result<(), String>
    where
        F: FnOnce() + Send + 'static,
    {
        app.run_on_main_thread(task)
            .map_err(|error| format!("queue {stage}: {error}"))
    }

    fn drive_event_loop(
        app: TestAppHandle,
        ready_rx: Receiver<ThreadId>,
        signal_rx: Receiver<Signal>,
        signal_tx: Sender<Signal>,
        state: Shared,
    ) -> Result<(), String> {
        let deadline = Instant::now() + TEST_TIMEOUT;
        let event_loop_thread = recv_before(&ready_rx, deadline, "Tauri setup")?;
        if event_loop_thread == thread::current().id() {
            return Err("driver must run off the Tauri event-loop thread".to_string());
        }
        lock_state(&state).worker_was_off_main = true;

        let task_app = app.clone();
        let task_state = state.clone();
        let error_tx = signal_tx.clone();
        queue_main(&app, "legacy same-task rebuild", move || {
            let result = (|| -> Result<(), String> {
                let predecessor = task_app
                    .get_webview_window(MAIN_LABEL)
                    .ok_or_else(|| "initial main window is missing".to_string())?;
                let predecessor_identity = window_identity(&predecessor)?;
                lock_state(&task_state).initial_hwnd = Some(predecessor_identity.hwnd);

                predecessor
                    .destroy()
                    .map_err(|error| format!("destroy initial main: {error}"))?;
                lock_state(&task_state)
                    .events
                    .push("legacy-destroy-enqueued");

                let retained = main_identity(&task_app)? == Some(predecessor_identity);
                if !retained {
                    return Err(
                        "AppManager removed main synchronously during destroy()".to_string()
                    );
                }
                lock_state(&task_state).manager_retained_after_destroy_call = true;

                match build_hidden_main(&task_app, ILLEGAL_TITLE) {
                    Err(tauri::Error::WebviewLabelAlreadyExists(label)) if label == MAIN_LABEL => {
                        let mut observations = lock_state(&task_state);
                        observations.legacy_same_task_label_exists = true;
                        observations.events.push("legacy-same-task-build-rejected");
                        Ok(())
                    }
                    Err(error) => Err(format!(
                        "same-task build returned the wrong error: {error:?}"
                    )),
                    Ok(unexpected) => {
                        let _ = unexpected.destroy();
                        Err("same-task build unexpectedly succeeded".to_string())
                    }
                }
            })();

            if let Err(error) = result {
                abort_from_main(&task_app, &task_state, &error_tx, error);
            }
        })?;

        let initial = match recv_signal(&signal_rx, deadline, "initial Destroyed listener")? {
            Signal::InitialDestroyed(snapshot) => snapshot,
            other => return Err(format!("expected initial Destroyed signal, got {other:?}")),
        };
        if initial.manager?.is_some() {
            return Err("initial exact listener ran before AppManager removal".to_string());
        }
        if initial.build_count != 0 {
            return Err(format!(
                "successor build count at initial exact listener was {}, expected 0",
                initial.build_count
            ));
        }
        {
            let mut observations = lock_state(&state);
            observations.initial_listener_saw_manager_removed = true;
            observations.initial_listener_build_count = Some(initial.build_count);
            observations
                .events
                .push("initial-listener-observed-removal-before-build");
        }

        let task_app = app.clone();
        let task_state = state.clone();
        let listener_tx = signal_tx.clone();
        let error_tx = signal_tx.clone();
        queue_main(&app, "successor build", move || {
            let result = (|| -> Result<(), String> {
                let successor = build_hidden_main(&task_app, SUCCESSOR_TITLE)
                    .map_err(|error| format!("build successor main: {error}"))?;
                let successor_identity = window_identity(&successor)?;
                let initial_hwnd = lock_state(&task_state)
                    .initial_hwnd
                    .ok_or_else(|| "initial HWND was not recorded".to_string())?;
                if successor_identity.hwnd == initial_hwnd {
                    return Err("successor reused the predecessor HWND".to_string());
                }
                let listener_app = task_app.clone();
                let listener_state = task_state.clone();
                let listener_tx = listener_tx.clone();
                on_destroyed_once(&successor, move || {
                    let build_count = lock_state(&listener_state).successor_build_count;
                    let _ = listener_tx.send(Signal::SuccessorDestroyed(ListenerSnapshot {
                        manager: main_identity(&listener_app),
                        build_count,
                    }));
                });
                {
                    let mut observations = lock_state(&task_state);
                    observations.successor_hwnd = Some(successor_identity.hwnd);
                    observations.successor_build_count += 1;
                    observations.phase = Phase::AwaitingSuccessorDestroyed;
                    observations
                        .events
                        .push("successor-built-on-queued-main-task");
                }
                successor
                    .destroy()
                    .map_err(|error| format!("destroy successor main: {error}"))?;
                lock_state(&task_state)
                    .events
                    .push("successor-destroy-enqueued");
                Ok(())
            })();

            if let Err(error) = result {
                abort_from_main(&task_app, &task_state, &error_tx, error);
            }
        })?;

        let successor = match recv_signal(&signal_rx, deadline, "successor Destroyed listener")? {
            Signal::SuccessorDestroyed(snapshot) => snapshot,
            other => {
                return Err(format!(
                    "expected successor Destroyed signal, got {other:?}"
                ))
            }
        };
        if successor.manager?.is_some() {
            return Err("successor exact listener ran before AppManager removal".to_string());
        }
        if successor.build_count != 1 {
            return Err(format!(
                "successor build count was {}, expected 1",
                successor.build_count
            ));
        }
        {
            let mut observations = lock_state(&state);
            observations.successor_listener_saw_manager_removed = true;
            observations
                .events
                .push("successor-listener-observed-removal");
        }

        let task_app = app.clone();
        let task_state = state.clone();
        let listener_tx = signal_tx.clone();
        let error_tx = signal_tx.clone();
        queue_main(&app, "replacement predecessor", move || {
            let result = (|| -> Result<(), String> {
                let predecessor = build_hidden_main(&task_app, REPLACEMENT_PREDECESSOR_TITLE)
                    .map_err(|error| format!("build replacement predecessor: {error}"))?;
                let listener_app = task_app.clone();
                let listener_state = task_state.clone();
                let listener_tx = listener_tx.clone();
                on_destroyed_once(&predecessor, move || {
                    let build_count = lock_state(&listener_state).third_window_build_count;
                    let _ = listener_tx.send(Signal::ReplacementPredecessorDestroyed(
                        ListenerSnapshot {
                            manager: main_identity(&listener_app),
                            build_count,
                        },
                    ));
                });
                {
                    let mut observations = lock_state(&task_state);
                    observations.phase = Phase::AwaitingReplacementPredecessorDestroyed;
                    observations.events.push("replacement-predecessor-built");
                }
                predecessor
                    .destroy()
                    .map_err(|error| format!("destroy replacement predecessor: {error}"))?;
                lock_state(&task_state)
                    .events
                    .push("replacement-predecessor-destroy-enqueued");
                Ok(())
            })();

            if let Err(error) = result {
                abort_from_main(&task_app, &task_state, &error_tx, error);
            }
        })?;

        let predecessor = match recv_signal(
            &signal_rx,
            deadline,
            "replacement predecessor Destroyed listener",
        )? {
            Signal::ReplacementPredecessorDestroyed(snapshot) => snapshot,
            other => {
                return Err(format!(
                    "expected replacement predecessor signal, got {other:?}"
                ))
            }
        };
        let expected_replacement = lock_state(&state)
            .replacement_identity
            .clone()
            .ok_or_else(|| "run_return callback did not create replacement B".to_string())?;
        if predecessor.manager? != Some(expected_replacement.clone()) {
            return Err("predecessor exact listener did not observe replacement B".to_string());
        }
        if predecessor.build_count != 0 {
            return Err(format!(
                "third-window build count was {}, expected 0",
                predecessor.build_count
            ));
        }
        {
            let mut observations = lock_state(&state);
            observations.replacement_listener_saw_replacement = true;
            observations
                .events
                .push("predecessor-listener-observed-replacement");
        }

        let task_app = app.clone();
        let task_state = state.clone();
        let error_tx = signal_tx.clone();
        queue_main(&app, "replacement-preserving continuation", move || {
            let result = (|| -> Result<(), String> {
                let replacement = task_app
                    .get_webview_window(MAIN_LABEL)
                    .ok_or_else(|| "queued continuation lost replacement B".to_string())?;
                let actual = window_identity(&replacement)?;
                if actual != expected_replacement {
                    return Err(format!(
                        "queued continuation found the wrong main window: {actual:?}"
                    ));
                }
                {
                    let mut observations = lock_state(&task_state);
                    if observations.third_window_build_count != 0 {
                        return Err("queued continuation attempted a third build".to_string());
                    }
                    observations.queued_continuation_preserved_replacement = true;
                    observations.phase = Phase::AwaitingReplacementDestroyed;
                    observations
                        .events
                        .push("queued-continuation-preserved-replacement");
                }
                replacement
                    .destroy()
                    .map_err(|error| format!("destroy replacement B during cleanup: {error}"))?;
                lock_state(&task_state)
                    .events
                    .push("replacement-destroy-enqueued");
                Ok(())
            })();

            if let Err(error) = result {
                abort_from_main(&task_app, &task_state, &error_tx, error);
            }
        })?;

        let replacement =
            match recv_signal(&signal_rx, deadline, "replacement B Destroyed listener")? {
                Signal::ReplacementDestroyed(snapshot) => snapshot,
                other => {
                    return Err(format!(
                        "expected replacement B Destroyed signal, got {other:?}"
                    ))
                }
            };
        if replacement.manager?.is_some() {
            return Err("replacement cleanup listener ran before AppManager removal".to_string());
        }
        if replacement.build_count != 0 {
            return Err(format!(
                "third-window build count after cleanup was {}, expected 0",
                replacement.build_count
            ));
        }
        {
            let mut observations = lock_state(&state);
            observations.replacement_listener_saw_manager_removed = true;
            observations.phase = Phase::Complete;
            observations
                .events
                .push("replacement-listener-observed-removal");
            observations.events.push("complete");
        }
        app.exit(0);
        Ok(())
    }

    fn inject_replacement(
        app: &TestAppHandle,
        state: &Shared,
        signal_tx: &Sender<Signal>,
    ) -> Result<(), String> {
        if main_identity(app)?.is_some() {
            return Err(
                "AppManager still contained predecessor in run_return Destroyed callback"
                    .to_string(),
            );
        }

        let replacement = build_hidden_main(app, REPLACEMENT_TITLE)
            .map_err(|error| format!("build replacement B in run_return callback: {error}"))?;
        let identity = window_identity(&replacement)?;
        let listener_app = app.clone();
        let listener_state = state.clone();
        let listener_tx = signal_tx.clone();
        on_destroyed_once(&replacement, move || {
            let build_count = lock_state(&listener_state).third_window_build_count;
            let _ = listener_tx.send(Signal::ReplacementDestroyed(ListenerSnapshot {
                manager: main_identity(&listener_app),
                build_count,
            }));
        });
        {
            let mut observations = lock_state(state);
            observations.replacement_callback_saw_manager_removed = true;
            observations.replacement_identity = Some(identity);
            observations.phase = Phase::AwaitingReplacementContinuation;
            observations
                .events
                .push("replacement-built-in-run-event-callback");
        }
        Ok(())
    }

    #[test]
    fn tauri_wry_destroy_ordering() {
        let state = Arc::new(Mutex::new(Observations::default()));
        let (ready_tx, ready_rx) = mpsc::channel::<ThreadId>();
        let (signal_tx, signal_rx) = mpsc::channel::<Signal>();

        let setup_state = state.clone();
        let setup_signal_tx = signal_tx.clone();
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();

        let app = tauri::Builder::default()
            .any_thread()
            .setup(move |app| {
                let initial = build_hidden_main(app.handle(), INITIAL_TITLE).map_err(|error| {
                    std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("build initial hidden main: {error}"),
                    )
                })?;
                let listener_app = app.handle().clone();
                let listener_state = setup_state.clone();
                let listener_tx = setup_signal_tx.clone();
                on_destroyed_once(&initial, move || {
                    let build_count = lock_state(&listener_state).successor_build_count;
                    let _ = listener_tx.send(Signal::InitialDestroyed(ListenerSnapshot {
                        manager: main_identity(&listener_app),
                        build_count,
                    }));
                });
                {
                    let mut observations = lock_state(&setup_state);
                    observations.phase = Phase::AwaitingInitialDestroyed;
                    observations.events.push("initial-hidden-window-created");
                }
                ready_tx.send(thread::current().id()).map_err(|error| {
                    std::io::Error::new(
                        std::io::ErrorKind::BrokenPipe,
                        format!("signal setup ready: {error}"),
                    )
                })?;
                Ok(())
            })
            .build(context)
            .expect("build real Tauri/Wry test application");

        let app_handle = app.handle().clone();
        let worker_app = app_handle.clone();
        let worker_state = state.clone();
        let worker_signal_tx = signal_tx.clone();
        let worker = thread::spawn(move || {
            let result = drive_event_loop(
                worker_app.clone(),
                ready_rx,
                signal_rx,
                worker_signal_tx,
                worker_state.clone(),
            );
            if let Err(error) = &result {
                record_failure(&worker_state, error.clone());
                worker_app.exit(124);
            }
            result
        });

        let run_state = state.clone();
        let run_signal_tx = signal_tx.clone();
        drop(signal_tx);
        let exit_code = app.run_return(move |app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } if label == MAIN_LABEL => {
                let should_inject =
                    lock_state(&run_state).phase == Phase::AwaitingReplacementPredecessorDestroyed;
                if should_inject {
                    if let Err(error) = inject_replacement(app, &run_state, &run_signal_tx) {
                        abort_from_main(app, &run_state, &run_signal_tx, error);
                    }
                }
            }
            RunEvent::ExitRequested { api, .. } => {
                let phase = lock_state(&run_state).phase;
                if !matches!(phase, Phase::Complete | Phase::Failed) {
                    api.prevent_exit();
                }
            }
            _ => {}
        });

        let worker_result = worker.join().expect("join bounded ordering worker");
        let observations = lock_state(&state);
        assert!(
            worker_result.is_ok(),
            "ordering worker failed: {:?}; observations: {observations:#?}",
            worker_result.err()
        );
        assert_eq!(exit_code, 0, "unexpected Tauri run_return exit code");
        assert_eq!(observations.phase, Phase::Complete);
        assert_eq!(observations.failure, None);
        assert!(observations.worker_was_off_main);
        assert!(observations.initial_hwnd.is_some());
        assert!(observations.successor_hwnd.is_some());
        assert_ne!(observations.initial_hwnd, observations.successor_hwnd);
        assert!(observations.manager_retained_after_destroy_call);
        assert!(observations.legacy_same_task_label_exists);
        assert!(observations.initial_listener_saw_manager_removed);
        assert_eq!(observations.initial_listener_build_count, Some(0));
        assert_eq!(observations.successor_build_count, 1);
        assert!(observations.successor_listener_saw_manager_removed);
        assert!(observations.replacement_callback_saw_manager_removed);
        assert!(observations.replacement_identity.is_some());
        assert!(observations.replacement_listener_saw_replacement);
        assert_eq!(observations.third_window_build_count, 0);
        assert!(observations.queued_continuation_preserved_replacement);
        assert!(observations.replacement_listener_saw_manager_removed);
        assert_eq!(
            observations.events,
            vec![
                "initial-hidden-window-created",
                "legacy-destroy-enqueued",
                "legacy-same-task-build-rejected",
                "initial-listener-observed-removal-before-build",
                "successor-built-on-queued-main-task",
                "successor-destroy-enqueued",
                "successor-listener-observed-removal",
                "replacement-predecessor-built",
                "replacement-predecessor-destroy-enqueued",
                "replacement-built-in-run-event-callback",
                "predecessor-listener-observed-replacement",
                "queued-continuation-preserved-replacement",
                "replacement-destroy-enqueued",
                "replacement-listener-observed-removal",
                "complete",
            ]
        );
    }
}

#[cfg(not(windows))]
#[test]
fn tauri_wry_destroy_ordering() {
    eprintln!("tauri_wry_destroy_ordering is Windows-only");
}
