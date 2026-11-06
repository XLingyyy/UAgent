//! Native file reads for a separately approved Host task. Native source evidence
//! remains here; returned source descriptions cannot create or refresh it.
#![cfg(windows)]
use crate::native_provider_transport::{NativeSession, SourceChecker};
use crate::native_responses_sources::{NativeSourceMonitor, SourceEvidence};
use crate::trusted_root_handle::{ReadRule, TrustedRootHandle};
use serde_json::{json, Value};
use std::sync::Arc;

type Result<T> = std::result::Result<T, &'static str>;
pub(crate) struct HostedReads {
    project: String,
    root: Arc<TrustedRootHandle>,
    read: Vec<String>,
    share: Vec<String>,
    monitor: NativeSourceMonitor,
    sources: Vec<(Value, SourceEvidence)>,
    complete_files: std::collections::HashMap<String, String>,
}

pub(crate) fn valid_prefixes(prefixes: &[String]) -> bool {
    !prefixes.is_empty() && prefixes.len() <= 8 && prefixes.iter().all(|prefix| {
        prefix.len() <= 1024 && !prefix.contains('\\') && !prefix.chars().any(|c| c.is_control() || matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
            && (prefix.is_empty() || ReadRule::subtree(prefix).is_ok())
    })
}
fn within(path: &str, prefixes: &[String]) -> bool {
    let path=path.to_lowercase();
    prefixes.iter().any(|prefix| {
        let prefix=prefix.to_lowercase();
        prefix.is_empty() || path==prefix || path.strip_prefix(&prefix).is_some_and(|tail|tail.starts_with('/'))
    })
}
pub(crate) fn tool_id(name:&str)->Option<&'static str> {
    match name {"project_read_file"=>Some("project.read_file"),"project_list_files"=>Some("project.list_files"),"project_find_files"=>Some("project.find_files"),_=>None}
}
pub(crate) fn definitions() -> Vec<Value> {
    let mut definitions=vec![json!({"name":"project_read_file","description":"Read bounded text from an approved project-relative file. Binary, secret and generated files are blocked. Results explicitly report truncation and redaction.",
        "parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}})];
    for search in [false,true] {
        let mut properties=json!({"prefix":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":25}});
        if search {properties["query"]=json!({"type":"string","minLength":1,"maxLength":100});}
        definitions.push(json!({"name":if search{"project_find_files"}else{"project_list_files"},
            "description":"List current project-relative file paths using a bounded native metadata scan. Only approved read/share prefixes are returned. Optional query matches paths, not contents. Truncation is explicit; no file contents are read.",
            "parameters":{"type":"object","properties":properties,"required":if search{vec!["prefix","query"]}else{vec!["prefix"]},"additionalProperties":false}}));
    }
    definitions
}
impl HostedReads {
    /// The native task scope issuer supplies the confirmed path lists.
    pub(crate) fn start(project: String, root: Arc<TrustedRootHandle>, read: Vec<String>, share: Vec<String>, session: &NativeSession) -> Result<Self> {
        if !valid_prefixes(&read) || !valid_prefixes(&share) { return Err("host_read_scope_invalid"); }
        let monitor=NativeSourceMonitor::start(&project,session.source_authority())?;
        let result=Self{project,root,read,share,monitor,sources:vec![],complete_files:std::collections::HashMap::new()};
        result.current()?;
        Ok(result)
    }
    pub(crate) fn has_complete_source(&self, path: &str) -> bool { self.complete_files.contains_key(path) }
    pub(crate) fn matches_complete_source(&self, path: &str, before: &str) -> Result<bool> {
        self.current()?;
        for (_, evidence) in &self.sources { self.monitor.verify_evidence(evidence)?; }
        Ok(self.complete_files.get(path).is_some_and(|text| text == before))
    }
    pub(crate) fn checker(&self) -> Arc<dyn SourceChecker> { self.monitor.checker() }
    pub(crate) fn release(&mut self) { self.monitor.revoke(); self.sources.clear(); self.complete_files.clear(); }
    fn current(&self) -> Result<()> {
        self.root.check_current().map_err(|_|"host_read_root_changed")?;
        let current=crate::resolve_trusted_root_handle_by_id(&self.project).map_err(|_|"host_read_root_changed")?;
        if !Arc::ptr_eq(&current,&self.root) {return Err("host_read_root_changed");}
        Ok(())
    }
    pub(crate) fn validate_sources(&self, sources:&Value) -> Result<bool> {
        self.current()?;
        let references=sources.as_array().filter(|values|values.len()<=64).ok_or("host_read_sources_invalid")?;
        if references.iter().any(|reference|!self.sources.iter().any(|(original,_)|reference==original)) {return Ok(false);}
        for (_,evidence) in &self.sources {self.monitor.verify_evidence(evidence)?;}
        Ok(true)
    }
    fn query(&mut self,call:&Value,args:&Value,result_limit:usize)->Result<Value> {
        let search=call["name"]=="project_find_files";
        let object=args.as_object().ok_or("host_read_call_invalid")?;
        if object.keys().any(|key|!matches!(key.as_str(),"prefix"|"limit")&&!(search&&key=="query")) {return Err("host_read_call_invalid");}
        let prefix=args["prefix"].as_str().ok_or("host_read_call_invalid")?;
        if !valid_prefixes(&[prefix.into()])||!within(prefix,&self.read)||!within(prefix,&self.share) {return Err("host_read_scope_denied");}
        let query=if search {args["query"].as_str().filter(|q|!q.trim().is_empty()&&q.chars().count()<=100&&!q.chars().any(char::is_control)).ok_or("host_read_call_invalid")?.to_lowercase()}else{String::new()};
        let limit=if object.contains_key("limit"){args["limit"].as_u64().filter(|n|(1..=25).contains(n)).ok_or("host_read_call_invalid")? as usize}else{20};
        let evidence=self.monitor.capture_index()?;
        let entries=crate::native_responses_sources::indexed_files(self.root.path_hint())?;
        self.monitor.verify_evidence(&evidence)?;
        let mut matches=entries.into_iter().filter(|(path,_)|within(path,&[prefix.into()])&&within(path,&self.read)&&within(path,&self.share)&&path.to_lowercase().contains(&query));
        let mut files=Vec::new();let mut truncated=false;
        for (path,bytes) in matches.by_ref() {
            if files.len()==limit {truncated=true;break;}
            files.push(json!({"path":path,"bytes":bytes}));
            if serde_json::to_vec(&files).map_err(|_|"host_read_result_invalid")?.len()>result_limit-1500 {files.pop();truncated=true;break;}
        }
        let version=evidence.version();
        let reference=json!({"projectId":self.project,"path":prefix,"version":version,"kind":"index_query"});
        let result=json!({"callId":call["id"],"toolId":tool_id(call["name"].as_str().unwrap_or("")),"status":"completed","effectState":"not_started",
            "output":{"files":files,"indexVersion":version,"scan":"bounded_native_metadata"},"sources":[reference],"truncated":truncated});
        if serde_json::to_vec(&result).map_err(|_|"host_read_result_invalid")?.len()>result_limit {return Err("host_read_result_limit");}
        let mut selected=self.sources.iter().map(|(_,evidence)|evidence.clone()).collect::<Vec<_>>();selected.push(evidence.clone());
        self.monitor.set_sources(&selected)?;self.current()?;self.sources.push((reference,evidence));Ok(result)
    }
    pub(crate) fn execute(&mut self, call:&Value, result_limit:usize) -> Result<Value> {
        self.current()?;
        if tool_id(call["name"].as_str().unwrap_or("")).is_none() || !call["id"].as_str().is_some_and(|id|!id.is_empty()&&id.len()<=128)
            || !(4096..=16384).contains(&result_limit) || self.sources.len()>=30 {return Err("host_read_call_invalid");}
        let args:Value=serde_json::from_str(call["arguments"].as_str().ok_or("host_read_call_invalid")?).map_err(|_|"host_read_call_invalid")?;
        if call["name"]!="project_read_file" { return self.query(call,&args,result_limit); }
        if !args.as_object().is_some_and(|object|object.len()==1&&object.contains_key("path")) {return Err("host_read_call_invalid");}
        let path=args["path"].as_str().ok_or("host_read_call_invalid")?;
        if !within(path,&self.read)||!within(path,&self.share) {return Err("host_read_scope_denied");}
        ReadRule::exact_file(path).map_err(|_|"host_read_scope_denied")?;
        let byte_limit=((result_limit-1500)/6).min(2048) as u32;
        let (preview,file)=crate::project_source_versions::read_bound_preview(&self.project,path,byte_limit,80)
            .map_err(|_|"host_read_unavailable")?;
        let freshness=crate::project_source_versions::bound_file_metadata_version(&file).map_err(|_|"host_read_source_changed")?;
        let evidence=self.monitor.capture_preview_guarded(path,byte_limit,80,&preview,file)?;
        let reference=json!({"projectId":self.project,"path":path,"version":freshness,"kind":"file_preview","freshness":freshness});
        let result=json!({"callId":call["id"],"toolId":"project.read_file","status":"completed","effectState":"not_started",
            "output":{"path":path,"text":preview.content,"redacted":false,"originalBytes":preview.original_bytes,
                "observedLines":preview.observed_lines,"lineCountComplete":preview.line_count_complete,
                "originalLines":if preview.line_count_complete {json!(preview.original_lines)} else {Value::Null}},
            "sources":[reference],"truncated":preview.truncated});
        if serde_json::to_vec(&result).map_err(|_|"host_read_result_invalid")?.len()>result_limit {return Err("host_read_result_limit");}
        let mut selected=self.sources.iter().map(|(_,evidence)|evidence.clone()).collect::<Vec<_>>();
        selected.push(evidence.clone());self.monitor.set_sources(&selected)?;
        self.current()?;
        if !preview.truncated { self.complete_files.insert(path.into(),preview.content.clone()); }
        self.sources.push((reference,evidence));
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn host_read_prefixes_reject_aliases_and_keep_directory_boundaries() {
        assert!(valid_prefixes(&["Source".into(),String::new()]));
        for path in ["../Source","Source\\Private","Source/../Private","Source/\u{202e}hidden"] {
            assert!(!valid_prefixes(&[path.into()]));
        }
        assert!(within("Source/Main.cpp",&["source".into()]));
        assert!(!within("SourcePrivate/Main.cpp",&["Source".into()]));
    }
}
