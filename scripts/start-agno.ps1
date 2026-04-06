param(
  [switch]$BootstrapOnly,
  [switch]$ServerOnly,
  [switch]$UiOnly,
  [int]$Port = 0,
  [int]$UiPort = 0
)

$ErrorActionPreference = "Stop"

if ($Port -le 0) {
  if ($env:AGNO_PORT) {
    $Port = [int]$env:AGNO_PORT
  }
  else {
    $Port = 7777
  }
}

if ($UiPort -le 0) {
  if ($env:AGNO_UI_PORT) {
    $UiPort = [int]$env:AGNO_UI_PORT
  }
  else {
    $UiPort = 3000
  }
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VenvPath = Join-Path $Root ".venv-agno"
$PythonExe = Join-Path $VenvPath "Scripts\\python.exe"
$Requirements = Join-Path $Root "python\\requirements.txt"
$UiPath = Join-Path $Root "apps\\agent-ui"
$UiEnvExample = Join-Path $UiPath ".env.local.example"
$UiEnvLocal = Join-Path $UiPath ".env.local"

function Invoke-Step {
  param(
    [string]$Command,
    [string]$WorkingDirectory = $Root
  )

  Write-Host ">> $Command" -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    Invoke-Expression $Command
  }
  finally {
    Pop-Location
  }
}

if (!(Test-Path $VenvPath)) {
  Invoke-Step "python -m venv `"$VenvPath`""
}

Invoke-Step "& `"$PythonExe`" -m pip install -r `"$Requirements`""

if (!(Test-Path (Join-Path $Root "dist\\cli.mjs"))) {
  Invoke-Step "bun run build"
}

if (!(Test-Path (Join-Path $UiPath "node_modules"))) {
  Invoke-Step "npm install" $UiPath
}

if ((Test-Path $UiEnvExample) -and !(Test-Path $UiEnvLocal)) {
  Copy-Item $UiEnvExample $UiEnvLocal
}

if ($BootstrapOnly) {
  Write-Host "Bootstrap concluido." -ForegroundColor Green
  exit 0
}

$serverCommand = "Set-Location `"$Root`"; `$env:AGNO_HOST='127.0.0.1'; `$env:AGNO_PORT='$Port'; `$env:AGNO_UI_PORT='$UiPort'; & `"$PythonExe`" `"$Root\\python\\agno_server.py`""
$uiCommand = "Set-Location `"$UiPath`"; npm run clean; `$env:NEXT_PUBLIC_AGENT_OS_ENDPOINT='http://127.0.0.1:$Port'; npm exec next dev -- --hostname 127.0.0.1 -p $UiPort"

if ($ServerOnly) {
  Invoke-Step $serverCommand
  exit $LASTEXITCODE
}

if ($UiOnly) {
  Invoke-Step $uiCommand
  exit $LASTEXITCODE
}

Write-Host "Subindo AgentOS em uma nova janela..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $serverCommand
) | Out-Null

Write-Host "AgentOS: http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "Agent UI: http://127.0.0.1:$UiPort" -ForegroundColor Green
Invoke-Step $uiCommand
