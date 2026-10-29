$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$scratch = Join-Path $repository 'tmp/ue-pickup-native-check'
New-Item -ItemType Directory -Path (Join-Path $scratch 'src') -Force | Out-Null
$manifest = @('[package]', 'name = "uagent-pickup-template-module-check"', 'version = "0.0.0"', 'edition = "2021"', '[dependencies]', 'serde = { version = "1", features = ["derive"] }', 'serde_json = "1"') -join "`n"
$manifest | Set-Content -LiteralPath (Join-Path $scratch 'Cargo.toml') -Encoding utf8NoBOM
$native = (Join-Path $repository 'apps/desktop/src-tauri/src/ue_pickup_template.rs').Replace('\', '/')
"#[path = `"$native`"]`npub mod ue_pickup_template;" | Set-Content -LiteralPath (Join-Path $scratch 'src/lib.rs') -Encoding utf8NoBOM
cargo test --offline --manifest-path (Join-Path $scratch 'Cargo.toml') --lib
if ($LASTEXITCODE -ne 0) { throw "pickup template native tests failed: $LASTEXITCODE" }
