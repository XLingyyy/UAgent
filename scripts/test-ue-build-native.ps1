param([string]$ScratchDirectory)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $ScratchDirectory) { $ScratchDirectory = Join-Path $repository 'tmp/ue-build-native-check' }
$scratch = [System.IO.Path]::GetFullPath($ScratchDirectory)
if (-not $scratch.StartsWith($repository + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'ScratchDirectory must be inside this checkout.'
}
New-Item -ItemType Directory -Path (Join-Path $scratch 'src') -Force | Out-Null
@'
[package]
name = "uagent-ue-build-module-check"
version = "0.0.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
'@ | Set-Content -LiteralPath (Join-Path $scratch 'Cargo.toml') -Encoding utf8NoBOM
$native = (Join-Path $repository 'apps/desktop/src-tauri/src').Replace('\', '/')
@"
#[path = "$native/ue_build_profile.rs"]
pub mod ue_build_profile;
#[path = "$native/ue_build_process.rs"]
pub mod ue_build_process;
"@ | Set-Content -LiteralPath (Join-Path $scratch 'src/lib.rs') -Encoding utf8NoBOM
# This isolated crate avoids Tauri, the desktop build script, and all unrelated native modules.
cargo test --offline --manifest-path (Join-Path $scratch 'Cargo.toml') -- --test-threads=1
if ($LASTEXITCODE -ne 0) { throw "UE build module tests failed: $LASTEXITCODE" }
