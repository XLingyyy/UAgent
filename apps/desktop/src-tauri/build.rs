use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Command;

// R7.3 transitive production-source identity binding.
//
// The release binary must never embed a stale compiled commit while the working
// tree still contains the MVP15D task diff. This script executes the
// repository-owned `mvp15d-source-identity.mjs` helper, which resolves the real
// git directory (directory or worktree gitfile), reads HEAD (symbolic or
// detached) and packed refs, enumerates explicit production roots with exact
// exclusions, computes a deterministic sorted SHA-256 over the complete
// production-source inventory, and records dirty state.
//
// Cargo reruns when the helper's validated complete build watch set changes: the
// repository `.git` directory or worktree gitfile, the actual Git-dir HEAD
// file, the resolved loose branch ref file in the correct git/common
// directory, the applicable packed-refs file, any validated production root,
// or any inventoried production source file. Root watches detect newly added
// untracked production files; a missing optional root also watches its closest
// validated existing parent to capture first creation. A same-branch commit
// therefore triggers a fresh identity computation. No `.git/HEAD` child paths
// are synthesized when `.git` is a file (linked worktrees).

// Minimal deterministic JSON field extraction for the source-identity helper
// output. Only simple top-level scalars and the inventoried file paths are
// read; this deliberately avoids an extra build dependency.
fn extract_identity_string(stdout: &str, key: &str) -> String {
    let needle = format!(r#""{key}":"#);
    let Some(start) = stdout.find(&needle) else {
        panic!("MVP15D source identity missing field: {key}");
    };
    let rest = &stdout[start + needle.len()..];
    let value = rest.trim_start();
    if !value.starts_with('"') {
        panic!("MVP15D source identity field must be a string: {key}");
    }
    let inner = &value[1..];
    let end = inner
        .find('"')
        .unwrap_or_else(|| panic!("MVP15D source identity field unterminated: {key}"));
    inner[..end].to_string()
}

fn extract_identity_bool(stdout: &str, key: &str) -> bool {
    let needle = format!(r#""{key}":"#);
    let Some(start) = stdout.find(&needle) else {
        panic!("MVP15D source identity missing field: {key}");
    };
    let rest = stdout[start + needle.len()..].trim_start();
    if rest.starts_with("true,") || rest.starts_with("true\n") || rest.starts_with("true}") {
        true
    } else if rest.starts_with("false,")
        || rest.starts_with("false\n")
        || rest.starts_with("false}")
    {
        false
    } else {
        panic!("MVP15D source identity field must be a boolean: {key}");
    }
}

fn repository_root(manifest_dir: &str) -> PathBuf {
    // CARGO_MANIFEST_DIR = .../apps/desktop/src-tauri. Repo root is ../../....
    let path = std::path::PathBuf::from(manifest_dir);
    path.join("..").join("..").join("..")
}

fn helper_script(repo_root: &PathBuf) -> PathBuf {
    repo_root.join("scripts").join("mvp15d-source-identity.mjs")
}

fn run_helper(repo_root: &PathBuf, watch_set: bool) -> String {
    let helper = helper_script(repo_root);
    let mut command = Command::new("node");
    command.arg(&helper).arg("--repository").arg(repo_root);
    if watch_set {
        command.arg("--watch-set");
    }
    let output = command
        .output()
        .expect("node is required to bind the MVP15D runtime bridge source identity");
    if !output.status.success() {
        panic!(
            "MVP15D source identity failed: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
    String::from_utf8(output.stdout).expect("MVP15D source identity output must be valid UTF-8")
}

fn emit_validated_watch_set(repo_root: &PathBuf) {
    let stdout = run_helper(repo_root, true);
    let helper_suffix = PathBuf::from("scripts").join("mvp15d-source-identity.mjs");
    let mut watch_set = BTreeSet::new();
    let mut previous: Option<&str> = None;

    for line in stdout.lines() {
        let path = line.trim();
        if path.is_empty() {
            continue;
        }
        assert!(
            PathBuf::from(path).is_absolute(),
            "MVP15D source watch path must be absolute: {path}"
        );
        if let Some(previous_path) = previous {
            assert!(
                previous_path < path,
                "MVP15D source watch set must be strictly sorted and unique"
            );
        }
        assert!(
            watch_set.insert(path.to_string()),
            "MVP15D source watch set contains a duplicate: {path}"
        );
        previous = Some(path);
        println!("cargo:rerun-if-changed={path}");
    }

    assert!(
        !watch_set.is_empty(),
        "MVP15D source watch set must not be empty"
    );
    assert!(
        watch_set
            .iter()
            .any(|path| PathBuf::from(path).ends_with(&helper_suffix)),
        "MVP15D source watch set must contain the identity helper"
    );
}

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is required");
    let repo_root = repository_root(&manifest_dir);

    // Consume the helper's validated complete build watch set. Every line is one
    // absolute path: the `.git` directory or worktree gitfile, the actual
    // Git-dir HEAD file, the resolved loose branch ref file, the applicable
    // packed-refs file, a production root/closest existing parent, or an
    // inventoried production file.
    emit_validated_watch_set(&repo_root);

    let stdout = run_helper(&repo_root, false);
    let compiled_commit = extract_identity_string(&stdout, "compiledCommit");
    let source_tree_sha256 = extract_identity_string(&stdout, "sourceTreeSha256");
    let source_dirty = extract_identity_bool(&stdout, "sourceDirty");
    let head_ref = extract_identity_string(&stdout, "headRef");

    let expected_commit_len = 40;
    assert!(
        compiled_commit.len() == expected_commit_len
            && compiled_commit
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "MVP15D compiled commit is invalid: {compiled_commit}"
    );
    assert!(
        source_tree_sha256.len() == 64 && source_tree_sha256.bytes().all(|b| b.is_ascii_hexdigit()),
        "MVP15D source-tree SHA-256 is invalid: {source_tree_sha256}"
    );

    println!("cargo:rustc-env=UAGENT_SOURCE_COMMIT={compiled_commit}");
    println!("cargo:rustc-env=UAGENT_SOURCE_TREE_SHA256={source_tree_sha256}");
    println!("cargo:rustc-env=UAGENT_SOURCE_DIRTY={source_dirty}");
    println!("cargo:rustc-env=UAGENT_SOURCE_HEAD_REF={head_ref}");

    tauri_build::build()
}
