use super::{sqlite::Db, Result, StoreError};
pub const SCHEMA_VERSION: i64 = 3;

// Each statement is prepared separately. Never split SQL on user supplied content.
pub(super) const V1: &[&str] = &[
    "CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL CHECK(created_at>=0))",
    "CREATE TABLE sessions (project_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL CHECK(created_at>=0), archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), parent_id TEXT, origin TEXT NOT NULL CHECK(origin IN ('native','historicalTextCopy')), PRIMARY KEY(project_id,id), FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(project_id,parent_id) REFERENCES sessions(project_id,id))",
    "CREATE TABLE messages (project_id TEXT NOT NULL, session_id TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>0), role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')), body TEXT NOT NULL, created_at INTEGER NOT NULL CHECK(created_at>=0), origin TEXT NOT NULL CHECK(origin IN ('native','historicalTextCopy')), PRIMARY KEY(project_id,id), UNIQUE(project_id,session_id,ordinal), FOREIGN KEY(project_id,session_id) REFERENCES sessions(project_id,id))",
    "CREATE TABLE runs (project_id TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('created','running','paused','succeeded','failed','cancelled','needsReconciliation')), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), created_at INTEGER NOT NULL CHECK(created_at>=0), updated_at INTEGER NOT NULL CHECK(updated_at>=0), PRIMARY KEY(project_id,id), FOREIGN KEY(project_id,session_id) REFERENCES sessions(project_id,id))",
    "CREATE INDEX messages_session_order ON messages(project_id,session_id,ordinal)",
    "CREATE INDEX sessions_project_time ON sessions(project_id,created_at,id)",
    "PRAGMA user_version=1",
];
const V2: &[&str] = &[
    "CREATE TABLE steps (project_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id,run_id,id), FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,id))",
    "CREATE TABLE tool_calls (project_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL, step_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id,run_id,id), FOREIGN KEY(project_id,run_id,step_id) REFERENCES steps(project_id,run_id,id))",
    "CREATE TABLE events (project_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0), payload TEXT NOT NULL, PRIMARY KEY(project_id,run_id,id), UNIQUE(project_id,run_id,sequence), FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,id))",
    "CREATE TABLE checkpoints (project_id TEXT NOT NULL, run_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), payload TEXT NOT NULL, PRIMARY KEY(project_id,run_id,revision), FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,id))",
    "CREATE TABLE changesets (project_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id,run_id,id), FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,id))",
    "CREATE TABLE artifact_blobs (project_id TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL CHECK(bytes>=0), PRIMARY KEY(project_id,sha256), FOREIGN KEY(project_id) REFERENCES projects(id))",
    "CREATE TABLE artifact_refs (project_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL, sha256 TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id,run_id,id), FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,id), FOREIGN KEY(project_id,sha256) REFERENCES artifact_blobs(project_id,sha256))",
    "CREATE TABLE legacy_imports (project_id TEXT NOT NULL, source_sha256 TEXT NOT NULL, legacy_chat_id TEXT NOT NULL, session_id TEXT NOT NULL, source_revision INTEGER NOT NULL CHECK(source_revision>0), prior_truncation TEXT NOT NULL CHECK(prior_truncation='unknownCannotRecover'), PRIMARY KEY(project_id,source_sha256,legacy_chat_id), FOREIGN KEY(project_id,session_id) REFERENCES sessions(project_id,id))",
    "PRAGMA user_version=2",
];
pub(super) fn migrate(db: &Db) -> Result<()> {
    db.transaction(|| {
        let version = db.query("PRAGMA user_version", &[])?[0][0].int()?;
        if version > SCHEMA_VERSION {
            return Err(StoreError::new(
                "newerSchema",
                "database requires a newer UAgent; it was not modified",
            ));
        }
        if version < 1 {
            for sql in V1 {
                db.execute(sql, &[])?;
            }
        }
        if version < 2 {
            for sql in V2 {
                db.execute(sql, &[])?;
            }
        }
        if version < 3 {
            for sql in super::project_memory::V3 { db.execute(sql, &[])?; }
        }
        Ok(())
    })
}
