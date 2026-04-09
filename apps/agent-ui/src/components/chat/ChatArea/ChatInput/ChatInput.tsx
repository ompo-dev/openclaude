'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Mic } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryState } from 'nuqs'

import { getSlashCatalogAPI } from '@/api/integration'
import useAIChatStreamHandler from '@/hooks/useAIStreamHandler'
import useChatActions from '@/hooks/useChatActions'
import { useStore } from '@/store'
import { SlashCatalogEntry, SlashCatalogSnapshot } from '@/types/integration'
import ChatComposerBar from './ChatComposerBar'

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

const ChatInput = () => {
  const { chatInputRef, selectedEndpoint, authToken } = useStore()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
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
    chatInputRef.current = textareaRef.current
  }, [chatInputRef])

  useEffect(() => {
    if (!textareaRef.current) return

    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      180
    )}px`
  }, [inputMessage])

  useEffect(() => {
    void (async () => {
      try {
        const nextCatalog = await getSlashCatalogAPI(
          selectedEndpoint,
          authToken
        )
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
      const knownEntry = [
        ...slashCatalog.commands,
        ...slashCatalog.skills
      ].find(
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
    <div className="bg-background border-t border-[#232327]">
      <div className="mx-auto max-w-3xl p-4">
        <div className="relative rounded-[28px] border border-[#2a2a30] bg-[#17171a] px-5 pb-3 pt-4 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
          {slashTokenMatch &&
          (filteredSlashEntries.length > 0 || filteredPlugins.length > 0) ? (
            <div className="absolute inset-x-0 bottom-full z-20 mb-3 overflow-hidden rounded-3xl border border-[#2d2d33] bg-[#151518] shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
              <div className="border-b border-[#242429] px-4 py-2 text-[11px] uppercase text-[#7f7f88]">
                Slash Catalog
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {filteredSlashEntries.map((entry, index) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => handleSelectSlashEntry(entry)}
                    className={`flex w-full items-start justify-between rounded-2xl px-3 py-2 text-left text-xs transition-colors ${
                      index === activeSlashIndex
                        ? 'bg-white/6 text-white'
                        : 'hover:bg-white/6 text-[#b7b7bf] hover:text-white'
                    }`}
                  >
                    <div>
                      <div className="font-medium text-[#f5f5f7]">
                        {entry.slash}
                      </div>
                      <div className="mt-1 text-[#8f8f96]">
                        {entry.description}
                      </div>
                    </div>
                    <div className="text-[10px] uppercase text-[#8f8f96]">
                      {entry.kind}
                    </div>
                  </button>
                ))}
                {filteredPlugins.length > 0 ? (
                  <div className="mt-1 border-t border-[#242429] px-3 py-2">
                    <div className="mb-2 text-[11px] uppercase text-[#7f7f88]">
                      Plugins
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {filteredPlugins.map((plugin) => (
                        <span
                          key={plugin.id}
                          className="rounded-full border border-[#2d2d33] px-2.5 py-1 text-[11px] text-[#d1d1d6]"
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

          <textarea
            ref={textareaRef}
            value={inputMessage}
            onChange={(event) => setInputMessage(event.target.value)}
            onKeyDown={(event) => {
              if (slashTokenMatch && filteredSlashEntries.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActiveSlashIndex((current) =>
                    current === filteredSlashEntries.length - 1
                      ? 0
                      : current + 1
                  )
                  return
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveSlashIndex((current) =>
                    current === 0
                      ? filteredSlashEntries.length - 1
                      : current - 1
                  )
                  return
                }

                if (
                  (event.key === 'Enter' || event.key === 'Tab') &&
                  !event.shiftKey
                ) {
                  event.preventDefault()
                  handleSelectSlashEntry(
                    filteredSlashEntries[activeSlashIndex]!
                  )
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
                !isStreaming
              ) {
                event.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder="Pergunte algo ou digite / para skills"
            className="h-fit w-full resize-none bg-transparent text-[14px] leading-6 text-[#f3f3f5] placeholder:text-[#8d8d95] focus:outline-none"
            rows={1}
            disabled={!(selectedAgent || teamId) || isStreaming}
          />

          <div className="mt-3 flex items-center justify-between border-t border-[#26262c] pt-3">
            <ChatComposerBar />

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#9e9ea7] transition-colors hover:bg-white/5 hover:text-white"
                title="Microfone"
              >
                <Mic className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={
                  !(selectedAgent || teamId) ||
                  !inputMessage.trim() ||
                  isStreaming
                }
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f4f6] text-[#101012] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
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

export default ChatInput
