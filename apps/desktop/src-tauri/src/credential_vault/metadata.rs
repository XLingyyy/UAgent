//! Independent credential-reference database. Never stores credential bytes.
use super::{CredentialBinding, Result, VaultError};
use std::{
    fs::{File, OpenOptions},
    io::ErrorKind,
    os::windows::fs::OpenOptionsExt,
};
type StoreError = VaultError;
#[allow(dead_code)]
#[path = "../local_run_store/sqlite.rs"]
mod sqlite;
use sqlite::{Db, Value};
pub(super) const FILE_NAME: &str = "credential-vault-state-v1.sqlite3";
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct State {
    pub revision: i64,
    pub active: Option<String>,
    pub token: Option<String>,
    pub cleanup: Vec<String>,
}
pub(super) struct Metadata {
    db: Db,
    _pin: File,
    key: String,
}
impl Metadata {
    pub fn open(binding: &CredentialBinding) -> Result<Self> {
        if super::windows::directory_identity(&binding.profile_root)? != binding.profile_identity {
            return Err(VaultError::Unavailable);
        }
        let path = binding.profile_root.join(FILE_NAME);
        // Deny DELETE sharing and open the final object itself: a reparse point
        // is rejected. CredentialBinding holds the native directory chain pins.
        let open = |create| {
            let mut options = OpenOptions::new();
            options
                .read(true)
                .write(true)
                .share_mode(3)
                .custom_flags(0x0020_0000);
            if create {
                options.create_new(true);
            }
            options.open(&path)
        };
        let pin = match open(true) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                open(false).map_err(|_| VaultError::Unavailable)?
            }
            Err(_) => return Err(VaultError::Unavailable),
        };
        use std::os::windows::fs::MetadataExt;
        let attributes = pin.metadata().map_err(|_| VaultError::Unavailable)?;
        if !attributes.is_file() || attributes.file_attributes() & 0x400 != 0 {
            return Err(VaultError::Unavailable);
        }
        let db = Db::open(&path)?;
        db.execute("PRAGMA synchronous=FULL", &[])?;
        db.transaction(|| {
            let application = db.query("PRAGMA application_id", &[])?[0][0].int()?;
            let version = db.query("PRAGMA user_version", &[])?[0][0].int()?;
            if application == 0 && version == 0 {
                if !db.query("SELECT name FROM sqlite_master WHERE type='table'", &[])?.is_empty() {
                    return Err(VaultError::Unavailable);
                }
                db.execute("CREATE TABLE credential_references(binding TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), active_version TEXT, cleanup_versions TEXT NOT NULL, mutation_token TEXT NOT NULL)", &[])?;
                db.execute("PRAGMA application_id=1430340438", &[])?;
                db.execute("PRAGMA user_version=1", &[])?;
            } else if application != 1430340438 || version != 1 {
                return Err(VaultError::Unavailable);
            }
            Ok(())
        })?;
        Ok(Self {
            db,
            _pin: pin,
            key: super::hex(&binding.digest),
        })
    }
    pub fn state(&self) -> Result<State> {
        let rows = self.db.query("SELECT revision,active_version,cleanup_versions,mutation_token FROM credential_references WHERE binding=?1", &[self.key.clone().into()])?;
        if rows.is_empty() {
            return Ok(State {
                revision: 0,
                active: None,
                token: None,
                cleanup: Vec::new(),
            });
        }
        if rows.len() != 1 {
            return Err(VaultError::Unavailable);
        }
        let row = &rows[0];
        let revision = row[0].int()?;
        let active = match &row[1] {
            Value::Null => None,
            Value::Text(v) => Some(v.clone()),
            _ => return Err(VaultError::Unavailable),
        };
        let token = row[3].text()?;
        let cleanup: Vec<String> =
            serde_json::from_str(&row[2].text()?).map_err(|_| VaultError::Unavailable)?;
        if revision <= 0
            || super::version_bytes(&token).is_err()
            || active.as_ref().is_some_and(|v| v != &token)
            || cleanup.len() > 256
            || active
                .as_ref()
                .is_some_and(|v| super::version_bytes(v).is_err())
            || cleanup.iter().any(|v| super::version_bytes(v).is_err())
            || active.as_ref().is_some_and(|v| cleanup.contains(v))
            || cleanup
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != cleanup.len()
        {
            return Err(VaultError::Unavailable);
        }
        Ok(State {
            revision,
            active,
            token: Some(token),
            cleanup,
        })
    }
    pub fn update(
        &self,
        expected: &State,
        active: Option<&str>,
        cleanup: &[String],
    ) -> Result<State> {
        if cleanup.len() > 256 {
            return Err(VaultError::Unavailable);
        }
        if let Some(v) = active {
            super::version_bytes(v)?;
        }
        for v in cleanup {
            super::version_bytes(v)?;
        }
        if active.is_some_and(|v| cleanup.iter().any(|p| p == v)) {
            return Err(VaultError::Unavailable);
        }
        let revision = expected
            .revision
            .checked_add(1)
            .ok_or(VaultError::Unavailable)?;
        let encoded = serde_json::to_string(cleanup).map_err(|_| VaultError::Unavailable)?;
        // Absence has a durable opaque CAS identity too. Otherwise a stale
        // Save(None) could reactivate an old key after save -> delete -> absent.
        let token = if let Some(active) = active {
            active.to_string()
        } else {
            let mut bytes = [0u8; 32];
            getrandom::getrandom(&mut bytes).map_err(|_| VaultError::Unavailable)?;
            super::hex(&bytes)
        };
        self.db.transaction(|| {
            if self.state()?!=*expected {return Err(VaultError::Conflict);}
            let params=[Value::Int(revision),active.map_or(Value::Null,|v|v.to_string().into()),encoded.clone().into(),token.clone().into(),self.key.clone().into()];
            if expected.revision==0 {
                self.db.execute("INSERT INTO credential_references(revision,active_version,cleanup_versions,mutation_token,binding) VALUES(?1,?2,?3,?4,?5)",&params)?;
            } else if self.db.execute("UPDATE credential_references SET revision=?1,active_version=?2,cleanup_versions=?3,mutation_token=?4 WHERE binding=?5",&params)?!=1 {
                return Err(VaultError::Unavailable);
            }
            Ok(State{revision,active:active.map(str::to_string),token:Some(token.clone()),cleanup:cleanup.to_vec()})
        })
    }
}
