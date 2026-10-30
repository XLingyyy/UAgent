//! Data-only DeepSeek discussion persistence. No network, project reads or execution grants.
#![cfg(windows)]
use crate::native_responses_chat_archive::{ArchiveAck, ChatArchive, UsageStatus};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Mutex, OnceLock},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveError {
    kind: &'static str,
}
fn failure() -> ArchiveError {
    ArchiveError {
        kind: "discussion_archive_unavailable",
    }
}
type Result<T> = std::result::Result<T, ArchiveError>;
fn fresh(prefix: &str) -> Result<String> {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).map_err(|_| failure())?;
    Ok(format!(
        "{prefix}{}",
        b.iter().map(|n| format!("{n:02x}")).collect::<String>()
    ))
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenInput {
    schema_version: u32,
    provider_id: String,
    model_id: String,
    conversation_id: String,
    logical_project_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    schema_version: u32,
    archive_handle: String,
    project_id: String,
    run_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandleInput {
    schema_version: u32,
    archive_handle: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationInput {
    schema_version: u32,
    archive_handle: String,
    mutation: Mutation,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Mutation {
    Begin {
        request_id: String,
        messages: Vec<Value>,
    },
    Delta {
        request_id: String,
        index: u32,
        text: String,
    },
    Complete {
        request_id: String,
        text: String,
        usage: Option<UsageInput>,
    },
    Fail {
        request_id: String,
        cancelled: bool,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageInput {
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: Option<u64>,
}
struct Entry {
    window: String,
    generation: u64,
    archive: ChatArchive,
}
#[derive(Default)]
struct Window {
    generation: u64,
    alive: bool,
}
#[derive(Default)]
struct Broker {
    windows: HashMap<String, Window>,
    entries: HashMap<String, Entry>,
}
impl Broker {
    fn rotate(&mut self, label: &str, alive: bool) -> Vec<Entry> {
        let window = self.windows.entry(label.into()).or_default();
        window.generation = window.generation.saturating_add(1);
        window.alive = alive;
        let handles = self
            .entries
            .iter()
            .filter(|(_, v)| v.window == label)
            .map(|(k, _)| k.clone())
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .filter_map(|key| self.entries.remove(&key))
            .collect()
    }
    fn open(&mut self, label: &str, root: &Path, input: OpenInput) -> Result<OpenResult> {
        let window = self
            .windows
            .get(label)
            .filter(|v| v.alive)
            .ok_or_else(failure)?;
        if input.schema_version != 1
            || input.provider_id != "deepseek"
            || input.model_id != "deepseek-flash"
            || self.entries.values().filter(|v| v.window == label).count() >= 128
        {
            return Err(failure());
        }
        let project_id = input
            .logical_project_id
            .as_ref()
            .map_or("chat:local".into(), |id| format!("chat:project:{id}"));
        let run_id = fresh("chat-run-")?;
        let archive_handle = fresh("discussion-")?;
        let archive = ChatArchive::start_deepseek(
            root,
            &project_id,
            &input.conversation_id,
            &run_id,
            input.logical_project_id.as_deref(),
        )
        .map_err(|_| failure())?;
        self.entries.insert(
            archive_handle.clone(),
            Entry {
                window: label.into(),
                generation: window.generation,
                archive,
            },
        );
        Ok(OpenResult {
            schema_version: 1,
            archive_handle,
            project_id,
            run_id,
        })
    }
    fn owned(&mut self, label: &str, handle: &str) -> Result<&mut Entry> {
        let window = self
            .windows
            .get(label)
            .filter(|v| v.alive)
            .ok_or_else(failure)?;
        self.entries
            .get_mut(handle)
            .filter(|e| e.window == label && e.generation == window.generation)
            .ok_or_else(failure)
    }
    fn mutate(&mut self, label: &str, input: MutationInput) -> Result<ArchiveAck> {
        if input.schema_version != 1 {
            return Err(failure());
        }
        let entry = self.owned(label, &input.archive_handle)?;
        let result = match input.mutation {
            Mutation::Begin {
                request_id,
                messages,
            } => entry.archive.begin_request(&request_id, &messages),
            Mutation::Delta {
                request_id,
                index,
                text,
            } => entry.archive.append_text_delta(&request_id, index, &text),
            Mutation::Complete {
                request_id,
                text,
                usage,
            } => {
                let usage = usage.map_or(UsageStatus::Unknown, |v| UsageStatus::Reported {
                    input_tokens: v.input_tokens,
                    output_tokens: v.output_tokens,
                    total_tokens: v.total_tokens,
                });
                entry.archive.complete_request(&request_id, &text, usage)
            }
            Mutation::Fail {
                request_id,
                cancelled,
            } => entry.archive.fail_delivery(&request_id, cancelled),
        };
        result.map_err(|_| failure())
    }
    fn close(&mut self, label: &str, input: HandleInput) -> Result<ArchiveAck> {
        if input.schema_version != 1 {
            return Err(failure());
        }
        self.owned(label, &input.archive_handle)?;
        let mut entry = self
            .entries
            .remove(&input.archive_handle)
            .ok_or_else(failure)?;
        entry.archive.finish_conversation().map_err(|_| failure())
    }
}
static BROKER: OnceLock<Mutex<Broker>> = OnceLock::new();
fn broker() -> &'static Mutex<Broker> {
    BROKER.get_or_init(|| Mutex::new(Broker::default()))
}
fn lifecycle(label: &str, alive: bool) {
    let entries = broker()
        .lock()
        .map(|mut b| b.rotate(label, alive))
        .unwrap_or_default();
    // A failed final write leaves the previous pending state, never false success.
    for mut entry in entries {
        let _ = entry.archive.finish_conversation();
    }
}
pub(crate) fn register_window(label: &str) {
    lifecycle(label, true);
}
pub(crate) fn close_window(label: &str) {
    lifecycle(label, false);
}
#[tauri::command]
pub async fn open_native_discussion_archive(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: OpenInput,
) -> Result<OpenResult> {
    let root = crate::app_profile::resolve_app_data_dir(&app)
        .map_err(|_| failure())?
        .join("run-store-v2");
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        broker()
            .lock()
            .map_err(|_| failure())?
            .open(&label, &root, input)
    })
    .await
    .map_err(|_| failure())?
}
#[tauri::command]
pub async fn mutate_native_discussion_archive(
    window: tauri::WebviewWindow,
    input: MutationInput,
) -> Result<ArchiveAck> {
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        broker()
            .lock()
            .map_err(|_| failure())?
            .mutate(&label, input)
    })
    .await
    .map_err(|_| failure())?
}
#[tauri::command]
pub async fn close_native_discussion_archive(
    window: tauri::WebviewWindow,
    input: HandleInput,
) -> Result<ArchiveAck> {
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        broker().lock().map_err(|_| failure())?.close(&label, input)
    })
    .await
    .map_err(|_| failure())?
}
#[cfg(test)]
#[path = "native_discussion_archive_commands/tests.rs"]
mod tests;
