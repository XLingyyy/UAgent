$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$scratch = Join-Path $repository 'tmp/ue-semantic-native-check'
New-Item -ItemType Directory -Path (Join-Path $scratch 'src') -Force | Out-Null
$manifest = @('[package]', 'name = "uagent-semantic-v2-module-check"', 'version = "0.0.0"', 'edition = "2021"', '[dependencies]', 'serde = { version = "1", features = ["derive"] }', 'serde_json = "1"') -join "`n"
$manifest | Set-Content -LiteralPath (Join-Path $scratch 'Cargo.toml') -Encoding utf8NoBOM
$native = (Join-Path $repository 'apps/desktop/src-tauri/src/ue_semantic_read.rs').Replace('\', '/')
"#[path = `"$native`"]`npub mod ue_semantic_read;" | Set-Content -LiteralPath (Join-Path $scratch 'src/lib.rs') -Encoding utf8NoBOM
cargo test --offline --manifest-path (Join-Path $scratch 'Cargo.toml') --lib
if ($LASTEXITCODE -ne 0) { throw "semantic v2 native tests failed: $LASTEXITCODE" }
