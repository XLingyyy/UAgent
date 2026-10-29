$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($repository -notmatch '^[EG]:\\' -or $env:TEMP -notmatch '^[EG]:\\' -or $env:CARGO_TARGET_DIR -notmatch '^[EG]:\\') { throw 'Run E/G environment helper first' }
$env:CARGO_HOME = 'E:\Codex\UAgent\2026-10-29\build-cache\t09-cargo-home'
$scratch = Join-Path $repository 'tmp/ue-build-repair-native-check'
New-Item -ItemType Directory -Path (Join-Path $scratch 'src'), (Join-Path $scratch 'fixtures') -Force | Out-Null
$env:UAGENT_REPAIR_TEST_DIR = Join-Path $scratch 'fixtures'
$native = (Join-Path $repository 'apps/desktop/src-tauri/src').Replace('\', '/')
$manifest = @('[package]', 'name = "uagent-build-repair-module-check"', 'version = "0.0.0"', 'edition = "2021"', '[dependencies]', 'serde = { version = "1", features = ["derive"] }', 'serde_json = "1"', 'sha2 = "0.10"') -join "`n"
$manifest | Set-Content -LiteralPath (Join-Path $scratch 'Cargo.toml') -Encoding utf8NoBOM
$modules = @('trusted_root_handle', 'ue_build_repair_io', 'ue_build_repair') | ForEach-Object { "#[path = `"$native/$_.rs`"]`npub mod $_;" }
$modules -join "`n" | Set-Content -LiteralPath (Join-Path $scratch 'src/lib.rs') -Encoding utf8NoBOM
$log = Join-Path $scratch ('native-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.log')
cargo test --offline --manifest-path (Join-Path $scratch 'Cargo.toml') --lib ue_build_repair::tests -- --test-threads=1 2>&1 | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) { throw "repair module tests failed: $LASTEXITCODE" }
