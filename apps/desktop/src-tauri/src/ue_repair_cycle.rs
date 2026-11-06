//! Native-owned finite repair chain. Never deserialized from renderer or recovered history.
use serde::Serialize;
use sha2::{Digest,Sha256};
pub(crate) const MAX_REBUILDS:u32=3;
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct CycleReport {pub chain_id:String,pub rebuilds:u32,pub max_rebuilds:u32,pub previous_run_id:Option<String>,pub status:String}
pub(crate) struct Cycle {report:CycleReport,last_run:String,seen:Vec<String>}
pub(crate) struct Observation<'a>{pub status:&'a str,pub exit_code:Option<i32>,pub tree_stopped:bool,pub complete:bool,pub truncated:bool,pub stdout:&'a str,pub stderr:&'a str,pub current_settled:bool}
impl Cycle {
 pub(crate) fn initial(run:&str)->Self{Self{report:CycleReport{chain_id:run.into(),rebuilds:0,max_rebuilds:MAX_REBUILDS,previous_run_id:None,status:"pending".into()},last_run:String::new(),seen:vec![]}}
 pub(crate) fn next(mut self)->Result<Self,String>{
  if self.report.status!="awaiting_review"||self.report.rebuilds>=MAX_REBUILDS{return Err("ue_repair_cycle_stopped".into());}
  self.report.rebuilds+=1;self.report.previous_run_id=Some(self.last_run.clone());self.report.status="pending".into();Ok(self)
 }
 pub(crate) fn observe(&mut self,run:&str,o:Observation<'_>)->CycleReport{
  let bytes=serde_json::to_vec(&(o.stdout.replace("\r\n","\n").trim(),o.stderr.replace("\r\n","\n").trim())).unwrap();
  let digest=format!("{:x}",Sha256::digest(bytes));
  self.report.status=(if !o.current_settled||!o.tree_stopped||!o.complete{"unconfirmed"}
   else if o.status=="succeeded"&&o.exit_code==Some(0){"succeeded"}
   else if o.status=="cancelled"{"cancelled"}
   else if o.status=="timed_out"{"timed_out"}
   else if o.status!="failed"||!o.exit_code.is_some_and(|c|c!=0){"not_repairable"}
   else if o.truncated{"incomplete_diagnostics"}
   else if self.seen.contains(&digest){"repeated_output"}
   else if self.report.rebuilds>=MAX_REBUILDS{"round_limit"}
   else {"awaiting_review"}).into();
  self.seen.push(digest);self.last_run=run.into();self.report.clone()
 }
}
#[cfg(test)]mod tests{
 use super::*;
 fn obs(text:&str)->Observation<'_>{Observation{status:"failed",exit_code:Some(6),tree_stopped:true,complete:true,truncated:false,stdout:text,stderr:"",current_settled:true}}
 #[test]fn fresh_diagnostics_continue_in_same_chain_until_three_rebuilds(){let mut c=Cycle::initial("first");let r=c.observe("first",obs("error A"));assert_eq!(r.status,"awaiting_review");for i in 1..=3{c=c.next().unwrap();let r=c.observe(&format!("run-{i}"),obs(&format!("error {i}")));assert_eq!(r.chain_id,"first");assert_eq!(r.rebuilds,i);assert_eq!(r.status,if i==3{"round_limit"}else{"awaiting_review"});}assert!(c.next().is_err());}
 #[test]fn repeated_output_stops_including_earlier_round(){let mut c=Cycle::initial("a");c.observe("a",obs("E1\r\n"));c=c.next().unwrap();c.observe("b",obs("E2"));c=c.next().unwrap();assert_eq!(c.observe("c",obs("E1\n")).status,"repeated_output");assert!(c.next().is_err());}
 #[test]fn success_cancellation_and_unconfirmed_results_never_continue(){for status in ["succeeded","cancelled","timed_out","unknown"]{let mut c=Cycle::initial("a");let mut o=obs("E");o.status=status;if status=="succeeded"{o.exit_code=Some(0);}assert_ne!(c.observe("a",o).status,"awaiting_review");assert!(c.next().is_err());}for mode in 0..3{let mut c=Cycle::initial("a");let mut o=obs("E");match mode{0=>o.current_settled=false,1=>o.complete=false,_=>o.truncated=true};assert_ne!(c.observe("a",o).status,"awaiting_review");assert!(c.next().is_err());}}
}
