//! Tauri adapter for native owner metadata, model admission and conservative status.
//! No generic operation dispatch, mark-done, stop-by-PID or observer-assertion command.
use crate::runtime_host_service::{HostResult, JobSnapshot, ModelJobInput, OwnerIdentity, OwnerRef,
    OwnerSnapshot, RuntimeHostService, TicketRef};
async fn worker<T: Send + 'static>(work: impl FnOnce() -> HostResult<T> + Send + 'static) -> HostResult<T> {
    // Root revalidation must not run on the webview/UI thread.
    tauri::async_runtime::spawn_blocking(work).await.map_err(|_| "runtime_host_worker_unavailable")?
}
#[tauri::command]
pub(crate) async fn connect_runtime_host_owner(
    window: tauri::WebviewWindow, host: tauri::State<'_, RuntimeHostService>, input: OwnerIdentity,
) -> HostResult<OwnerSnapshot> {
    let host = host.inner().clone(); let window = window.label().to_owned();
    worker(move || host.connect(&window, input)).await
}
#[tauri::command]
pub(crate) async fn heartbeat_runtime_host_owner(
    window: tauri::WebviewWindow, host: tauri::State<'_, RuntimeHostService>, input: OwnerRef,
) -> HostResult<OwnerSnapshot> {
    let host = host.inner().clone(); let window = window.label().to_owned();
    worker(move || host.heartbeat(&window, &input)).await
}
#[tauri::command]
pub(crate) async fn get_runtime_host_status(
    window: tauri::WebviewWindow, host: tauri::State<'_, RuntimeHostService>, input: OwnerRef,
) -> HostResult<OwnerSnapshot> {
    let host = host.inner().clone(); let window = window.label().to_owned();
    worker(move || host.status(&window, &input)).await
}
#[tauri::command]
pub(crate) async fn disconnect_runtime_host_owner(
    window: tauri::WebviewWindow, host: tauri::State<'_, RuntimeHostService>, input: OwnerRef,
) -> HostResult<OwnerSnapshot> {
    let host = host.inner().clone(); let window = window.label().to_owned();
    worker(move || host.disconnect(&window, &input)).await
}
#[tauri::command]
pub(crate) async fn enqueue_runtime_host_model_job(
    window: tauri::WebviewWindow, host: tauri::State<'_, RuntimeHostService>, input: ModelJobInput,
) -> HostResult<JobSnapshot> {
    let host = host.inner().clone(); let window = window.label().to_owned();
    worker(move || host.enqueue_model(&window, input)).await
}
#[tauri::command]
pub(crate) async fn cancel_runtime_host_job(
    window: tauri::WebviewWindow, host: tauri::State<'_, RuntimeHostService>, input: TicketRef,
) -> HostResult<JobSnapshot> {
    let host = host.inner().clone(); let window = window.label().to_owned();
    worker(move || host.cancel(&window, &input)).await
}
// Integrator: install one RuntimeHostService plus its RuntimeHostMonitor in Builder::setup.
// On WindowEvent::Destroyed call host.disconnect_window(window.label()).
// Before renderer replacement disconnect the old owner explicitly; on RunEvent::Exit close.
// The native provider/UE sender must consume a ticket through register_pending BEFORE
// scheduling the real worker, then move its nonserializable guard into that worker.
