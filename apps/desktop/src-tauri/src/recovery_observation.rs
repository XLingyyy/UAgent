use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct RecoveryStatusInput { pub schema_version:u32, pub project_id:String, pub run_id:String }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct RecoveryStatus {
    schema_version:u32, project_id:String, run_id:String, observed_at:u64,
    scan_state:&'static str, scan_complete:bool, project_effect_count:usize, project_legacy_count:usize,
    native_writer_fence_installed:bool, observation_only:bool, recovery_eligibility:&'static str,
}
pub fn project(input:RecoveryStatusInput,observed_at:u64,complete:bool,status:&str,fence:bool,
    effects:impl Iterator<Item=impl AsRef<str>>,legacy:impl Iterator<Item=impl AsRef<str>>)->Result<RecoveryStatus,&'static str>{
    if status=="startup_scan_closed" {return Err("recovery_status_unavailable");}
    let scan_state=if complete {"complete"} else {match status {
        "not_scanned"=>"notScanned", "scanning"|"startup_scan_pending_release"=>"pending", _=>"unavailable"}};
    Ok(RecoveryStatus {schema_version:1,
        project_effect_count:effects.filter(|v|v.as_ref()==input.project_id).count(),
        project_legacy_count:legacy.filter(|v|v.as_ref()==input.project_id).count(),
        project_id:input.project_id,run_id:input.run_id,observed_at,scan_state,
        scan_complete:complete,native_writer_fence_installed:fence,
        observation_only:true,recovery_eligibility:"unverified"})
}
#[cfg(test)]
mod tests {
    use super::*;
    fn input()->RecoveryStatusInput {RecoveryStatusInput{schema_version:1,project_id:"A".into(),run_id:"run".into()}}
    #[test] fn counts_only_requested_project_and_serializes_no_other_identity(){
        let v=project(input(),1,true,"scan_complete",false,["A","SECRET","A"].into_iter(),["SECRET","A"].into_iter()).unwrap();
        assert_eq!(v.project_effect_count,2);assert_eq!(v.project_legacy_count,1);
        let json=serde_json::to_string(&v).unwrap();assert!(!json.contains("SECRET"));assert!(!json.contains("positiveAdmission"));
    }
    #[test] fn empty_without_fence_is_unverified(){
        let v=project(input(),1,true,"scan_complete",false,["other"].into_iter(),["other"].into_iter()).unwrap();
        assert_eq!(v.project_effect_count,0);assert_eq!(v.recovery_eligibility,"unverified");assert!(v.observation_only);
    }
    #[test] fn installed_fence_still_is_not_a_grant(){
        let v=project(input(),1,true,"scan_complete",true,["A"].into_iter(),["A"].into_iter()).unwrap();
        assert_eq!(v.recovery_eligibility,"unverified");
    }
    #[test] fn closed_is_unavailable(){assert!(project(input(),1,false,"startup_scan_closed",false,["A"].into_iter(),["A"].into_iter()).is_err());}
    #[test] fn incomplete_phases_are_sanitized(){
        for (status,expected) in [("not_scanned","notScanned"),("scanning","pending"),("startup_scan_pending_release","pending"),("scan_panicked","unavailable"),("physical_database_changed","unavailable")]{
            let v=project(input(),1,false,status,false,["A"].into_iter(),["A"].into_iter()).unwrap();
            assert!(!v.scan_complete);assert_eq!(v.scan_state,expected);assert_eq!(v.recovery_eligibility,"unverified");
        }
    }
}
