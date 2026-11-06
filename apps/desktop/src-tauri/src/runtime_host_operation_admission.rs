//! Native UE reservation and same-transaction handoff admission. No IPC or approval.
use super::*;
use crate::runtime_host_recovery_catalog::{PersistentRecoveryCatalog,OperationRecoveryAdmission};
use crate::local_run_store::effect_reconciliation as ledger;

impl RuntimeHostService {
    /// Call only after native exact-plan approval. This reserves ownership but cannot
    /// launch work. Move the returned guard into the original bounded native worker.
    pub(crate) fn register_ue_operation_pending(&self,window:&str,input:NativeOperationInput,
        expected:&OwnerIdentity,catalog:&Arc<PersistentRecoveryCatalog>)->HostResult<RegisteredExecution>{
        valid_id(&input.job_id)?;valid_id(&input.step_id)?;
        if !(1..=3_600_000).contains(&input.queue_timeout_ms)||!(1..=3_600_000).contains(&input.execution_timeout_ms)
            ||!input.resources.is_current()||!input.resources.claims.iter().any(|c|c.kind==ResourceKind::Ubt){
            return Err("runtime_host_invalid_operation");
        }
        let mut inner=self.lock()?;let now=Instant::now();refresh(&mut inner,now);prune(&mut inner,now);
        self.check_owner(&inner,window,&input.owner,true)?;
        if inner.closed||!inner.monitor_active{return Err("runtime_host_closed");}
        if !inner.catalog.as_ref().is_some_and(|installed|std::ptr::eq(Arc::as_ptr(installed) as *const (),Arc::as_ptr(catalog) as *const ())){
            return Err("runtime_host_catalog_changed");
        }
        let owner=&inner.owners[&input.owner.owner_id];
        if owner.identity!=*expected||expected.root_ref!=input.resources.root_object_id{return Err("runtime_host_owner_mismatch");}
        if inner.jobs.len()>=MAX_JOBS{return Err("runtime_host_capacity");}
        if inner.jobs.iter().any(|j|j.ticket.owner_id==input.owner.owner_id&&j.job_id==input.job_id){return Err("runtime_host_duplicate_job");}
        // No pending reservation jumps a conflicting earlier queued/live operation.
        if inner.jobs.iter().any(|j|j.phase!=JobPhase::Finished&&
            (j.project_id==expected.project_id||j.root()==Some(input.resources.root_object_id.as_str())
                ||j.claims().iter().any(|a|input.resources.claims.iter().any(|b|a.key==b.key)))){
            return Err("runtime_host_resource_conflict");
        }
        let ticket=TicketRef{host_generation:self.generation.to_string(),owner_id:input.owner.owner_id,ticket_id:random_id()?};
        let identity=NativeExecutionIdentity{ticket:ticket.clone(),owner:expected.clone(),execution_id:random_id()?,step_id:input.step_id.clone()};
        let cancel=Arc::new(AtomicBool::new(false));let duration=Duration::from_millis(input.queue_timeout_ms.min(input.execution_timeout_ms));
        inner.jobs.push_back(Job{ticket,job_id:input.job_id,step_id:input.step_id,execution_id:identity.execution_id.clone(),
            project_id:expected.project_id.clone(),kind:JobKind::Operation,phase:JobPhase::HandoffPending,
            reason:Some("operation_recovery_validation_pending"),queued_deadline:now+duration,execution_duration:duration,
            execution_deadline:Some(now+duration),finished_at:None,resources:Some(input.resources),observer:Some(input.observer),
            observation:ExecutionObservation::Unknown,observing:false,callback_settled:false,began:false,
            requires_memory_transaction:false,requires_operation_transaction:true,native_creation:None,cancel:cancel.clone()});
        Ok(RegisteredExecution{host:self.clone(),identity,cancel,closed:false})
    }
}
fn matches_intent(identity:&NativeExecutionIdentity,intent:&ledger::EffectIntent)->bool {
    let a=&identity.owner;let b=&intent.owner;
    a.scope_id==b.scope_id&&a.run_id==b.run_id&&a.project_id==b.project_id&&a.root_ref==b.root_ref
        &&a.conversation_id==b.conversation_id&&a.provider_id==b.provider_id&&a.model_id==b.model_id
        &&identity.execution_id==b.execution_id&&identity.step_id==b.step_id&&identity.ticket.host_generation==b.host_generation
        &&intent.key.project_id==a.project_id
}
fn valid_operation(inner:&Inner,registration:&RegisteredExecution,intent:&ledger::EffectIntent,began:bool)->HostResult<()> {
    let now=Instant::now();
    if registration.closed||inner.closed||!inner.monitor_active||!matches_intent(&registration.identity,intent){return Err("runtime_host_operation_mismatch");}
    let owner=inner.owners.get(&registration.identity.ticket.owner_id).ok_or("runtime_host_owner_unknown")?;
    if !owner.connected||owner.expires<=now||owner.identity!=registration.identity.owner{return Err("runtime_host_owner_revoked");}
    let job=inner.jobs.iter().find(|j|j.ticket==registration.identity.ticket).ok_or("runtime_host_job_unknown")?;
    if !job.requires_operation_transaction||job.requires_memory_transaction||job.kind!=JobKind::Operation
        ||job.began!=began||job.callback_settled||job.phase!=(if began{JobPhase::Running}else{JobPhase::HandoffPending})
        ||job.execution_id!=registration.identity.execution_id||job.step_id!=registration.identity.step_id
        ||!Arc::ptr_eq(&job.cancel,&registration.cancel)||job.cancel.load(Ordering::SeqCst)
        ||job.execution_deadline.map_or(true,|d|d<=now){return Err("runtime_host_dispatch_revoked");}
    let binding=job.resources.as_ref().ok_or("runtime_host_root_pin_missing")?;
    if binding.held.as_ref().map_or(true,|pin|pin.is_revoked())||binding.root_object_id!=intent.root_object_id
        ||binding.claims.len()!=intent.resources.len()||!binding.claims.iter().all(|a|intent.resources.iter().any(|b|
            a.key==b.key&&matches!((a.kind,b.kind),(ResourceKind::Ubt,ledger::ResourceKind::Ubt)
                |(ResourceKind::UeEditor,ledger::ResourceKind::UeEditor)|(ResourceKind::FileWrite,ledger::ResourceKind::FileWrite)))){
        return Err("runtime_host_operation_mismatch");
    }
    if inner.jobs.iter().any(|other|other.ticket!=job.ticket&&other.phase!=JobPhase::Finished&&
        (other.project_id==job.project_id||other.root()==job.root()||conflicts(job,other))){return Err("runtime_host_resource_conflict");}
    Ok(())
}
impl RegisteredExecution {
    /// SQL -> catalog -> host lock order. No path I/O or external callback under host lock.
    pub(crate) fn admit_ue_operation(&mut self,recovery:&OperationRecoveryAdmission<'_>)->HostResult<()> {
        let mut inner=self.host.lock()?;
        if !inner.catalog.as_ref().is_some_and(|c|recovery.is_for_catalog(c.as_ref()))||!recovery.ready(){return Err("runtime_host_recovery_blocked");}
        valid_operation(&inner,self,&recovery.record().intent,false)?;
        let job=find_job(&mut inner,&self.identity.ticket)?;
        job.began=true;job.phase=JobPhase::Running;job.reason=None;
        Ok(())
    }
    /// After claim COMMIT, immediately before handing work to the protected executor.
    /// This checks native liveness, never invents another catalog proof.
    pub(crate) fn check_started_ue_operation(&self,intent:&ledger::EffectIntent)->HostResult<()> {
        let inner=self.host.lock()?;
        valid_operation(&inner,self,intent,true)
    }
}
#[cfg(test)]
#[path="runtime_host_operation_admission_tests.rs"]
mod tests;

impl RegisteredExecution {
    /// The worker retains this exact registration through executor return and observer
    /// settlement. This method is not a renderer approval or an arbitrary process API.
    pub(crate) fn dispatch_ue_once<T>(&mut self,journal:&ledger::EffectJournal<'_>,context:&ledger::CurrentRun<'_>,
        ticket:&mut ledger::DispatchTicket,catalog:&PersistentRecoveryCatalog,deadline:Instant,
        execute:impl FnOnce(&ledger::EffectIntent)->crate::local_run_store::Result<T>,
    )->crate::local_run_store::Result<T>{
        let cancellation=self.cancellation();
        let registration=std::cell::RefCell::new(self);
        let mut result=None;
        journal.dispatch_once_with_operation_snapshot(context,ticket,&cancellation,deadline,|physical|{
            catalog.with_operation_admission(physical,|recovery|{
                registration.borrow_mut().admit_ue_operation(&recovery).map_err(|kind|
                    crate::local_run_store::StoreError{kind:kind.into(),message:"native UE operation admission rejected".into()})
            })
        },|intent|{
            result=Some(registration.borrow().check_started_ue_operation(intent).map_err(|kind|
                crate::local_run_store::StoreError{kind:kind.into(),message:"native UE operation revoked before execution".into()})
                .and_then(|()|{
                    // COMMIT/context validation may outlive the transaction's budget.
                    // Recheck the original deadline immediately before external work.
                    if cancellation.load(Ordering::SeqCst)||Instant::now()>=deadline {
                        return Err(crate::local_run_store::StoreError{kind:"operationAdmissionRevoked".into(),
                            message:"original operation deadline or cancellation expired before execution".into()});
                    }
                    execute(intent)
                }));
        })?;
        result.ok_or_else(||crate::local_run_store::StoreError{kind:"operationNotDispatched".into(),message:"no owned callback entered".into()})?
    }
}

impl RegisteredExecution {
    /// Durable InCallback remains claimed until the actual native executor returns.
    pub(crate) fn claim_ue_once(&mut self,journal:&ledger::EffectJournal<'_>,context:&ledger::CurrentRun<'_>,
        ticket:&mut ledger::DispatchTicket,catalog:&PersistentRecoveryCatalog,deadline:Instant,
    )->crate::local_run_store::Result<ledger::OwnedOperationHandoff>{
        let cancellation=self.cancellation();
        journal.claim_once_with_operation_snapshot(context,ticket,&cancellation,deadline,|physical|{
            catalog.with_operation_admission(physical,|recovery|self.admit_ue_operation(&recovery).map_err(|kind|
                crate::local_run_store::StoreError{kind:kind.into(),message:"native UE operation admission rejected".into()}))
        })
    }
}

impl RegisteredExecution {
    pub(crate) fn claim_ue_restore_once(&mut self,journal:&ledger::EffectJournal<'_>,context:&ledger::CurrentRun<'_>,
        ticket:&mut ledger::DispatchTicket,catalog:&PersistentRecoveryCatalog,deadline:Instant,
        restore:&crate::runtime_host_recovery_catalog::SettledRepairRestore,
    )->crate::local_run_store::Result<ledger::OwnedOperationHandoff>{
        let cancellation=self.cancellation();
        journal.claim_once_with_operation_snapshot(context,ticket,&cancellation,deadline,|physical|{
            catalog.with_restore_operation_admission(physical,Some(restore),|recovery|self.admit_ue_operation(&recovery).map_err(|kind|
                crate::local_run_store::StoreError{kind:kind.into(),message:"native restore admission rejected".into()}))
        })
    }
}
