//! Small, isolated registry logic tests: no database, worker, clock waiting or filesystem.
use super::*;
fn key(index: usize) -> RequestKey { ("synthetic-project".into(), format!("request-{index}")) }

#[test]
fn acknowledged_pre_cancel_survives_257_key_pressure_and_blocks_dispatch() {
    let mut entries = HashMap::new();
    assert!(cancel_entry(&mut entries, key(0)).unwrap());
    let original_flag = entries[&key(0)].cancelled.clone();
    for index in 1..256 { assert!(cancel_entry(&mut entries, key(index)).unwrap()); }
    assert_eq!(entries.len(), 256);
    // The 257th distinct cancellation is rejected, not acknowledged and forgotten.
    let error = cancel_entry(&mut entries, key(256)).unwrap_err();
    assert_eq!(error.kind, "busy");
    assert!(error.message.contains("was not accepted"));
    assert!(!entries.contains_key(&key(256)));
    // Normal new work must also fail closed, without recycling a cancellation slot.
    assert_eq!(begin_entry(&mut entries, key(257)).unwrap_err().kind, "busy");
    assert_eq!(entries.len(), 256);
    let dispatched_flag = begin_entry(&mut entries, key(0)).unwrap();
    assert!(Arc::ptr_eq(&original_flag, &dispatched_flag));
    assert_eq!(CatalogControl::new(dispatched_flag.clone()).check().unwrap_err().kind, "catalogCancelled");
    finish_entry(&mut entries, &key(0), &dispatched_flag);
    // Only after that same cancelled work has returned may its Finished slot be reused.
    assert!(begin_entry(&mut entries, key(258)).is_ok());
    assert!(!entries.contains_key(&key(0)));
    assert_eq!(entries.len(), 256);
}

#[test]
fn pending_cancellation_has_no_age_expiry_and_only_finished_entries_are_recycled() {
    let mut entries = HashMap::new();
    assert!(cancel_entry(&mut entries, key(0)).unwrap());
    let initial = Instant::now();
    entries.get_mut(&key(0)).unwrap().updated = initial;
    // A completed record may age out; a pre-start promise with the same age may not.
    let finished_flag = begin_entry(&mut entries, key(1)).unwrap();
    finish_entry(&mut entries, &key(1), &finished_flag);
    entries.get_mut(&key(1)).unwrap().updated = initial;
    let later = initial.checked_add(Duration::from_secs(601)).unwrap();
    make_room_at(&mut entries, &key(2), later).unwrap();
    assert!(entries.contains_key(&key(0)));
    assert!(!entries.contains_key(&key(1)));
    for index in 2..257 { assert!(cancel_entry(&mut entries, key(index)).unwrap()); }
    assert_eq!(entries.len(), 256);
    assert_eq!(cancel_entry(&mut entries, key(257)).unwrap_err().kind, "busy");
    let flag = begin_entry(&mut entries, key(0)).unwrap();
    assert_eq!(CatalogControl::new(flag).check().unwrap_err().kind, "catalogCancelled");
}

#[test]
fn full_registry_keeps_existing_active_requests_cancellable_and_finished_ack_false() {
    let mut entries = HashMap::new();
    let active = begin_entry(&mut entries, key(0)).unwrap();
    for index in 1..256 { assert!(cancel_entry(&mut entries, key(index)).unwrap()); }
    assert_eq!(entries.len(), 256);
    assert!(cancel_entry(&mut entries, key(0)).unwrap());
    assert!(active.load(Ordering::Acquire));
    assert!(cancel_entry(&mut entries, key(1)).unwrap()); // Repeated Ack retains the same obligation.
    assert_eq!(entries.len(), 256);
    assert_eq!(cancel_entry(&mut entries, key(256)).unwrap_err().kind, "busy");
    finish_entry(&mut entries, &key(0), &active);
    assert!(!cancel_entry(&mut entries, key(0)).unwrap());
    assert!(cancel_entry(&mut entries, key(256)).unwrap());
    assert!(!entries.contains_key(&key(0)));
    assert!(entries.contains_key(&key(1)));
    assert_eq!(entries.len(), 256);
}


#[test]
fn rejected_native_work_reclaims_pre_cancel_slots_without_age_or_unsafe_eviction(){
    let mut entries=HashMap::new();
    for index in 0..1024{
        let key=key(index);
        assert!(cancel_entry(&mut entries,key.clone()).unwrap());
        let accepted=entries[&key].cancelled.clone();
        let owned=prepare_native_entry(&mut entries,key.clone()).unwrap();
        assert!(Arc::ptr_eq(&accepted,&owned));assert!(owned.load(Ordering::Acquire));
        finish_unentered_native_entry(&mut entries,&key,&owned);
        assert!(!cancel_entry(&mut entries,key).unwrap());
    }
    assert!(begin_entry(&mut entries,key(2048)).is_ok());
    assert!(entries.len()<=256);
}
#[test]
fn pending_native_work_cannot_be_stolen_without_its_native_dispatch_binding(){
    let mut entries=HashMap::new();let key=key(5000);
    let owned=prepare_native_entry(&mut entries,key.clone()).unwrap();
    assert!(begin_entry(&mut entries,key.clone()).is_err());
    assert!(cancel_entry(&mut entries,key.clone()).unwrap());
    let _binding=NativeRequestBinding::enter(&key,&owned).unwrap();
    let handler=begin_entry(&mut entries,key.clone()).unwrap();
    assert!(Arc::ptr_eq(&owned,&handler));assert!(handler.load(Ordering::Acquire));
    finish_entry(&mut entries,&key,&handler);
}
#[test]
fn native_envelope_destruction_does_not_finish_an_active_or_replacement_request(){
    let mut entries=HashMap::new();let key=key(5001);
    let pending=prepare_native_entry(&mut entries,key.clone()).unwrap();
    let _binding=NativeRequestBinding::enter(&key,&pending).unwrap();
    let active=begin_entry(&mut entries,key.clone()).unwrap();
    finish_unentered_native_entry(&mut entries,&key,&pending);
    assert!(entries[&key].phase==Phase::Active);
    assert!(cancel_entry(&mut entries,key.clone()).unwrap());assert!(active.load(Ordering::Acquire));
    finish_entry(&mut entries,&key,&active);
    let replacement=Arc::new(AtomicBool::new(true));
    entries.insert(key.clone(),Entry{cancelled:replacement.clone(),phase:Phase::PendingNativeWork,updated:Instant::now()});
    finish_unentered_native_entry(&mut entries,&key,&pending);
    assert!(entries[&key].phase==Phase::PendingNativeWork);
    assert!(Arc::ptr_eq(&entries[&key].cancelled,&replacement));
}
#[test]
fn still_owned_pending_requests_remain_pinned_under_capacity_pressure(){
    let mut entries=HashMap::new();let key=key(5002);
    assert!(cancel_entry(&mut entries,key.clone()).unwrap());
    let owned=prepare_native_entry(&mut entries,key.clone()).unwrap();
    for index in 6000..6255{assert!(cancel_entry(&mut entries,self::key(index)).unwrap());}
    assert_eq!(prepare_native_entry(&mut entries,self::key(7000)).unwrap_err().kind,"busy");
    assert!(entries[&key].phase==Phase::PendingNativeWork);assert!(owned.load(Ordering::Acquire));
    finish_unentered_native_entry(&mut entries,&key,&owned);
    assert!(prepare_native_entry(&mut entries,self::key(7001)).is_ok());
}
#[test]
fn actual_native_envelope_drop_finishes_unentered_but_bound_dispatch_keeps_cancel_flag(){
    let project="synthetic-native-envelope";
    for index in 0..300{
        let request=format!("discarded-{index}");
        let owned=NativeRequestLifetime::prepare(1,project,&request).unwrap();
        let cancel_input=CancelInput{schema_version:1,project_id:project.into(),request_id:request};
        assert!(cancel(&cancel_input).unwrap().cancellation_requested);
        drop(owned);
        assert!(!cancel(&cancel_input).unwrap().cancellation_requested);
    }
    let owned=NativeRequestLifetime::prepare(1,project,"dispatched").unwrap();
    let input=CancelInput{schema_version:1,project_id:project.into(),request_id:"dispatched".into()};
    assert!(cancel(&input).unwrap().cancellation_requested);
    owned.run(||{
        let permit=Permit::begin(project,"dispatched")?;
        assert!(permit.control.cancelled.load(Ordering::Acquire));Ok(())
    }).unwrap();
    assert!(!cancel(&input).unwrap().cancellation_requested);
}
