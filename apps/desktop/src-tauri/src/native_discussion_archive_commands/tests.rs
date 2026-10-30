use super::*;
use crate::local_run_store::{RunStatus, RunStore};
use serde_json::json;
use std::path::PathBuf;
struct Fixture {
    root: PathBuf,
    broker: Broker,
    opened: OpenResult,
}
fn input(project: Option<&str>) -> OpenInput {
    OpenInput {
        schema_version: 1,
        provider_id: "deepseek".into(),
        model_id: "deepseek-flash".into(),
        conversation_id: "conversation".into(),
        logical_project_id: project.map(str::to_owned),
    }
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir()
            .join("uagent-deepseek-history")
            .join(fresh("fixture-").unwrap());
        assert!(root.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(&root).unwrap();
        let mut broker = Broker::default();
        broker.rotate("owned", true);
        let opened = broker.open("owned", &root, input(None)).unwrap();
        Self {
            root,
            broker,
            opened,
        }
    }
    fn mutate(&mut self, m: Mutation) -> Result<ArchiveAck> {
        self.broker.mutate(
            "owned",
            MutationInput {
                schema_version: 1,
                archive_handle: self.opened.archive_handle.clone(),
                mutation: m,
            },
        )
    }
    fn begin(&mut self, id: &str, messages: Vec<Value>) {
        self.mutate(Mutation::Begin {
            request_id: id.into(),
            messages,
        })
        .unwrap();
    }
    fn delta(&mut self, id: &str, index: u32, text: &str) {
        self.mutate(Mutation::Delta {
            request_id: id.into(),
            index,
            text: text.into(),
        })
        .unwrap();
    }
    fn complete(&mut self, id: &str, text: &str) {
        self.mutate(Mutation::Complete {
            request_id: id.into(),
            text: text.into(),
            usage: None,
        })
        .unwrap();
    }
    fn close(&mut self) {
        self.broker
            .close(
                "owned",
                HandleInput {
                    schema_version: 1,
                    archive_handle: self.opened.archive_handle.clone(),
                },
            )
            .unwrap();
    }
    fn batches(&self) -> Vec<crate::local_run_store::CheckpointBatch> {
        let s = RunStore::open(&self.root).unwrap();
        let n = s
            .snapshot(&self.opened.project_id, &self.opened.run_id)
            .unwrap()
            .run
            .revision;
        (1..=n)
            .map(|r| {
                s.checkpoint_batch(&self.opened.project_id, &self.opened.run_id, r)
                    .unwrap()
                    .unwrap()
            })
            .collect()
    }
    fn messages(&self) -> Vec<Value> {
        self.batches()
            .into_iter()
            .flat_map(|b| b.messages)
            .map(|m| serde_json::from_str::<Value>(&m.body).unwrap()["message"].clone())
            .collect()
    }
    fn events(&self) -> Vec<crate::local_run_store::RunEvent> {
        self.batches().into_iter().flat_map(|b| b.events).collect()
    }
}
fn messages(text: &str) -> Vec<Value> {
    vec![
        json!({"role":"system","content":"Only user-selected text."}),
        json!({"role":"user","content":text}),
    ]
}
#[test]
fn complete_unicode_bodies_survive_reopen_and_later_bounded_history() {
    let mut f = Fixture::new();
    let answer = "complete Unicode \u{4e2d}\u{6587}\u{1f642}\n".repeat(400);
    assert!(answer.chars().count() > 2000);
    f.begin("one", messages("First question"));
    for (i, part) in answer.chars().collect::<Vec<_>>().chunks(500).enumerate() {
        f.delta("one", i as u32, &part.iter().collect::<String>());
    }
    f.complete("one", &answer);
    // The next request can omit old text for its outbound context budget.
    f.begin("two", messages("Second question"));
    f.delta("two", 0, "Second complete answer");
    f.complete("two", "Second complete answer");
    f.close();
    let transcript = f.messages();
    assert_eq!(
        transcript
            .iter()
            .filter(|m| m["role"] == "assistant")
            .count(),
        2
    );
    assert_eq!(transcript[2]["content"], answer);
    assert_eq!(transcript[4]["content"], "Second complete answer");
    let reopened = RunStore::open(&f.root)
        .unwrap()
        .snapshot(&f.opened.project_id, &f.opened.run_id)
        .unwrap();
    assert_eq!(reopened.run.status, RunStatus::Succeeded);
    assert!(reopened.requires_fresh_authorization);
    assert!(reopened.tool_calls.is_empty() && reopened.steps.is_empty());
    assert!(f
        .events()
        .iter()
        .any(|e| e.data["archiveFormat"] == "uagent.deepseek-chat-archive.v1"));
}
#[test]
fn cancelled_partial_is_durable_evidence_never_a_completed_turn() {
    let mut f = Fixture::new();
    f.begin("good", messages("Completed question"));
    f.complete("good", "Complete answer");
    f.begin("cancel", messages("Cancelled question"));
    let partial = "partial ".repeat(800);
    f.delta("cancel", 0, &partial);
    f.mutate(Mutation::Fail {
        request_id: "cancel".into(),
        cancelled: true,
    })
    .unwrap();
    f.close();
    let events = f.events();
    assert_eq!(
        events
            .iter()
            .filter(|e| e.kind == "model_completed")
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .find(|e| e.kind == "model_text_delta")
            .unwrap()
            .data["payload"]["text"],
        partial
    );
    assert_eq!(
        f.messages()
            .iter()
            .filter(|m| m["role"] == "assistant")
            .count(),
        1
    );
    assert_eq!(
        RunStore::open(&f.root)
            .unwrap()
            .snapshot(&f.opened.project_id, &f.opened.run_id)
            .unwrap()
            .run
            .status,
        RunStatus::Cancelled
    );
}
#[test]
fn failed_partial_and_unclosed_interruption_do_not_record_success() {
    let mut f = Fixture::new();
    f.begin("failed", messages("Question"));
    f.delta("failed", 0, "Actual partial");
    let before = RunStore::open(&f.root)
        .unwrap()
        .snapshot(&f.opened.project_id, &f.opened.run_id)
        .unwrap();
    assert_eq!(before.run.status, RunStatus::Running);
    assert!(before.requires_fresh_authorization);
    assert!(!f.events().iter().any(|e| e.kind == "model_completed"));
    f.mutate(Mutation::Fail {
        request_id: "failed".into(),
        cancelled: false,
    })
    .unwrap();
    f.close();
    assert_eq!(
        RunStore::open(&f.root)
            .unwrap()
            .snapshot(&f.opened.project_id, &f.opened.run_id)
            .unwrap()
            .run
            .status,
        RunStatus::Failed
    );
}
#[test]
fn delta_ack_retry_is_idempotent_and_gaps_or_false_completion_fail_without_writes() {
    let mut f = Fixture::new();
    f.begin("one", messages("Question"));
    f.delta("one", 0, "Exact partial");
    let count = f.events().len();
    f.delta("one", 0, "Exact partial");
    assert_eq!(f.events().len(), count);
    for mutation in [
        Mutation::Delta {
            request_id: "one".into(),
            index: 0,
            text: "different".into(),
        },
        Mutation::Delta {
            request_id: "one".into(),
            index: 2,
            text: "gap".into(),
        },
        Mutation::Complete {
            request_id: "one".into(),
            text: "fake success".into(),
            usage: None,
        },
    ] {
        assert!(f.mutate(mutation).is_err());
        assert_eq!(f.events().len(), count);
    }
    f.complete("one", "Exact partial");
    assert_eq!(f.messages().last().unwrap()["content"], "Exact partial");
    assert!(f
        .mutate(Mutation::Delta {
            request_id: "one".into(),
            index: 1,
            text: "late".into()
        })
        .is_err());
}
#[test]
fn foreign_window_and_old_generation_handles_never_write() {
    let mut f = Fixture::new();
    f.begin("one", messages("Question"));
    let old = f.opened.archive_handle.clone();
    let count = f.events().len();
    f.broker.rotate("foreign", true);
    assert!(f
        .broker
        .mutate(
            "foreign",
            MutationInput {
                schema_version: 1,
                archive_handle: old.clone(),
                mutation: Mutation::Delta {
                    request_id: "one".into(),
                    index: 0,
                    text: "foreign".into()
                }
            }
        )
        .is_err());
    assert_eq!(f.events().len(), count);
    for mut entry in f.broker.rotate("owned", false) {
        entry.archive.finish_conversation().unwrap();
    }
    assert!(f.broker.open("owned", &f.root, input(None)).is_err());
    f.broker.rotate("owned", true);
    assert!(f
        .broker
        .mutate(
            "owned",
            MutationInput {
                schema_version: 1,
                archive_handle: old,
                mutation: Mutation::Complete {
                    request_id: "one".into(),
                    text: "old".into(),
                    usage: None
                }
            }
        )
        .is_err());
    let reopened = Broker::default();
    assert!(reopened.entries.is_empty());
    assert!(!f.events().iter().any(|e| e.kind == "model_completed"));
}
#[test]
fn project_namespaces_and_new_runs_preserve_prior_records() {
    let mut f = Fixture::new();
    f.begin("one", messages("Local only"));
    f.complete("one", "Local reply");
    f.close();
    let before = f.messages();
    let a = f.broker.open("owned", &f.root, input(Some("A"))).unwrap();
    let b = f.broker.open("owned", &f.root, input(Some("B"))).unwrap();
    assert_eq!(a.project_id, "chat:project:A");
    assert_eq!(b.project_id, "chat:project:B");
    assert_ne!(a.archive_handle, b.archive_handle);
    assert_ne!(a.run_id, b.run_id);
    assert_eq!(f.messages(), before);
}
#[test]
fn other_models_tools_and_structured_authority_are_rejected() {
    let mut f = Fixture::new();
    let mut other = input(None);
    other.model_id = "other-model".into();
    assert!(f.broker.open("owned", &f.root, other).is_err());
    assert!(serde_json::from_value::<OpenInput>(json!({"schemaVersion":1,"providerId":"deepseek","modelId":"deepseek-flash","conversationId":"x","logicalProjectId":null,"credential":"synthetic-do-not-save"})).is_err());
    assert!(f
        .mutate(Mutation::Begin {
            request_id: "bad".into(),
            messages: vec![json!({"role":"user","content":"text","approval":"not authority"})]
        })
        .is_err());
    assert!(f
        .mutate(Mutation::Begin {
            request_id: "tool".into(),
            messages: vec![json!({"role":"tool","content":"not selected"})]
        })
        .is_err());
    assert!(f.messages().is_empty());
}
#[test]
fn stop_after_provider_completion_keeps_bytes_but_retracts_completed_delivery() {
    let mut f = Fixture::new();
    f.begin("one", messages("Question"));
    f.delta("one", 0, "Full provider reply");
    f.complete("one", "Full provider reply");
    f.mutate(Mutation::Fail {
        request_id: "one".into(),
        cancelled: true,
    })
    .unwrap();
    f.close();
    assert_eq!(
        f.messages().last().unwrap()["content"],
        "Full provider reply"
    );
    let events = f.events();
    let last = events
        .iter()
        .filter(|e| e.kind == "coordinator_state_v1")
        .last()
        .unwrap();
    assert_eq!(last.data["lastRequestStatus"], "cancelled");
    assert_eq!(
        RunStore::open(&f.root)
            .unwrap()
            .snapshot(&f.opened.project_id, &f.opened.run_id)
            .unwrap()
            .run
            .status,
        RunStatus::Cancelled
    );
}
#[test]
fn attachment_bearing_request_is_archived_but_ineligible_for_implicit_context() {
    let mut f = Fixture::new();
    let mut m = messages("Typed question");
    m.push(json!({"role":"user","content":"User-selected reference"}));
    f.begin("one", m);
    f.complete("one", "Answer");
    let event = f
        .events()
        .into_iter()
        .find(|e| e.kind == "model_started")
        .unwrap();
    assert_eq!(event.data["payload"]["contextEligible"], false);
    assert!(f
        .messages()
        .iter()
        .any(|m| m["content"] == "User-selected reference"));
}
