#Requires -Version 5
# Run lawyer-mobile on Windows desktop (or Chrome) using repo .env.local dart-defines.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $Root "..\..")
Set-Location $Root

$Device = if ($args.Count -gt 0) { $args[0] } else { "windows" }

function Find-Flutter {
  $cmd = Get-Command flutter -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:LOCALAPPDATA\flutter\bin\flutter.bat",
    "$env:USERPROFILE\flutter\bin\flutter.bat",
    "C:\src\flutter\bin\flutter.bat",
    "C:\flutter\bin\flutter.bat"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  if ($env:FLUTTER_ROOT) {
    $p = Join-Path $env:FLUTTER_ROOT "bin\flutter.bat"
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  Write-Host "Loading env: $Path"
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    Set-Item -Path "Env:$key" -Value $val
  }
}

Import-DotEnv (Join-Path $RepoRoot ".env.local")
Import-DotEnv (Join-Path $RepoRoot ".env")
Import-DotEnv (Join-Path $Root ".env")

if (-not $env:SUPABASE_URL -and $env:NEXT_PUBLIC_SUPABASE_URL) {
  $env:SUPABASE_URL = $env:NEXT_PUBLIC_SUPABASE_URL
}
if (-not $env:SUPABASE_ANON_KEY -and $env:NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  $env:SUPABASE_ANON_KEY = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
}
if (-not $env:API_BASE_URL) { $env:API_BASE_URL = "" }
if (-not $env:NEXT_BASE_URL) { $env:NEXT_BASE_URL = "https://qalatlaw.com" }
if (-not $env:R2_PUBLIC_URL -and $env:NEXT_PUBLIC_R2_PUBLIC_URL) {
  $env:R2_PUBLIC_URL = $env:NEXT_PUBLIC_R2_PUBLIC_URL
}
if (-not $env:R2_PUBLIC_URL) {
  $env:R2_PUBLIC_URL = "https://pub-029fa309232c423fbacd7723c644d28f.r2.dev"
}

$flutter = Find-Flutter
if (-not $flutter) { throw "Flutter not found. Install Flutter or set FLUTTER_ROOT." }
if (-not $env:SUPABASE_URL) { throw "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL in .env.local" }
if (-not $env:SUPABASE_ANON_KEY) { throw "Missing SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local" }

Write-Host "Using Flutter: $flutter"
Write-Host "Device: $Device"

& $flutter pub get
if ($Device -eq "windows") {
  & $flutter config --enable-windows-desktop | Out-Null
}

& $flutter run -d $Device `
  --dart-define=SUPABASE_URL=$env:SUPABASE_URL `
  --dart-define=SUPABASE_ANON_KEY=$env:SUPABASE_ANON_KEY `
  --dart-define=API_BASE_URL=$env:API_BASE_URL `
  --dart-define=NEXT_BASE_URL=$env:NEXT_BASE_URL `
  --dart-define=R2_PUBLIC_URL=$env:R2_PUBLIC_URL
