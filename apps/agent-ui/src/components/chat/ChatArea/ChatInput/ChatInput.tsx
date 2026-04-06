'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useQueryState } from 'nuqs'

import { getSlashCatalogAPI } from '@/api/integration'
import { TextArea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import useAIChatStreamHandler from '@/hooks/useAIStreamHandler'
import useChatActions from '@/hooks/useChatActions'
import { useStore } from '@/store'
import { SlashCatalogEntry, SlashCatalogSnapshot } from '@/types/integration'

const MAX_VISIBLE_COMMANDS = 8

const buildCatalogMessage = (
  title: string,
  entries: SlashCatalogEntry[],
  emptyState: string
) =>
  entries.length > 0
    ? [`## ${title}`, '', ...entries.map((entry) => `- \`${entry.slash}\` ${entry.description}`)].join('\n')
    : emptyState

const ChatInput = () => {
  const { chatInputRef, selectedEndpoint, authToken } = useStore()
  const { addMessage } = useChatActions()
  const { handleStreamResponse } = useAIChatStreamHandler()
  const [selectedAgent] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const [inputMessage, setInputMessage] = useState('')
  const [slashCatalog, setSlashCatalog] = useState<SlashCatalogSnapshot | null>(
    null
  )
  const [activeSlashIndex, setActiveSlashIndex] = useState(0)
  const isStreaming = useStore((state) => state.isStreaming)

  useEffect(() => {
    void (async () => {
      try {
        const nextCatalog = await getSlashCatalogAPI(selectedEndpoint, authToken)
        setSlashCatalog(nextCatalog)
      } catch {
        setSlashCatalog(null)
      }
    })()
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
          entry.aliases.some((alias) => alias.toLowerCase().includes(slashQuery)) ||
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

    if (normalized.startsWith('/')) {
      const slashName = normalized.slice(1).split(/\s+/, 1)[0]
      const knownEntry = [...slashCatalog.commands, ...slashCatalog.skills].find(
        (entry) =>
          entry.name.toLowerCase() === slashName ||
          entry.aliases.some((alias) => alias.toLowerCase() === slashName)
      )
      if (knownEntry) {
        postLocalReply(
          `\`${knownEntry.slash}\` is available in the OpenClaude catalog. Full slash execution is still being moved onto the native processor, so use the matching web controls for now when this action changes local CLI state.`
        )
        return true
      }
    }

    return false
  }

  const handleSubmit = async () => {
    if (!inputMessage.trim()) return

    const currentMessage = inputMessage
    if (await maybeHandleLocalSlashCommand(currentMessage)) return
    setInputMessage('')

    try {
      await handleStreamResponse(currentMessage)
    } catch (error) {
      toast.error(
        `Error in handleSubmit: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return (
    <div className="relative mx-auto mb-1 flex w-full max-w-2xl items-end justify-center gap-x-2 font-geist">
      {slashTokenMatch && (filteredSlashEntries.length > 0 || filteredPlugins.length > 0) ? (
        <div className="absolute inset-x-0 bottom-full mb-3 overflow-hidden rounded-2xl border border-primary/10 bg-background shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          <div className="border-b border-primary/10 px-4 py-3 text-[11px] uppercase text-muted">
            Slash Catalog
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {filteredSlashEntries.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => handleSelectSlashEntry(entry)}
                className={`flex w-full items-start justify-between rounded-xl px-3 py-2 text-left transition-colors ${
                  index === activeSlashIndex
                    ? 'bg-primary/10'
                    : 'hover:bg-background-secondary'
                }`}
              >
                <div>
                  <div className="text-sm font-medium text-secondary">
                    {entry.slash}
                  </div>
                  <div className="text-xs text-muted">{entry.description}</div>
                </div>
                <div className="text-[10px] uppercase text-muted">
                  {entry.kind}
                </div>
              </button>
            ))}
            {filteredPlugins.length > 0 ? (
              <div className="mt-2 border-t border-primary/10 px-3 pt-3">
                <div className="mb-2 text-[11px] uppercase text-muted">
                  Plugins
                </div>
                <div className="flex flex-wrap gap-2">
                  {filteredPlugins.map((plugin) => (
                    <span
                      key={plugin.id}
                      className="rounded-full border border-primary/10 bg-background-secondary px-3 py-1 text-[11px] uppercase text-secondary"
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
      <TextArea
        placeholder={'Ask anything or type / for skills'}
        value={inputMessage}
        onChange={(e) => setInputMessage(e.target.value)}
        onKeyDown={(e) => {
          if (slashTokenMatch && filteredSlashEntries.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveSlashIndex((current) =>
                current === filteredSlashEntries.length - 1 ? 0 : current + 1
              )
              return
            }

            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveSlashIndex((current) =>
                current === 0 ? filteredSlashEntries.length - 1 : current - 1
              )
              return
            }

            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
              e.preventDefault()
              handleSelectSlashEntry(filteredSlashEntries[activeSlashIndex]!)
              return
            }

            if (e.key === 'Escape') {
              e.preventDefault()
              setInputMessage('')
              return
            }
          }

          if (
            e.key === 'Enter' &&
            !e.nativeEvent.isComposing &&
            !e.shiftKey &&
            !isStreaming
          ) {
            e.preventDefault()
            void handleSubmit()
          }
        }}
        className="w-full border border-accent bg-primaryAccent px-4 text-sm text-primary focus:border-accent"
        disabled={!(selectedAgent || teamId)}
        ref={chatInputRef}
      />
      <Button
        onClick={() => void handleSubmit()}
        disabled={
          !(selectedAgent || teamId) || !inputMessage.trim() || isStreaming
        }
        size="icon"
        className="rounded-xl bg-primary p-5 text-primaryAccent"
      >
        <Icon type="send" color="primaryAccent" />
      </Button>
    </div>
  )
}

export default ChatInput
