//! Process-local storage selection. Initialize before constructing any Tauri windows.
//!
//! An isolated profile is explicit, local, pinned for the lifetime of the process,
//! and never selected through IPC or persisted in the ordinary application data.
use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

static PROFILE: OnceLock<Result<Profile, String>> = OnceLock::new();

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplicationProfile {
    pub isolated: bool,
    pub offline_demo: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Arguments {
    profile_dir: Option<PathBuf>,
    offline_demo: bool,
}

struct Profile {
    isolated: Option<IsolatedProfile>,
    offline_demo: bool,
}

struct IsolatedProfile {
    root: PathBuf,
    webview: PathBuf,
    // These handles deny DELETE sharing: neither the selected directories nor
    // any ancestor can be renamed/replaced while the profile is in use.
    pins: Vec<DirectoryPin>,
}

struct DirectoryPin {
    path: PathBuf,
    #[cfg(windows)]
    file: std::fs::File,
    #[cfg(windows)]
    identity: windows::Identity,
}

/// Call first in run(), before generate_context!(), setup hooks or storage reads.
/// Both success and failure are retained; an invalid profile cannot fall back to
/// the ordinary profile, and subsequent calls cannot change the selection.
pub(crate) fn initialize_from_env() -> Result<(), String> {
    PROFILE
        .get_or_init(|| profile_from_args(std::env::args_os().skip(1)))
        .as_ref()
        .map(|_| ())
        .map_err(Clone::clone)
}

fn selected() -> Result<&'static Profile, String> {
    PROFILE
        .get()
        .ok_or_else(|| "application_profile_not_initialized".to_string())?
        .as_ref()
        .map_err(Clone::clone)
}

/// All native consumers of app_data_dir must resolve through this function.
pub(crate) fn resolve_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    resolve_for_profile(selected()?, || {
        app.path().app_data_dir().map_err(|error| error.to_string())
    })
}

fn resolve_for_profile(
    profile: &Profile,
    ordinary: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    match &profile.isolated {
        Some(isolated) => {
            isolated.verify()?;
            Ok(isolated.root.clone())
        }
        None => ordinary(),
    }
}

/// For isolated startup only, mark configured windows create=false before
/// Builder::run, then build them in setup with
/// WebviewWindowBuilder::from_config(app, config)?.data_directory(path).build().
/// The builder override accepts an absolute path; WindowConfig.data_directory
/// is documented as relative and must not be relied on for this isolation.
pub(crate) fn webview_data_directory() -> Result<Option<PathBuf>, String> {
    let profile = selected()?;
    match &profile.isolated {
        Some(isolated) => {
            isolated.verify()?;
            Ok(Some(isolated.webview.clone()))
        }
        None => Ok(None),
    }
}

/// Suppress automatic configured windows only for an explicit isolated profile.
/// Call after generate_context!() and before Builder::run(context).
pub(crate) fn configure_isolated_windows(
    context: &mut tauri::Context<tauri::Wry>,
) -> Result<(), String> {
    if webview_data_directory()?.is_some() {
        for window in &mut context.config_mut().app.windows {
            window.create = false;
        }
    }
    Ok(())
}

/// Run from Builder::setup. Absolute builder paths bypass Tauri's relative
/// WindowConfig.data_directory handling and its ordinary data-local resolution.
pub(crate) fn setup_isolated_windows(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let Some(path) = webview_data_directory().map_err(std::io::Error::other)? else {
        return Ok(());
    };
    for configured in &app.config().app.windows {
        let mut config = configured.clone();
        config.data_directory = None;
        tauri::WebviewWindowBuilder::from_config(app, &config)?
            .data_directory(path.clone())
            .build()?;
    }
    Ok(())
}

/// Descriptive UI state only. Neither field grants permission for any command.
#[tauri::command]
pub(crate) fn get_application_profile() -> Result<ApplicationProfile, String> {
    let profile = selected()?;
    if let Some(isolated) = &profile.isolated {
        isolated.verify()?;
    }
    Ok(profile.description())
}

impl Profile {
    fn description(&self) -> ApplicationProfile {
        ApplicationProfile {
            isolated: self.isolated.is_some(),
            offline_demo: self.offline_demo,
        }
    }
}

fn profile_from_args(args: impl IntoIterator<Item = OsString>) -> Result<Profile, String> {
    // Finish parsing and lexical validation before touching any directory.
    let args = parse_arguments(args)?;
    let isolated = args.profile_dir.map(create_isolated_profile).transpose()?;
    Ok(Profile {
        isolated,
        offline_demo: args.offline_demo,
    })
}

fn parse_arguments(args: impl IntoIterator<Item = OsString>) -> Result<Arguments, String> {
    let mut parsed = Arguments::default();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--offline-demo" {
            if parsed.offline_demo {
                return Err("duplicate_offline_demo_flag".into());
            }
            parsed.offline_demo = true;
        } else {
            let path = if arg == "--profile-dir" {
                args.next()
                    .ok_or_else(|| "profile_dir_requires_absolute_local_path".to_string())?
            } else if let Some(value) = arg.to_str().and_then(|s| s.strip_prefix("--profile-dir="))
            {
                OsString::from(value)
            } else {
                return Err("unsupported_application_argument".into());
            };
            if parsed.profile_dir.is_some() {
                return Err("duplicate_profile_dir_flag".into());
            }
            parsed.profile_dir = Some(validate_profile_path(Path::new(&path))?);
        }
    }
    if parsed.offline_demo && parsed.profile_dir.is_none() {
        return Err("offline_demo_requires_explicit_isolated_profile".into());
    }
    Ok(parsed)
}

#[cfg(windows)]
fn validate_profile_path(path: &Path) -> Result<PathBuf, String> {
    use std::path::{Component, Prefix};
    let invalid = || "profile_dir_requires_safe_absolute_local_E_or_G_directory".to_string();
    let text = path.to_str().ok_or_else(invalid)?;
    // Do not let Win32 normalization reinterpret traversal, streams or aliases.
    if text
        .split(['\\', '/'])
        .any(|part| part == "." || part == "..")
    {
        return Err(invalid());
    }
    let mut components = path.components();
    let drive = match components.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive.to_ascii_uppercase(),
            _ => return Err(invalid()),
        },
        _ => return Err(invalid()),
    };
    if !matches!(drive, b'E' | b'G') || components.next() != Some(Component::RootDir) {
        return Err(invalid());
    }
    let mut normalized = PathBuf::from(format!("{}:\\", drive as char));
    let mut depth = 0;
    for component in components {
        let Component::Normal(name) = component else {
            return Err(invalid());
        };
        let name = name.to_str().ok_or_else(invalid)?;
        let stem = name
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end_matches(' ')
            .to_ascii_uppercase();
        let reserved = matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|tail| {
                matches!(
                    tail,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
        if name.is_empty()
            || name.ends_with(['.', ' '])
            || name
                .chars()
                .any(|c| c.is_control() || "<>:\"|?*/\\".contains(c))
            || reserved
        {
            return Err(invalid());
        }
        if depth == 0
            && [
                "windows",
                "program files",
                "program files (x86)",
                "programdata",
                "users",
                "$recycle.bin",
                "system volume information",
            ]
            .iter()
            .any(|protected| name.eq_ignore_ascii_case(protected))
        {
            return Err("profile_dir_cannot_be_system_directory".into());
        }
        normalized.push(name);
        depth += 1;
    }
    // Require a dedicated directory below a parent, never a drive/top-level root.
    if depth < 2 {
        return Err("profile_dir_must_be_dedicated_directory_below_parent".into());
    }
    Ok(normalized)
}

#[cfg(not(windows))]
fn validate_profile_path(_: &Path) -> Result<PathBuf, String> {
    Err("isolated_profile_requires_windows_local_E_or_G_directory".into())
}

#[cfg(windows)]
fn create_isolated_profile(root: PathBuf) -> Result<IsolatedProfile, String> {
    let root = validate_profile_path(&root)?;
    windows::check_local_drive(&root)?;
    let mut pins = Vec::new();
    let mut current = PathBuf::new();
    for component in root.components() {
        current.push(component.as_os_str());
        // A drive prefix alone (E:) is drive-relative; never access it.
        if !current.is_absolute() {
            continue;
        }
        match std::fs::symlink_metadata(&current) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // The parent was checked and pinned before creating this child.
                match std::fs::create_dir(&current) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(_) => return Err("isolated_profile_directory_creation_failed".into()),
                }
            }
            Err(_) => return Err("isolated_profile_directory_unavailable".into()),
        }
        pins.push(DirectoryPin::open(current.clone())?);
    }
    let canonical = std::fs::canonicalize(&root)
        .map_err(|_| "isolated_profile_canonicalization_failed".to_string())?;
    validate_profile_path(&canonical)?;
    windows::check_local_drive(&canonical)?;
    let webview = root.join("webview");
    match std::fs::create_dir(&webview) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("isolated_webview_directory_creation_failed".into()),
    }
    pins.push(DirectoryPin::open(webview.clone())?);
    let isolated = IsolatedProfile {
        root,
        webview,
        pins,
    };
    isolated.verify()?;
    Ok(isolated)
}

#[cfg(not(windows))]
fn create_isolated_profile(_: PathBuf) -> Result<IsolatedProfile, String> {
    Err("isolated_profile_requires_windows_local_E_or_G_directory".into())
}

impl IsolatedProfile {
    fn verify(&self) -> Result<(), String> {
        for pin in &self.pins {
            pin.verify()?;
        }
        Ok(())
    }
}

#[cfg(windows)]
impl DirectoryPin {
    fn open(path: PathBuf) -> Result<Self, String> {
        use std::os::windows::fs::OpenOptionsExt;
        let file = std::fs::OpenOptions::new()
            .access_mode(0x81) // FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES
            .share_mode(0x1 | 0x2) // FILE_SHARE_READ | FILE_SHARE_WRITE; no DELETE
            .custom_flags(0x02000000 | 0x00200000) // BACKUP_SEMANTICS | OPEN_REPARSE_POINT
            .open(&path)
            .map_err(|_| "isolated_profile_directory_cannot_be_pinned".to_string())?;
        let metadata = file
            .metadata()
            .map_err(|_| "isolated_profile_directory_unavailable".to_string())?;
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("isolated_profile_reparse_point_forbidden".into());
        }
        if !metadata.is_dir() {
            return Err("isolated_profile_path_must_be_directory".into());
        }
        let identity = windows::identity(&file)?;
        Ok(Self {
            path,
            file,
            identity,
        })
    }

    fn verify(&self) -> Result<(), String> {
        let reopened = Self::open(self.path.clone())?;
        if windows::identity(&self.file)? != self.identity || reopened.identity != self.identity {
            return Err("isolated_profile_directory_identity_changed".into());
        }
        Ok(())
    }
}

#[cfg(not(windows))]
impl DirectoryPin {
    fn verify(&self) -> Result<(), String> {
        Err("isolated_profile_directory_identity_unavailable".into())
    }
}

#[cfg(windows)]
mod windows {
    use std::fs::File;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::{Component, Path};

    #[derive(Debug, Copy, Clone, PartialEq, Eq)]
    pub(super) struct Identity {
        volume: u32,
        index: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct FileInformation {
        attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(
            handle: *mut std::ffi::c_void,
            info: *mut FileInformation,
        ) -> i32;
        fn GetDriveTypeW(root: *const u16) -> u32;
    }

    pub(super) fn identity(file: &File) -> Result<Identity, String> {
        let mut info = FileInformation::default();
        // SAFETY: file owns a live handle; info has the Win32 structure layout.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err("isolated_profile_directory_identity_unavailable".into());
        }
        let index = (u64::from(info.index_high) << 32) | u64::from(info.index_low);
        if index == 0 {
            return Err("isolated_profile_directory_identity_unavailable".into());
        }
        Ok(Identity {
            volume: info.volume_serial,
            index,
        })
    }

    pub(super) fn check_local_drive(path: &Path) -> Result<(), String> {
        let mut root = std::path::PathBuf::new();
        for component in path.components() {
            root.push(component.as_os_str());
            if component == Component::RootDir {
                break;
            }
        }
        let root: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: root is a NUL-terminated UTF-16 absolute drive root.
        if !matches!(unsafe { GetDriveTypeW(root.as_ptr()) }, 2 | 3 | 6) {
            return Err("isolated_profile_requires_local_disk".into());
        }
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    fn sandbox() -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "uagent-isolated-profile-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        validate_profile_path(&root).expect("test TEMP must be a safe E/G directory");
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn ordinary_startup_keeps_the_existing_fallback() {
        let profile = profile_from_args(Vec::new()).unwrap();
        assert_eq!(
            profile.description(),
            ApplicationProfile {
                isolated: false,
                offline_demo: false
            }
        );
        let expected = PathBuf::from("existing-ordinary-app-data");
        assert_eq!(
            resolve_for_profile(&profile, || Ok(expected.clone())).unwrap(),
            expected
        );
    }

    #[test]
    fn offline_demo_requires_an_explicit_profile() {
        assert_eq!(
            parse_arguments(args(&["--offline-demo"])).unwrap_err(),
            "offline_demo_requires_explicit_isolated_profile"
        );
        let parsed = parse_arguments(args(&[
            "--offline-demo",
            "--profile-dir",
            "E:\\scratch\\demo",
        ]))
        .unwrap();
        assert!(parsed.offline_demo);
    }

    #[test]
    fn malformed_and_duplicate_cli_options_fail_closed() {
        for input in [
            vec!["--profile-dir"],
            vec!["--profile-dir="],
            vec!["--profile-dir", "--offline-demo"],
            vec!["--offline-demo", "--offline-demo"],
            vec![
                "--profile-dir",
                "E:\\scratch\\one",
                "--profile-dir",
                "G:\\scratch\\two",
            ],
            vec!["--offline-demo=true"],
            vec!["--unknown-profile-option"],
        ] {
            assert!(parse_arguments(args(&input)).is_err(), "{input:?}");
        }
    }

    #[test]
    fn accepts_only_safe_absolute_disk_or_verbatim_disk_paths() {
        for input in [
            "E:\\scratch\\demo",
            "g:/scratch/demo",
            r"\\?\E:\scratch\demo",
        ] {
            let result = validate_profile_path(Path::new(input)).unwrap();
            assert!(result.is_absolute());
        }
        for input in [
            r"C:\Users\someone\AppData",
            r"D:\scratch\demo",
            r"E:\",
            r"E:\scratch",
            r"E:scratch\demo",
            r"\scratch\demo",
            "scratch/demo",
            r"\\server\share\demo",
            r"\\?\UNC\server\share\demo",
            r"\\.\E:\scratch\demo",
            r"\\?\GLOBALROOT\Device\HarddiskVolume1\demo",
            r"E:\scratch\..\demo",
            r"E:\scratch\.\demo",
            r"E:\scratch\demo.",
            r"E:\scratch\demo ",
            r"E:\scratch\demo:stream",
            r"E:\scratch\NUL.txt",
            r"E:\scratch\NUL .txt",
            r"\\?\E:\scratch\safe/NUL",
            r"E:\scratch\COM1",
            r"E:\Windows\demo",
        ] {
            assert!(
                validate_profile_path(Path::new(input)).is_err(),
                "{input:?}"
            );
        }
    }

    #[test]
    fn invalid_cli_does_not_create_a_profile_or_call_ordinary_storage() {
        let root = sandbox().join("must-not-exist");
        assert!(profile_from_args(vec![
            OsString::from("--profile-dir"),
            root.clone().into_os_string(),
            OsString::from("--offline-demo"),
            OsString::from("--unknown-profile-option"),
        ])
        .is_err());
        assert!(!root.exists());
        let once: OnceLock<Result<Profile, String>> = OnceLock::new();
        assert!(once
            .get_or_init(|| profile_from_args(args(&["--offline-demo"])))
            .is_err());
        assert!(once
            .get_or_init(|| panic!("invalid startup must remain failed"))
            .is_err());
    }

    #[test]
    fn isolated_storage_and_webview_never_use_the_ordinary_fallback() {
        let root = sandbox().join("profile");
        let profile = profile_from_args(vec![
            OsString::from("--profile-dir"),
            root.clone().into_os_string(),
            OsString::from("--offline-demo"),
        ])
        .unwrap();
        let resolved = resolve_for_profile(&profile, || {
            panic!("must not access ordinary application data")
        })
        .unwrap();
        assert_eq!(resolved, root);
        let isolated = profile.isolated.as_ref().unwrap();
        assert_eq!(isolated.webview, root.join("webview"));
        assert!(isolated.webview.is_dir());
        assert_eq!(
            serde_json::to_value(profile.description()).unwrap(),
            serde_json::json!({"isolated": true, "offlineDemo": true})
        );
    }

    #[test]
    fn profile_without_offline_flag_is_not_a_demo() {
        let root = sandbox().join("profile");
        let profile =
            profile_from_args(vec![OsString::from("--profile-dir"), root.into_os_string()])
                .unwrap();
        assert_eq!(
            profile.description(),
            ApplicationProfile {
                isolated: true,
                offline_demo: false
            }
        );
    }

    #[test]
    fn directory_handles_block_profile_and_parent_replacement() {
        let parent = sandbox();
        let root = parent.join("profile");
        let isolated = create_isolated_profile(root.clone()).unwrap();
        for path in [&root, &parent, &isolated.webview] {
            let destination = path.with_file_name(format!(
                "{}-moved",
                path.file_name().unwrap().to_string_lossy()
            ));
            assert!(std::fs::rename(path, destination).is_err());
        }
        isolated.verify().unwrap();
    }

    #[test]
    fn identity_check_fails_closed_if_a_directory_resolves_elsewhere() {
        let parent = sandbox();
        let mut isolated = create_isolated_profile(parent.join("profile")).unwrap();
        let other = parent.join("other");
        std::fs::create_dir(&other).unwrap();
        isolated.pins.last_mut().unwrap().path = other;
        assert_eq!(
            isolated.verify().unwrap_err(),
            "isolated_profile_directory_identity_changed"
        );
    }

    fn junction(link: &Path, target: &Path) {
        let output = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "junction setup failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn rejects_reparse_points_in_ancestors_and_webview_directory() {
        let parent = sandbox();
        let target = parent.join("target");
        std::fs::create_dir(&target).unwrap();
        let link = parent.join("alias");
        junction(&link, &target);
        let error = create_isolated_profile(link.join("profile")).err().unwrap();
        assert_eq!(error, "isolated_profile_reparse_point_forbidden");
        assert!(!target.join("profile").exists());
        let root = parent.join("profile");
        std::fs::create_dir(&root).unwrap();
        junction(&root.join("webview"), &target);
        assert_eq!(
            create_isolated_profile(root).err().unwrap(),
            "isolated_profile_reparse_point_forbidden"
        );
    }

    #[test]
    fn rejects_a_regular_file_in_the_profile_path() {
        let root = sandbox().join("file");
        std::fs::write(&root, "fixture").unwrap();
        assert!(create_isolated_profile(root).is_err());
    }
}
