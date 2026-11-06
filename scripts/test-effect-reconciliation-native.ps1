$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($repository -notmatch '^[EG]:\\' -or $env:TEMP -notmatch '^[EG]:\\' -or $env:CARGO_TARGET_DIR -notmatch '^[EG]:\\') { throw 'Run the E/G environment helper first' }
$env:CARGO_HOME = 'E:\Codex\UAgent\2026-10-29\build-cache\native-cargo-home'
$scratch = Join-Path $repository 'tmp/effect-reconciliation-native-check'
New-Item -ItemType Directory -Path (Join-Path $scratch 'src'), (Join-Path $scratch 'fixtures') -Force | Out-Null
$env:UAGENT_EFFECT_TEST_DIR = Join-Path $scratch 'fixtures'
$native = (Join-Path $repository 'apps/desktop/src-tauri/src').Replace('\', '/')
$manifest = @('[package]', 'name = "uagent-effect-reconciliation-check"', 'version = "0.0.0"', 'edition = "2021"', '[dependencies]', 'serde = { version = "1", features = ["derive"] }', 'serde_json = "1"', 'sha2 = "0.10"', 'getrandom = "=0.2.17"') -join "`n"
$manifest | Set-Content -LiteralPath (Join-Path $scratch 'Cargo.toml') -Encoding utf8NoBOM
# Only this scratch copy opts into the child module; production source/entrypoints stay unchanged.
$store = Get-Content -LiteralPath (Join-Path $repository 'apps/desktop/src-tauri/src/local_run_store/mod.rs') -Raw
foreach ($name in @('schema', 'sqlite', 'legacy')) { $store = $store.Replace("mod $name;", "#[path = `"$native/local_run_store/$name.rs`"]`nmod $name;") }
$store = $store.Replace('#[path = "../../tests/local_run_store_tests.rs"]', "#[path = `"$native/../tests/local_run_store_tests.rs`"]")
$effectDeclaration = "#[path = `"$native/local_run_store/effect_reconciliation.rs`"]`npub mod effect_reconciliation;"
if ($store.Contains('pub mod effect_reconciliation;')) {
    $store = $store.Replace('pub mod effect_reconciliation;', $effectDeclaration)
} else {
    $store += "`n$effectDeclaration`n"
}
$store | Set-Content -LiteralPath (Join-Path $scratch 'src/local_run_store.rs') -Encoding utf8NoBOM
@("#[path = `"$native/trusted_root_handle.rs`"]`npub mod trusted_root_handle;", 'pub mod local_run_store;') -join "`n" | Set-Content -LiteralPath (Join-Path $scratch 'src/lib.rs') -Encoding utf8NoBOM
$log = Join-Path $scratch ('native-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.log')
cargo test --offline --manifest-path (Join-Path $scratch 'Cargo.toml') --lib local_run_store::effect_reconciliation::tests -- --test-threads=1 2>&1 | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) { throw "effect reconciliation tests failed: $LASTEXITCODE" }

# A returned Future must not be marked settled before anybody polls it.
$bin = Join-Path $scratch 'src/bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
$forbidden = @("use uagent_effect_reconciliation_check::local_run_store::effect_reconciliation::{CurrentRun, DispatchTicket, EffectJournal};", "fn cannot_return_unpolled_future(j: &EffectJournal<'_>, c: &CurrentRun<'_>, ticket: &mut DispatchTicket) {", "    let _ = j.dispatch_once(c, ticket, |_| async { () });", "}", "fn main() {}") -join "`n"
$forbidden | Set-Content -LiteralPath (Join-Path $bin 'forbidden-async-handoff.rs') -Encoding utf8NoBOM
$negativeLog = Join-Path $scratch 'forbidden-async-handoff.log'
$negative = cargo check --offline --manifest-path (Join-Path $scratch 'Cargo.toml') --bin forbidden-async-handoff 2>&1
$negativeCode = $LASTEXITCODE
$negative | Set-Content -LiteralPath $negativeLog -Encoding utf8NoBOM
$negativeText = $negative -join "`n"
if ($negativeCode -eq 0 -or $negativeText -notmatch 'E0308' -or $negativeText -notmatch 'expected.*\(\)' -or $negativeText -notmatch 'async') { throw 'unpolled Future was not rejected by the handoff type boundary as expected' }
Write-Output 'PASS: returning an unpolled Future from dispatch_once is a compile error (expected E0308).'
