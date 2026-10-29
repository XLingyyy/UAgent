//! Synthetic, text-only fixtures against the Windows native SQLite RunStore.
use super::*;
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(1);
struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "uagent-chat-archive-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self { root }
    }
    fn start(&self) -> ChatArchive {
        ChatArchive::start(
            &self.root.join("store"),
            "chat:local",
            "native-conversation",
            "native-run",
            "synthetic-provider",
            "synthetic-model",
        )
        .unwrap()
    }
    fn store(&self) -> RunStore {
        RunStore::open(self.root.join("store")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Delete only this unique fixture directly beneath the configured E: temp.
        if self.root.is_absolute()
            && self.root.parent() == Some(std::env::temp_dir().as_path())
            && self
                .root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("uagent-chat-archive-")
        {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}
fn request(text: &str) -> Vec<Value> {
    vec![
        json!({"role":"system","content":"Exact system\n中文\0🟢"}),
        json!({"role":"developer","content":"Text may mention headers, approval and credential."}),
        json!({"role":"user","content":text}),
    ]
}
fn state(store: &RunStore, revision: i64) -> Value {
    store
        .checkpoint_batch("chat:local", "native-run", revision)
        .unwrap()
        .unwrap()
        .events
        .into_iter()
        .find(|event| event.kind == "coordinator_state_v1")
        .unwrap()
        .data
}
fn transcript(store: &RunStore) -> Vec<Value> {
    store
        .messages("chat:local", "native-conversation", 0, 500)
        .unwrap()
        .iter()
        .map(|message| serde_json::from_str::<Value>(&message.body).unwrap()["message"].clone())
        .collect()
}
fn assert_no_execution_authority(value: &Value) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                assert!(![
                    "headers",
                    "scope",
                    "scopeRef",
                    "rootRef",
                    "approval",
                    "credential",
                    "apiKey",
                    "endpoint"
                ]
                .contains(&key.as_str()));
                assert_no_execution_authority(child);
            }
        }
        Value::Array(values) => {
            for child in values {
                assert_no_execution_authority(child);
            }
        }
        _ => {}
    }
}

#[test]
fn native_sqlite_two_turns_reopen_exact_history_without_duplicates_or_authority() {
    fn assert_send<T: Send>() {}
    assert_send::<ChatArchive>();
    let fixture = Fixture::new();
    let first = request("First\n user\0中文 🟢");
    let assistant_one = " First assistant\r\n\0中文 🟢 ";
    let assistant_two = "Second assistant\nwithout synthetic usage";
    let mut expected = first.clone();
    expected.push(json!({"role":"assistant","content":assistant_one}));
    let mut second = expected.clone();
    second.push(json!({"role":"user","content":"Second exact user"}));
    let mut archive = fixture.start();
    assert_eq!(
        archive.begin_request("logical-one", &first).unwrap(),
        ArchiveAck {
            revision: 1,
            message_count: 3
        }
    );
    assert_eq!(
        archive
            .complete_request("logical-one", assistant_one, UsageStatus::Unknown)
            .unwrap(),
        ArchiveAck {
            revision: 2,
            message_count: 4
        }
    );
    assert_eq!(
        archive.begin_request("logical-two", &second).unwrap(),
        ArchiveAck {
            revision: 3,
            message_count: 5
        }
    );
    assert_eq!(
        archive
            .complete_request(
                "logical-two",
                assistant_two,
                UsageStatus::Reported {
                    input_tokens: 17,
                    output_tokens: 9,
                    total_tokens: Some(26),
                }
            )
            .unwrap(),
        ArchiveAck {
            revision: 4,
            message_count: 6
        }
    );
    assert_eq!(
        archive.finish_conversation().unwrap(),
        ArchiveAck {
            revision: 5,
            message_count: 6
        }
    );
    drop(archive);
    expected.push(second.last().unwrap().clone());
    expected.push(json!({"role":"assistant","content":assistant_two}));
    let store = fixture.store();
    assert_eq!(transcript(&store), expected);
    let saved = store.snapshot("chat:local", "native-run").unwrap();
    assert_eq!(saved.run.status, RunStatus::Succeeded);
    assert_eq!(saved.run.revision, 5);
    assert!(saved.requires_fresh_authorization);
    assert!(!saved.has_unknown_external_effects);
    assert!(saved.steps.is_empty() && saved.tool_calls.is_empty() && saved.artifacts.is_empty());
    let stored = store
        .messages("chat:local", "native-conversation", 0, 500)
        .unwrap();
    for (index, message) in stored.iter().enumerate() {
        assert_eq!(message.id, format!("native-run:message:{}", index + 1));
        assert_eq!(
            serde_json::from_str::<Value>(&message.body).unwrap()["format"],
            "uagent.provider-message.v1"
        );
    }
    assert_eq!(stored[1].role, Role::System);
    let events = store.events("chat:local", "native-run", 0, 500).unwrap();
    for event in &events {
        assert_no_execution_authority(&event.event.data);
        if event.event.kind == "coordinator_state_v1" {
            continue;
        }
        let data = &event.event.data;
        assert_eq!(data["schemaVersion"], 1);
        assert_eq!(data["eventId"], event.event.id);
        assert_eq!(data["type"], event.event.kind);
        assert_eq!(data["runId"], "native-run");
        assert_eq!(data["createdAt"], event.event.created_at);
        assert_eq!(data["sequence"], event.sequence);
    }
    let started: Vec<_> = events
        .iter()
        .filter(|event| event.event.kind == "model_started")
        .collect();
    assert_eq!(started[0].event.data["payload"]["messages"], json!(first));
    assert_eq!(started[1].event.data["payload"]["messages"], json!(second));
    let completed: Vec<_> = events
        .iter()
        .filter(|event| event.event.kind == "model_completed")
        .collect();
    assert_eq!(completed[0].event.data["payload"]["usageStatus"], "unknown");
    assert!(completed[0].event.data["payload"].get("usage").is_none());
    assert_eq!(
        completed[1].event.data["payload"]["usage"],
        json!({"inputTokens":17,"outputTokens":9,"totalTokens":26})
    );
    let latest = state(&store, 5);
    assert_eq!(latest["format"], "uagent.coordinator-state.v1");
    assert_eq!(latest["projectId"], "chat:local");
    assert_eq!(latest["runId"], "native-run");
    assert_eq!(latest["conversationId"], "native-conversation");
    assert_eq!(latest["messageCount"], 6);
    assert_eq!(latest["taskMode"], "discussion");
    assert_eq!(latest["providerId"], "synthetic-provider");
    assert_eq!(latest["modelId"], "synthetic-model");
    assert_eq!(latest["logicalProjectId"], Value::Null);
    assert_eq!(latest["lastRequestStatus"], "completed");
    assert_eq!(latest["requiresFreshAuthorization"], true);
    assert_eq!(
        store.history_runs(None, None, 100, 0).unwrap()[0].project_root,
        "conversation://local"
    );
    assert_eq!(
        ChatArchive::start(
            &fixture.root.join("store"),
            "chat:local",
            "native-conversation",
            "native-run",
            "synthetic-provider",
            "synthetic-model"
        )
        .err()
        .unwrap()
        .kind,
        "conflict"
    );
}

#[test]
fn cancellation_and_failure_never_write_assistant_or_completed_model_events() {
    for cancelled in [true, false] {
        let fixture = Fixture::new();
        let mut archive = fixture.start();
        let input = request("Exact request that will not succeed");
        archive.begin_request("request", &input).unwrap();
        let failed = archive.fail_request("request", cancelled).unwrap();
        assert_eq!(
            failed,
            ArchiveAck {
                revision: 2,
                message_count: 3
            }
        );
        assert_eq!(archive.fail_request("request", cancelled).unwrap(), failed);
        assert!(archive
            .complete_request("request", "must not exist", UsageStatus::Unknown)
            .is_err());
        archive.finish_conversation().unwrap();
        let store = fixture.store();
        assert_eq!(transcript(&store), input);
        assert!(!store
            .events("chat:local", "native-run", 0, 500)
            .unwrap()
            .iter()
            .any(|event| event.event.kind == "model_completed"));
        assert_eq!(
            store.run("chat:local", "native-run").unwrap().status,
            if cancelled {
                RunStatus::Cancelled
            } else {
                RunStatus::Failed
            }
        );
        assert_eq!(
            state(&store, 3)["lastRequestStatus"],
            if cancelled { "cancelled" } else { "failed" }
        );
    }
}

#[test]
fn pending_and_empty_conversations_finish_cancelled_and_close_is_idempotent() {
    for with_pending in [true, false] {
        let fixture = Fixture::new();
        let mut archive = fixture.start();
        if with_pending {
            archive
                .begin_request("request", &request("pending"))
                .unwrap();
        }
        let ack = archive.finish_conversation().unwrap();
        assert_eq!(archive.finish_conversation().unwrap(), ack);
        assert_eq!(
            fixture
                .store()
                .run("chat:local", "native-run")
                .unwrap()
                .status,
            RunStatus::Cancelled
        );
        assert_eq!(
            archive
                .begin_request("later", &request("later"))
                .unwrap_err()
                .kind,
            "closed"
        );
        assert_eq!(
            archive
                .complete_request("request", "no success", UsageStatus::Unknown)
                .unwrap_err()
                .kind,
            "closed"
        );
        assert_eq!(
            archive.fail_request("request", true).unwrap_err().kind,
            "closed"
        );
        assert!(!fixture
            .store()
            .events("chat:local", "native-run", 0, 500)
            .unwrap()
            .iter()
            .any(|event| event.event.kind == "model_completed"));
    }
}

#[test]
fn repeated_pending_or_completion_ack_does_not_duplicate_history() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    let input = request("repeat");
    let first = archive.begin_request("request", &input).unwrap();
    assert_eq!(archive.begin_request("request", &input).unwrap(), first);
    assert_eq!(
        archive.begin_request("other", &input).unwrap_err().kind,
        "conflict"
    );
    let done = archive
        .complete_request("request", "", UsageStatus::Unknown)
        .unwrap();
    assert_eq!(
        archive
            .complete_request("request", "", UsageStatus::Unknown)
            .unwrap(),
        done
    );
    assert_eq!(
        archive
            .complete_request("request", "changed", UsageStatus::Unknown)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        archive.begin_request("request", &input).unwrap_err().kind,
        "conflict"
    );
    assert_eq!(
        transcript(&fixture.store()).last().unwrap(),
        &json!({"role":"assistant","content":""})
    );
    assert_eq!(
        fixture
            .store()
            .run("chat:local", "native-run")
            .unwrap()
            .revision,
        2
    );
}

#[test]
fn tools_functions_transport_metadata_and_non_text_content_are_rejected_atomically() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    let invalid = [
        json!({"role":"tool","content":"tool result"}),
        json!({"role":"function","content":"function result"}),
        json!({"type":"function_call","name":"read","arguments":"{}"}),
        json!({"role":"assistant","content":"","toolCalls":[]}),
        json!({"role":"user","content":"x","headers":{"Authorization":"synthetic"}}),
        json!({"role":"user","content":"x","credential":"synthetic"}),
        json!({"role":"user","content":"x","name":"extra metadata"}),
        json!({"role":"user","content":[{"type":"input_text","text":"must be normalized first"}]}),
        json!({"role":"user","content":null}),
    ];
    for value in invalid {
        let mut input = vec![value];
        input.push(json!({"role":"user","content":"end"}));
        assert_eq!(
            archive
                .begin_request("invalid-request", &input)
                .unwrap_err()
                .kind,
            "invalid"
        );
    }
    assert!(transcript(&fixture.store()).is_empty());
    assert_eq!(
        fixture
            .store()
            .run("chat:local", "native-run")
            .unwrap()
            .revision,
        0
    );
    archive
        .begin_request(
            "valid",
            &request("Literal {\"headers\":\"credential\"} is ordinary user text"),
        )
        .unwrap();
}

#[test]
fn changed_instructions_and_bounded_history_do_not_overwrite_archived_bodies() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    let first = request("First actual wire user\nNo tool policy");
    archive.begin_request("first", &first).unwrap();
    archive
        .complete_request("first", "Original exact assistant", UsageStatus::Unknown)
        .unwrap();
    let before = transcript(&fixture.store());
    let selected = vec![
        json!({"role":"developer","content":"New instructions and current plan goal"}),
        json!({"role":"user","content":"First original draft without wire policy"}),
        json!({"role":"assistant","content":"Bounded excerpt of old assistant"}),
        json!({"role":"user","content":"Second actual wire user"}),
    ];
    archive.begin_request("second", &selected).unwrap();
    let current = transcript(&fixture.store());
    assert_eq!(&current[..before.len()], before.as_slice());
    assert_eq!(current.len(), 5);
    assert_eq!(current[4], selected[3]);
    archive
        .complete_request("second", "Second exact assistant", UsageStatus::Unknown)
        .unwrap();
    let bounded = vec![
        json!({"role":"developer","content":"Third current instructions"}),
        json!({"role":"user","content":"Third input with all previous history omitted"}),
    ];
    archive.begin_request("third", &bounded).unwrap();
    let current = transcript(&fixture.store());
    assert_eq!(&current[..before.len()], before.as_slice());
    assert_eq!(current.len(), 7);
    assert_eq!(current[6], bounded[1]);
    let events = fixture
        .store()
        .events("chat:local", "native-run", 0, 500)
        .unwrap();
    let starts: Vec<_> = events
        .iter()
        .filter(|event| event.event.kind == "model_started")
        .collect();
    assert_eq!(starts[1].event.data["payload"]["messages"], json!(selected));
    assert_eq!(starts[2].event.data["payload"]["messages"], json!(bounded));
}

#[test]
fn first_request_selected_history_is_an_event_not_fabricated_native_turns() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    let selected = vec![
        json!({"role":"system","content":"Initial instructions"}),
        json!({"role":"user","content":"Selected prior draft"}),
        json!({"role":"assistant","content":"Selected historical excerpt"}),
        json!({"role":"user","content":"Current native request"}),
    ];
    let ack = archive.begin_request("first", &selected).unwrap();
    assert_eq!(ack.message_count, 2);
    assert_eq!(
        transcript(&fixture.store()),
        vec![selected[0].clone(), selected[3].clone()]
    );
    let start = fixture
        .store()
        .events("chat:local", "native-run", 0, 500)
        .unwrap()
        .into_iter()
        .find(|event| event.event.kind == "model_started")
        .unwrap();
    assert_eq!(start.event.data["payload"]["messages"], json!(selected));
}

#[test]
fn failed_user_attempt_stays_exact_without_repeating_context_or_selected_history() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    archive
        .begin_request("failed", &request("cancelled input"))
        .unwrap();
    archive.fail_request("failed", true).unwrap();
    archive
        .begin_request("retry", &request("actual retry"))
        .unwrap();
    archive
        .complete_request("retry", "ok", UsageStatus::Unknown)
        .unwrap();
    let saved = transcript(&fixture.store());
    assert_eq!(saved.len(), 5); // Initial context once, both real user attempts, one assistant.
    assert_eq!(saved[2]["content"], "cancelled input");
    assert_eq!(saved[3]["content"], "actual retry");
    assert_eq!(saved[4]["content"], "ok");
    let mut next = request("actual retry");
    next.push(json!({"role":"assistant","content":"ok"}));
    next.push(json!({"role":"user","content":"next"}));
    archive.begin_request("next", &next).unwrap();
    assert_eq!(transcript(&fixture.store()).len(), 6);
}

#[test]
fn native_run_revisions_prevent_stale_success_and_leave_pending_archive_intact() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    archive
        .begin_request("request", &request("pending"))
        .unwrap();
    let store = fixture.store();
    let mut external_batch = store
        .checkpoint_batch("chat:local", "native-run", 1)
        .unwrap()
        .unwrap();
    external_batch.messages.clear();
    external_batch.events.clear();
    store
        .commit_checkpoint("chat:local", "native-run", 1, &external_batch)
        .unwrap();
    assert_eq!(
        archive
            .complete_request("request", "stale success", UsageStatus::Unknown)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        archive.ack(),
        ArchiveAck {
            revision: 1,
            message_count: 3
        }
    );
    assert!(archive.pending.is_some());
    assert_eq!(transcript(&store).len(), 3);
    assert_eq!(
        store
            .events("chat:local", "native-run", 0, 500)
            .unwrap()
            .iter()
            .filter(|event| event.event.kind == "model_completed")
            .count(),
        0
    );
}

#[test]
fn oversized_request_or_assistant_and_unsafe_usage_fail_without_truncation() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    assert_eq!(
        archive
            .begin_request("large", &request(&"x".repeat(MAX_MESSAGE_BYTES + 1)))
            .unwrap_err()
            .kind,
        "capacity"
    );
    assert_eq!(
        fixture
            .store()
            .run("chat:local", "native-run")
            .unwrap()
            .revision,
        0
    );
    archive.begin_request("valid", &request("valid")).unwrap();
    assert_eq!(
        archive
            .complete_request(
                "valid",
                &"x".repeat(MAX_MESSAGE_BYTES + 1),
                UsageStatus::Unknown
            )
            .unwrap_err()
            .kind,
        "capacity"
    );
    assert_eq!(
        archive
            .complete_request(
                "valid",
                "unsafe usage",
                UsageStatus::Reported {
                    input_tokens: MAX_SAFE_INTEGER + 1,
                    output_tokens: 1,
                    total_tokens: None,
                }
            )
            .unwrap_err()
            .kind,
        "invalid"
    );
    assert_eq!(transcript(&fixture.store()).len(), 3);
    assert_eq!(archive.ack().revision, 1);
    archive
        .complete_request(
            "valid",
            "exact assistant after rejected oversized attempt",
            UsageStatus::Unknown,
        )
        .unwrap();
    assert_eq!(
        transcript(&fixture.store()).last().unwrap()["content"],
        "exact assistant after rejected oversized attempt"
    );
}

#[test]
fn reported_usage_without_total_does_not_invent_total_or_require_positive_counts() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    archive.begin_request("valid", &request("valid")).unwrap();
    archive
        .complete_request(
            "valid",
            "answer",
            UsageStatus::Reported {
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: None,
            },
        )
        .unwrap();
    let event = fixture
        .store()
        .events("chat:local", "native-run", 0, 500)
        .unwrap()
        .into_iter()
        .find(|event| event.event.kind == "model_completed")
        .unwrap();
    assert_eq!(
        event.event.data["payload"]["usage"],
        json!({"inputTokens":0,"outputTokens":0})
    );
    assert_eq!(event.event.data["payload"]["usageStatus"], "reported");
}

#[test]
fn project_marker_is_not_readable_project_authority_and_collision_does_not_overwrite() {
    let fixture = Fixture::new();
    let mut archive = ChatArchive::start_with_logical_project(
        &fixture.root.join("store"),
        "chat:project-id",
        "native-conversation",
        "native-run",
        "provider",
        "model",
        Some("missing-untrusted-project"),
    )
    .unwrap();
    archive
        .begin_request(
            "request",
            &[json!({"role":"user","content":"discussion with no project access"})],
        )
        .unwrap();
    let store = fixture.store();
    let saved = store
        .checkpoint_batch("chat:project-id", "native-run", 1)
        .unwrap()
        .unwrap();
    let saved_state = &saved
        .events
        .iter()
        .find(|event| event.kind == "coordinator_state_v1")
        .unwrap()
        .data;
    assert_eq!(saved_state["logicalProjectId"], "missing-untrusted-project");
    assert_eq!(store.projects().unwrap()[0].root, "conversation://chat");
    assert_no_execution_authority(saved_state);
    store
        .create_project(&Project {
            id: "executable-project".into(),
            root: "G:/not-present/synthetic-project".into(),
            label: "Existing project".into(),
            created_at: 1,
        })
        .unwrap();
    assert_eq!(
        ChatArchive::start(
            &fixture.root.join("store"),
            "executable-project",
            "new-conversation",
            "new-run",
            "provider",
            "model"
        )
        .err()
        .unwrap()
        .kind,
        "conflict"
    );
    let project = store
        .projects()
        .unwrap()
        .into_iter()
        .find(|project| project.id == "executable-project")
        .unwrap();
    assert_eq!(project.root, "G:/not-present/synthetic-project");
    assert_eq!(project.label, "Existing project");
    assert!(store
        .runs("executable-project", "new-conversation", 500, 0)
        .unwrap()
        .is_empty());
}

#[test]
fn different_request_id_cannot_complete_or_cancel_the_pending_request() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    archive.begin_request("real", &request("exact")).unwrap();
    assert_eq!(
        archive
            .complete_request("foreign", "must not save", UsageStatus::Unknown)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        archive.fail_request("foreign", true).unwrap_err().kind,
        "conflict"
    );
    assert_eq!(transcript(&fixture.store()).len(), 3);
    assert_eq!(archive.ack().revision, 1);
    archive
        .complete_request("real", "correct native result", UsageStatus::Unknown)
        .unwrap();
}

#[test]
fn trailing_user_block_preserves_typed_questions_and_selected_attachments_on_each_turn() {
    let fixture = Fixture::new();
    let mut archive = fixture.start();
    let first = vec![
        json!({"role":"system","content":"Initial system instructions"}),
        json!({"role":"developer","content":"Initial plan goal"}),
        json!({"role":"user","content":"Selected older user history"}),
        json!({"role":"assistant","content":"Selected older assistant history"}),
        json!({"role":"user","content":"First typed question\nExact spacing  "}),
        json!({"role":"user","content":"First explicitly selected attachment\nfile contents"}),
    ];
    assert_eq!(
        archive.begin_request("first-with-context", &first).unwrap(),
        ArchiveAck {
            revision: 1,
            message_count: 4
        }
    );
    let mut expected = vec![
        first[0].clone(),
        first[1].clone(),
        first[4].clone(),
        first[5].clone(),
    ];
    assert_eq!(transcript(&fixture.store()), expected);
    archive
        .complete_request(
            "first-with-context",
            "First observed answer",
            UsageStatus::Unknown,
        )
        .unwrap();
    expected.push(json!({"role":"assistant","content":"First observed answer"}));
    let second = vec![
        json!({"role":"developer","content":"Changed instructions and current plan goal"}),
        first[4].clone(),
        first[5].clone(),
        json!({"role":"assistant","content":"Bounded excerpt of first observed answer"}),
        json!({"role":"user","content":"Second typed question\r\n"}),
        json!({"role":"user","content":"Second explicitly selected attachment\nmore exact text"}),
    ];
    assert_eq!(
        archive
            .begin_request("second-with-context", &second)
            .unwrap(),
        ArchiveAck {
            revision: 3,
            message_count: 7
        }
    );
    expected.extend_from_slice(&second[4..]);
    assert_eq!(transcript(&fixture.store()), expected);
    archive
        .complete_request(
            "second-with-context",
            "Second observed answer",
            UsageStatus::Unknown,
        )
        .unwrap();
    expected.push(json!({"role":"assistant","content":"Second observed answer"}));
    assert_eq!(
        archive.finish_conversation().unwrap(),
        ArchiveAck {
            revision: 5,
            message_count: 8
        }
    );
    drop(archive);
    let store = fixture.store();
    assert_eq!(transcript(&store), expected);
    assert_eq!(
        store.run("chat:local", "native-run").unwrap().status,
        RunStatus::Succeeded
    );
    let events = store.events("chat:local", "native-run", 0, 500).unwrap();
    let starts: Vec<_> = events
        .iter()
        .filter(|event| event.event.kind == "model_started")
        .collect();
    assert_eq!(starts.len(), 2);
    assert_eq!(starts[0].event.data["payload"]["messages"], json!(first));
    assert_eq!(starts[1].event.data["payload"]["messages"], json!(second));
    let messages = store
        .messages("chat:local", "native-conversation", 0, 500)
        .unwrap();
    for (index, message) in messages.iter().enumerate() {
        assert_eq!(message.id, format!("native-run:message:{}", index + 1));
    }
}
