$ErrorActionPreference = 'Stop'

$base = Join-Path $env:APPDATA 'skald-launcher\emulators\rpcs3'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path 'C:\Projects\SKALD' ".tmp-rpcs3-prompt-capture-$timestamp.json"
$targets = @(
  'dev_hdd0\game',
  'dev_hdd0\disc',
  'dev_bdvd',
  'games'
)

function Get-FileSnapshot {
  param(
    [string]$RootBase,
    [string]$RelativePath
  )

  $fullPath = Join-Path $RootBase $RelativePath
  if (-not (Test-Path -LiteralPath $fullPath)) {
    return @()
  }

  return @(
    Get-ChildItem -LiteralPath $fullPath -Recurse -Force -File -ErrorAction SilentlyContinue |
      ForEach-Object {
        [ordered]@{
          path = $_.FullName
          relative = $_.FullName.Substring($RootBase.Length).TrimStart('\')
          length = $_.Length
          lastWriteUtc = $_.LastWriteTimeUtc.ToString('o')
        }
      }
  )
}

function Get-RecentLogTail {
  param(
    [string]$FilePath,
    [int]$Lines = 240
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    return @()
  }

  try {
    return @(Get-Content -LiteralPath $FilePath -Tail $Lines -ErrorAction Stop)
  } catch {
    return @("<could not read tail: $($_.Exception.Message)>")
  }
}

$logDir = Join-Path $base 'log'
$recentLogs = @()
if (Test-Path -LiteralPath $logDir) {
  $recentLogs = @(
    Get-ChildItem -LiteralPath $logDir -Force -File -ErrorAction SilentlyContinue |
      Where-Object {
        try {
          $null = $_.FullName
          $true
        } catch {
          $false
        }
      } |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 5 |
      ForEach-Object {
        $exists = $false
        try { $exists = Test-Path -LiteralPath $_.FullName -ErrorAction Stop } catch { $exists = $false }
        [ordered]@{
          path = $_.FullName
          lastWriteUtc = $_.LastWriteTimeUtc.ToString('o')
          length = $_.Length
          tail = if ($exists) { Get-RecentLogTail -FilePath $_.FullName } else { @('<log not accessible>') }
        }
      }
  )
}

$result = [ordered]@{
  capturedAt = (Get-Date).ToString('o')
  base = $base
  targets = [ordered]@{}
  logs = [ordered]@{
    files = $recentLogs
  }
}

foreach ($rel in $targets) {
  $result.targets[$rel] = Get-FileSnapshot -RootBase $base -RelativePath $rel
}

$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding UTF8
Write-Output $out
