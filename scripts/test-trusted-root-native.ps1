$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($repository -notmatch '^[EG]:\\') { throw 'Trusted root fixtures must stay on E: or G:' }
if ($env:CARGO_TARGET_DIR -notmatch '^[EG]:\\' -or $env:TEMP -notmatch '^[EG]:\\') { throw 'Run use-e-drive.ps1 first' }
$env:CARGO_HOME = 'E:\Codex\UAgent\2026-10-29\build-cache\t09-cargo-home'
$scratch = Join-Path $repository 'tmp/trusted-root-native-check'
New-Item -ItemType Directory -Path (Join-Path $scratch 'src'), (Join-Path $scratch 'fixtures') -Force | Out-Null
$env:UAGENT_TRUSTED_ROOT_TEST_DIR = Join-Path $scratch 'fixtures'
$native = (Join-Path $repository 'apps/desktop/src-tauri/src/trusted_root_handle.rs').Replace('\', '/')
$manifest = @('[package]', 'name = "uagent-trusted-root-module-check"', 'version = "0.0.0"', 'edition = "2021"') -join "`n"
$manifest | Set-Content -LiteralPath (Join-Path $scratch 'Cargo.toml') -Encoding utf8NoBOM
"#[path = `"$native`"]`npub mod trusted_root_handle;" | Set-Content -LiteralPath (Join-Path $scratch 'src/lib.rs') -Encoding utf8NoBOM
$runLog = Join-Path $scratch ('native-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.log')
cargo test --offline --manifest-path (Join-Path $scratch 'Cargo.toml') --lib -- --test-threads=1 2>&1 | Tee-Object -FilePath $runLog
if ($LASTEXITCODE -ne 0) { throw "trusted root native tests failed: $LASTEXITCODE" }
