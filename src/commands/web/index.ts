import type { Command } from '../../commands.js'

const web = {
  type: 'local',
  name: 'web',
  description: 'Launch OpenClaude Web for this install',
  supportsNonInteractive: true,
  load: () => import('./web.js'),
} satisfies Command

export default web
