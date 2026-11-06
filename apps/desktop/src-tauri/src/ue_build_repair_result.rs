//! Durable before-image and native source-write result. Never a saved write authorization.
use crate::{local_run_store::{self as store,effect_reconciliation as effect},trusted_root_handle::TrustedRootHandle,
    ue_build_repair::{RepairJournal,RepairRecoveryBundle,NativeRepairPreview,RepairApplyReceipt},runtime_host_recovery_catalog::PersistentRecoveryCatalog};
use std::{sync::atomic::{AtomicBool,Ordering},time::{SystemTime,UNIX_EPOCH}};
fn now()->i64{SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_millis() as i64).unwrap_or(0)}
fn err()->store::StoreError{store::StoreError{kind:"repairResultInvalid".into(),message:"native repair persistence failed".into()}}
pub(crate) struct StoreRepairJournal<'a>{db:&'a store::RunStore,intent:&'a effect::EffectIntent,pub checkpoint_written:bool}
impl<'a> StoreRepairJournal<'a>{pub fn new(db:&'a store::RunStore,intent:&'a effect::EffectIntent)->Self{Self{db,intent,checkpoint_written:false}}}
fn checkpoint(db:&store::RunStore,intent:&effect::EffectIntent,revision:i64,status:store::RunStatus,kind:&str,bytes:&[u8])->store::Result<String>{
    let artifact=db.put_artifact(&intent.key.project_id,bytes)?;let at=now();
    db.commit_checkpoint(&intent.key.project_id,&intent.owner.run_id,revision,&store::CheckpointBatch{status,
        checkpoint:store::Checkpoint{next_step_id:None,reason:kind.into(),summary:intent.plan_summary.clone(),captured_at:at},messages:vec![],steps:vec![],tool_calls:vec![],changesets:vec![],
        events:vec![store::RunEvent{id:kind.into(),kind:kind.into(),created_at:at,data:serde_json::json!({"planDigest":intent.approved_plan_digest,"artifactSha256":artifact.sha256})}],
        artifacts:vec![store::ArtifactRef{id:kind.into(),sha256:artifact.sha256.clone(),media_type:"application/json".into(),label:kind.into()}]})?;
    Ok(artifact.sha256)
}
impl RepairJournal for StoreRepairJournal<'_>{
    fn persist_before(&mut self,bundle:&RepairRecoveryBundle)->Result<String,String>{
        if bundle.preview.native_plan_digest!=self.intent.approved_plan_digest||bundle.preview.preview.binding.project_id!=self.intent.key.project_id||self.checkpoint_written{return Err("repair_backup_binding_changed".into());}
        let execution=crate::repair_execution_identity::ExecutionIdentity::capture(
            self.db.repair_execution_database_key().map_err(|_|"repair_database_identity_unavailable")?,
            &self.intent.key.project_id,&self.intent.owner.run_id,&self.intent.key.operation_id,
            &self.intent.digest().map_err(|_|"repair_intent_invalid")?).map_err(|_|"repair_process_identity_unavailable")?;
        let mut value=serde_json::to_value(bundle).map_err(|_|"repair_backup_encoding")?;
        value["executionIdentity"]=serde_json::to_value(execution).map_err(|_|"repair_backup_encoding")?;
        let bytes=serde_json::to_vec(&value).map_err(|_|"repair_backup_encoding")?;
        let digest=checkpoint(self.db,self.intent,0,store::RunStatus::Running,"nativeRepairBefore",&bytes).map_err(|_|"repair_backup_not_durable")?;
        self.checkpoint_written=true;Ok(digest)
    }
}
struct Observed<'a>{intent:&'a effect::EffectIntent,complete:bool,not_started:bool,digest:String}
impl effect::ReadOnlyEffectObserver for Observed<'_>{
    fn adapter_identity(&self)->effect::AdapterIdentity{self.intent.adapter.clone()}
    fn observe(&self,_:&effect::RecoveryReadScope<'_>,query:&effect::EffectQuery,cancelled:&AtomicBool)->Result<effect::EffectObservation,effect::ObserverFailure>{
        if cancelled.load(Ordering::Acquire)||query.intent!=*self.intent{return Err(effect::ObserverFailure::Unavailable);}
        let outcome=if self.complete{effect::EffectOutcome::Completed}else if self.not_started{effect::EffectOutcome::NotOccurred}else{effect::EffectOutcome::Unknown};
        Ok(effect::EffectObservation{query_id:query.query_id.clone(),key:self.intent.key.clone(),owner:self.intent.owner.clone(),root_object_id:self.intent.root_object_id.clone(),intent_digest:query.intent_digest.clone(),idempotency_key:self.intent.idempotency_key.clone(),query_scope_digest:query.query_scope_digest.clone(),outcome,execution:effect::ExecutionObservation::Quiescent,coverage:effect::Coverage::Exact,attribution:effect::Attribution::OperationBound,evidence_digest:Some(self.digest.clone()),reason:if outcome==effect::EffectOutcome::Unknown{effect::UnknownReason::ExecutionUnknown}else{effect::UnknownReason::None}})
    }
}
pub(crate) fn persist(db:&store::RunStore,root:&TrustedRootHandle,intent:&effect::EffectIntent,preview:&NativeRepairPreview,receipt:&RepairApplyReceipt,before_written:bool,catalog:&PersistentRecoveryCatalog,proof:&effect::SettledOperationProof)->store::Result<()>{
    if preview.native_plan_digest!=intent.approved_plan_digest||receipt.binding!=preview.preview.binding||receipt.diagnostic!=preview.preview.diagnostic||receipt.task!=preview.preview.task||receipt.preview_id!=preview.preview.preview_id||receipt.effects.len()!=preview.preview.files.len(){return Err(err());}
    let complete=receipt.status=="applied"&&before_written&&receipt.recovery_record.is_some()&&receipt.effects.iter().zip(&preview.preview.files).all(|(e,f)|e.status=="applied"&&e.path==f.path&&e.before_hash==f.before_hash&&e.before_object_identity==f.before_object_identity&&e.after_hash.as_ref()==Some(&f.after_hash)&&e.after_object_identity.as_ref()==Some(&f.before_object_identity));
    let not_started=["not_started","conflict"].contains(&receipt.status.as_str())&&receipt.effects.iter().all(|e|["not_started","conflict"].contains(&e.status.as_str())&&e.after_hash.is_none());
    let bytes=serde_json::to_vec(receipt).map_err(|_|err())?;
    let digest=checkpoint(db,intent,if before_written{1}else{0},if complete{store::RunStatus::Succeeded}else if not_started{store::RunStatus::Failed}else{store::RunStatus::NeedsReconciliation},"nativeRepairResult",&bytes)?;
    let current=||!root.is_revoked();let scope=effect::RecoveryReadScope::from_verified_host_read(root,intent.key.clone(),intent.owner.clone(),intent.owner.host_generation.clone(),&current)?;
    let observed=db.open_effect_journal()?.reconcile(&scope,2,now(),&Observed{intent,complete,not_started,digest},&AtomicBool::new(false))?;
    if complete||not_started{catalog.retire_original_settled_operation(proof,&observed,&scope).map_err(|_|err())?;}
    Ok(())
}
