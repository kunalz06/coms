param(
  [string]$RootEnv = "..\..\.env.local",
  [string]$Output = "env\local.json",
  [string]$DotEnvOutput = ".env.local"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv([string]$Path) {
  $values = @{}
  if (!(Test-Path $Path)) {
    throw "Env file not found: $Path"
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) {
      return
    }

    $parts = $line.Split("=", 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }

  return $values
}

$envValues = Read-DotEnv $RootEnv

$flutterEnv = [ordered]@{
  COMMS_API_BASE_URL = $envValues["NEXT_PUBLIC_APP_URL"]
  COMMS_SIGNALING_URL = $envValues["NEXT_PUBLIC_SIGNALING_URL"]
  SUPABASE_URL = $envValues["NEXT_PUBLIC_SUPABASE_URL"]
  SUPABASE_ANON_KEY = $envValues["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  CLOUDINARY_CLOUD_NAME = $envValues["NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"]
  STUN_URLS = $envValues["NEXT_PUBLIC_STUN_URLS"]
  TURN_URLS = $envValues["NEXT_PUBLIC_TURN_URLS"]
  TURN_USERNAME = $envValues["NEXT_PUBLIC_TURN_USERNAME"]
  TURN_CREDENTIAL = $envValues["NEXT_PUBLIC_TURN_CREDENTIAL"]
}

$missing = $flutterEnv.GetEnumerator() |
  Where-Object { $_.Key -in @("SUPABASE_URL", "SUPABASE_ANON_KEY", "CLOUDINARY_CLOUD_NAME") -and [string]::IsNullOrWhiteSpace([string]$_.Value) } |
  ForEach-Object { $_.Key }

if ($missing.Count -gt 0) {
  throw "Missing required Flutter env values: $($missing -join ', ')"
}

$outputPath = Join-Path (Get-Location) $Output
$outputDir = Split-Path $outputPath
if (!(Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$flutterEnv | ConvertTo-Json | Set-Content -Path $outputPath -Encoding UTF8
Write-Host "Wrote Flutter dart-define env to $Output"

$dotEnvLines = $flutterEnv.GetEnumerator() | ForEach-Object {
  "$($_.Key)=$($_.Value)"
}
$dotEnvPath = Join-Path (Get-Location) $DotEnvOutput
$dotEnvLines | Set-Content -Path $dotEnvPath -Encoding UTF8
Write-Host "Wrote Flutter local env to $DotEnvOutput"
