import net from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LocalCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'
import { getCwd } from '../../utils/cwd.js'

const commandDir = path.dirname(fileURLToPath(import.meta.url))
const host = '127.0.0.1'
const startupTimeoutMs = 25000
const healthPollIntervalMs = 1000

type LauncherResult = {
  status: 'started' | 'already_running' | 'failed'
  workspaceRoot: string
  targetWorkspace?: string
  uiUrl: string
  apiUrl: string
  statusUrl: string
  docsUrl: string
  uiPort: number
  apiPort: number
  uiChanged: boolean
  apiChanged: boolean
  logs?: {
    apiStdout?: string
    apiStderr?: string
    uiStdout?: string
    uiStderr?: string
  }
  note?: string
  error?: string
}

function findInstallRoot(startDir: string): string {
  let current = path.resolve(startDir)

  while (true) {
    if (
      existsSync(path.join(current, 'package.json')) &&
      existsSync(path.join(current, 'scripts', 'openclaude-web.mjs'))
    ) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return path.resolve(commandDir, '../../..')
}

const installRoot = findInstallRoot(commandDir)
const launcherPath = path.join(installRoot, 'scripts', 'openclaude-web.mjs')

function hasWebWorkspace(rootDir: string): boolean {
  return (
    existsSync(path.join(rootDir, 'scripts', 'start-agno.ps1')) &&
    existsSync(path.join(rootDir, 'python', 'agno_server.py')) &&
    existsSync(path.join(rootDir, 'apps', 'agent-ui', 'package.json'))
  )
}

function resolveWorkspaceRoot(): string {
  let current = path.resolve(getCwd())
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

  return installRoot
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 1500,
  init?: RequestInit,
): Promise<Response> {
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

async function isApiHealthy(apiUrl: string, uiUrl: string): Promise<boolean> {
  try {
    const expectedOrigin = new URL(uiUrl).origin
    const response = await fetchWithTimeout(`${apiUrl}/healthz`, 1500, {
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

function extractStylesheetHref(html: string): string | null {
  const match = html.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/i)
  return match?.[1] ?? null
}

async function isUiHealthy(uiUrl: string): Promise<boolean> {
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

async function isPortFree(port: number, bindHost = host): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, bindHost, () => {
      server.close(() => resolve(true))
    })
  })
}

async function findAvailablePort(preferredPort: number): Promise<number> {
  for (let offset = 0; offset <= 20; offset += 1) {
    const candidate = preferredPort + offset
    if (await isPortFree(candidate)) {
      return candidate
    }
  }

  return preferredPort
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function readLogTail(logPath?: string): string | undefined {
  if (!logPath || !existsSync(logPath)) {
    return undefined
  }

  try {
    const contents = readFileSync(logPath, 'utf-8').trim()
    if (!contents) {
      return undefined
    }

    const lines = contents.split(/\r?\n/)
    return lines.slice(-4).join('\n')
  } catch {
    return undefined
  }
}

async function waitForStartupHealth(
  apiUrl: string,
  uiUrl: string,
): Promise<{ apiReady: boolean; uiReady: boolean }> {
  const startedAt = Date.now()
  let apiReady = false
  let uiReady = false

  while (Date.now() - startedAt < startupTimeoutMs) {
    if (!apiReady) {
      apiReady = await isApiHealthy(apiUrl, uiUrl)
    }
    if (!uiReady) {
      uiReady = await isUiHealthy(uiUrl)
    }

    if (apiReady && uiReady) {
      break
    }

    await sleep(healthPollIntervalMs)
  }

  return { apiReady, uiReady }
}

async function runLauncher(
  workspaceRoot: string,
  targetWorkspace: string,
  apiPort: number,
  uiPort: number,
): Promise<LauncherResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcherPath, '--no-browser', '--json'], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AGNO_UI_PORT: String(uiPort),
        AGNO_PORT: String(apiPort),
        OPENCLAUDE_WEB_WORKSPACE: workspaceRoot,
        OPENCLAUDE_TARGET_WORKSPACE: targetWorkspace,
      },
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })

    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })

    child.on('error', error => {
      reject(error)
    })

    child.on('close', code => {
      const trimmedStdout = stdout.trim()
      if (!trimmedStdout) {
        reject(
          new Error(
            stderr.trim() || `OpenClaude Web launcher exited without output (code ${code ?? 'unknown'}).`,
          ),
        )
        return
      }

      try {
        resolve(JSON.parse(trimmedStdout) as LauncherResult)
      } catch (error) {
        reject(
          new Error(
            `Failed to parse launcher output: ${error instanceof Error ? error.message : String(error)}\n${trimmedStdout}`,
          ),
        )
      }
    })
  })
}

export const call: LocalCommandCall = async () => {
  const workspaceRoot = resolveWorkspaceRoot()
  const targetWorkspace = path.resolve(getCwd())
  const requestedUiPort = Number(process.env.AGNO_UI_PORT || '3000')
  const requestedApiPort = Number(process.env.AGNO_PORT || '7777')

  if (!existsSync(launcherPath)) {
    return {
      type: 'text',
      value:
        `OpenClaude Web assets are missing from this install. Expected launcher at ${launcherPath}.`,
    }
  }

  const defaultUiUrl = `http://${host}:${requestedUiPort}`
  const defaultApiUrl = `http://${host}:${requestedApiPort}`

  if ((await isApiHealthy(defaultApiUrl, defaultUiUrl)) && (await isUiHealthy(defaultUiUrl))) {
    return {
      type: 'text',
      value: [
        'OpenClaude Web is already running.',
        `Workspace: ${workspaceRoot}`,
        `Target workspace: ${targetWorkspace}`,
        `UI: ${defaultUiUrl} (port ${requestedUiPort})`,
        `API: ${defaultApiUrl} (port ${requestedApiPort})`,
        `Status: ${defaultApiUrl}/integration/status`,
        `Docs: ${defaultApiUrl}/integration/docs`,
        'Override ports with AGNO_UI_PORT and AGNO_PORT before launching if needed.',
      ].join('\n'),
    }
  }

  const uiPort = await findAvailablePort(requestedUiPort)
  const apiPort = await findAvailablePort(requestedApiPort)

  let launchResult: LauncherResult
  try {
    launchResult = await runLauncher(workspaceRoot, targetWorkspace, apiPort, uiPort)
  } catch (error) {
    logForDebugging(`web launcher failed: ${error}`, { level: 'error' })
    return {
      type: 'text',
      value: `OpenClaude Web failed to launch.\nWorkspace: ${workspaceRoot}\nTarget workspace: ${targetWorkspace}\nLauncher: ${launcherPath}\nError: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const health = await waitForStartupHealth(launchResult.apiUrl, launchResult.uiUrl)
  const apiStatusLine = health.apiReady
    ? `API health: ready at ${launchResult.apiUrl}/healthz`
    : `API health: not ready yet at ${launchResult.apiUrl}/healthz`
  const uiStatusLine = health.uiReady
    ? `UI health: ready at ${launchResult.uiUrl}/healthz`
    : `UI health: still compiling or failed at ${launchResult.uiUrl}/healthz`

  const apiLogHint = readLogTail(launchResult.logs?.apiStderr) || readLogTail(launchResult.logs?.apiStdout)
  const uiLogHint = readLogTail(launchResult.logs?.uiStderr) || readLogTail(launchResult.logs?.uiStdout)

  return {
    type: 'text',
    value: [
      launchResult.status === 'already_running'
        ? 'OpenClaude Web is already running.'
        : 'OpenClaude Web launch requested.',
      `Workspace: ${launchResult.workspaceRoot}`,
      `Target workspace: ${launchResult.targetWorkspace || targetWorkspace}`,
      `UI: ${launchResult.uiUrl} (port ${launchResult.uiPort})`,
      `API: ${launchResult.apiUrl} (port ${launchResult.apiPort})`,
      `Status: ${launchResult.statusUrl}`,
      `Docs: ${launchResult.docsUrl}`,
      launchResult.uiChanged
        ? `Default UI port 3000 was busy, using ${launchResult.uiPort}.`
        : undefined,
      launchResult.apiChanged
        ? `Default API port 7777 was busy, using ${launchResult.apiPort}.`
        : undefined,
      apiStatusLine,
      uiStatusLine,
      launchResult.note ||
        'The UI boots asynchronously. On the first launch, Next.js may take around 10-20 seconds to compile before the page responds.',
      launchResult.logs?.apiStdout
        ? `API logs: ${launchResult.logs.apiStdout}`
        : undefined,
      launchResult.logs?.uiStdout
        ? `UI logs: ${launchResult.logs.uiStdout}`
        : undefined,
      !health.apiReady && apiLogHint
        ? `Recent API log lines:\n${apiLogHint}`
        : undefined,
      !health.uiReady && uiLogHint
        ? `Recent UI log lines:\n${uiLogHint}`
        : undefined,
      'Override ports with AGNO_UI_PORT and AGNO_PORT before launching if needed.',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}
