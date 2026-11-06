//! Per native document cancellation lookup. Renderer IDs never create ownership.
use std::{collections::HashMap, sync::{Arc, Mutex, Weak, atomic::{AtomicBool, Ordering}}};
type Key = (String, String);
#[derive(Default)]
pub(crate) struct SessionRequestScope { entries: Mutex<HashMap<Key, Weak<AtomicBool>>>, closed: AtomicBool }
pub(crate) struct SessionRequestRegistration { scope: Arc<SessionRequestScope>, key: Key, flag: Arc<AtomicBool> }
impl SessionRequestScope {
    pub(crate) fn register(self: &Arc<Self>, project: &str, request: &str, flag: Arc<AtomicBool>) -> Result<SessionRequestRegistration, &'static str> {
        let mut entries = self.entries.lock().map_err(|_| "unavailable")?;
        if self.closed.load(Ordering::Acquire) { return Err("unavailable"); }
        entries.retain(|_, flag| flag.strong_count() > 0);
        let key = (project.into(), request.into());
        if entries.contains_key(&key) || entries.len() >= 64 { return Err("busy"); }
        entries.insert(key.clone(), Arc::downgrade(&flag));
        Ok(SessionRequestRegistration { scope: self.clone(), key, flag })
    }
    pub(crate) fn cancel(&self, project: &str, request: &str) -> Result<(), &'static str> {
        let entries = self.entries.lock().map_err(|_| "unavailable")?;
        if self.closed.load(Ordering::Acquire) { return Err("unavailable"); }
        let flag = entries.get(&(project.into(), request.into())).and_then(Weak::upgrade).ok_or("unavailable")?;
        flag.store(true, Ordering::Release);
        Ok(())
    }
    pub(crate) fn revoke(&self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(mut entries) = self.entries.lock() {
            for (_, flag) in entries.drain() { if let Some(flag) = flag.upgrade() { flag.store(true, Ordering::Release); } }
        }
    }
}
impl SessionRequestRegistration {
    pub(crate) fn is_current(&self) -> bool { !self.scope.closed.load(Ordering::Acquire) }
}
impl Drop for SessionRequestRegistration {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.scope.entries.lock() {
            if entries.get(&self.key).is_some_and(|old| old.ptr_eq(&Arc::downgrade(&self.flag))) { entries.remove(&self.key); }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn scope() -> Arc<SessionRequestScope> { Arc::new(SessionRequestScope::default()) }
    fn flag() -> Arc<AtomicBool> { Arc::new(AtomicBool::new(false)) }
    #[test] fn only_own_existing_project_request_can_be_cancelled() {
        let a=scope();let b=scope();let f=flag();let _r=a.register("p","r",f.clone()).unwrap();
        assert!(b.cancel("p","r").is_err());assert!(a.cancel("other","r").is_err());assert!(a.cancel("p","unknown").is_err());
        assert!(!f.load(Ordering::Acquire));a.cancel("p","r").unwrap();assert!(f.load(Ordering::Acquire));
    }
    #[test] fn unknown_cancel_does_not_pre_cancel_a_future_request() {
        let a=scope();assert!(a.cancel("p","r").is_err());let f=flag();let _r=a.register("p","r",f.clone()).unwrap();assert!(!f.load(Ordering::Acquire));
    }
    #[test] fn navigation_revoke_cancels_old_requests_only_and_cannot_regrant() {
        let old=scope();let fresh=scope();let f=flag();let g=flag();let r=old.register("p","r",f.clone()).unwrap();let _s=fresh.register("p","r",g.clone()).unwrap();
        old.revoke();assert!(f.load(Ordering::Acquire));assert!(!g.load(Ordering::Acquire));assert!(!r.is_current());
        assert!(old.cancel("p","r").is_err());assert!(old.register("p","next",flag()).is_err());
    }
    #[test] fn completed_or_rejected_envelope_releases_ownership() {
        let a=scope();let f=flag();let r=a.register("p","r",f.clone()).unwrap();drop(r);
        assert!(a.cancel("p","r").is_err());assert!(!f.load(Ordering::Acquire));assert!(a.entries.lock().unwrap().is_empty());
    }
    #[test] fn sequential_finished_requests_do_not_exhaust_document_capacity() {
        let a=scope();let mut retained=Vec::new();for i in 0..300 {let f=flag();let r=a.register("p",&i.to_string(),f.clone()).unwrap();retained.push(f);drop(r);}
        assert!(a.entries.lock().unwrap().is_empty());
    }
    #[test] fn close_and_release_do_not_remove_other_scope_requests() {
        let a=scope();let b=scope();let f=flag();let g=flag();let r=a.register("p","r",f.clone()).unwrap();let _s=b.register("p","r",g.clone()).unwrap();
        a.revoke();drop(r);b.cancel("p","r").unwrap();assert!(g.load(Ordering::Acquire));
    }
    #[test] fn registration_racing_close_is_either_rejected_or_cancelled() {
        for _ in 0..64 {let a=scope();let b=a.clone();let f=flag();let worker=std::thread::spawn(move || b.revoke());let r=a.register("p","r",f.clone());worker.join().unwrap();if let Ok(r)=r {assert!(!r.is_current());assert!(f.load(Ordering::Acquire));}assert!(a.cancel("p","r").is_err());}
    }
}
