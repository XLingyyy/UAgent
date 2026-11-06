//! Static test source only in B delivery. No grant fixture or transport substitute.
use super::*;
use crate::local_run_store::project_memory::{MemoryConfirmation, MemoryOrigin, MemorySource};
use serde_json::json;

fn row(id: &str) -> ProjectMemory {
    ProjectMemory {
        id: id.into(), project_id: "project-fixture-data".into(), kind: "decision".into(),
        body: "Synthetic descriptive decision only".into(), source_refs: vec![],
        share_paths: vec!["notes".into()], priority: "normal".into(), visibility: "project".into(),
        origin: MemoryOrigin { kind: "user".into(), session_id: None, message_id: None },
        read_at: 10, validity: "valid".into(), revision: 1,
        confirmation: Some(MemoryConfirmation { kind: "user".into(), confirmed_at: 11 }),
    }
}
fn selected(rows: Vec<ProjectMemory>) -> FrozenSelection {
    freeze_selection("project-fixture-data", rows, MAX_CONTEXT_BYTES).unwrap()
}
fn wire(selection: &FrozenSelection) -> Value {
    json!({ "model":"synthetic-model", "store":false, "input":[
        {"type":"message","role":"system","content":[{"type":"input_text","text":"Synthetic system"}]},
        {"type":"message","role":"developer","content":[{"type":"input_text","text":"Synthetic constraints"}]},
        {"type":"message","role":"user","content":[{"type":"input_text","text":selection.message}]},
        {"type":"message","role":"user","content":[{"type":"input_text","text":"Synthetic request"}]}
    ]})
}
fn valid(value: &Value, selection: &FrozenSelection) -> bool {
    validate_wire(&serde_json::to_vec(value).unwrap(), selection).is_ok()
}

#[test]
fn canonical_native_section_preserves_member_order_and_all_reviewed_text() {
    let mut second = row("B");
    second.body = "Synthetic UTF-8: \u{4e2d}\u{6587}, quotes \" and newline\n".into();
    let frozen = selected(vec![row("A"), second.clone()]);
    let projected: Value = serde_json::from_str(frozen.message.strip_prefix(MEMORY_PREFIX).unwrap()).unwrap();
    assert_eq!(projected[0]["id"], "A");
    assert_eq!(projected[1]["id"], "B");
    assert_eq!(projected[1]["body"], second.body);
    assert_eq!(hex(&Sha256::digest(frozen.message.as_bytes())), hex(&frozen.section_sha256));
    assert!(valid(&wire(&frozen), &frozen));
}

#[test]
fn ui_file_fact_preserves_freshness_in_original_rows_and_canonical_section() {
    let mut fact = row("file-fact");
    fact.kind = "fact".into();
    fact.source_refs = vec![MemorySource {
        project_id: fact.project_id.clone(), path: "notes/synthetic.txt".into(),
        kind: "file_preview".into(), version: "meta-v1:synthetic".into(),
        freshness: Some("meta-v1:synthetic".into()),
    }];
    let frozen = selected(vec![fact.clone()]);
    assert_eq!(frozen.rows, vec![fact.clone()]);
    let projected: Value = serde_json::from_str(frozen.message.strip_prefix(MEMORY_PREFIX).unwrap()).unwrap();
    assert_eq!(projected[0]["sourceRefs"][0]["freshness"], "meta-v1:synthetic");
    assert!(valid(&wire(&frozen), &frozen));
    let mut removed_freshness = fact.clone(); removed_freshness.source_refs[0].freshness = None;
    assert!(compare_rows(&frozen.rows, &[removed_freshness]).is_err());
    assert_eq!(fact.source_refs[0].freshness.as_deref(), Some(fact.source_refs[0].version.as_str()));
    // Pure rows/serialization only. It does not create a live grant or establish
    // A transaction + MemoryBatch::capture acceptance without central evidence.
}

#[test]
fn transaction_comparison_checks_full_rows_and_original_order() {
    let original = vec![row("A"), row("B")];
    assert!(compare_rows(&original, &original).is_ok());
    for field in ["body", "share", "source", "confirmation", "origin", "readAt", "priority", "revision", "visibility", "validity", "project"] {
        let mut changed = original.clone();
        let item = &mut changed[0];
        match field {
            "body" => item.body.push('!'),
            "share" => item.share_paths.push("other".into()),
            "source" => item.source_refs.push(MemorySource { project_id: item.project_id.clone(), path: "notes/a.txt".into(), version: "meta-v1:synthetic".into(), kind: "file_preview".into(), freshness: None }),
            "confirmation" => item.confirmation.as_mut().unwrap().confirmed_at += 1,
            "origin" => item.origin.kind = "model".into(),
            "readAt" => item.read_at += 1,
            "priority" => item.priority = "constraint".into(),
            "revision" => item.revision += 1,
            "visibility" => item.visibility = "private".into(),
            "validity" => item.validity = "stale".into(),
            _ => item.project_id = "other-project".into(),
        }
        assert_eq!(compare_rows(&original, &changed), Err("memory_selection_changed"), "{field}");
    }
    assert!(compare_rows(&original, &original[..1]).is_err());
    let mut swapped = original.clone(); swapped.swap(0, 1);
    assert!(compare_rows(&original, &swapped).is_err());
}

#[test]
fn invalid_member_rejects_whole_selection_without_omission() {
    for invalid in ["private", "pending", "unconfirmed", "other-project", "missing-source"] {
        let mut item = row("B");
        match invalid {
            "private" => item.visibility = "private".into(),
            "pending" => item.validity = "pending".into(),
            "unconfirmed" => item.confirmation = None,
            "other-project" => item.project_id = "other-project".into(),
            _ => item.kind = "fact".into(),
        }
        assert!(freeze_selection("project-fixture-data", vec![row("A"), item], MAX_CONTEXT_BYTES).is_err(), "{invalid}");
    }
    assert!(freeze_selection("project-fixture-data", vec![row("A"), row("A")], MAX_CONTEXT_BYTES).is_err());
    assert!(freeze_selection("project-fixture-data", vec![], MAX_CONTEXT_BYTES).is_err());
}

#[test]
fn budget_and_selected_count_reject_instead_of_truncate() {
    let too_many = (0..257).map(|i| row(&format!("id-{i}"))).collect();
    assert!(freeze_selection("project-fixture-data", too_many, MAX_CONTEXT_BYTES).is_err());
    assert!(freeze_selection("project-fixture-data", vec![row("A")], 32).is_err());
    assert!(freeze_selection("project-fixture-data", vec![row("A")], MAX_CONTEXT_BYTES + 1).is_err());
    let mut frozen = selected(vec![row("A")]);
    let body = wire(&frozen);
    frozen.max_context_bytes = frozen.message.len();
    assert!(!valid(&body, &frozen)); // full input budget, not memory text alone
}

#[test]
fn exact_responses_slot_rejects_missing_double_and_wrong_location() {
    let frozen = selected(vec![row("A")]);
    let original = wire(&frozen);
    for mode in ["missing", "double", "instructions", "role", "string", "part-type", "extra-part", "extra-field"] {
        let mut value = original.clone();
        match mode {
            "missing" => { value["input"].as_array_mut().unwrap().remove(MEMORY_INDEX); },
            "double" => { value["input"].as_array_mut().unwrap().push(original["input"][MEMORY_INDEX].clone()); },
            "instructions" => {
                value["input"][MEMORY_INDEX]["content"][0]["text"] = json!("ordinary user data");
                value["instructions"] = json!(frozen.message);
            },
            "role" => value["input"][MEMORY_INDEX]["role"] = json!("developer"),
            "string" => value["input"][MEMORY_INDEX]["content"] = json!(frozen.message),
            "part-type" => value["input"][MEMORY_INDEX]["content"][0]["type"] = json!("output_text"),
            "extra-part" => value["input"][MEMORY_INDEX]["content"].as_array_mut().unwrap().push(json!({"type":"input_text","text":"extra"})),
            _ => value["input"][MEMORY_INDEX]["memoryAllowed"] = json!(true),
        }
        assert!(!valid(&value, &frozen), "{mode}");
    }
}

#[test]
fn member_deletion_reorder_or_one_byte_edit_cannot_match_native_section() {
    let frozen = selected(vec![row("A"), row("B")]);
    let changed_sections = [
        selected(vec![row("A")]).message,
        selected(vec![row("B"), row("A")]).message,
        format!("{} ", frozen.message),
    ];
    for changed in changed_sections {
        let mut value = wire(&frozen);
        value["input"][MEMORY_INDEX]["content"][0]["text"] = json!(changed);
        assert!(!valid(&value, &frozen));
    }
}

#[test]
fn every_duplicate_json_key_is_rejected_including_escaped_spelling() {
    let frozen = selected(vec![row("A")]);
    let body = serde_json::to_string(&wire(&frozen)).unwrap();
    let duplicates = [
        body.replacen("\"model\":\"synthetic-model\"", "\"model\":\"synthetic-model\",\"model\":\"synthetic-model\"", 1),
        body.replacen("\"model\":\"synthetic-model\"", "\"model\":\"synthetic-model\",\"\\u006dodel\":\"synthetic-model\"", 1),
        body.replacen("\"input\":", "\"input\":[],\"input\":", 1),
        body.replacen("\"role\":\"system\"", "\"role\":\"system\",\"role\":\"system\"", 1),
        body.replacen("\"type\":\"input_text\"", "\"type\":\"input_text\",\"type\":\"input_text\"", 1),
    ];
    for duplicate in duplicates {
        assert_ne!(duplicate, body);
        assert_eq!(validate_wire(duplicate.as_bytes(), &frozen), Err("memory_body_invalid"));
    }
}

#[test]
fn malformed_oversized_deep_and_trailing_json_are_rejected() {
    let frozen = selected(vec![row("A")]);
    assert!(validate_wire(&[0xff], &frozen).is_err());
    assert!(validate_wire(&vec![b' '; MAX_REQUEST_BYTES + 1], &frozen).is_err());
    let trailing = format!("{} {{}}", serde_json::to_string(&wire(&frozen)).unwrap());
    assert!(validate_wire(trailing.as_bytes(), &frozen).is_err());
    let mut nested = json!(null);
    for _ in 0..66 { nested = json!([nested]); }
    let mut value = wire(&frozen); value["unknown"] = nested;
    assert!(!valid(&value, &frozen));
}

#[test]
fn body_attachment_is_one_shot_even_after_abandoning_first_attachment() {
    let attachment = BatchAttachment::new();
    assert_eq!(attachment.take(), Ok(()));
    assert_eq!(attachment.take(), Err("memory_batch_replayed"));
    assert_eq!(attachment.take(), Err("memory_batch_replayed"));
}

#[test]
fn concurrent_body_attachments_have_exactly_one_winner() {
    let attachment = BatchAttachment::new();
    let barrier = std::sync::Barrier::new(4);
    let wins = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..4).map(|_| scope.spawn(|| {
            barrier.wait();
            attachment.take().is_ok()
        })).collect();
        workers.into_iter().map(|worker| worker.join().unwrap()).filter(|won| *won).count()
    });
    assert_eq!(wins, 1);
    assert_eq!(attachment.take(), Err("memory_batch_replayed"));
}

#[test]
fn equal_hash_or_bytes_cannot_replace_original_native_allocation() {
    let original: Arc<[u8]> = b"synthetic exact body".to_vec().into();
    let same = Arc::clone(&original);
    let equal_copy: Arc<[u8]> = original.to_vec().into();
    assert_eq!(Sha256::digest(&original), Sha256::digest(&equal_copy));
    assert!(same_allocation(&original, &same));
    assert!(!same_allocation(&original, &equal_copy));
    let instance = Arc::new(()); let other = Arc::new(());
    assert!(!same_allocation(&instance, &other));
}

#[test]
fn approved_snapshot_keeps_original_rows_and_wire_when_catalog_values_change() {
    let mut rows = vec![row("snapshot")];
    let frozen = selected(rows.clone());
    let reviewed = serde_json::to_vec(&wire(&frozen)).unwrap();
    rows[0].body = "Changed later".into();
    rows[0].visibility = "private".into();
    rows[0].revision += 1;
    // A change BEFORE final admission must still fail the full-row comparison.
    assert!(compare_rows(&frozen.rows, &rows).is_err());
    // A change AFTER admission cannot replace any byte of the original request.
    assert_eq!(serde_json::to_vec(&wire(&frozen)).unwrap(), reviewed);
    assert!(validate_wire(&reviewed, &frozen).is_ok());
    assert_ne!(frozen.rows, rows);
}
