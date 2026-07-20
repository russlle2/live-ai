param(
  [string]$CoachModel = "gpt-oss:20b",
  [string]$SttModel = "Systran/faster-whisper-large-v3-turbo"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "This setup script targets the owner's Windows 11 workstation."
}

$ProjectDir = Split-Path -Parent $PSScriptRoot
$RepoDir = Split-Path -Parent $ProjectDir
$EnvPath = Join-Path $RepoDir ".env.local"
$SttDir = Join-Path $ProjectDir "services\stt"

function Ensure-WingetPackage {
  param([string]$CommandName, [string]$PackageId)
  if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
    return
  }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Windows Package Manager (winget) is required to install $PackageId."
  }
  winget install --id $PackageId -e --accept-package-agreements --accept-source-agreements
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
      [Environment]::GetEnvironmentVariable("Path", "Machine")
  }
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "$PackageId installed, but $CommandName is not available in this terminal. Open a new PowerShell window and run this script again."
  }
}

function Set-EnvValue {
  param([string]$Key, [string]$Value)
  $lines = if (Test-Path $EnvPath) {
    [System.Collections.Generic.List[string]](Get-Content $EnvPath)
  } else {
    [System.Collections.Generic.List[string]]::new()
  }
  $replacement = "$Key=$Value"
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match "^$([regex]::Escape($Key))=") {
      $lines[$index] = $replacement
      $found = $true
      break
    }
  }
  if (-not $found) {
    $lines.Add($replacement)
  }
  [System.IO.File]::WriteAllLines($EnvPath, $lines)
}

Write-Host "[local-ai] Installing required local runtimes..."
Ensure-WingetPackage -CommandName "uv" -PackageId "astral-sh.uv"
Ensure-WingetPackage -CommandName "ollama" -PackageId "Ollama.Ollama"

[Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "-1", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_GPU_OVERLAP", "1", "User")
$env:OLLAMA_KEEP_ALIVE = "-1"
$env:OLLAMA_GPU_OVERLAP = "1"

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -TimeoutSec 2 | Out-Null
} catch {
  Write-Host "[local-ai] Starting Ollama..."
  Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    try {
      Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -TimeoutSec 2 | Out-Null
      $ready = $true
      break
    } catch {
      # Continue the bounded readiness loop.
    }
  }
  if (-not $ready) {
    throw "Ollama did not become ready on http://127.0.0.1:11434."
  }
}

Write-Host "[local-ai] Downloading coaching model $CoachModel..."
ollama pull $CoachModel

Write-Host "[local-ai] Installing the locked faster-whisper service..."
Push-Location $SttDir
try {
  uv sync --frozen --no-dev
} finally {
  Pop-Location
}

Set-EnvValue -Key "LOCAL_AI_BASE_URL" -Value "http://127.0.0.1:11434/v1"
Set-EnvValue -Key "LOCAL_COACH_MODEL" -Value $CoachModel
Set-EnvValue -Key "LOCAL_STT_BASE_URL" -Value "http://127.0.0.1:8178/v1"
Set-EnvValue -Key "LOCAL_STT_MODEL" -Value $SttModel
Set-EnvValue -Key "LOCAL_STT_DEVICE" -Value "cuda"

$sttEnvironment = @{
  LOCAL_STT_MODEL = $SttModel
  LOCAL_STT_DEVICE = "cuda"
}
foreach ($entry in $sttEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

Write-Host "[local-ai] Starting local transcription..."
Start-Process `
  -FilePath "uv" `
  -ArgumentList @("run", "python", "-m", "live_rhetoric_stt") `
  -WorkingDirectory $SttDir `
  -WindowStyle Hidden

$sttReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:8178/health" -TimeoutSec 2 | Out-Null
    $sttReady = $true
    break
  } catch {
    # The first launch can spend longer initializing Python dependencies.
  }
}
if (-not $sttReady) {
  throw "Local STT did not become ready on http://127.0.0.1:8178."
}

Write-Host "[local-ai] Ready. Restart Live Rhetoric to use local coaching and transcription."
