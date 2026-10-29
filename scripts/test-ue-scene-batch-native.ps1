$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($repository -notmatch '^[EG]:\\') { throw 'T14 test artifacts must stay on E: or G:' }
$env:CARGO_HOME = 'E:\Codex\UAgent\2026-10-29\build-cache\t09-cargo-home'
if ($env:CARGO_TARGET_DIR -notmatch '^[EG]:\\' -or $env:TEMP -notmatch '^[EG]:\\') { throw 'Run use-e-drive.ps1 -CargoCache t09 first' }
$scratch = Join-Path $repository 'tmp/ue-scene-native-check'
New-Item -ItemType Directory -Path (Join-Path $scratch 'src') -Force | Out-Null
$manifest = @('[package]', 'name = "uagent-scene-batch-module-check"', 'version = "0.0.0"', 'edition = "2021"', '[dependencies]', 'serde = { version = "1", features = ["derive"] }', 'serde_json = "1"') -join "`n"
$manifest | Set-Content -LiteralPath (Join-Path $scratch 'Cargo.toml') -Encoding utf8NoBOM
$native = (Join-Path $repository 'apps/desktop/src-tauri/src/ue_scene_batch.rs').Replace('\', '/')
"#[path = `"$native`"]`npub mod ue_scene_batch;" | Set-Content -LiteralPath (Join-Path $scratch 'src/lib.rs') -Encoding utf8NoBOM
cargo test --offline --manifest-path (Join-Path $scratch 'Cargo.toml') --lib
if ($LASTEXITCODE -ne 0) { throw "scene batch native tests failed: $LASTEXITCODE" }
