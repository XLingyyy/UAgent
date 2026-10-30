//! Metadata-only credential management IPC. Keys are accepted only on explicit Save.
//! The OS vault and native senders consume them; no command returns key bytes.
#![cfg(windows)]
use crate::credential_vault::{
    self, CredentialBinding, CredentialRecovery, CredentialStatus, Secret,
};
use crate::product_settings_store::{
    AuthMode, NativeEndpointPolicy, ProductSettingsStore, ProviderSnapshot, ProviderVersion,
    WireApi,
};
use crate::provider_endpoint_policy::NATIVE_ENDPOINT_POLICY;
use serde::{Deserialize, Serialize};
use std::path::Path;
type Result<T> = std::result::Result<T, String>;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StatusInput {
    provider_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveInput {
    provider_id: String,
    expected_provider_version: ProviderVersion,
    expected_credential_version: Option<String>,
    credential: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteInput {
    provider_id: String,
    expected_provider_version: ProviderVersion,
    expected_credential_version: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    saved: bool,
    version: Option<String>,
    mask: Option<&'static str>,
    provider_version: ProviderVersion,
    cleanup_pending: bool,
    recovery: Option<CredentialRecovery>,
    wire_api: &'static str,
    endpoint: &'static str,
}
pub(crate) fn binding_at(
    root: &Path,
    provider_id: &str,
) -> Result<(ProviderSnapshot, CredentialBinding)> {
    let store = ProductSettingsStore::open(root.join("run-store-v2"))
        .map_err(|_| "credential_configuration_unavailable")?;
    let snapshot = store
        .provider(provider_id, &NATIVE_ENDPOINT_POLICY)
        .map_err(|_| "credential_configuration_unavailable")?
        .ok_or("credential_configuration_unavailable")?;
    if snapshot.config.auth_mode != AuthMode::EnvKey {
        return Err("credential_provider_unsupported".into());
    }
    let decision = NATIVE_ENDPOINT_POLICY
        .validate_endpoint(snapshot.config.wire_api, &snapshot.config.base_url)
        .map_err(|_| "credential_endpoint_rejected")?;
    let endpoint = decision.canonical_base_url.trim_end_matches('/');
    let supported = match snapshot.config.wire_api {
        WireApi::Responses => endpoint == "https://api.openai.com/v1",
        WireApi::ChatCompletions | WireApi::OpenaiCompatible => {
            endpoint == "https://api.deepseek.com"
        }
        _ => false,
    };
    if !decision.transport_supported || !supported {
        return Err("credential_provider_unsupported".into());
    }
    let binding = CredentialBinding::new(root, provider_id, &snapshot.generation, endpoint)
        .map_err(|e| e.kind().to_string())?;
    Ok((snapshot, binding))
}
fn checked(snapshot: &ProviderSnapshot, expected: &ProviderVersion) -> Result<()> {
    if snapshot.version() != *expected {
        return Err("credential_configuration_changed".into());
    }
    Ok(())
}
fn receipt(snapshot: &ProviderSnapshot, status: CredentialStatus) -> Receipt {
    Receipt {
        saved: status.exists,
        version: status.version,
        mask: if status.exists {
            Some("********")
        } else {
            None
        },
        provider_version: snapshot.version(),
        cleanup_pending: status.cleanup_pending,
        recovery: status.recovery,
        wire_api: if snapshot.config.wire_api == WireApi::Responses {
            "responses"
        } else {
            "chat_completions"
        },
        endpoint: if snapshot.config.wire_api == WireApi::Responses {
            "https://api.openai.com/v1/responses"
        } else {
            "https://api.deepseek.com/chat/completions"
        },
    }
}
async fn worker<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "credential_worker_unavailable".to_string())?
}
#[tauri::command]
pub(crate) async fn get_saved_provider_credential(
    app: tauri::AppHandle,
    input: StatusInput,
) -> Result<Receipt> {
    let root = crate::app_profile::resolve_app_data_dir(&app)
        .map_err(|_| "credential_profile_unavailable")?;
    worker(move || {
        let (snapshot, binding) = binding_at(&root, &input.provider_id)?;
        let status = credential_vault::status(&binding).map_err(|e| e.kind().to_string())?;
        // Do not publish a status for a configuration superseded while the vault blocked.
        let (current, _) = binding_at(&root, &input.provider_id)?;
        checked(&current, &snapshot.version())?;
        Ok(receipt(&snapshot, status))
    })
    .await
}
#[tauri::command]
pub(crate) async fn save_provider_credential(
    app: tauri::AppHandle,
    input: SaveInput,
) -> Result<Receipt> {
    let root = crate::app_profile::resolve_app_data_dir(&app)
        .map_err(|_| "credential_profile_unavailable")?;
    worker(move || {
        if input.credential == "********" {
            return Err("credential_input_invalid".into());
        }
        let secret =
            Secret::new(input.credential.into_bytes()).map_err(|e| e.kind().to_string())?;
        let _responses =
            crate::native_responses_commands::begin_provider_update(&input.provider_id)?;
        let _deepseek = crate::native_saved_deepseek::begin_provider_update(&input.provider_id)?;
        let (snapshot, binding) = binding_at(&root, &input.provider_id)?;
        checked(&snapshot, &input.expected_provider_version)?;
        let status = credential_vault::save(
            &binding,
            input.expected_credential_version.as_deref(),
            secret,
        )
        .map_err(|e| e.kind().to_string())?;
        let (current, _) = binding_at(&root, &input.provider_id)?;
        checked(&current, &snapshot.version())?;
        Ok(receipt(&snapshot, status))
    })
    .await
}
#[tauri::command]
pub(crate) async fn delete_provider_credential(
    app: tauri::AppHandle,
    input: DeleteInput,
) -> Result<Receipt> {
    let root = crate::app_profile::resolve_app_data_dir(&app)
        .map_err(|_| "credential_profile_unavailable")?;
    worker(move || {
        let _responses =
            crate::native_responses_commands::begin_provider_update(&input.provider_id)?;
        let _deepseek = crate::native_saved_deepseek::begin_provider_update(&input.provider_id)?;
        let (snapshot, binding) = binding_at(&root, &input.provider_id)?;
        checked(&snapshot, &input.expected_provider_version)?;
        let status = credential_vault::delete(&binding, &input.expected_credential_version)
            .map_err(|e| e.kind().to_string())?;
        Ok(receipt(&snapshot, status))
    })
    .await
}
