# Dot-source this script before development commands. Process scope only.
$ErrorActionPreference = 'Stop'
$UAgentProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if ($UAgentProjectRoot -ine 'E:\Codex\UAgent') { throw 'Expected the formal E:\Codex\UAgent repository.' }

function Assert-UAgentLocalDirectory {
    param([Parameter(Mandatory)][string]$Path, [switch]$InspectChildren)
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($full -ine $UAgentProjectRoot -and -not $full.StartsWith($UAgentProjectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Directory is outside the formal repository: $full"
    }
    # Check every existing ancestor, including E:\ and E:\Codex, before use.
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "Directory is a file or reparse point: $cursor"
            }
        }
        $parent = [IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor = $parent.FullName
    }
    if ($InspectChildren -and (Test-Path -LiteralPath $full)) {
        $pending = [Collections.Generic.Stack[string]]::new()
        $pending.Push($full)
        while ($pending.Count -gt 0) {
            foreach ($entry in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
                if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    throw "Refusing a reparse point in local working files: $($entry.FullName)"
                }
                if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
            }
        }
    }
}

Assert-UAgentLocalDirectory -Path $UAgentProjectRoot
$local = Join-Path $UAgentProjectRoot '.local-dev'
Assert-UAgentLocalDirectory -Path $local -InspectChildren
$directories = @{
    TEMP = Join-Path $local 'temp'
    TMP = Join-Path $local 'temp'
    CARGO_HOME = Join-Path $local 'cargo-home'
    CARGO_TARGET_DIR = Join-Path $local 'cargo-target'
    npm_config_cache = Join-Path $local 'npm-cache'
    npm_config_store_dir = Join-Path $local 'pnpm-store'
    UAGENT_PNPM_STORE_DIR = Join-Path $local 'pnpm-store'
}
foreach ($path in ($directories.Values | Select-Object -Unique)) {
    Assert-UAgentLocalDirectory -Path $path
    [IO.Directory]::CreateDirectory($path) | Out-Null
}
foreach ($entry in $directories.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
}
