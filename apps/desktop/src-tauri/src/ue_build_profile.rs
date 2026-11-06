//! UE build preparation only. Callers resolve a trusted root and approve the returned fingerprint.
//! No command, shell arguments, executable override, or target discovery from model text is accepted.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UEBuildProfile {
    pub schema_version: u32,
    pub profile_id: String,
    pub project_id: String,
    pub engine_root: String,
    pub uproject_relative_path: String,
    pub target: String,
    pub platform: String,
    pub configuration: String,
    pub method: String,
    pub bundled_dotnet_version: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UEBuildPreview {
    pub profile: UEBuildProfile,
    pub fingerprint: String,
    pub engine_version: String,
    pub project_root: String,
    pub uproject: String,
    pub target_file: String,
    pub program: String,
    pub arguments: Vec<String>,
    pub cwd: String,
    pub timeout_ms: u64,
    pub expected_mutation: String,
    pub verification: String,
}

/// Only preparation can construct this type; JSON previews cannot become executable plans.
#[derive(Debug)]
pub struct PreparedUEBuild {
    preview: UEBuildPreview,
    project_root: PathBuf,
    program: PathBuf,
    cwd: PathBuf,
    arguments: Vec<String>,
    batch_line: Option<String>,
    dotnet_root: Option<PathBuf>,
    binding_files: Vec<PathBuf>,
}

/// Windows handles deny write/delete sharing for the checked files until execution finishes.
pub(crate) struct BindingFileGuards {
    _files: Vec<fs::File>,
}

impl PreparedUEBuild {
    pub fn preview(&self) -> &UEBuildPreview {
        &self.preview
    }

    pub(crate) fn program(&self) -> &Path {
        &self.program
    }
    pub(crate) fn cwd(&self) -> &Path {
        &self.cwd
    }
    pub(crate) fn arguments(&self) -> &[String] {
        &self.arguments
    }
    pub(crate) fn batch_line(&self) -> Option<&str> {
        self.batch_line.as_deref()
    }
    pub(crate) fn dotnet_root(&self) -> Option<&Path> {
        self.dotnet_root.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn revalidate(&self) -> Result<(), String> {
        self.revalidate_and_hold().map(|_| ())
    }

    pub(crate) fn revalidate_and_hold(&self) -> Result<BindingFileGuards, String> {
        let mut files = Vec::new();
        for path in &self.binding_files {
            let mut options = fs::OpenOptions::new();
            options.read(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(1); // FILE_SHARE_READ; deny writes and replacement/deletion.
            }
            files.push(
                options
                    .open(path)
                    .map_err(|_| "binding_file_busy_or_unavailable")?,
            );
        }
        let current = prepare_ue_build(&self.preview.profile, &self.project_root)?;
        if current.preview.fingerprint != self.preview.fingerprint {
            return Err("build_binding_changed".into());
        }
        Ok(BindingFileGuards { _files: files })
    }
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .enumerate()
            .all(|(i, b)| b.is_ascii_alphanumeric() && (i > 0 || !b.is_ascii_digit()) || b == b'_')
}

fn opaque_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn safe_path(path: &Path) -> Result<String, String> {
    let text = path.to_str().ok_or("path_not_unicode")?;
    // Build.bat re-expands arguments with CALL and delayed expansion. Reject those tokens even for UBT.
    if text
        .chars()
        .any(|c| c.is_control() || "\"%!&|<>^".contains(c))
    {
        return Err("unsafe_path_character".into());
    }
    // cmd.exe batch expansion cannot use Rust's canonical verbatim prefix reliably.
    Ok(if let Some(unc) = text.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        text.strip_prefix("\\\\?\\").unwrap_or(text).to_string()
    })
}

fn canonical_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("root_must_be_absolute".into());
    }
    let canonical = fs::canonicalize(path).map_err(|_| "root_not_found")?;
    if !canonical.is_dir() {
        return Err("root_not_directory".into());
    }
    safe_path(&canonical)?;
    Ok(canonical)
}

fn child(root: &Path, relative: &Path, directory: bool) -> Result<PathBuf, String> {
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("invalid_relative_path".into());
    }
    if relative.to_str().map_or(true, |value| value.contains(':')) {
        return Err("invalid_relative_path".into());
    }
    let result = fs::canonicalize(root.join(relative)).map_err(|_| "required_path_missing")?;
    if !result.starts_with(root) {
        return Err("path_escapes_root".into());
    }
    if directory && !result.is_dir() || !directory && !result.is_file() {
        return Err("unexpected_path_type".into());
    }
    safe_path(&result)?;
    Ok(result)
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|_| "binding_file_unreadable")?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "binding_file_unreadable")?;
    if bytes.len() as u64 > limit {
        return Err("binding_file_too_large".into());
    }
    Ok(bytes)
}

#[cfg(windows)]
fn command_interpreter() -> Result<PathBuf, String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
    }
    let mut buffer = vec![0u16; 32_768];
    let len = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if len == 0 || len >= buffer.len() {
        return Err("system_directory_unavailable".into());
    }
    let root =
        PathBuf::from(String::from_utf16(&buffer[..len]).map_err(|_| "system_directory_invalid")?);
    fs::canonicalize(root.join("cmd.exe")).map_err(|_| "system_cmd_missing".into())
}

#[cfg(not(windows))]
fn command_interpreter() -> Result<PathBuf, String> {
    Err("unsupported_host".into())
}

/// Reads metadata and fixed entrypoints; never launches an editor, UBT, or a script.
pub fn prepare_ue_build(
    profile: &UEBuildProfile,
    trusted_project_root: &Path,
) -> Result<PreparedUEBuild, String> {
    if profile.schema_version != 1 {
        return Err("unsupported_schema".into());
    }
    if !opaque_id(&profile.profile_id)
        || !opaque_id(&profile.project_id)
        || !identifier(&profile.target)
    {
        return Err("invalid_identifier".into());
    }
    if profile.platform != "Win64" {
        return Err("unsupported_platform".into());
    }
    if !["Debug", "DebugGame", "Development", "Shipping", "Test"]
        .contains(&profile.configuration.as_str())
    {
        return Err("invalid_configuration".into());
    }
    if !(1_000..=7_200_000).contains(&profile.timeout_ms) {
        return Err("invalid_timeout".into());
    }
    if !["ubt", "build_bat"].contains(&profile.method.as_str()) {
        return Err("invalid_method".into());
    }
    let project_root = canonical_root(trusted_project_root)?;
    let engine = canonical_root(Path::new(&profile.engine_root))?;
    let relative = Path::new(&profile.uproject_relative_path);
    if relative.extension().and_then(|e| e.to_str()) != Some("uproject") {
        return Err("invalid_uproject_extension".into());
    }
    let uproject = child(&project_root, relative, false)?;
    let project_directory = uproject.parent().ok_or("project_parent_missing")?;
    let target = child(
        project_directory,
        &PathBuf::from("Source").join(format!("{}.Target.cs", profile.target)),
        false,
    )?;
    let version_file = child(&engine, Path::new("Engine/Build/Build.version"), false)?;
    let version_bytes = read_bounded(&version_file, 1_048_576)?;
    let version: serde_json::Value =
        serde_json::from_slice(&version_bytes).map_err(|_| "invalid_build_version")?;
    let major = version["MajorVersion"]
        .as_u64()
        .ok_or("invalid_engine_major")?;
    let minor = version["MinorVersion"]
        .as_u64()
        .ok_or("invalid_engine_minor")?;
    let patch = version["PatchVersion"]
        .as_u64()
        .ok_or("invalid_engine_patch")?;
    let project_bytes = read_bounded(&uproject, 1_048_576)?;
    let project: serde_json::Value =
        serde_json::from_slice(&project_bytes).map_err(|_| "invalid_uproject_json")?;
    if !project.is_object() {
        return Err("invalid_uproject_json".into());
    }
    let association = project
        .get("EngineAssociation")
        .and_then(|v| v.as_str())
        .ok_or("engine_association_unresolved")?;
    // Registered GUID/source engines require a future trusted registry resolver. Do not guess.
    if association != format!("{major}.{minor}")
        && association != format!("{major}.{minor}.{patch}")
    {
        return Err("engine_association_mismatch_or_unresolved".into());
    }
    let cwd = child(&engine, Path::new("Engine/Source"), true)?;
    let arguments = vec![
        profile.target.clone(),
        profile.platform.clone(),
        profile.configuration.clone(),
        format!("-Project={}", safe_path(&uproject)?),
        "-WaitMutex".into(),
        "-NoHotReloadFromIDE".into(),
        "-UTF8Output".into(),
    ];
    let mut binding_files = vec![version_file, uproject.clone(), target.clone()];
    let mut batch_line = None;
    let mut dotnet_root = None;
    let (program, launch_arguments) = if profile.method == "ubt" {
        let sdk = profile
            .bundled_dotnet_version
            .as_deref()
            .ok_or("bundled_dotnet_version_required")?;
        let parts: Vec<_> = sdk.split('.').collect();
        if !(2..=4).contains(&parts.len())
            || parts
                .iter()
                .any(|s| s.is_empty() || !s.bytes().all(|c| c.is_ascii_digit()))
        {
            return Err("invalid_bundled_dotnet_version".into());
        }
        let root = child(
            &engine,
            &PathBuf::from("Engine/Binaries/ThirdParty/DotNet")
                .join(sdk)
                .join("win-x64"),
            true,
        )?;
        binding_files.push(child(&root, Path::new("dotnet.exe"), false)?);
        dotnet_root = Some(root);
        let executable = child(
            &engine,
            Path::new("Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe"),
            false,
        )?;
        binding_files.push(child(
            &engine,
            Path::new("Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll"),
            false,
        )?);
        binding_files.push(child(
            &engine,
            Path::new("Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.runtimeconfig.json"),
            false,
        )?);
        (executable, arguments.clone())
    } else {
        let bat = child(
            &engine,
            Path::new("Engine/Build/BatchFiles/Build.bat"),
            false,
        )?;
        binding_files.push(bat.clone());
        // CALL-based batch parsing is intentionally more restrictive than CreateProcess argv.
        for text in [safe_path(&bat)?, safe_path(&uproject)?] {
            if text.contains(['(', ')']) {
                return Err("batch_path_parentheses_unsupported".into());
            }
        }
        let quoted = arguments
            .iter()
            .map(|a| format!("\"{a}\""))
            .collect::<Vec<_>>()
            .join(" ");
        let line = format!("\"\"{}\" {quoted}\"", safe_path(&bat)?);
        batch_line = Some(line.clone());
        (
            command_interpreter()?,
            vec!["/d".into(), "/v:off".into(), "/s".into(), "/c".into(), line],
        )
    };
    binding_files.push(program.clone());
    let mut preview = UEBuildPreview {
        profile: profile.clone(),
        fingerprint: String::new(),
        engine_version: format!("{major}.{minor}.{patch}"),
        project_root: safe_path(&project_root)?,
        uproject: safe_path(&uproject)?,
        target_file: safe_path(&target)?,
        program: safe_path(&program)?,
        arguments: launch_arguments.clone(),
        cwd: safe_path(&cwd)?,
        timeout_ms: profile.timeout_ms,
        expected_mutation: "build_artifacts_and_project_build_logic".into(),
        verification: "not_started".into(),
    };
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(&preview).map_err(|_| "profile_serialization_failed")?);
    for file in &binding_files {
        hash.update(safe_path(&file)?.as_bytes());
        hash.update([0u8]);
        hash.update(Sha256::digest(read_bounded(&file, 64 * 1_048_576)?));
    }
    preview.fingerprint = format!("{:x}", hash.finalize());
    Ok(PreparedUEBuild {
        preview,
        project_root,
        program,
        cwd,
        arguments: launch_arguments,
        batch_line,
        dotnet_root,
        binding_files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        path: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if let (Ok(path), Ok(root)) = (
                fs::canonicalize(&self.path),
                fs::canonicalize(std::env::temp_dir()),
            ) {
                if path.starts_with(root)
                    && path
                        .file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with("uagent-ue-build-"))
                {
                    let _ = fs::remove_dir_all(path);
                }
            }
        }
    }
    fn fixture() -> (Fixture, UEBuildProfile, PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "uagent-ue-build-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let engine = path.join("engine space");
        let project = path.join("project space");
        for (name, body) in [
            (
                "Engine/Build/Build.version",
                "{\"MajorVersion\":5,\"MinorVersion\":8,\"PatchVersion\":4}",
            ),
            (
                "Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe",
                "fixture",
            ),
            (
                "Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll",
                "fixture",
            ),
            (
                "Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.runtimeconfig.json",
                "{}",
            ),
            (
                "Engine/Binaries/ThirdParty/DotNet/10.0/win-x64/dotnet.exe",
                "fixture",
            ),
            ("Engine/Build/BatchFiles/Build.bat", "@exit /b 0"),
        ] {
            let file = engine.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, body).unwrap();
        }
        fs::create_dir_all(engine.join("Engine/Source")).unwrap();
        fs::create_dir_all(project.join("Source")).unwrap();
        fs::write(
            project.join("Game.uproject"),
            "{\"EngineAssociation\":\"5.8\"}",
        )
        .unwrap();
        fs::write(
            project.join("Source/GameEditor.Target.cs"),
            "// fixture, never executed",
        )
        .unwrap();
        let profile = UEBuildProfile {
            schema_version: 1,
            profile_id: "game_editor".into(),
            project_id: "game".into(),
            engine_root: engine.to_string_lossy().into(),
            uproject_relative_path: "Game.uproject".into(),
            target: "GameEditor".into(),
            platform: "Win64".into(),
            configuration: "Development".into(),
            method: "ubt".into(),
            bundled_dotnet_version: Some("10.0".into()),
            timeout_ms: 1_000,
        };
        (Fixture { path }, profile, project)
    }
    #[test]
    fn prepares_bound_argv_without_execution() {
        let (_fixture, profile, project) = fixture();
        let prepared = prepare_ue_build(&profile, &project).unwrap();
        assert_eq!(prepared.preview.engine_version, "5.8.4");
        assert_eq!(
            prepared.arguments[0..3],
            ["GameEditor", "Win64", "Development"]
        );
        assert_eq!(prepared.preview.verification, "not_started");
        assert_eq!(prepared.preview.fingerprint.len(), 64);
        assert!(prepared.revalidate().is_ok());
        fs::write(
            project.join("Source/GameEditor.Target.cs"),
            "// changed externally",
        )
        .unwrap();
        assert_eq!(prepared.revalidate().unwrap_err(), "build_binding_changed");
    }
    #[test]
    fn public_execution_rejects_wrong_approval_cancellation_and_changed_binding_before_spawn() {
        use crate::ue_build_process::{execute_ue_build, UEBuildCancellation, UEBuildOwner};
        let (_fixture, profile, project) = fixture();
        let build = prepare_ue_build(&profile, &project).unwrap();
        let owner = UEBuildOwner {
            run_id: "run-1".into(),
            step_id: "step-1".into(),
            fingerprint: build.preview.fingerprint.clone(),
        };
        let cancel = UEBuildCancellation::new(owner.clone());
        let mut wrong = owner.clone();
        wrong.fingerprint = "unapproved".into();
        let denied = execute_ue_build(&build, wrong, &cancel);
        assert_eq!(denied.status, "not_started");
        assert!(denied.pid.is_none());
        assert_eq!(denied.reason, "build_owner_or_approval_mismatch");
        cancel.cancel(&owner).unwrap();
        let cancelled = execute_ue_build(&build, owner.clone(), &cancel);
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.effects, "not_started");
        assert!(cancelled.pid.is_none());
        let cancel = UEBuildCancellation::new(owner.clone());
        fs::write(
            project.join("Source/GameEditor.Target.cs"),
            "// external edit",
        )
        .unwrap();
        let changed = execute_ue_build(&build, owner, &cancel);
        assert_eq!(changed.status, "not_started");
        assert_eq!(changed.reason, "build_binding_changed");
        assert!(changed.pid.is_none());
    }
    #[cfg(windows)]
    #[test]
    fn checked_file_handles_block_writes_and_deletion_until_released() {
        let (_fixture, profile, project) = fixture();
        let prepared = prepare_ue_build(&profile, &project).unwrap();
        let guards = prepared.revalidate_and_hold().unwrap();
        let target = project.join("Source/GameEditor.Target.cs");
        assert!(fs::OpenOptions::new().write(true).open(&target).is_err());
        assert!(fs::remove_file(&target).is_err());
        assert!(fs::rename(&target, project.join("Source/Replaced.Target.cs")).is_err());
        drop(guards);
        fs::write(&target, "// edited after lock release").unwrap();
        assert_eq!(prepared.revalidate().unwrap_err(), "build_binding_changed");
    }
    #[test]
    fn rejects_bad_target_and_relative_escape() {
        let (_fixture, mut profile, project) = fixture();
        profile.target = "GameEditor -Clean".into();
        assert_eq!(
            prepare_ue_build(&profile, &project).unwrap_err(),
            "invalid_identifier"
        );
        profile.target = "GameEditor".into();
        profile.uproject_relative_path = "../project/Game.uproject".into();
        assert_eq!(
            prepare_ue_build(&profile, &project).unwrap_err(),
            "invalid_relative_path"
        );
        profile.uproject_relative_path = "Game:stream.uproject".into();
        assert_eq!(
            prepare_ue_build(&profile, &project).unwrap_err(),
            "invalid_relative_path"
        );
    }
    #[test]
    fn rejects_engine_mismatch_missing_target_and_unbounded_timeout() {
        let (_fixture, mut profile, project) = fixture();
        fs::write(
            project.join("Game.uproject"),
            "{\"EngineAssociation\":\"5.7\"}",
        )
        .unwrap();
        assert_eq!(
            prepare_ue_build(&profile, &project).unwrap_err(),
            "engine_association_mismatch_or_unresolved"
        );
        fs::write(
            project.join("Game.uproject"),
            "{\"EngineAssociation\":\"5.8\"}",
        )
        .unwrap();
        profile.target = "OtherEditor".into();
        assert_eq!(
            prepare_ue_build(&profile, &project).unwrap_err(),
            "required_path_missing"
        );
        profile.timeout_ms = u64::MAX;
        assert_eq!(
            prepare_ue_build(&profile, &project).unwrap_err(),
            "invalid_timeout"
        );
    }
    #[cfg(windows)]
    #[test]
    fn batch_uses_only_system_interpreter_and_quoted_fixed_arguments() {
        let (_fixture, mut profile, project) = fixture();
        profile.method = "build_bat".into();
        let build = prepare_ue_build(&profile, &project).unwrap();
        assert!(build.program.ends_with("cmd.exe"));
        assert_eq!(build.arguments[0..4], ["/d", "/v:off", "/s", "/c"]);
        assert!(build.batch_line.as_ref().unwrap().starts_with("\"\""));
    }
    #[cfg(windows)]
    #[test]
    fn safe_batch_stub_receives_exact_argv_with_space_paths() {
        use crate::ue_build_process::{execute_ue_build, UEBuildCancellation, UEBuildOwner};
        let (_fixture, mut profile, project) = fixture();
        profile.method = "build_bat".into();
        let expected_project =
            safe_path(&fs::canonicalize(project.join("Game.uproject")).unwrap()).unwrap();
        let stub = format!("@echo off\r\nif not \"%~1\"==\"GameEditor\" exit /b 21\r\nif not \"%~2\"==\"Win64\" exit /b 22\r\nif not \"%~3\"==\"Development\" exit /b 23\r\nif not \"%~4\"==\"-Project={expected_project}\" exit /b 24\r\nif not \"%~5\"==\"-WaitMutex\" exit /b 25\r\nif not \"%~6\"==\"-NoHotReloadFromIDE\" exit /b 26\r\nif not \"%~7\"==\"-UTF8Output\" exit /b 27\r\necho safe-batch-fixture-complete\r\nexit /b 0\r\n");
        fs::write(
            Path::new(&profile.engine_root).join("Engine/Build/BatchFiles/Build.bat"),
            stub,
        )
        .unwrap();
        let build = prepare_ue_build(&profile, &project).unwrap();
        let owner = UEBuildOwner {
            run_id: "batch-fixture".into(),
            step_id: "one".into(),
            fingerprint: build.preview.fingerprint.clone(),
        };
        let cancel = UEBuildCancellation::new(owner.clone());
        let result = execute_ue_build(&build, owner, &cancel);
        assert_eq!(result.status, "succeeded", "{result:?}");
        assert_eq!(result.exit_code, Some(0));
        assert!(result.stdout.contains("safe-batch-fixture-complete"));
        assert!(result.tree_stopped);
    }
    #[cfg(windows)]
    #[test]
    fn canonical_junction_escape_is_rejected() {
        // File symlinks may require privilege. A directory junction uses the system cmd only in this test.
        use std::os::windows::process::CommandExt;
        let (fixture, mut profile, project) = fixture();
        let outside = fixture.path.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("Other.uproject"), "{}").unwrap();
        let status = std::process::Command::new(command_interpreter().unwrap())
            .args(["/d", "/c", "mklink", "/J"])
            .arg(project.join("escape"))
            .arg(&outside)
            .creation_flags(0x08000000)
            .status()
            .unwrap();
        assert!(status.success());
        profile.uproject_relative_path = "escape/Other.uproject".into();
        assert_eq!(
            prepare_ue_build(&profile, &project).unwrap_err(),
            "path_escapes_root"
        );
    }
}
