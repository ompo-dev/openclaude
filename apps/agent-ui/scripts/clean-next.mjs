import { existsSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(scriptDir, '..')
const nextDir = path.join(appDir, '.next')

const bestEffortRemove = async (targetPath) => {
  try {
    await rm(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 150
    })
    return true
  } catch {
    return false
  }
}

if (existsSync(nextDir)) {
  const removed = await bestEffortRemove(nextDir)

  if (!removed && existsSync(nextDir)) {
    const staleDir = path.join(
      appDir,
      `.next-stale-${Date.now().toString(36)}`
    )

    try {
      await rename(nextDir, staleDir)
      void bestEffortRemove(staleDir)
    } catch {
      console.warn(
        '[clean-next] Could not fully remove .next; continuing so next build can retry with the current tree.'
      )
    }
  }
}
