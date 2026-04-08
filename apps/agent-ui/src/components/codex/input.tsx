'use client'

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { ArrowUp, ChevronDown, Mic } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { toast } from 'sonner'

import { activateNamedModelAPI, getSlashCatalogAPI } from '@/api/integration'
import useChatActions from '@/hooks/useChatActions'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { SlashCatalogEntry, SlashCatalogSnapshot } from '@/types/integration'

interface InputProps {
  onSend: (message: string) => void | Promise<void>
  isLoading: boolean
  branch: string
  models: string[]
  currentModel: string
  onModelChange?: (model: string) => void | Promise<void>
}

const MAX_VISIBLE_COMMANDS = 8

const buildCatalogMessage = (
  title: string,
  entries: SlashCatalogEntry[],
  emptyState: string
) =>
  entries.length > 0
    ? [
        `## ${title}`,
        '',
        ...entries.map((entry) => `- \`${entry.slash}\` ${entry.description}`)
      ].join('\n')
    : emptyState

export function Input({
  onSend,
  isLoading,
  models,
  currentModel,
  onModelChange
}: InputProps) {
  const {
    chatInputRef,
    chatInputSeed,
    chatInputSeedNonce,
    clearChatInputSeed,
    selectedEndpoint,
    authToken,
    selectedModel,
    setSelectedModel,
    setWorkspaceView
  } = useStore()
  const { addMessage, initialize } = useChatActions()
  const [selectedAgent] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const [inputMessage, setInputMessage] = useState('')
  const [slashCatalog, setSlashCatalog] = useState<SlashCatalogSnapshot | null>(
    null
  )
  const [activeSlashIndex, setActiveSlashIndex] = useState(0)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [isModelPending, setIsModelPending] = useState(false)
  const canUseRemoteRun = Boolean(selectedAgent || teamId)
  const canSubmit =
    Boolean(inputMessage.trim()) &&
    !isLoading &&
    (canUseRemoteRun || inputMessage.trim().startsWith('/'))

  useEffect(() => {
    if (!chatInputRef.current) return

    chatInputRef.current.style.height = 'auto'
    chatInputRef.current.style.height = `${Math.min(
      chatInputRef.current.scrollHeight,
      180
    )}px`
  }, [chatInputRef, inputMessage])

  useEffect(() => {
    if (!chatInputSeed) return

    setInputMessage(chatInputSeed)
    clearChatInputSeed()
    requestAnimationFrame(() => {
      chatInputRef.current?.focus()
      chatInputRef.current?.setSelectionRange(
        chatInputSeed.length,
        chatInputSeed.length
      )
    })
  }, [chatInputRef, chatInputSeed, chatInputSeedNonce, clearChatInputSeed])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const nextCatalog = await getSlashCatalogAPI(
          selectedEndpoint,
          authToken
        )
        if (!cancelled) setSlashCatalog(nextCatalog)
      } catch {
        if (!cancelled) setSlashCatalog(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedEndpoint, authToken])

  const slashTokenMatch = inputMessage.match(/^\/([^\s]*)$/)
  const slashQuery = (slashTokenMatch?.[1] || '').toLowerCase()

  const filteredSlashEntries = useMemo(() => {
    if (!slashCatalog || !slashTokenMatch) return []

    const entries = [...slashCatalog.commands, ...slashCatalog.skills]
    return entries
      .filter((entry) => {
        if (!slashQuery) return true
        return (
          entry.name.toLowerCase().includes(slashQuery) ||
          entry.aliases.some((alias) =>
            alias.toLowerCase().includes(slashQuery)
          ) ||
          entry.description.toLowerCase().includes(slashQuery)
        )
      })
      .slice(0, MAX_VISIBLE_COMMANDS)
  }, [slashCatalog, slashQuery, slashTokenMatch])

  const filteredPlugins = useMemo(() => {
    if (!slashCatalog || !slashTokenMatch) return []

    return slashCatalog.plugins.filter((plugin) => {
      if (!slashQuery) return true
      return (
        plugin.name.toLowerCase().includes(slashQuery) ||
        plugin.description.toLowerCase().includes(slashQuery)
      )
    })
  }, [slashCatalog, slashQuery, slashTokenMatch])

  const availableModels = useMemo(() => {
    const uniqueModels = Array.from(
      new Set([currentModel, selectedModel, ...models].filter(Boolean))
    )
    return uniqueModels.length > 0 ? uniqueModels : ['Modelo']
  }, [currentModel, models, selectedModel])

  useEffect(() => {
    setActiveSlashIndex(0)
  }, [slashQuery])

  const handleSelectSlashEntry = (entry: SlashCatalogEntry) => {
    setInputMessage(entry.slash)
    setActiveSlashIndex(0)
    requestAnimationFrame(() => chatInputRef.current?.focus())
  }

  const maybeHandleLocalSlashCommand = async (message: string) => {
    const normalized = message.trim().toLowerCase()
    if (!normalized.startsWith('/')) return false

    const createdAt = Math.floor(Date.now() / 1000)
    const postLocalReply = (content: string) => {
      addMessage({ role: 'user', content: message, created_at: createdAt })
      addMessage({
        role: 'agent',
        content,
        created_at: createdAt + 1
      })
      setInputMessage('')
    }

    if (!slashCatalog) return false

    if (normalized === '/help') {
      postLocalReply(
        [
          buildCatalogMessage(
            'Commands',
            slashCatalog.commands.slice(0, 12),
            'No commands available.'
          ),
          '',
          buildCatalogMessage(
            'Skills',
            slashCatalog.skills.slice(0, 12),
            'No skills available.'
          )
        ].join('\n')
      )
      return true
    }

    if (normalized === '/skills') {
      postLocalReply(
        buildCatalogMessage(
          'Skills',
          slashCatalog.skills,
          'No skills available in this workspace.'
        )
      )
      return true
    }

    if (normalized === '/plugin' || normalized === '/plugins') {
      postLocalReply(
        slashCatalog.plugins.length > 0
          ? [
              '## Plugins',
              '',
              ...slashCatalog.plugins.map(
                (plugin) =>
                  `- \`${plugin.name}\` ${plugin.enabled ? '(enabled)' : '(disabled)'} ${plugin.description}`
              )
            ].join('\n')
          : 'No plugins detected in the current OpenClaude installation.'
      )
      return true
    }

    return false
  }

  const handleSubmit = async () => {
    if (!inputMessage.trim() || isLoading) return

    const currentMessage = inputMessage
    if (await maybeHandleLocalSlashCommand(currentMessage)) return
    if (!canUseRemoteRun) {
      toast.error(
        'Aguarde a inicializacao do runtime antes de enviar mensagens.'
      )
      return
    }

    setInputMessage('')
    try {
      await onSend(currentMessage)
    } catch (error) {
      setInputMessage(currentMessage)
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar a mensagem'
      )
    }
  }

  const handleModelChange = async (modelName: string) => {
    setShowModelMenu(false)

    if (!modelName || modelName === currentModel) return

    if (modelName === '__settings__') {
      setWorkspaceView('settings')
      return
    }

    if (onModelChange) {
      await onModelChange(modelName)
      return
    }

    setIsModelPending(true)
    try {
      await activateNamedModelAPI(selectedEndpoint, modelName, authToken)
      setSelectedModel(modelName)
      await initialize()
      toast.success(`Modelo ativo: ${modelName}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao trocar de modelo'
      )
    } finally {
      setIsModelPending(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashTokenMatch && filteredSlashEntries.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveSlashIndex((current) =>
          current === filteredSlashEntries.length - 1 ? 0 : current + 1
        )
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveSlashIndex((current) =>
          current === 0 ? filteredSlashEntries.length - 1 : current - 1
        )
        return
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault()
        handleSelectSlashEntry(filteredSlashEntries[activeSlashIndex]!)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setInputMessage('')
        return
      }
    }

    if (
      event.key === 'Enter' &&
      !event.nativeEvent.isComposing &&
      !event.shiftKey &&
      !isLoading
    ) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className="shrink-0 bg-[#0d1117] px-4 py-4">
      <div className="mx-auto max-w-4xl">
        <div className="relative overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22]">
          {slashTokenMatch &&
          (filteredSlashEntries.length > 0 || filteredPlugins.length > 0) ? (
            <div className="absolute inset-x-3 bottom-full z-30 mb-3 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="border-b border-[#30363d] px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                Slash catalog
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {filteredSlashEntries.map((entry, index) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => handleSelectSlashEntry(entry)}
                    className={cn(
                      'flex w-full items-start justify-between rounded-md px-3 py-2 text-left text-xs transition-colors',
                      index === activeSlashIndex
                        ? 'bg-[#0f1a2b] text-[#f0f6fc]'
                        : 'text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#f0f6fc]'
                    )}
                  >
                    <div>
                      <div className="font-medium text-[#f0f6fc]">
                        {entry.slash}
                      </div>
                      <div className="mt-1 text-[#7d8590]">
                        {entry.description}
                      </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.1em] text-[#7d8590]">
                      {entry.kind}
                    </div>
                  </button>
                ))}

                {filteredPlugins.length > 0 ? (
                  <div className="mt-1 border-t border-[#30363d] px-3 py-2">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                      Plugins
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {filteredPlugins.map((plugin) => (
                        <span
                          key={plugin.id}
                          className="rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-[11px] text-[#c9d1d9]"
                        >
                          {plugin.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="px-4 pb-3 pt-4">
            <textarea
              ref={chatInputRef}
              value={inputMessage}
              onChange={(event) => setInputMessage(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte algo ou digite / para skills"
              className="h-fit w-full resize-none border-none bg-transparent text-sm leading-7 text-[#e6edf3] outline-none placeholder:text-[#7d8590]"
              rows={1}
              disabled={isLoading}
            />
          </div>

          <div className="flex items-center justify-between border-t border-[#30363d] px-4 py-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelMenu((current) => !current)}
                disabled={isModelPending}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-[#30363d] bg-[#0d1117] px-3 text-xs font-medium text-[#c9d1d9] transition-colors hover:bg-[#11161d] hover:text-[#f0f6fc] disabled:opacity-45"
              >
                <span className="max-w-[220px] truncate">{currentModel}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#7d8590]" />
              </button>

              {showModelMenu ? (
                <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[240px] overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                  <div className="border-b border-[#30363d] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                    Modelos
                  </div>
                  <div className="p-1.5">
                    {availableModels.map((modelName) => (
                      <button
                        key={modelName}
                        type="button"
                        onClick={() => {
                          void handleModelChange(modelName)
                        }}
                        className={cn(
                          'block w-full rounded-md px-3 py-2 text-left text-xs transition-colors',
                          modelName === currentModel
                            ? 'bg-[#0f1a2b] text-[#58a6ff]'
                            : 'text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#f0f6fc]'
                        )}
                      >
                        {modelName}
                      </button>
                    ))}
                    <div className="my-1 h-px bg-[#30363d]" />
                    <button
                      type="button"
                      onClick={() => {
                        void handleModelChange('__settings__')
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left text-xs text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                    >
                      Gerenciar modelos
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                title="Microfone"
              >
                <Mic className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleSubmit()
                }}
                disabled={!canSubmit}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-[#2f6f3e] bg-[#238636] text-white transition-colors hover:bg-[#2ea043] disabled:cursor-not-allowed disabled:opacity-45"
                title="Enviar"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
