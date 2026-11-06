//! Central cross-language IPC and shared opener regressions. Synthetic data only.
use crate::{local_run_store as records,project_memory_commands as memory,session_catalog_commands as catalog};
use serde_json::json;

#[test]
fn catalog_request_uses_camel_case_and_rejects_renderer_authority_fields(){
    let value=json!({"schemaVersion":1,"projectId":"A","requestId":"r1","includeArchived":false,"offset":0,"limit":30});
    let input:catalog::ListInput=serde_json::from_value(value.clone()).unwrap();
    assert_eq!(input.project_id,"A");assert_eq!(input.request_id,"r1");
    for key in ["window","owner","lease","approval"]{
        let mut bad=value.clone();bad[key]=json!("old-token");
        assert!(serde_json::from_value::<catalog::ListInput>(bad).is_err());
    }
    let mut bad=value.clone();bad.as_object_mut().unwrap().remove("requestId");
    assert!(serde_json::from_value::<catalog::ListInput>(bad).is_err());
    let mut bad=value;bad["offset"]=json!(0.5);
    assert!(serde_json::from_value::<catalog::ListInput>(bad).is_err());
}
#[test]
fn field_patch_wire_contract_keeps_rename_and_archive_conflicts_independent(){
    for patch in [json!({"kind":"rename","title":"Next","expectedTitle":"Before"}),
        json!({"kind":"setArchived","archived":true,"expectedArchived":false})]{
        let input:catalog::UpdateInput=serde_json::from_value(json!({"schemaVersion":1,"projectId":"A","requestId":"r2","sessionId":"s1","patch":patch})).unwrap();
        assert_eq!(serde_json::to_value(input.patch).unwrap(),patch);
    }
    for patch in [json!({"kind":"rename","title":"Next","expected_title":"Before"}),
        json!({"kind":"rename","title":"Next","expectedTitle":"Before","archived":true}),
        json!({"kind":"setArchived","archived":true})]{
        assert!(serde_json::from_value::<catalog::SessionPatch>(patch).is_err());
    }
}
#[test]
fn catalog_read_echo_flattens_session_and_requires_fresh_authorization(){
    let result=catalog::ReadResult{schema_version:1,project_id:"A".into(),request_id:"r3".into(),
        session:records::session_catalog::CatalogSession{session:records::Session{
            project_id:"A".into(),id:"s1".into(),title:"Saved".into(),created_at:1,archived:false,parent_id:None,origin:records::Origin::Native},
            message_count:1,last_ordinal:1,latest_run_id:None},through_ordinal:1,prefix_message_count:1,
        messages:vec![records::Message{project_id:"A".into(),session_id:"s1".into(),id:"m1".into(),ordinal:1,
            role:records::Role::Tool,body:"Quoted archive data".into(),created_at:1,origin:records::Origin::HistoricalTextCopy}],
        requires_fresh_authorization:true};
    let wire=serde_json::to_value(result).unwrap();
    assert_eq!(wire["prefixMessageCount"],1);assert_eq!(wire["requiresFreshAuthorization"],true);
    assert_eq!(wire["session"]["id"],"s1");assert!(wire["session"].get("session").is_none());
    assert_eq!(wire["messages"][0]["role"],"tool");assert_eq!(wire["messages"][0]["origin"],"historicalTextCopy");
    for key in ["approval","scope","owner","credential"]{assert!(wire.get(key).is_none());}
}
#[test]
fn memory_update_accepts_expected_revision_and_exact_mutation_tags(){
    let value=json!({"schemaVersion":1,"projectId":"A","id":"m1","expectedRevision":1,"mutation":{"type":"markStale"}});
    let input:memory::MemoryUpdateInput=serde_json::from_value(value.clone()).unwrap();
    assert_eq!(input.expected_revision,1);
    assert!(matches!(input.mutation,records::project_memory::MemoryMutation::MarkStale));
    for key in ["window","cancelled","deadline","writerFence"]{
        let mut bad=value.clone();bad[key]=json!(true);
        assert!(serde_json::from_value::<memory::MemoryUpdateInput>(bad).is_err());
    }
    let mut bad=value;bad["mutation"]=json!({"type":"mark_stale"});
    assert!(serde_json::from_value::<memory::MemoryUpdateInput>(bad).is_err());
}
#[test]
fn memory_content_contract_preserves_private_default_input_and_nullable_origins(){
    let content=json!({"kind":"todo","body":"Synthetic task","sourceRefs":[],"sharePaths":[],"priority":"normal","visibility":"private",
        "origin":{"kind":"user","sessionId":null,"messageId":null},"readAt":1});
    let value=json!({"schemaVersion":1,"projectId":"A","id":"m1","content":content});
    let input:memory::MemoryCreateInput=serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(input.content).unwrap(),content);
    let mut bad=value;bad["content"]["owner"]=json!("restored");
    assert!(serde_json::from_value::<memory::MemoryCreateInput>(bad).is_err());
}
#[test]
fn nested_run_settings_and_continuation_opens_share_a_reentrant_native_gate(){
    let base=std::path::PathBuf::from(std::env::var_os("UAGENT_MANAGED_STORE_TEST_ROOT")
        .expect("set an E:/G: retained synthetic fixture root in the protected native profile"));
    let base=std::fs::canonicalize(base).unwrap();
    use std::path::{Component,Prefix};
    assert!(matches!(base.components().next(),Some(Component::Prefix(prefix))
        if matches!(prefix.kind(),Prefix::Disk(drive)|Prefix::VerbatimDisk(drive) if matches!(drive.to_ascii_uppercase(),b'E'|b'G'))));
    let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root=base.join(format!("shared-openers-{}-{stamp}",std::process::id()));
    let run=records::RunStore::open(&root).unwrap();
    let settings=crate::product_settings_store::ProductSettingsStore::open(&root).unwrap();
    let continuation=crate::provider_continuation_store::ProviderContinuationStore::open(&root).unwrap();
    assert_eq!(run.schema_version().unwrap(),3);
    assert_eq!(settings.schema_version().unwrap(),crate::product_settings_store::SETTINGS_SCHEMA_VERSION);
    drop(continuation);drop(settings);drop(run);
    assert_eq!(records::RunStore::open(&root).unwrap().schema_version().unwrap(),3);
    // All fixtures remain on E:/G: as acceptance evidence. No deletion or provider API.
}
