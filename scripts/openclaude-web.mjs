import net from 'node:net'
import { spawn } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const requestedApiPort = Number(process.env.AGNO_PORT || '7777')
const requestedUiPort = Number(process.env.AGNO_UI_PORT || '3000')
const requestedTargetWorkspace = path.resolve(
  process.env.OPENCLAUDE_TARGET_WORKSPACE || process.cwd()
)
const dryRun = args.has('--dry-run')
const noBrowser = args.has('--no-browser')
const jsonOutput = args.has('--json')
const stopOnly = args.has('--stop')
const host = '127.0.0.1'

function hasWebWorkspace(rootDir) {
  return (
    existsSync(path.join(rootDir, 'scripts', 'start-agno.ps1')) &&
    existsSync(path.join(rootDir, 'python', 'agno_server.py')) &&
    existsSync(path.join(rootDir, 'apps', 'agent-ui', 'package.json'))
  )
}

function findWorkspaceRoot() {
  const envRoot = process.env.OPENCLAUDE_WEB_WORKSPACE
  if (envRoot) {
    const resolved = path.resolve(envRoot)
    if (hasWebWorkspace(resolved)) {
      return resolved
    }
  }

  let current = path.resolve(process.cwd())
  while (true) {
    if (hasWebWorkspace(current)) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return packageRoot
}

const rootDir = findWorkspaceRoot()

function getLogPaths() {
  return {
    apiStdout: path.join(rootDir, '.agno-server.stdout.log'),
    apiStderr: path.join(rootDir, '.agno-server.stderr.log'),
    uiStdout: path.join(rootDir, '.agent-ui.stdout.log'),
    uiStderr: path.join(rootDir, '.agent-ui.stderr.log'),
  }
}

function buildUrls(apiPort, uiPort) {
  const apiUrl = `http://${host}:${apiPort}`
  const uiUrl = `http://${host}:${uiPort}`

  return {
    apiUrl,
    uiUrl,
    statusUrl: `${apiUrl}/integration/status`,
    docsUrl: `${apiUrl}/integration/docs`,
  }
}

async function fetchWithTimeout(url, timeoutMs = 2500, init = undefined) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      method: 'GET',
      ...(init ?? {}),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function isApiHealthy(apiUrl, uiUrl) {
  try {
    const expectedOrigin = new URL(uiUrl).origin
    const response = await fetchWithTimeout(`${apiUrl}/healthz`, 2500, {
      headers: {
        Origin: expectedOrigin,
      },
    })
    if (!response.ok) {
      return false
    }

    const allowOrigin = response.headers.get('access-control-allow-origin')
    return allowOrigin === expectedOrigin || allowOrigin === '*'
  } catch {
    return false
  }
}

function extractStylesheetHref(html) {
  const match = html.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/i)
  return match?.[1] ?? null
}

async function isUiHealthy(uiUrl) {
  try {
    const response = await fetchWithTimeout(`${uiUrl}/healthz`)
    if (response.ok) {
      const payload = await response.json()
      if (!(payload?.ok === true && payload?.app === 'openclaude-web')) {
        return false
      }
    }
  } catch {
    return false
  }

  try {
    const response = await fetchWithTimeout(uiUrl)
    if (!response.ok) {
      return false
    }

    const html = await response.text()
    if (!html.includes('<title>OpenClaude Web</title>')) {
      return false
    }

    const stylesheetHref = extractStylesheetHref(html)
    if (!stylesheetHref) {
      return false
    }

    const stylesheetResponse = await fetchWithTimeout(new URL(stylesheetHref, uiUrl).toString())
    return stylesheetResponse.ok
  } catch {
    return false
  }
}

async function isPortFree(port, bindHost = host) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, bindHost, () => {
      server.close(() => resolve(true))
    })
  })
}

function cleanupWindowsStack() {
  const launcherPattern = path.join(rootDir, 'scripts', 'start-agno.ps1')
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$launcherPattern = ${toPowerShellString(launcherPattern)}`,
    '$targets = Get-CimInstance Win32_Process | Where-Object {',
    '  $_.ProcessId -ne $PID -and',
    '  $_.CommandLine -and',
    '  $_.CommandLine.Contains($launcherPattern) -and',
    '  ($_.CommandLine.Contains("-ServerOnly") -or $_.CommandLine.Contains("-UiOnly"))',
    '}',
    '$pids = $targets | Select-Object -ExpandProperty ProcessId -Unique',
    '$pids | ForEach-Object { taskkill.exe /PID $_ /T /F | Out-Null }',
    'Start-Sleep -Milliseconds 1200',
  ].join('; ')

  spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script], {
    cwd: rootDir,
    stdio: 'ignore',
    windowsHide: true,
  })
}

function cleanupUnixStack() {
  const child = spawnSync(
    'bash',
    [
      '-lc',
      `pkill -f "${path.join(rootDir, 'python', 'agno_server.py')}" || true; pkill -f "apps/agent-ui" || true`,
    ],
    {
      cwd: rootDir,
      stdio: 'ignore',
    }
  )
  return child.status === 0
}

function cleanupExistingStack() {
  if (process.platform === 'win32') {
    cleanupWindowsStack()
    return
  }

  cleanupUnixStack()
}

async function findAvailablePort(preferredPort, bindHost = host, maxOffset = 20) {
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const candidate = preferredPort + offset
    if (await isPortFree(candidate, bindHost)) {
      return candidate
    }
  }

  throw new Error(`No free port found near ${preferredPort}`)
}

function toPowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function spawnWindowsStack(apiPort, uiPort, env, logs) {
  const scriptPath = path.join(rootDir, 'scripts', 'start-agno.ps1')

  if (!existsSync(scriptPath)) {
    throw new Error(`OpenClaude Web launcher not found: ${scriptPath}`)
  }

  const innerCommand = [
    "$ErrorActionPreference = 'Stop'",
    `Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoLogo','-ExecutionPolicy','Bypass','-File',${toPowerShellString(scriptPath)},'-ServerOnly','-Port',${toPowerShellString(apiPort)},'-UiPort',${toPowerShellString(uiPort)}) -RedirectStandardOutput ${toPowerShellString(logs.apiStdout)} -RedirectStandardError ${toPowerShellString(logs.apiStderr)} | Out-Null`,
    `Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoLogo','-ExecutionPolicy','Bypass','-File',${toPowerShellString(scriptPath)},'-UiOnly','-Port',${toPowerShellString(apiPort)},'-UiPort',${toPowerShellString(uiPort)}) -RedirectStandardOutput ${toPowerShellString(logs.uiStdout)} -RedirectStandardError ${toPowerShellString(logs.uiStderr)} | Out-Null`,
  ].join('; ')

  const child = spawn(
    'cmd.exe',
    [
      '/c',
      'start',
      '',
      'powershell.exe',
      '-NoLogo',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      innerCommand,
    ],
    {
      cwd: rootDir,
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true,
    }
  )

  child.unref()
}

function spawnUnixStack(apiPort, uiPort, env) {
  const scriptPath = path.join(rootDir, 'scripts', 'start-agno.sh')

  if (!existsSync(scriptPath)) {
    throw new Error(`OpenClaude Web launcher not found: ${scriptPath}`)
  }

  const child = spawn('bash', [scriptPath], {
    cwd: rootDir,
    detached: true,
    stdio: 'ignore',
    env: {
      ...env,
      AGNO_PORT: String(apiPort),
      AGNO_UI_PORT: String(uiPort),
    },
  })

  child.unref()
}

async function openBrowser(url) {
  const options = {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }

  if (process.platform === 'win32') {
    const child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], options)
    child.unref()
    return
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [url], options)
  child.unref()
}

function buildUiLaunchUrl(uiUrl, apiUrl) {
  const launchUrl = new URL(uiUrl)
  launchUrl.searchParams.set('workspace', requestedTargetWorkspace)
  launchUrl.searchParams.set('endpoint', apiUrl)
  return launchUrl.toString()
}

function formatResult(result) {
  if (result.status === 'stopped') {
    return [
      'OpenClaude Web background stack stopped.',
      `Workspace: ${result.workspaceRoot}`,
      `Target workspace: ${result.targetWorkspace || requestedTargetWorkspace}`,
      result.note,
    ]
      .filter(Boolean)
      .join('\n')
  }

  const lines = [
    result.status === 'already_running'
      ? 'OpenClaude Web is already running.'
      : result.status === 'started'
        ? 'OpenClaude Web is starting in the background.'
        : 'OpenClaude Web failed to start.',
    `Workspace: ${result.workspaceRoot}`,
    `Target workspace: ${result.targetWorkspace || requestedTargetWorkspace}`,
    `UI: ${result.uiUrl} (port ${result.uiPort})`,
    `API: ${result.apiUrl} (port ${result.apiPort})`,
    `Status: ${result.statusUrl}`,
    `Docs: ${result.docsUrl}`,
  ]

  if (result.uiChanged) {
    lines.push(`UI port ${requestedUiPort} was busy, using ${result.uiPort}.`)
  }
  if (result.apiChanged) {
    lines.push(`API port ${requestedApiPort} was busy, using ${result.apiPort}.`)
  }
  if (result.note) {
    lines.push(result.note)
  }
  if (result.logs?.apiStdout) {
    lines.push(`API logs: ${result.logs.apiStdout}`)
  }
  if (result.logs?.uiStdout) {
    lines.push(`UI logs: ${result.logs.uiStdout}`)
  }
  if (result.status === 'failed' && result.error) {
    lines.push(`Error: ${result.error}`)
  }

  return lines.join('\n')
}

function printResult(result) {
  if (jsonOutput) {
    console.log(JSON.stringify(result))
    return
  }

  console.log(formatResult(result))
}

const logs = getLogPaths()
cleanupExistingStack()

if (stopOnly) {
  printResult({
    status: 'stopped',
    workspaceRoot: rootDir,
    targetWorkspace: requestedTargetWorkspace,
    note: 'OpenClaude Web background stack stopped.',
  })
  process.exit(0)
}

const apiPort = await findAvailablePort(requestedApiPort)
const uiPort = await findAvailablePort(requestedUiPort)
const urls = buildUrls(apiPort, uiPort)

if (dryRun) {
  console.log(`root=${rootDir}`)
  console.log(`ui=${urls.uiUrl}`)
  console.log(`api=${urls.apiUrl}`)
  process.exit(0)
}

const env = {
  ...process.env,
  AGNO_PORT: String(apiPort),
  AGNO_UI_PORT: String(uiPort),
  OPENCLAUDE_WEB_WORKSPACE: rootDir,
  OPENCLAUDE_TARGET_WORKSPACE: requestedTargetWorkspace,
}

try {
  if (process.platform === 'win32') {
    spawnWindowsStack(apiPort, uiPort, env, logs)
  } else {
    spawnUnixStack(apiPort, uiPort, env)
  }

  const result = {
    status: 'started',
    workspaceRoot: rootDir,
    targetWorkspace: requestedTargetWorkspace,
    uiUrl: urls.uiUrl,
    apiUrl: urls.apiUrl,
    statusUrl: urls.statusUrl,
    docsUrl: urls.docsUrl,
    uiPort,
    apiPort,
    uiChanged: uiPort !== requestedUiPort,
    apiChanged: apiPort !== requestedApiPort,
    logs,
    note: 'The UI boots asynchronously. On the first launch, Next.js may take around 10-20 seconds to compile before the page responds.',
  }

  printResult(result)

  if (!noBrowser) {
    setTimeout(() => {
      void openBrowser(buildUiLaunchUrl(result.uiUrl, result.apiUrl))
    }, 3000)
  }

  process.exit(0)
} catch (error) {
  const result = {
    status: 'failed',
    workspaceRoot: rootDir,
    targetWorkspace: requestedTargetWorkspace,
    uiUrl: urls.uiUrl,
    apiUrl: urls.apiUrl,
    statusUrl: urls.statusUrl,
    docsUrl: urls.docsUrl,
    uiPort,
    apiPort,
    uiChanged: uiPort !== requestedUiPort,
    apiChanged: apiPort !== requestedApiPort,
    logs,
    error: error instanceof Error ? error.message : String(error),
  }

  printResult(result)
  process.exit(1)
}
