//! New, isolated, versioned local data. No old state migration or credential DTOs.
use serde::{Serialize,Deserialize};
use sha2::{Digest,Sha256};
use std::{fs,io::{Read,Write},path::{Path,PathBuf}};
use tauri::Manager;
use crate::provider_budget::{lock,open_file};
const MAX_BYTES:u64=2_097_152;
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Workspace {
    schema_version:u32, theme:String, project_roots:Vec<String>, selected_project_root:Option<String>,
    deepseek_configured:bool, chats:Vec<Chat>,
}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Chat { id:String,title:String,project_label:String,created_at:u64,archived:bool,messages:Vec<Message> }
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Message { role:String,text:String }
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct VersionedWorkspace { revision:u64, workspace:Workspace }
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry { previous:String,data:VersionedWorkspace,checksum:String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SaveInput { expected_revision:u64,workspace:Workspace }
fn err()->String{"local_workspace_invalid_or_unavailable".into()}
fn text_safe(value:&str,limit:usize)->bool {
    let lower=value.to_ascii_lowercase();
    value.len()<=limit && !value.contains('\0') && !["sk-","github_pat_","ghp_","bearer ","api_key=","api-key=","password=","secret=","-----begin"].iter().any(|p|lower.contains(p))
}
fn validate(w:&Workspace)->Result<(),String>{
    if w.schema_version!=1 || !["dark","light"].contains(&w.theme.as_str()) || w.project_roots.len()>16 || w.chats.len()>30 {return Err(err());}
    let mut roots=std::collections::HashSet::new();
    for root in &w.project_roots {
        if !text_safe(root,1024) || !roots.insert(root) || root.len()<3 || root.as_bytes()[1]!=b':' || !root.as_bytes()[0].is_ascii_alphabetic() || ![b'/',b'\\'].contains(&root.as_bytes()[2]) {return Err(err());}
    }
    if w.selected_project_root.as_ref().is_some_and(|p|!roots.contains(p)) {return Err(err());}
    let mut ids=std::collections::HashSet::new();
    for chat in &w.chats {
        if chat.id.len()>80 || !chat.id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-') || !ids.insert(&chat.id) || !text_safe(&chat.title,200) || !text_safe(&chat.project_label,200) || chat.created_at>9_007_199_254_740_991 || chat.messages.len()>60 {return Err(err());}
        for message in &chat.messages {if !["user","assistant","tool"].contains(&message.role.as_str()) || !text_safe(&message.text,8192) {return Err(err());}}
    }
    if serde_json::to_vec(w).map_err(|_|err())?.len()>131_072{return Err(err());}
    Ok(())
}
fn hash(previous:&str,data:&VersionedWorkspace)->Result<String,String>{Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(&(previous,data)).map_err(|_|err())?)))}
fn load(root:&Path)->Result<(Option<VersionedWorkspace>,String),String>{
    let path=root.join("workspace.jsonl");
    if !path.exists(){return Ok((None,"0".repeat(64)));}
    let file=open_file(&path,false,false)?;let mut text=String::new();file.take(MAX_BYTES+1).read_to_string(&mut text).map_err(|_|err())?;
    if text.len()as u64>MAX_BYTES || !text.ends_with('\n'){return Err(err());}
    let(mut latest,mut previous,mut revision)=(None,"0".repeat(64),0);
    for line in text.lines(){let entry:Entry=serde_json::from_str(line).map_err(|_|err())?;validate(&entry.data.workspace)?;
        if entry.data.revision!=revision+1 || entry.previous!=previous || entry.checksum!=hash(&previous,&entry.data)?{return Err(err());}
        revision=entry.data.revision;previous=entry.checksum;latest=Some(entry.data);
    }
    Ok((latest,previous))
}
fn read(root:&Path)->Result<Option<VersionedWorkspace>,String>{if !root.exists(){return Ok(None);}let _guard=lock(root)?;Ok(load(root)?.0)}
fn save(root:&Path,input:SaveInput)->Result<VersionedWorkspace,String>{
    validate(&input.workspace)?;
    if !root.exists(){fs::create_dir_all(root).map_err(|_|err())?;}
    let _guard=lock(root)?;let(previous,checksum)=load(root)?;
    let revision=previous.as_ref().map(|p|p.revision).unwrap_or(0);
    if revision!=input.expected_revision{return Err("local_workspace_conflict_reload_required".into());}
    let data=VersionedWorkspace{revision:revision+1,workspace:input.workspace};
    let entry=Entry{checksum:hash(&checksum,&data)?,previous:checksum,data:data.clone()};
    let mut bytes=serde_json::to_vec(&entry).map_err(|_|err())?;bytes.push(b'\n');
    let path=root.join("workspace.jsonl");let exists=path.exists();let mut file=open_file(&path,!exists,exists)?;
    if file.metadata().map_err(|_|err())?.len()+bytes.len()as u64>MAX_BYTES{return Err("local_workspace_capacity_reached".into());}
    file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|err())?;Ok(data)
}
fn app_root(app:&tauri::AppHandle)->Result<PathBuf,String>{Ok(app.path().app_data_dir().map_err(|_|err())?.join("workspace-v1"))}
#[tauri::command]
pub fn read_local_workspace(app:tauri::AppHandle)->Result<Option<VersionedWorkspace>,String>{read(&app_root(&app)?)}
#[tauri::command]
pub fn save_local_workspace(app:tauri::AppHandle,input:SaveInput)->Result<VersionedWorkspace,String>{save(&app_root(&app)?,input)}

#[cfg(all(test,windows))]
mod tests{
 use super::*;
 struct Fixture(PathBuf);impl Fixture{fn new()->Self{let mut b=[0u8;8];getrandom::getrandom(&mut b).unwrap();Self(std::env::temp_dir().join(format!("uagent-workspace-test-{:x}",u64::from_le_bytes(b))))}}
 impl Drop for Fixture{fn drop(&mut self){if self.0.parent()==Some(std::env::temp_dir().as_path()) && self.0.file_name().unwrap().to_string_lossy().starts_with("uagent-workspace-test-"){let _=fs::remove_dir_all(&self.0);}}}
 fn sample()->Workspace{Workspace{schema_version:1,theme:"dark".into(),project_roots:vec!["G:/SyntheticProject".into()],selected_project_root:Some("G:/SyntheticProject".into()),deepseek_configured:true,chats:vec![Chat{id:"synthetic-chat".into(),title:"Synthetic".into(),project_label:"Synthetic".into(),created_at:1,archived:false,messages:vec![Message{role:"user".into(),text:"Explain a synthetic cube".into()}]}]}}
 #[test]fn local_workspace_round_trip_and_archive(){let f=Fixture::new();assert!(read(&f.0).unwrap().is_none());let saved=save(&f.0,SaveInput{expected_revision:0,workspace:sample()}).unwrap();assert_eq!(read(&f.0).unwrap().unwrap().workspace,saved.workspace);let mut next=saved.workspace;next.chats[0].archived=true;save(&f.0,SaveInput{expected_revision:1,workspace:next}).unwrap();assert!(read(&f.0).unwrap().unwrap().workspace.chats[0].archived);}
 #[test]fn local_workspace_stale_writer_cannot_overwrite(){let f=Fixture::new();save(&f.0,SaveInput{expected_revision:0,workspace:sample()}).unwrap();assert!(save(&f.0,SaveInput{expected_revision:0,workspace:sample()}).unwrap_err().contains("conflict"));}
 #[test]fn local_workspace_rejects_credentials_unknown_fields_and_corruption(){let f=Fixture::new();let mut w=sample();w.chats[0].messages[0].text="Bearer synthetic-secret".into();assert!(save(&f.0,SaveInput{expected_revision:0,workspace:w}).is_err());let mut value=serde_json::to_value(sample()).unwrap();value["apiKey"]=serde_json::json!("synthetic");assert!(serde_json::from_value::<Workspace>(value).is_err());save(&f.0,SaveInput{expected_revision:0,workspace:sample()}).unwrap();std::fs::OpenOptions::new().append(true).open(f.0.join("workspace.jsonl")).unwrap().write_all(b"partial").unwrap();assert!(read(&f.0).is_err());assert!(save(&f.0,SaveInput{expected_revision:1,workspace:sample()}).is_err());}
}
