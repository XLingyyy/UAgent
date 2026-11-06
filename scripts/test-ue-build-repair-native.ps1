$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'use-project-env.ps1')
$repository = $UAgentProjectRoot
$scratch = Join-Path $repository 'tmp/ue-build-repair-native-check'
Assert-UAgentLocalDirectory -Path $scratch -InspectChildren
New-Item -ItemType Directory -Path (Join-Path $scratch 'fixtures') -Force | Out-Null
$env:UAGENT_REPAIR_TEST_DIR = Join-Path $scratch 'fixtures'
# Use the native crate's module graph; recovery tests now depend on its managed store and host.
$manifest = Join-Path $repository 'apps/desktop/src-tauri/Cargo.toml'
$log = Join-Path $scratch ('native-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.log')
cargo test --offline --locked --profile integrated --manifest-path $manifest --lib ue_build_repair::tests -- --test-threads=1 2>&1 | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) { throw "repair module tests failed: $LASTEXITCODE" }
