use super::*;
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};

const SYNTHETIC: &str = "uagent-test-value-not-an-api-key";
const REPLACEMENT: &str = "uagent-replacement-not-an-api-key";
struct Fixture {
    root: PathBuf,
    bindings: Vec<CredentialBinding>,
    directories: Vec<PathBuf>,
}
impl Fixture {
    fn new() -> Self {
        let base = PathBuf::from(
            std::env::var_os("UAGENT_CREDENTIAL_VAULT_TEST_ROOT")
                .expect("Provide an explicit E/G fixture root"),
        );
        assert!(base.is_absolute());
        let drive = base
            .to_string_lossy()
            .chars()
            .next()
            .unwrap()
            .to_ascii_uppercase();
        assert!(matches!(drive, 'E' | 'G'));
        fs::create_dir_all(&base).unwrap();
        let mut id = [0; 24];
        getrandom::getrandom(&mut id).unwrap();
        let root = base.join(format!("credential-vault-test-{}", hex(&id)));
        fs::create_dir(&root).unwrap();
        Self {
            root,
            bindings: Vec::new(),
            directories: Vec::new(),
        }
    }
    fn binding_at(
        &mut self,
        profile: &str,
        provider: &str,
        generation: &str,
        endpoint: &str,
    ) -> CredentialBinding {
        let path = self.root.join(profile);
        if !path.exists() {
            fs::create_dir(&path).unwrap();
            self.directories.push(path.clone());
        }
        let binding = CredentialBinding::new(&path, provider, generation, endpoint).unwrap();
        self.bindings.push(binding.clone());
        binding
    }
    fn binding(&mut self) -> CredentialBinding {
        self.binding_at(
            "profile",
            "synthetic-provider",
            "test-generation-one",
            "https://api.deepseek.com",
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // No enumeration or broad target prefix cleanup. These exact targets
        // were constructed only for this fresh random fixture's known bindings.
        let mut cleanup_failed = false;
        for binding in &self.bindings {
            if let Ok(_guard) = windows::TargetGuard::acquire(&binding.target) {
                match metadata::Metadata::open(binding).and_then(|db| db.state()) {
                    Ok(state) => {
                        let versions = state.active.into_iter().chain(state.cleanup);
                        for version in versions {
                            let target = binding.os_target(&version).unwrap();
                            if windows::delete(&target).is_err()
                                || !matches!(windows::read(&target), Ok(None))
                            {
                                cleanup_failed = true;
                            }
                        }
                    }
                    Err(_) => cleanup_failed = true,
                }
            } else {
                cleanup_failed = true;
            }
        }
        if cleanup_failed {
            if std::thread::panicking() {
                eprintln!("Own credential-vault fixture cleanup failed");
            } else {
                panic!("Own credential-vault fixture cleanup failed");
            }
        }
        for path in &self.directories {
            for name in [
                metadata::FILE_NAME,
                &format!("{}-journal", metadata::FILE_NAME),
            ] {
                let file = path.join(name);
                if file.exists() {
                    fs::remove_file(file).unwrap();
                }
            }
        }
        self.bindings.clear(); // Release only our directory-chain pins.
        for path in self.directories.iter().rev() {
            let _ = fs::remove_dir(path); // Empty fixture directories only.
        }
        let _ = fs::remove_dir(&self.root);
    }
}
fn secret(value: &str) -> Secret {
    Secret::new(value.as_bytes().to_vec()).unwrap()
}

#[test]
fn new_binding_has_no_record_and_does_not_create_one() {
    let mut f = Fixture::new();
    let b = f.binding();
    assert_eq!(status(&b).unwrap(), CredentialStatus::absent());
    assert_eq!(load(&b, &"0".repeat(64)).err(), Some(VaultError::Conflict));
    assert_eq!(status(&b).unwrap(), CredentialStatus::absent());
}

#[test]
fn actual_windows_round_trip_fixed_mask_and_reopen() {
    let mut f = Fixture::new();
    let b = f.binding();
    let stored = save(&b, None, secret(SYNTHETIC)).unwrap();
    assert!(stored.exists);
    assert_eq!(stored.masked, Some("********"));
    let version = stored.version.unwrap();
    assert_eq!(version.len(), 64);
    assert_eq!(load(&b, &version).unwrap().as_bytes(), SYNTHETIC.as_bytes());
    let reopened = CredentialBinding::new(
        &f.root.join("profile"),
        "synthetic-provider",
        "test-generation-one",
        "https://api.deepseek.com",
    )
    .unwrap();
    assert_eq!(status(&reopened).unwrap().version, Some(version));
    let encoded = serde_json::to_string(&status(&reopened).unwrap()).unwrap();
    assert!(!encoded.contains(SYNTHETIC));
    assert!(!format!("{:?}", status(&reopened).unwrap()).contains(SYNTHETIC));
}

#[test]
fn replacement_requires_captured_version_and_invalidates_old_load_and_guard() {
    let mut f = Fixture::new();
    let b = f.binding();
    let first = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    assert_eq!(
        save(&b, None, secret(REPLACEMENT)).err(),
        Some(VaultError::Conflict)
    );
    let second = save(&b, Some(&first), secret(REPLACEMENT))
        .unwrap()
        .version
        .unwrap();
    assert_ne!(first, second);
    assert_eq!(load(&b, &first).err(), Some(VaultError::Conflict));
    assert_eq!(
        save(&b, Some(&first), secret(SYNTHETIC)).err(),
        Some(VaultError::Conflict)
    );
    let invoked = AtomicBool::new(false);
    assert_eq!(
        with_current(&b, &first, || invoked.store(true, Ordering::SeqCst)),
        Err(VaultError::Conflict)
    );
    assert!(!invoked.load(Ordering::SeqCst));
    assert_eq!(
        load(&b, &second).unwrap().as_bytes(),
        REPLACEMENT.as_bytes()
    );
}

#[test]
fn deletion_requires_current_version_and_never_clears_another_replacement() {
    let mut f = Fixture::new();
    let b = f.binding();
    let first = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    let second = save(&b, Some(&first), secret(REPLACEMENT))
        .unwrap()
        .version
        .unwrap();
    assert_eq!(delete(&b, &first).err(), Some(VaultError::Conflict));
    assert_eq!(status(&b).unwrap().version, Some(second.clone()));
    let deleted = delete(&b, &second).unwrap();
    assert!(!deleted.exists && !deleted.cleanup_pending && deleted.masked.is_none());
    assert!(deleted.version.is_some() && deleted.version.as_deref() != Some(second.as_str()));
    assert_eq!(load(&b, &second).err(), Some(VaultError::Conflict));
    let third = save(&b, deleted.version.as_deref(), secret(SYNTHETIC))
        .unwrap()
        .version
        .unwrap();
    assert_ne!(third, first);
    assert_ne!(third, second);
    assert_eq!(delete(&b, &second).err(), Some(VaultError::Conflict));
    assert!(status(&b).unwrap().exists);
}

#[test]
fn exact_provider_generation_endpoint_and_profile_binding() {
    let mut f = Fixture::new();
    let first = f.binding();
    let version = save(&first, None, secret(SYNTHETIC))
        .unwrap()
        .version
        .unwrap();
    let alternatives = [
        f.binding_at(
            "profile",
            "other-provider",
            "test-generation-one",
            "https://api.deepseek.com",
        ),
        f.binding_at(
            "profile",
            "synthetic-provider",
            "test-generation-two",
            "https://api.deepseek.com",
        ),
        f.binding_at(
            "profile",
            "synthetic-provider",
            "test-generation-one",
            "https://api.openai.com/v1",
        ),
        f.binding_at(
            "other-profile",
            "synthetic-provider",
            "test-generation-one",
            "https://api.deepseek.com",
        ),
    ];
    for other in alternatives {
        assert_ne!(first.target, other.target);
        assert_eq!(status(&other).unwrap(), CredentialStatus::absent());
        assert_eq!(load(&other, &version).err(), Some(VaultError::Conflict));
    }
    assert_eq!(
        load(&first, &version).unwrap().as_bytes(),
        SYNTHETIC.as_bytes()
    );
}

#[test]
fn binding_rejects_noncanonical_or_unsupported_targets_and_bad_ids() {
    let f = Fixture::new();
    for endpoint in [
        "https://api.deepseek.com/",
        "https://api.deepseek.com:443",
        "https://api.deepseek.com@other.invalid",
        "https://api.openai.com/v1/",
        "https://api.openai.com/v1?api_key=synthetic",
        "http://127.0.0.1:1",
        "https://other.invalid/v1",
        "https://API.OPENAI.COM/v1",
    ] {
        assert_eq!(
            CredentialBinding::new(&f.root, "provider", "generation-one", endpoint).err(),
            Some(VaultError::InvalidInput)
        );
    }
    for provider in ["", "space provider", "../provider", "provider\0"] {
        assert_eq!(
            CredentialBinding::new(
                &f.root,
                provider,
                "generation-one",
                "https://api.deepseek.com"
            )
            .err(),
            Some(VaultError::InvalidInput)
        );
    }
    assert_eq!(
        CredentialBinding::new(&f.root, "provider", "", "https://api.deepseek.com").err(),
        Some(VaultError::InvalidInput)
    );
    assert_eq!(
        CredentialBinding::new(
            Path::new("relative"),
            "provider",
            "generation-one",
            "https://api.deepseek.com"
        )
        .err(),
        Some(VaultError::InvalidInput)
    );
}

#[test]
fn invalid_secret_and_version_fail_without_os_mutation() {
    let mut f = Fixture::new();
    let b = f.binding();
    for value in [
        vec![b'a'; 7],
        vec![b'a'; MAX_KEY + 1],
        b"test value with spaces".to_vec(),
        b"test-value\r\n".to_vec(),
        vec![0xe9; 10],
    ] {
        assert_eq!(Secret::new(value).err(), Some(VaultError::InvalidInput));
    }
    assert_eq!(
        save(&b, Some("invalid-version"), secret(SYNTHETIC)).err(),
        Some(VaultError::InvalidInput)
    );
    assert_eq!(
        with_current(&b, "invalid-version", || 1),
        Err(VaultError::InvalidInput)
    );
    assert_eq!(status(&b).unwrap(), CredentialStatus::absent());
    let max = "x".repeat(MAX_KEY);
    let version = save(&b, None, secret(&max)).unwrap().version.unwrap();
    assert_eq!(load(&b, &version).unwrap().as_bytes().len(), MAX_KEY);
}

#[test]
fn fixed_mask_does_not_disclose_secret_length_or_suffix() {
    let mut f = Fixture::new();
    let b = f.binding();
    let first = save(&b, None, secret("eightkey")).unwrap();
    let second = save(&b, first.version.as_deref(), secret(&"x".repeat(2048))).unwrap();
    assert_eq!(first.masked, second.masked);
    assert_eq!(second.masked, Some("********"));
}

#[test]
fn native_dispatch_guard_excludes_replacement_until_callback_returns() {
    let mut f = Fixture::new();
    let b = f.binding();
    let version = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let guard_binding = b.clone();
    let old = version.clone();
    let guard_worker = std::thread::spawn(move || {
        with_current(&guard_binding, &old, || {
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        })
        .unwrap();
    });
    entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let (saved_tx, saved_rx) = mpsc::sync_channel(1);
    let replacement_binding = b.clone();
    let old = version.clone();
    let save_worker = std::thread::spawn(move || {
        let result = save(&replacement_binding, Some(&old), secret(REPLACEMENT));
        saved_tx.send(result).unwrap();
    });
    assert!(saved_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release_tx.send(()).unwrap();
    guard_worker.join().unwrap();
    let updated = saved_rx
        .recv_timeout(Duration::from_secs(3))
        .unwrap()
        .unwrap();
    save_worker.join().unwrap();
    assert_ne!(updated.version.as_deref(), Some(version.as_str()));
    assert_eq!(with_current(&b, &version, || 1), Err(VaultError::Conflict));
}

#[test]
fn only_one_of_two_simultaneous_captured_saves_can_succeed() {
    let mut f = Fixture::new();
    let b = f.binding();
    let version = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let binding = b.clone();
            let version = version.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                save(&binding, Some(&version), secret(REPLACEMENT))
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| r.as_ref().err() == Some(&VaultError::Conflict))
            .count(),
        1
    );
}

#[test]
fn malformed_os_record_is_static_error_and_never_a_default_reset() {
    let mut f = Fixture::new();
    let b = f.binding();
    let version = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    let target = b.os_target(&version).unwrap();
    let bad = b"synthetic malformed private fixture";
    windows::write(&target, bad).unwrap();
    let recovery = status(&b).unwrap();
    assert!(!recovery.exists && recovery.masked.is_none());
    assert_eq!(recovery.recovery, Some(CredentialRecovery::Corrupt));
    assert_eq!(recovery.version.as_deref(), Some(version.as_str()));
    assert_eq!(
        save(&b, None, secret(SYNTHETIC)).err(),
        Some(VaultError::Conflict)
    );
    assert_eq!(windows::read(&target).unwrap().unwrap().0, bad);
    assert_eq!(
        VaultError::Unavailable.to_string(),
        "credential_vault_unavailable"
    );
}

#[test]
fn clear_bytes_uses_the_scrubber() {
    let mut bytes = [1, 2, 3, 4];
    zero(&mut bytes);
    assert_eq!(bytes, [0; 4]);
}

#[test]
fn actual_record_can_be_loaded_by_a_new_process_without_plaintext_arguments() {
    let mut f = Fixture::new();
    let b = f.binding();
    let version = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("credential_vault::tests::explicit_child_reads_only_own_fixture")
        .arg("--test-threads=1")
        .env("UAGENT_CREDENTIAL_VAULT_CHILD_ROOT", f.root.join("profile"))
        .env("UAGENT_CREDENTIAL_VAULT_CHILD_VERSION", &version)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Child returned static test failure"
    );
    assert_eq!(status(&b).unwrap().version, Some(version));
}
#[test]
fn explicit_child_reads_only_own_fixture() {
    let Some(path) = std::env::var_os("UAGENT_CREDENTIAL_VAULT_CHILD_ROOT") else {
        return;
    };
    let root = PathBuf::from(path);
    assert!(
        root.to_string_lossy().starts_with("E:\\") || root.to_string_lossy().starts_with("G:\\")
    );
    let parent = root
        .parent()
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy();
    assert!(
        parent.starts_with("credential-vault-test-")
            && parent.len() == "credential-vault-test-".len() + 48
    );
    let binding = CredentialBinding::new(
        &root,
        "synthetic-provider",
        "test-generation-one",
        "https://api.deepseek.com",
    )
    .unwrap();
    let version = std::env::var("UAGENT_CREDENTIAL_VAULT_CHILD_VERSION").unwrap();
    if std::env::var("UAGENT_CREDENTIAL_VAULT_CHILD_ACTION").as_deref() == Ok("replace") {
        fs::write(root.parent().unwrap().join("replacement-ready"), b"ready").unwrap();
        let updated = save(&binding, Some(&version), secret(REPLACEMENT)).unwrap();
        assert_ne!(updated.version.as_deref(), Some(version.as_str()));
    } else if std::env::var("UAGENT_CREDENTIAL_VAULT_CHILD_ACTION").as_deref()
        == Ok("reject-disabled")
    {
        let state = status(&binding).unwrap();
        assert!(!state.exists && state.cleanup_pending);
        assert_eq!(load(&binding, &version).err(), Some(VaultError::Conflict));
        assert_eq!(
            with_current(&binding, &version, || 1),
            Err(VaultError::Conflict)
        );
    } else {
        assert_eq!(
            status(&binding).unwrap().version.as_deref(),
            Some(version.as_str())
        );
        assert_eq!(
            load(&binding, &version).unwrap().as_bytes(),
            SYNTHETIC.as_bytes()
        );
    }
}

#[test]
fn cross_process_replacement_waits_for_native_dispatch_guard() {
    let mut f = Fixture::new();
    let b = f.binding();
    let version = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    let mut child = with_current(&b, &version, || {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("credential_vault::tests::explicit_child_reads_only_own_fixture")
            .arg("--test-threads=1")
            .env("UAGENT_CREDENTIAL_VAULT_CHILD_ROOT", f.root.join("profile"))
            .env("UAGENT_CREDENTIAL_VAULT_CHILD_VERSION", &version)
            .env("UAGENT_CREDENTIAL_VAULT_CHILD_ACTION", "replace")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let started = std::time::Instant::now();
        while !f.root.join("replacement-ready").exists() {
            assert!(
                started.elapsed() < Duration::from_secs(2),
                "Child did not reach replacement gate"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            child.try_wait().unwrap().is_none(),
            "Replacement escaped the held native dispatch guard"
        );
        assert_eq!(
            status(&b).unwrap().version.as_deref(),
            Some(version.as_str())
        );
        child
    })
    .unwrap();
    assert!(child.wait().unwrap().success());
    fs::remove_file(f.root.join("replacement-ready")).unwrap();
    let updated = status(&b).unwrap().version.unwrap();
    assert_ne!(updated, version);
    assert_eq!(
        load(&b, &updated).unwrap().as_bytes(),
        REPLACEMENT.as_bytes()
    );
}

// These fault hooks are test-only: they reject one WinCred boundary call while
// all other reads/writes use the actual per-user Windows store.
#[test]
fn os_delete_failure_is_durably_disabled_before_cleanup_and_child_reopen() {
    let mut f = Fixture::new();
    let b = f.binding();
    let version = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    faults::FAIL_DELETE.with(|v| v.set(true));
    assert_eq!(delete(&b, &version).err(), Some(VaultError::CleanupPending));
    let state = status(&b).unwrap();
    assert!(
        !state.exists
            && state.version.as_deref() != Some(version.as_str())
            && state.cleanup_pending
    );
    assert!(windows::read(&b.os_target(&version).unwrap())
        .unwrap()
        .is_some());
    assert_eq!(load(&b, &version).err(), Some(VaultError::Conflict));
    let called = AtomicBool::new(false);
    assert_eq!(
        with_current(&b, &version, || called.store(true, Ordering::SeqCst)),
        Err(VaultError::Conflict)
    );
    assert!(!called.load(Ordering::SeqCst));
    let child = Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("credential_vault::tests::explicit_child_reads_only_own_fixture")
        .arg("--test-threads=1")
        .env("UAGENT_CREDENTIAL_VAULT_CHILD_ROOT", f.root.join("profile"))
        .env("UAGENT_CREDENTIAL_VAULT_CHILD_VERSION", &version)
        .env("UAGENT_CREDENTIAL_VAULT_CHILD_ACTION", "reject-disabled")
        .output()
        .unwrap();
    assert!(
        child.status.success(),
        "Child did not reject durably disabled record"
    );
    let cleaned = cleanup(&b).unwrap();
    assert!(!cleaned.exists && !cleaned.cleanup_pending && cleaned.masked.is_none());
    assert!(windows::read(&b.os_target(&version).unwrap())
        .unwrap()
        .is_none());
}
#[test]
fn os_replacement_write_failure_cannot_restore_old_version() {
    let mut f = Fixture::new();
    let b = f.binding();
    let version = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    faults::FAIL_WRITE.with(|v| v.set(true));
    assert_eq!(
        save(&b, Some(&version), secret(REPLACEMENT)).err(),
        Some(VaultError::Unavailable)
    );
    let reopened = CredentialBinding::new(
        &f.root.join("profile"),
        "synthetic-provider",
        "test-generation-one",
        "https://api.deepseek.com",
    )
    .unwrap();
    let state = status(&reopened).unwrap();
    assert!(!state.exists && state.cleanup_pending);
    assert_eq!(load(&reopened, &version).err(), Some(VaultError::Conflict));
    assert_eq!(
        with_current(&reopened, &version, || 1),
        Err(VaultError::Conflict)
    );
    assert!(windows::read(&b.os_target(&version).unwrap())
        .unwrap()
        .is_some());
    let cleaned = cleanup(&b).unwrap();
    assert!(!cleaned.exists && !cleaned.cleanup_pending && cleaned.masked.is_none());
}
#[test]
fn replacement_cleanup_failure_keeps_only_new_version_active() {
    let mut f = Fixture::new();
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    faults::FAIL_DELETE.with(|v| v.set(true));
    let saved = save(&b, Some(&old), secret(REPLACEMENT)).unwrap();
    assert!(saved.exists && saved.cleanup_pending);
    let new = saved.version.unwrap();
    assert_eq!(load(&b, &old).err(), Some(VaultError::Conflict));
    assert_eq!(load(&b, &new).err(), Some(VaultError::CleanupPending));
    let clean = cleanup(&b).unwrap();
    assert!(clean.exists && !clean.cleanup_pending);
    assert_eq!(clean.version.as_deref(), Some(new.as_str()));
    assert_eq!(load(&b, &new).unwrap().as_bytes(), REPLACEMENT.as_bytes());
    assert!(windows::read(&b.os_target(&old).unwrap())
        .unwrap()
        .is_none());
}
#[test]
fn independent_metadata_contains_no_credential_bytes() {
    let mut f = Fixture::new();
    let b = f.binding();
    let saved = save(&b, None, secret(SYNTHETIC)).unwrap();
    let data = fs::read(b.profile_root.join(metadata::FILE_NAME)).unwrap();
    assert!(!data
        .windows(SYNTHETIC.len())
        .any(|v| v == SYNTHETIC.as_bytes()));
    assert!(data
        .windows(saved.version.as_ref().unwrap().len())
        .any(|v| v == saved.version.as_ref().unwrap().as_bytes()));
}

#[test]
fn persistent_tombstone_rejects_absent_save_aba_and_stale_retired_token() {
    let mut f = Fixture::new();
    let b = f.binding();
    assert_eq!(status(&b).unwrap().version, None);
    let active = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    let tombstone = delete(&b, &active).unwrap();
    assert!(!tombstone.exists && tombstone.version.is_some());
    assert_eq!(
        save(&b, None, secret(SYNTHETIC)).err(),
        Some(VaultError::Conflict)
    );
    assert_eq!(
        load(&b, tombstone.version.as_deref().unwrap()).err(),
        Some(VaultError::Conflict)
    );
    let revived = save(&b, tombstone.version.as_deref(), secret(REPLACEMENT))
        .unwrap()
        .version
        .unwrap();
    let second_tombstone = delete(&b, &revived).unwrap();
    assert_ne!(second_tombstone.version, tombstone.version);
    let reopened = CredentialBinding::new(
        &f.root.join("profile"),
        "synthetic-provider",
        "test-generation-one",
        "https://api.deepseek.com",
    )
    .unwrap();
    assert_eq!(status(&reopened).unwrap().version, second_tombstone.version);
    assert_eq!(
        save(&reopened, tombstone.version.as_deref(), secret(SYNTHETIC)).err(),
        Some(VaultError::Conflict)
    );
    assert!(!status(&reopened).unwrap().exists);
}

#[test]
fn root_and_ancestor_rename_are_blocked_until_all_binding_pins_drop() {
    let mut f = Fixture::new();
    let b = f.binding();
    let root = f.root.join("profile");
    let moved = f.root.join("moved-profile");
    assert!(fs::rename(&root, &moved).is_err());
    let parent_moved = f.root.with_extension("moved");
    assert!(fs::rename(&f.root, &parent_moved).is_err());
    drop(b);
    f.bindings.clear();
    fs::rename(&root, &moved).unwrap();
    fs::rename(&moved, &root).unwrap();
}
#[test]
fn profile_path_junction_is_rejected_without_changing_link_privileges() {
    use std::os::windows::process::CommandExt;
    let mut f = Fixture::new();
    let b = f.binding_at(
        "real-profile",
        "synthetic-provider",
        "test-generation-one",
        "https://api.deepseek.com",
    );
    let alias = f.root.join("junction-alias");
    let target = f.root.join("real-profile");
    for p in [&alias, &target] {
        assert!(!p.to_string_lossy().chars().any(|c| "&|<>^%!".contains(c)));
    }
    let created = Command::new("cmd.exe")
        .args(["/c", "mklink", "/J"])
        .arg(&alias)
        .arg(&target)
        .creation_flags(0x0800_0000)
        .output()
        .unwrap();
    assert!(
        created.status.success(),
        "Own E-drive junction fixture creation failed; no privileges were modified"
    );
    let rejected = CredentialBinding::new(
        &alias,
        "synthetic-provider",
        "test-generation-one",
        "https://api.deepseek.com",
    )
    .err();
    assert_eq!(rejected, Some(VaultError::InvalidInput));
    // remove_dir removes this exact junction object, never the target contents.
    fs::remove_dir(&alias).unwrap();
    assert!(target.exists());
    drop(b);
}

#[test]
fn recovery_missing_os_entry_can_be_explicitly_replaced_with_captured_metadata_token() {
    let mut f = Fixture::new();
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    windows::delete(&b.os_target(&old).unwrap()).unwrap();
    let reopened = CredentialBinding::new(
        &f.root.join("profile"),
        "synthetic-provider",
        "test-generation-one",
        "https://api.deepseek.com",
    )
    .unwrap();
    let state = status(&reopened).unwrap();
    assert!(!state.exists && state.masked.is_none() && !state.cleanup_pending);
    assert_eq!(state.version.as_deref(), Some(old.as_str()));
    assert_eq!(state.recovery, Some(CredentialRecovery::Missing));
    assert_eq!(load(&reopened, &old).err(), Some(VaultError::Unavailable));
    let called = AtomicBool::new(false);
    assert_eq!(
        with_current(&reopened, &old, || called.store(true, Ordering::SeqCst)),
        Err(VaultError::Unavailable)
    );
    assert!(!called.load(Ordering::SeqCst));
    let restored = save(&reopened, state.version.as_deref(), secret(REPLACEMENT)).unwrap();
    assert!(restored.exists && restored.recovery.is_none());
    assert_ne!(restored.version.as_deref(), Some(old.as_str()));
    assert_eq!(
        load(&reopened, restored.version.as_deref().unwrap())
            .unwrap()
            .as_bytes(),
        REPLACEMENT.as_bytes()
    );
    assert_eq!(
        save(&reopened, Some(&old), secret(SYNTHETIC)).err(),
        Some(VaultError::Conflict)
    );
}
#[test]
fn recovery_corrupt_os_entry_can_be_explicitly_replaced_without_reusing_old_cas() {
    let mut f = Fixture::new();
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    windows::write(
        &b.os_target(&old).unwrap(),
        b"owned synthetic malformed record",
    )
    .unwrap();
    let state = status(&b).unwrap();
    assert!(!state.exists && state.masked.is_none());
    assert_eq!(state.version.as_deref(), Some(old.as_str()));
    assert_eq!(state.recovery, Some(CredentialRecovery::Corrupt));
    let encoded = serde_json::to_string(&state).unwrap();
    assert!(encoded.contains("\"recovery\":\"corrupt\""));
    assert!(!encoded.contains(SYNTHETIC) && !encoded.contains("malformed"));
    assert_eq!(load(&b, &old).err(), Some(VaultError::Unavailable));
    let called = AtomicBool::new(false);
    assert_eq!(
        with_current(&b, &old, || called.store(true, Ordering::SeqCst)),
        Err(VaultError::Unavailable)
    );
    assert!(!called.load(Ordering::SeqCst));
    let restored = save(&b, state.version.as_deref(), secret(REPLACEMENT)).unwrap();
    assert!(restored.exists && restored.recovery.is_none());
    assert_eq!(status(&b).unwrap(), restored);
    assert_eq!(
        save(&b, Some(&old), secret(SYNTHETIC)).err(),
        Some(VaultError::Conflict)
    );
    assert_eq!(delete(&b, &old).err(), Some(VaultError::Conflict));
}
#[test]
fn recovery_missing_os_entry_can_be_explicitly_reset_and_tombstone_stays_cas_bound() {
    let mut f = Fixture::new();
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    windows::delete(&b.os_target(&old).unwrap()).unwrap();
    let state = status(&b).unwrap();
    assert_eq!(state.recovery, Some(CredentialRecovery::Missing));
    let removed = delete(&b, state.version.as_deref().unwrap()).unwrap();
    assert!(!removed.exists && !removed.cleanup_pending && removed.recovery.is_none());
    assert_ne!(removed.version, state.version);
    assert_eq!(
        save(&b, state.version.as_deref(), secret(REPLACEMENT)).err(),
        Some(VaultError::Conflict)
    );
    let restored = save(&b, removed.version.as_deref(), secret(REPLACEMENT)).unwrap();
    assert!(restored.exists && restored.recovery.is_none());
}
#[test]
fn recovery_unknown_os_read_failure_is_unavailable_and_dispatch_callback_never_runs() {
    let mut f = Fixture::new();
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    faults::FAIL_READ.with(|v| v.set(true));
    let state = status(&b).unwrap();
    assert!(!state.exists && state.masked.is_none());
    assert_eq!(state.version.as_deref(), Some(old.as_str()));
    assert_eq!(state.recovery, Some(CredentialRecovery::Unavailable));
    faults::FAIL_READ.with(|v| v.set(true));
    assert_eq!(load(&b, &old).err(), Some(VaultError::Unavailable));
    let called = AtomicBool::new(false);
    faults::FAIL_READ.with(|v| v.set(true));
    assert_eq!(
        with_current(&b, &old, || called.store(true, Ordering::SeqCst)),
        Err(VaultError::Unavailable)
    );
    assert!(!called.load(Ordering::SeqCst));
    // Explicit reset does not need to read the old OS secret. Its metadata CAS
    // commits inactivity before a failed OS delete can leave the record behind.
    faults::FAIL_DELETE.with(|v| v.set(true));
    assert_eq!(
        delete(&b, state.version.as_deref().unwrap()).err(),
        Some(VaultError::CleanupPending)
    );
    let disabled = status(&b).unwrap();
    assert!(!disabled.exists && disabled.recovery.is_none() && disabled.cleanup_pending);
    assert_ne!(disabled.version, state.version);
    assert!(windows::read(&b.os_target(&old).unwrap())
        .unwrap()
        .is_some());
    assert_eq!(load(&b, &old).err(), Some(VaultError::Conflict));
    let clean = cleanup(&b).unwrap();
    assert!(!clean.exists && !clean.cleanup_pending && clean.recovery.is_none());
}
#[test]
fn recovery_unknown_os_read_failure_allows_only_deliberate_cas_replacement() {
    let mut f = Fixture::new();
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    faults::FAIL_READ.with(|v| v.set(true));
    let state = status(&b).unwrap();
    assert_eq!(state.recovery, Some(CredentialRecovery::Unavailable));
    assert_eq!(state.version.as_deref(), Some(old.as_str()));
    assert_eq!(
        save(&b, None, secret(REPLACEMENT)).err(),
        Some(VaultError::Conflict)
    );
    let restored = save(&b, state.version.as_deref(), secret(REPLACEMENT)).unwrap();
    assert!(restored.exists && restored.recovery.is_none());
    assert_eq!(
        load(&b, restored.version.as_deref().unwrap())
            .unwrap()
            .as_bytes(),
        REPLACEMENT.as_bytes()
    );
}
#[test]
fn recovery_unreadable_metadata_still_fails_whole_status_without_a_token() {
    use std::os::windows::fs::OpenOptionsExt;
    let mut f = Fixture::new();
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    let pin = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(b.profile_root.join(metadata::FILE_NAME))
        .unwrap();
    assert_eq!(status(&b).err(), Some(VaultError::Unavailable));
    let called = AtomicBool::new(false);
    assert_eq!(
        with_current(&b, &old, || called.store(true, Ordering::SeqCst)),
        Err(VaultError::Unavailable)
    );
    assert!(!called.load(Ordering::SeqCst));
    drop(pin);
    let original = status(&b).unwrap();
    assert!(original.exists && original.recovery.is_none());
    assert_eq!(original.version.as_deref(), Some(old.as_str()));
}

/// External helper for this task's just-created isolated native UI fixtures.
/// No environment flag or mutation entry is present in production builds.
#[test]
fn recovery_external_owned_fixture_mutator() {
    let Some(root) = std::env::var_os("UAGENT_RECOVERY_UI_ROOT") else {
        return;
    };
    let root = PathBuf::from(root)
        .canonicalize()
        .expect("Own isolated fixture root must exist");
    let base =
        PathBuf::from(r"E:\Codex\UAgent\2026-10-29\evidence\credential-vault-recovery-20261030")
            .canonicalize()
            .expect("Own fixture evidence base must exist");
    assert!(
        root != base && root.starts_with(&base),
        "Refuse any production/outside fixture root"
    );
    let provider = std::env::var("UAGENT_RECOVERY_UI_PROVIDER").expect("Explicit fixture provider");
    let generation =
        std::env::var("UAGENT_RECOVERY_UI_GENERATION").expect("Explicit fixture generation");
    let endpoint =
        std::env::var("UAGENT_RECOVERY_UI_ENDPOINT").expect("Explicit fixture canonical endpoint");
    let version =
        std::env::var("UAGENT_RECOVERY_UI_VERSION").expect("Explicit active fixture version");
    let action =
        std::env::var("UAGENT_RECOVERY_UI_ACTION").expect("Explicit missing/corrupt action");
    assert!(
        matches!(action.as_str(), "missing" | "corrupt"),
        "Unknown fixture action"
    );
    let binding = CredentialBinding::new(&root, &provider, &generation, &endpoint)
        .expect("Native fixture binding");
    let _guard = windows::TargetGuard::acquire(&binding.target).expect("Own fixture must be idle");
    let metadata = metadata::Metadata::open(&binding).expect("Own fixture healthy metadata");
    let state = metadata.state().expect("Own fixture metadata state");
    assert!(
        state.cleanup.is_empty()
            && state.active.as_deref() == Some(version.as_str())
            && state.token.as_deref() == Some(version.as_str()),
        "Fixture active/version mismatch"
    );
    let record = read_record(&binding, &version).expect("Own fixture readable initial record");
    assert!(
        matches!(
            record.secret.as_bytes(),
            b"uagent-recovery-fixture-key-20261030-A" | b"uagent-recovery-fixture-key-20261030-B"
        ),
        "Refuse to mutate any non-designated synthetic fixture credential"
    );
    drop(record);
    let target = binding.os_target(&version).expect("Exact owned target");
    if action == "missing" {
        windows::delete(&target).expect("Own fixture deletion");
    } else {
        windows::write(&target, b"owned-recovery-fixture-malformed-blob")
            .expect("Own fixture corruption");
    }
    assert_eq!(metadata.state().expect("Unchanged fixture metadata"), state);
    println!("Owned isolated synthetic fixture mutation completed; metadata/version preserved; no enumeration.");
}

fn cleanup_pending_fixture(f: &mut Fixture) -> (CredentialBinding, String, String) {
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    faults::FAIL_DELETE.with(|v| v.set(true));
    let saved = save(&b, Some(&old), secret(REPLACEMENT)).unwrap();
    assert!(saved.exists && saved.cleanup_pending && saved.recovery.is_none());
    let current = saved.version.unwrap();
    (b, old, current)
}
#[test]
fn cleanup_matrix_active_pending_blocks_send_stale_cas_and_failed_cleanup_then_retry() {
    let mut f = Fixture::new();
    let (b, old, current) = cleanup_pending_fixture(&mut f);
    assert_eq!(load(&b, &current).err(), Some(VaultError::CleanupPending));
    let called = AtomicBool::new(false);
    assert_eq!(
        with_current(&b, &current, || called.store(true, Ordering::SeqCst)),
        Err(VaultError::CleanupPending)
    );
    assert!(!called.load(Ordering::SeqCst));
    faults::FAIL_DELETE.with(|v| v.set(true));
    assert_eq!(
        cleanup_if_current(&b, &old).err(),
        Some(VaultError::Conflict)
    );
    assert!(
        faults::FAIL_DELETE.with(|v| v.get()),
        "Stale cleanup touched the OS delete gate"
    );
    // The next correct call consumes the still-pending fault and remains
    // truthfully active+pending, with no authority to load/send.
    assert_eq!(
        cleanup_if_current(&b, &current).err(),
        Some(VaultError::CleanupPending)
    );
    let failed = status(&b).unwrap();
    assert!(failed.exists && failed.cleanup_pending && failed.recovery.is_none());
    assert_eq!(failed.version.as_deref(), Some(current.as_str()));
    assert!(windows::read(&b.os_target(&old).unwrap())
        .unwrap()
        .is_some());
    let clean = cleanup_if_current(&b, &current).unwrap();
    assert!(clean.exists && !clean.cleanup_pending && clean.recovery.is_none());
    assert_eq!(clean.version.as_deref(), Some(current.as_str()));
    assert_eq!(
        load(&b, &current).unwrap().as_bytes(),
        REPLACEMENT.as_bytes()
    );
    let count = std::cell::Cell::new(0);
    with_current(&b, &current, || count.set(count.get() + 1)).unwrap();
    assert_eq!(count.get(), 1);
}
#[test]
fn cleanup_matrix_recovery_pending_stays_recovery_after_cleanup_until_explicit_replace() {
    for recovery in [
        CredentialRecovery::Missing,
        CredentialRecovery::Corrupt,
        CredentialRecovery::Unavailable,
    ] {
        let mut f = Fixture::new();
        let (b, _old, current) = cleanup_pending_fixture(&mut f);
        match recovery {
            CredentialRecovery::Missing => {
                windows::delete(&b.os_target(&current).unwrap()).unwrap()
            }
            CredentialRecovery::Corrupt => windows::write(
                &b.os_target(&current).unwrap(),
                b"owned pending corrupt fixture",
            )
            .unwrap(),
            CredentialRecovery::Unavailable => faults::FAIL_READ.with(|v| v.set(true)),
        }
        let pending = status(&b).unwrap();
        assert!(!pending.exists && pending.cleanup_pending && pending.masked.is_none());
        assert_eq!(pending.recovery, Some(recovery));
        assert_eq!(load(&b, &current).err(), Some(VaultError::CleanupPending));
        let called = AtomicBool::new(false);
        assert_eq!(
            with_current(&b, &current, || called.store(true, Ordering::SeqCst)),
            Err(VaultError::CleanupPending)
        );
        assert!(!called.load(Ordering::SeqCst));
        if recovery == CredentialRecovery::Unavailable {
            faults::FAIL_READ.with(|v| v.set(true));
        }
        let cleaned = cleanup_if_current(&b, pending.version.as_deref().unwrap()).unwrap();
        assert!(!cleaned.exists && !cleaned.cleanup_pending && cleaned.masked.is_none());
        assert_eq!(cleaned.recovery, Some(recovery));
        assert_eq!(cleaned.version.as_deref(), Some(current.as_str()));
        if recovery == CredentialRecovery::Unavailable {
            faults::FAIL_READ.with(|v| v.set(true));
        }
        assert_eq!(load(&b, &current).err(), Some(VaultError::Unavailable));
        if recovery == CredentialRecovery::Unavailable {
            faults::FAIL_READ.with(|v| v.set(true));
        }
        assert_eq!(
            with_current(&b, &current, || called.store(true, Ordering::SeqCst)),
            Err(VaultError::Unavailable)
        );
        assert!(!called.load(Ordering::SeqCst));
        let repaired = save(&b, cleaned.version.as_deref(), secret(SYNTHETIC)).unwrap();
        assert!(repaired.exists && !repaired.cleanup_pending && repaired.recovery.is_none());
        assert_ne!(repaired.version, cleaned.version);
        assert_eq!(
            load(&b, repaired.version.as_deref().unwrap())
                .unwrap()
                .as_bytes(),
            SYNTHETIC.as_bytes()
        );
    }
}
#[test]
fn cleanup_matrix_inactive_pending_remains_disabled_on_failure_then_uses_new_tombstone() {
    let mut f = Fixture::new();
    let b = f.binding();
    let old = save(&b, None, secret(SYNTHETIC)).unwrap().version.unwrap();
    faults::FAIL_DELETE.with(|v| v.set(true));
    assert_eq!(delete(&b, &old).err(), Some(VaultError::CleanupPending));
    let pending = status(&b).unwrap();
    assert!(!pending.exists && pending.cleanup_pending && pending.recovery.is_none());
    let token = pending.version.unwrap();
    assert_ne!(token, old);
    assert_eq!(load(&b, &token).err(), Some(VaultError::CleanupPending));
    let called = AtomicBool::new(false);
    assert_eq!(
        with_current(&b, &token, || called.store(true, Ordering::SeqCst)),
        Err(VaultError::CleanupPending)
    );
    assert!(!called.load(Ordering::SeqCst));
    faults::FAIL_DELETE.with(|v| v.set(true));
    assert_eq!(
        cleanup_if_current(&b, &token).err(),
        Some(VaultError::CleanupPending)
    );
    let failed = status(&b).unwrap();
    assert!(!failed.exists && failed.cleanup_pending && failed.recovery.is_none());
    assert_eq!(failed.version.as_deref(), Some(token.as_str()));
    let clean = cleanup_if_current(&b, &token).unwrap();
    assert!(!clean.exists && !clean.cleanup_pending && clean.recovery.is_none());
    assert_ne!(clean.version.as_deref(), Some(token.as_str()));
    assert_eq!(
        load(&b, clean.version.as_deref().unwrap()).err(),
        Some(VaultError::Conflict)
    );
    assert_eq!(
        cleanup_if_current(&b, &token).err(),
        Some(VaultError::Conflict)
    );
    assert!(windows::read(&b.os_target(&old).unwrap())
        .unwrap()
        .is_none());
}
#[test]
fn cleanup_matrix_generation_endpoint_and_profile_mismatch_touch_no_pending_target() {
    let mut f = Fixture::new();
    let (b, old, current) = cleanup_pending_fixture(&mut f);
    let others = [
        f.binding_at(
            "profile",
            "synthetic-provider",
            "test-generation-two",
            "https://api.deepseek.com",
        ),
        f.binding_at(
            "profile",
            "synthetic-provider",
            "test-generation-one",
            "https://api.openai.com/v1",
        ),
        f.binding_at(
            "other-profile",
            "synthetic-provider",
            "test-generation-one",
            "https://api.deepseek.com",
        ),
    ];
    for other in others {
        assert_eq!(
            cleanup_if_current(&other, &current).err(),
            Some(VaultError::Conflict)
        );
        assert!(windows::read(&b.os_target(&old).unwrap())
            .unwrap()
            .is_some());
    }
    let pending = status(&b).unwrap();
    assert!(pending.exists && pending.cleanup_pending);
    assert_eq!(pending.version.as_deref(), Some(current.as_str()));
    assert!(cleanup_if_current(&b, &current).unwrap().exists);
}

/// Only the new cleanup native-UI run may call this test binary entry.
/// The previous recovery profile and its OS targets are never accepted.
#[test]
fn cleanup_external_owned_fixture_mutator() {
    let Some(root) = std::env::var_os("UAGENT_CLEANUP_UI_ROOT") else {
        return;
    };
    let root = PathBuf::from(root)
        .canonicalize()
        .expect("New own cleanup profile must exist");
    let allowed = PathBuf::from(
        r"E:\Codex\UAgent\2026-10-29\evidence\credential-vault-cleanup-20261030\isolated-ui-r1",
    )
    .canonicalize()
    .expect("New own cleanup evidence profile must exist");
    assert!(
        root == allowed || root.starts_with(&allowed),
        "Refuse old recovery/production/outside cleanup profile"
    );
    let provider = std::env::var("UAGENT_CLEANUP_UI_PROVIDER").expect("Explicit fixture provider");
    let generation =
        std::env::var("UAGENT_CLEANUP_UI_GENERATION").expect("Explicit fixture generation");
    let endpoint =
        std::env::var("UAGENT_CLEANUP_UI_ENDPOINT").expect("Explicit canonical endpoint");
    let version =
        std::env::var("UAGENT_CLEANUP_UI_VERSION").expect("Explicit current active version");
    let action = std::env::var("UAGENT_CLEANUP_UI_ACTION").expect("Explicit owned fixture action");
    assert!(
        matches!(
            action.as_str(),
            "missing" | "corrupt" | "replace-pending" | "delete-pending"
        ),
        "Unknown cleanup fixture action"
    );
    let binding = CredentialBinding::new(&root, &provider, &generation, &endpoint)
        .expect("Native owned fixture binding");
    let _guard = windows::TargetGuard::acquire(&binding.target).expect("Own fixture must be idle");
    let metadata = metadata::Metadata::open(&binding).expect("Own healthy fixture metadata");
    let state = metadata.state().expect("Own current fixture state");
    assert!(
        state.active.as_deref() == Some(version.as_str())
            && state.token.as_deref() == Some(version.as_str()),
        "Own fixture active/token mismatch"
    );
    let record = read_record(&binding, &version).expect("Own readable active synthetic record");
    let a = b"uagent-recovery-fixture-key-20261030-A";
    let b = b"uagent-recovery-fixture-key-20261030-B";
    assert!(
        record.secret.as_bytes() == a || record.secret.as_bytes() == b,
        "Refuse non-designated synthetic credential"
    );
    let replacement = if record.secret.as_bytes() == a { b } else { a };
    drop(record);
    let target = binding.os_target(&version).expect("Exact owned target");
    match action.as_str() {
        "missing" => {
            windows::delete(&target).expect("Own exact active fixture removal");
            assert_eq!(metadata.state().unwrap(), state);
        }
        "corrupt" => {
            windows::write(&target, b"owned-cleanup-fixture-malformed")
                .expect("Own exact active fixture corruption");
            assert_eq!(metadata.state().unwrap(), state);
        }
        "replace-pending" => {
            faults::FAIL_DELETE.with(|v| v.set(true));
            let saved = save(
                &binding,
                Some(&version),
                Secret::new(replacement.to_vec()).unwrap(),
            )
            .expect("Own pending replacement");
            assert!(saved.exists && saved.cleanup_pending && saved.recovery.is_none());
            assert_ne!(saved.version.as_deref(), Some(version.as_str()));
        }
        "delete-pending" => {
            faults::FAIL_DELETE.with(|v| v.set(true));
            assert_eq!(
                delete(&binding, &version).err(),
                Some(VaultError::CleanupPending)
            );
            let disabled = metadata.state().unwrap();
            assert!(disabled.active.is_none() && !disabled.cleanup.is_empty());
        }
        _ => unreachable!(),
    }
    println!("Owned new cleanup fixture action completed; only designated synthetic target(s); no enumeration/network.");
}
