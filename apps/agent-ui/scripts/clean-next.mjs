import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(scriptDir, '..')
const nextDir = path.join(appDir, '.next')

if (existsSync(nextDir)) {
  await rm(nextDir, { recursive: true, force: true })
}
