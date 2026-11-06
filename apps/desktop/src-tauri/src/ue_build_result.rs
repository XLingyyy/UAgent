//! Native-only receipt persistence; no execution or recovered authority.
use crate::{local_run_store::{self as store,effect_reconciliation as effect},ue_build_process::UEBuildExecutionResult,trusted_root_handle::TrustedRootHandle};
use std::{sync::atomic::{AtomicBool,Ordering},time::{SystemTime,UNIX_EPOCH}};
fn error(code:&str)->store::StoreError{store::StoreError{kind:code.into(),message:"native build receipt persistence failed".into()}}
fn now()->i64{SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_millis() as i64).unwrap_or(0)}

struct ResultObserver<'a>{intent:&'a effect::EffectIntent,result:&'a UEBuildExecutionResult,digest:String}
impl effect::ReadOnlyEffectObserver for ResultObserver<'_>{
    fn adapter_identity(&self)->effect::AdapterIdentity{self.intent.adapter.clone()}
    fn observe(&self,_:&effect::RecoveryReadScope<'_>,query:&effect::EffectQuery,cancelled:&AtomicBool)
        ->Result<effect::EffectObservation,effect::ObserverFailure>{
        if cancelled.load(Ordering::Acquire)||query.intent!=*self.intent||self.result.owner.run_id!=self.intent.owner.run_id
            ||self.result.owner.step_id!=self.intent.owner.step_id||self.result.owner.fingerprint!=self.intent.approved_plan_digest{
            return Err(effect::ObserverFailure::Unavailable);
        }
        let stopped=self.result.tree_stopped;
        let outcome=if stopped&&self.result.output_complete{
            if self.result.pid.is_none()&&self.result.effects=="not_started"{effect::EffectOutcome::NotOccurred}else{effect::EffectOutcome::Completed}
        }else{effect::EffectOutcome::Unknown};
        Ok(effect::EffectObservation{query_id:query.query_id.clone(),key:self.intent.key.clone(),owner:self.intent.owner.clone(),root_object_id:self.intent.root_object_id.clone(),
            intent_digest:query.intent_digest.clone(),idempotency_key:self.intent.idempotency_key.clone(),query_scope_digest:query.query_scope_digest.clone(),outcome,
            execution:if stopped{effect::ExecutionObservation::Quiescent}else{effect::ExecutionObservation::Unknown},coverage:effect::Coverage::Exact,
            attribution:effect::Attribution::OperationBound,evidence_digest:Some(self.digest.clone()),
            reason:if outcome==effect::EffectOutcome::Unknown{effect::UnknownReason::ExecutionUnknown}else{effect::UnknownReason::None}})
    }
}
pub(crate) fn persist_result(db:&store::RunStore,project:&str,run:&str,root:&TrustedRootHandle,intent:&effect::EffectIntent,result:&UEBuildExecutionResult,settlement:Option<(&crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog,&effect::SettledOperationProof)>)->store::Result<()>{
    persist_result_with_cycle(db,project,run,root,intent,result,settlement,None)
}
pub(crate) fn persist_result_with_cycle(db:&store::RunStore,project:&str,run:&str,root:&TrustedRootHandle,intent:&effect::EffectIntent,result:&UEBuildExecutionResult,settlement:Option<(&crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog,&effect::SettledOperationProof)>,cycle:Option<&crate::ue_repair_cycle::CycleReport>)->store::Result<()>{
    if result.owner.run_id!=intent.owner.run_id||result.owner.step_id!=intent.owner.step_id||result.owner.fingerprint!=intent.approved_plan_digest
        ||project!=intent.key.project_id||run!=intent.owner.run_id{return Err(error("ue_build_result_identity_changed"));}
    let bytes=serde_json::to_vec(result).map_err(|_|error("ue_build_result_encoding"))?;
    let artifact=db.put_artifact(project,&bytes)?;
    let complete=result.tree_stopped&&result.output_complete;
    let succeeded=complete&&result.status=="succeeded"&&result.exit_code==Some(0);
    let status=if !complete{store::RunStatus::NeedsReconciliation}else if succeeded{store::RunStatus::Succeeded}
        else if result.status=="cancelled"{store::RunStatus::Cancelled}else{store::RunStatus::Failed};
    let at=now();
    db.commit_checkpoint(project,run,0,&store::CheckpointBatch{status,checkpoint:store::Checkpoint{next_step_id:None,reason:result.reason.clone(),
        summary:format!("Native build: {} (exit {:?})",result.status,result.exit_code),captured_at:at},messages:vec![],steps:vec![],tool_calls:vec![],changesets:vec![],
        events:vec![store::RunEvent{id:"native-build-result".into(),kind:"nativeBuildResult".into(),created_at:at,
            data:serde_json::json!({"status":result.status,"exitCode":result.exit_code,"treeStopped":result.tree_stopped,"outputComplete":result.output_complete,"receiptSha256":artifact.sha256,"repairCycle":cycle})}],
        artifacts:vec![store::ArtifactRef{id:"native-build-result".into(),sha256:artifact.sha256.clone(),media_type:"application/json".into(),label:"Original native build receipt".into()}]})?;
    let current=||!root.is_revoked();let scope=effect::RecoveryReadScope::from_verified_host_read(root,intent.key.clone(),intent.owner.clone(),intent.owner.host_generation.clone(),&current)?;
    let observation=db.open_effect_journal()?.reconcile(&scope,2,now(),&ResultObserver{intent,result,digest:artifact.sha256},&AtomicBool::new(false))?;
    if let Some((catalog,proof))=settlement {
        catalog.retire_original_settled_operation(proof,&observation,&scope).map_err(error)?;
    }
    Ok(())
}