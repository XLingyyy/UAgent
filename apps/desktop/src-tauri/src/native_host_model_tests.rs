use super::*;
use crate::product_settings_store::{ProductSettingsStore, ProviderConfig, ProviderModel,
    AuthMode, WireApi, CapabilityDeclarations, Declaration, RequestDefaults};
use crate::provider_endpoint_policy::NATIVE_ENDPOINT_POLICY;
use crate::managed_run_store::{memory_pipeline_fixture, task_for_pipeline_fixture, stop_memory_pipeline_fixture};

struct Fixture {
    root: PathBuf,
    managed: crate::managed_run_store::ManagedRunStoreState,
    document: Arc<NativeStoreWindowGrant>,
    task: Arc<NativeStoreTaskGrant>,
    config: ProviderConfig,
    version: ProviderVersion,
    profile: String,
}
impl Fixture {
    fn new() -> Self {
        let unique=token().unwrap();
        let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap()
            .join(".local-dev/temp/host-model-tests").join(&unique);
        let (managed, document)=memory_pipeline_fixture(root.join("task-store"));
        let task=task_for_pipeline_fixture(&managed,"project","run");
        let config=ProviderConfig { provider_id:format!("synthetic-{unique}"), display_name:"Synthetic".into(),
            base_url:"https://api.deepseek.com".into(),wire_api:WireApi::ChatCompletions,auth_mode:AuthMode::EnvKey,
            models:vec![ProviderModel{id:"deepseek-flash".into(),label:"Synthetic".into(),context_window:32768,
                supports_reasoning:false,reasoning_efforts:None,capability_declarations:CapabilityDeclarations{
                    text:Declaration::Supported,tools:Declaration::Supported,streaming:Declaration::Supported},
                request_defaults:RequestDefaults::default()}],default_model:Some("deepseek-flash".into()),
            default_reasoning_effort:None,enabled:true};
        let settings=ProductSettingsStore::open(&root.join("run-store-v2")).unwrap();
        let snapshot=settings.save_provider(&settings.provider_version(&config.provider_id).unwrap(),&config,&NATIVE_ENDPOINT_POLICY).unwrap();
        drop(settings);
        let version=snapshot.version();
        let profile=open(&root,"main",document.clone(),&version,"deepseek-flash",b"synthetic-task-only".to_vec()).unwrap();
        Self{root,managed,document,task,config,version,profile}
    }
    fn owner(&self) -> Owner {
        Owner{project:"project".into(),epoch:1,run:"run".into(),conversation:"conversation".into(),
            provider:self.config.provider_id.clone(),model:"deepseek-flash".into()}
    }
    fn capture(&self) -> Arc<TaskModel> {
        capture(&self.profile,"main",&self.document,self.task.clone(),self.owner(),60_000).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _=close_profile(&self.profile,"main");
        stop_memory_pipeline_fixture(&self.managed);
    }
}

#[test]
fn host_model_late_task_uses_absolute_deadline_and_never_extends_profile_ttl() {
    use std::sync::atomic::AtomicU64;
    struct TestClock(AtomicU64);
    impl Clock for TestClock { fn now_ms(&self)->u64 {self.0.load(Ordering::Acquire)} }
    for (started, expected_deadline) in [(180_000,240_000),(TTL-1000,TTL)] {
        let f=Fixture::new();let clock=Arc::new(TestClock(AtomicU64::new(started)));
        {let mut state=lock().unwrap();Arc::get_mut(state.profiles.get_mut(&f.profile).unwrap()).unwrap().clock=clock.clone();}
        let task=f.capture();assert_eq!(task.deadline_ms(),expected_deadline);
        let lease=task.session().capture_lease(task.deadline_ms()).unwrap();
        clock.0.store(expected_deadline-1,Ordering::Release);
        assert!(lease.is_current());assert!(task.check_current().is_ok());
        clock.0.store(expected_deadline,Ordering::Release);
        assert!(!lease.is_current());assert!(task.check_current().is_err());
    }
}

#[test]
fn host_model_task_survives_view_revocation_but_cannot_mint_another_task() {
    let f=Fixture::new();let task=f.capture();
    let lease=task.session().capture_lease(1000).unwrap();
    f.document.native_document().revoke();
    release_window("main");
    assert!(task.check_current().is_ok());assert!(lease.is_current());
    assert!(capture(&f.profile,"main",&f.document,f.task.clone(),f.owner(),1000).is_err());
    close_profile(&f.profile,"main").unwrap();
    assert!(task.check_current().is_err());assert!(!lease.is_current());
}

#[test]
fn host_model_provider_update_revokes_task_and_blocks_new_credentials() {
    let f=Fixture::new();let task=f.capture();let lease=task.session().capture_lease(1000).unwrap();
    let update=crate::native_saved_deepseek::begin_provider_update(&f.config.provider_id).unwrap();
    assert!(!lease.is_current());assert!(task.check_current().is_err());
    assert!(open(&f.root,"main",f.document.clone(),&f.version,"deepseek-flash",b"synthetic-task-only".to_vec()).is_err());
    drop(update);
    assert!(capture(&f.profile,"main",&f.document,f.task.clone(),f.owner(),1000).is_err());
}

#[test]
fn host_model_run_and_document_identity_cannot_be_substituted() {
    let f=Fixture::new();let mut foreign=f.owner();foreign.run="other".into();
    assert!(capture(&f.profile,"main",&f.document,f.task.clone(),foreign,1000).is_err());
    let other=Fixture::new();
    assert!(capture(&f.profile,"main",&other.document,f.task.clone(),f.owner(),1000).is_err());
    assert!(capture(&f.profile,"foreign-window",&f.document,f.task.clone(),f.owner(),1000).is_err());
    let task=f.capture();
    assert!(close_profile(&f.profile,"foreign-window").is_err());
    assert!(task.check_current().is_ok());
}

#[test]
fn host_model_changed_configuration_and_project_revocation_close_sessions() {
    let mut f=Fixture::new();let task=f.capture();
    let settings=ProductSettingsStore::open(&f.root.join("run-store-v2")).unwrap();
    f.config.display_name="Changed".into();
    settings.save_provider(&f.version,&f.config,&NATIVE_ENDPOINT_POLICY).unwrap();drop(settings);
    assert!(task.check_current().is_err());
    let g=Fixture::new();let other=g.capture();let lease=other.session().capture_lease(1000).unwrap();
    revoke_project("project");
    assert!(!lease.is_current());assert!(other.check_current().is_err());
}
