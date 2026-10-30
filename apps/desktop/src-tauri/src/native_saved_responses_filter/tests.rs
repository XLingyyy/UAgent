use super::*;
use serde_json::json;

const KEY: &str = "sk-synthetic-filter-key-9876";

fn filter() -> SavedResponsesFilter {
    SavedResponsesFilter::new(KEY.as_bytes().to_vec()).unwrap()
}
fn frame(value: Value) -> Vec<u8> {
    format!(
        "event: {}\ndata: {}\n\n",
        value["type"].as_str().unwrap(),
        value
    )
    .into_bytes()
}
fn delta(text: &str, sequence: u64) -> Vec<u8> {
    frame(
        json!({"type":"response.output_text.delta","sequence_number":sequence,
        "output_index":0,"content_index":0,"item_id":"message-one","delta":text}),
    )
}
fn done(text: &str, sequence: u64) -> Vec<u8> {
    frame(
        json!({"type":"response.output_text.done","sequence_number":sequence,
        "output_index":0,"content_index":0,"item_id":"message-one","text":text}),
    )
}
fn terminal(text: &str, sequence: u64) -> Vec<u8> {
    frame(
        json!({"type":"response.completed","sequence_number":sequence,"response":{
        "id":"response-one","model":"synthetic-model-2026-10-30","status":"completed",
        "created_at":1,"usage":null,"output":[{"id":"message-one","type":"message",
        "role":"assistant","status":"completed","content":[{"type":"output_text","text":text}]}]}}),
    )
}
fn complete_stream(text: &str) -> Vec<u8> {
    [
        frame(
            json!({"type":"response.created","sequence_number":0,"response":{
            "id":"response-one","model":"synthetic-model-2026-10-30","status":"in_progress",
            "created_at":1,"usage":null,"output":[]}}),
        ),
        frame(
            json!({"type":"response.output_item.added","sequence_number":1,
            "output_index":0,"item":{"id":"message-one","type":"message","role":"assistant",
            "status":"in_progress","content":[]}}),
        ),
        delta(text, 2),
        done(text, 3),
        frame(
            json!({"type":"response.output_item.done","sequence_number":4,
            "output_index":0,"item":{"id":"message-one","type":"message","role":"assistant",
            "status":"completed","content":[{"type":"output_text","text":text}]}}),
        ),
        terminal(text, 5),
    ]
    .concat()
}
#[test]
fn normal_frames_preserve_exact_bytes_and_emit_incrementally() {
    let mut filter = filter();
    let first = delta("Plain normal text.", 1);
    assert_eq!(filter.push(&first).unwrap().concat(), first);
    let last = terminal("Plain normal text.", 2);
    assert_eq!(filter.push(&last).unwrap().concat(), last);
    assert!(filter.finish().unwrap().is_empty());
}
#[test]
fn unknown_usage_created_metadata_and_unicode_keep_original_wire_bytes() {
    let input = complete_stream("Hello \u{4e2d}\u{6587} \u{1f9ed}.");
    let mut filter = filter();
    let mut actual = Vec::new();
    for byte in &input {
        actual.extend(filter.push(&[*byte]).unwrap().concat());
    }
    actual.extend(filter.finish().unwrap().concat());
    assert_eq!(actual, input);
}
#[test]
fn every_raw_byte_boundary_keeps_normal_sse_identity_and_sequence() {
    let input = complete_stream("Bounded plain Unicode \u{4e16}\u{754c}.");
    for split in 0..input.len() {
        let mut filter = filter();
        let mut actual = filter.push(&input[..split]).unwrap().concat();
        actual.extend(filter.push(&input[split..]).unwrap().concat());
        actual.extend(filter.finish().unwrap().concat());
        assert_eq!(actual, input, "split {split}");
    }
}
#[test]
fn crlf_cr_and_mixed_line_endings_remain_exact() {
    for newline in ["\r\n", "\r"] {
        let input = String::from_utf8(complete_stream("Normal ending."))
            .unwrap()
            .replace('\n', newline)
            .into_bytes();
        let mut filter = filter();
        let mut actual = Vec::new();
        for byte in &input {
            actual.extend(filter.push(&[*byte]).unwrap().concat());
        }
        actual.extend(filter.finish().unwrap().concat());
        assert_eq!(actual, input);
    }
}
#[test]
fn full_literal_or_decoded_key_is_rejected_without_a_frame() {
    for value in [
        json!({"type":"response.created","response":{"id":KEY}}),
        json!({"type":"response.created","response":{"metadata":{"value":KEY}}}),
        json!({"type":"response.created","response":{KEY:"ignored"}}),
        json!({"type":"response.created","response":{"arguments":format!(r#"{{"\u0073k-synthetic-filter-key-9876":"x"}}"#)}}),
    ] {
        let mut filter = filter();
        assert!(filter.push(&frame(value)).is_err());
        assert!(filter.finish().is_err());
    }
    let escaped = br#"event: response.created
data: {"type":"response.created","response":{"value":"\u0073k-synthetic-filter-key-9876"}}

"#;
    assert!(filter().push(escaped).is_err());
}
#[test]
fn every_text_delta_split_withholds_the_credential_prefix_frame() {
    for split in 1..KEY.len() {
        let mut filter = filter();
        let first = delta(&format!("Benign prefix: {}", &KEY[..split]), 0);
        assert!(
            filter.push(&first).unwrap().is_empty(),
            "prefix split {split}"
        );
        assert!(
            filter.push(&delta(&KEY[split..], 1)).is_err(),
            "split {split}"
        );
        assert!(
            filter.push(&terminal("ignored", 2)).is_err(),
            "sticky split {split}"
        );
    }
}
#[test]
fn json_escaped_delta_prefix_and_suffix_are_detected_after_decoding() {
    for split in [1, 3, 8, KEY.len() - 1] {
        let escaped_prefix = KEY[..split]
            .bytes()
            .map(|b| format!("\\u{b:04x}"))
            .collect::<String>();
        let escaped_suffix = KEY[split..]
            .bytes()
            .map(|b| format!("\\u{b:04x}"))
            .collect::<String>();
        let first=format!("data: {{\"type\":\"response.output_text.delta\",\"sequence_number\":0,\"output_index\":0,\"content_index\":0,\"delta\":\"{escaped_prefix}\"}}\n\n");
        let last=format!("data: {{\"type\":\"response.output_text.delta\",\"sequence_number\":1,\"output_index\":0,\"content_index\":0,\"delta\":\"{escaped_suffix}\"}}\n\n");
        let mut filter = filter();
        for byte in first.bytes() {
            assert!(filter.push(&[byte]).unwrap().is_empty());
        }
        let mut rejected = false;
        for byte in last.bytes() {
            if filter.push(&[byte]).is_err() {
                rejected = true;
                break;
            }
        }
        assert!(rejected);
    }
}
#[test]
fn prefix_mismatch_releases_all_original_frames_in_order() {
    let first = delta("This is sk-syn", 0);
    let second = delta("apse, ordinary text.", 1);
    let mut filter = filter();
    assert!(filter.push(&first).unwrap().is_empty());
    assert_eq!(
        filter.push(&second).unwrap().concat(),
        [first, second].concat()
    );
    let end = terminal("This is sk-synapse, ordinary text.", 2);
    assert_eq!(filter.push(&end).unwrap().concat(), end);
    filter.finish().unwrap();
}
#[test]
fn legal_final_prefix_flushes_only_after_full_safe_terminal() {
    let text = "A plain answer ends in sk-syn";
    let first = delta(text, 0);
    let final_part = done(text, 1);
    let end = terminal(text, 2);
    let mut filter = filter();
    assert!(filter.push(&first).unwrap().is_empty());
    assert!(filter.push(&final_part).unwrap().is_empty());
    assert_eq!(
        filter.push(&end).unwrap().concat(),
        [first, final_part, end].concat()
    );
    assert!(filter.finish().unwrap().is_empty());
}
#[test]
fn key_across_visible_content_parts_or_refusal_is_rejected() {
    let mut filter = filter();
    let left = &KEY[..10];
    let right = &KEY[10..];
    assert!(filter.push(&delta(left, 0)).unwrap().is_empty());
    assert!(filter.push(&done(left, 1)).unwrap().is_empty());
    let second = frame(json!({"type":"response.refusal.delta","sequence_number":2,
        "output_index":1,"content_index":0,"item_id":"message-two","delta":right}));
    assert!(filter.push(&second).is_err());
}
#[test]
fn final_text_suffix_and_terminal_cross_part_echo_are_not_forwarded() {
    let mut filter = filter();
    assert!(filter.push(&delta(&KEY[..8], 0)).unwrap().is_empty());
    assert!(filter.push(&done(KEY, 1)).is_err());
    let mut filter = SavedResponsesFilter::new(KEY.as_bytes().to_vec()).unwrap();
    let value = json!({"type":"response.completed","response":{"status":"completed","output":[
        {"type":"message","role":"assistant","content":[
            {"type":"output_text","text":&KEY[..8]},{"type":"refusal","refusal":&KEY[8..]}]}]}});
    assert!(filter.push(&frame(value)).is_err());
}
#[test]
fn reasoning_prefix_survives_interleaved_channels_until_safe_or_rejected() {
    let reason = |text: &str, item: &str, sequence| {
        frame(json!({"type":"response.reasoning_text.delta",
        "sequence_number":sequence,"item_id":item,"output_index":0,"delta":text}))
    };
    let mut filter = filter();
    assert!(filter
        .push(&reason(&KEY[..9], "reason-one", 0))
        .unwrap()
        .is_empty());
    assert!(filter
        .push(&reason("unrelated text.", "reason-two", 1))
        .unwrap()
        .is_empty());
    assert!(filter.push(&reason(&KEY[9..], "reason-one", 2)).is_err());
}
#[test]
fn ordinary_saved_path_never_forwards_function_calls_even_without_a_secret() {
    for value in [
        json!({"type":"response.function_call_arguments.delta","delta":"{\"safe\":true}"}),
        json!({"type":"response.output_item.added","item":{"type":"function_call","arguments":"{}"}}),
        json!({"type":"response.completed","response":{"status":"completed",
            "output":[{"type":"function_call","arguments":"{}"}]}}),
    ] {
        assert!(filter().push(&frame(value)).is_err());
    }
}
#[test]
fn error_cancelled_failed_and_uncertain_eof_do_not_flush_pending_prefixes() {
    for kind in ["error", "response.failed", "response.cancelled"] {
        let mut filter = filter();
        assert!(filter.push(&delta(&KEY[..6], 0)).unwrap().is_empty());
        assert!(filter
            .push(&frame(
                json!({"type":kind,"message":"remote details not exposed"})
            ))
            .is_err());
        assert!(filter.finish().is_err());
    }
    let mut filter = filter();
    assert!(filter.push(&delta(&KEY[..6], 0)).unwrap().is_empty());
    assert!(filter.finish().is_err());
}
#[test]
fn valid_max_output_incomplete_preserves_length_terminal_but_not_other_incomplete() {
    let mut filter = filter();
    let value = json!({"type":"response.incomplete","response":{"status":"incomplete","output":[],
        "incomplete_details":{"reason":"max_output_tokens"},"usage":null}});
    let input = frame(value);
    assert_eq!(filter.push(&input).unwrap().concat(), input);
    filter.finish().unwrap();
    let value = json!({"type":"response.incomplete","response":{"status":"incomplete","output":[],
        "incomplete_details":{"reason":"content_filter"}}});
    assert!(SavedResponsesFilter::new(KEY.as_bytes().to_vec())
        .unwrap()
        .push(&frame(value))
        .is_err());
}
#[test]
fn duplicate_sequence_event_name_mismatch_truncation_and_invalid_utf8_fail_closed() {
    let mut filter = filter();
    filter.push(&delta("First.", 1)).unwrap();
    assert!(filter.push(&delta("Second.", 1)).is_err());
    assert!(SavedResponsesFilter::new(KEY.as_bytes().to_vec())
        .unwrap()
        .push(b"event: response.created\ndata: {\"type\":\"response.in_progress\"}\n\n")
        .is_err());
    let mut filter = SavedResponsesFilter::new(KEY.as_bytes().to_vec()).unwrap();
    filter
        .push(b"data: {\"type\":\"response.created\"")
        .unwrap();
    assert!(filter.finish().is_err());
    assert!(SavedResponsesFilter::new(KEY.as_bytes().to_vec())
        .unwrap()
        .push(b"data: \xff\n\n")
        .is_err());
}
#[test]
fn frame_chunk_total_and_post_terminal_bounds_are_enforced() {
    assert!(filter().push(&vec![b'x'; MAX_CHUNK + 1]).is_err());
    let mut f = filter();
    for _ in 0..MAX_FRAME / MAX_CHUNK {
        f.push(&vec![b'x'; MAX_CHUNK]).unwrap();
    }
    assert!(f.push(b"x").is_err());
    let mut f = filter();
    let frame = [b": ".to_vec(), vec![b'x'; 59_995], b"\n\n".to_vec()].concat();
    for _ in 0..69 {
        f.push(&frame).unwrap();
    }
    assert!(f.push(&frame).is_err());
    let mut f = filter();
    f.push(&terminal("", 0)).unwrap();
    f.finish().unwrap();
    assert!(f.push(&delta("later", 1)).is_err());
}
#[test]
fn large_terminal_frame_is_byte_exact_but_ipc_chunks_stay_bounded() {
    let text = "A long ordinary answer. ".repeat(5000);
    let input = complete_stream(&text);
    let mut filter = filter();
    let mut output = Vec::new();
    for chunk in input.chunks(8192) {
        let released = filter.push(chunk).unwrap();
        assert!(released.iter().all(|chunk| chunk.len() <= MAX_CHUNK));
        output.extend(released.concat());
    }
    output.extend(filter.finish().unwrap().concat());
    assert_eq!(output, input);
}
#[test]
fn invalid_credentials_and_unfinished_keepalive_are_rejected() {
    for key in [
        vec![],
        b"short".to_vec(),
        vec![b'x'; 2049],
        b"spaces not allowed".to_vec(),
        vec![0xff; 8],
    ] {
        assert!(SavedResponsesFilter::new(key).is_err());
    }
    let mut f = filter();
    let comment = b": local keepalive\n\n";
    assert_eq!(f.push(comment).unwrap().concat(), comment);
    assert!(f.finish().is_err(), "No synthetic completion is invented.");
}
