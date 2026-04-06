import { enableConfigs } from '../src/utils/config.ts'

enableConfigs()

const [{ getCommands, getCommandName }, { getBuiltinPlugins }, { loadAllPluginsCacheOnly }] =
  await Promise.all([
    import('../src/commands.ts'),
    import('../src/plugins/builtinPlugins.ts'),
    import('../src/utils/plugins/pluginLoader.ts')
  ])

const commands = await getCommands(process.cwd())
const builtinPlugins = getBuiltinPlugins()
const pluginLoad = await loadAllPluginsCacheOnly()

type SlashItem = {
  id: string
  name: string
  slash: string
  kind: 'command' | 'skill'
  source: string
  loaded_from: string | null
  description: string
  aliases: string[]
}

const slashItems: SlashItem[] = commands.map((command) => {
  const name = getCommandName(command)
  const loadedFrom =
    'loadedFrom' in command && typeof command.loadedFrom === 'string'
      ? command.loadedFrom
      : null
  const source = typeof command.source === 'string' ? command.source : 'builtin'
  const aliases =
    'aliases' in command && Array.isArray(command.aliases)
      ? command.aliases.filter((alias) => typeof alias === 'string')
      : []
  const kind: 'command' | 'skill' =
    source === 'builtin' && !loadedFrom ? 'command' : 'skill'

  return {
    id: `${kind}:${name}`,
    name,
    slash: `/${name}`,
    kind,
    source,
    loaded_from: loadedFrom,
    description: command.description ?? '',
    aliases
  }
})

const pluginEntries = [...builtinPlugins.enabled, ...builtinPlugins.disabled, ...pluginLoad.enabled, ...pluginLoad.disabled]
const uniquePlugins = new Map(
  pluginEntries.map((plugin) => [
    plugin.source,
    {
      id: plugin.source,
      name: plugin.name,
      description: plugin.manifest.description ?? '',
      source: plugin.source,
      enabled: plugin.enabled !== false,
      builtin: plugin.isBuiltin === true
    }
  ])
)

console.log(
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      commands: slashItems.filter((item) => item.kind === 'command'),
      skills: slashItems.filter((item) => item.kind === 'skill'),
      plugins: [...uniquePlugins.values()].sort((left, right) =>
        left.name.localeCompare(right.name)
      )
    },
    null,
    2
  )
)
