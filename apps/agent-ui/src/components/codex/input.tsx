'use client'

import { ArrowUp, ChevronDown, FileText, Mic } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { useQueryState } from 'nuqs'
import { toast } from 'sonner'

import { activateNamedModelAPI, getSlashCatalogAPI } from '@/api/integration'
import useChatActions from '@/hooks/useChatActions'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type {
  SkillLibraryEntry,
  SlashCatalogEntry,
  SlashCatalogSnapshot,
  WorkspaceFileSearchEntry,
  WorkspaceFileSearchResponse,
  WorkspaceSnippetMatchResponse
} from '@/types/integration'

interface InputProps {
  onSend: (message: string) => void | Promise<void>
  isLoading: boolean
  branch: string
  skillLibrary: SkillLibraryEntry[]
  models: string[]
  currentModel: string
  onModelChange?: (model: string) => void | Promise<void>
  searchFiles: (query: string) => Promise<WorkspaceFileSearchResponse>
  detectSnippet: (snippet: string) => Promise<WorkspaceSnippetMatchResponse>
}

type ComposerBadge =
  | {
      id: string
      kind: 'skill'
      label: string
      value: string
    }
  | {
      id: string
      kind: 'slash'
      label: string
      value: string
    }
  | {
      id: string
      kind: 'file'
      label: string
      value: string
      path: string
      lineStart?: number
      lineEnd?: number
    }

type ActiveTokenContext = {
  kind: 'slash' | 'mention'
  query: string
  textNode: Text
  tokenStart: number
  caretOffset: number
}

const MAX_VISIBLE_COMMANDS = 8
const MAX_VISIBLE_FILE_RESULTS = 8
const FILE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-[#58a6ff]"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path></svg>'
const X_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-[#f85149]"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>'

const DEFAULT_SLASH_CATALOG: SlashCatalogSnapshot = {
  generated_at: '',
  commands: [
    {
      id: 'fallback:help',
      name: 'help',
      slash: '/help',
      kind: 'command',
      source: 'builtin',
      loaded_from: null,
      description: 'Show help and available commands',
      aliases: []
    },
    {
      id: 'fallback:skills',
      name: 'skills',
      slash: '/skills',
      kind: 'command',
      source: 'builtin',
      loaded_from: null,
      description: 'List available skills',
      aliases: []
    },
    {
      id: 'fallback:plugin',
      name: 'plugin',
      slash: '/plugin',
      kind: 'command',
      source: 'builtin',
      loaded_from: null,
      description: 'Manage plugins',
      aliases: ['plugins']
    }
  ],
  skills: [],
  plugins: []
}

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

const buildFallbackSkillEntries = (
  skillLibrary: SkillLibraryEntry[]
): SlashCatalogEntry[] => {
  const seen = new Set<string>()
  const items: SlashCatalogEntry[] = []

  for (const entry of skillLibrary) {
    if (entry.kind !== 'file' || !/(^|\/)SKILL\.md$/i.test(entry.path)) continue

    const segments = entry.path.split('/').filter(Boolean)
    const folderName =
      segments.length > 1 ? segments[segments.length - 2] : 'skill'
    const normalizedName = folderName.trim()
    if (!normalizedName || seen.has(normalizedName)) continue
    seen.add(normalizedName)

    items.push({
      id: `fallback-skill:${normalizedName}`,
      name: normalizedName,
      slash: `/${normalizedName}`,
      kind: 'skill',
      source: 'skill-library',
      loaded_from: entry.path,
      description: `Skill ${normalizedName}`,
      aliases: []
    })
  }

  return items.sort((left, right) =>
    left.name.localeCompare(right.name, 'pt-BR')
  )
}

const formatBadgeLabel = (file: {
  name: string
  lineStart?: number
  lineEnd?: number
}) => {
  if (file.lineStart && file.lineEnd) {
    return `${file.name} (${file.lineStart}-${file.lineEnd})`
  }
  return file.name
}

const isBadgeElement = (node: Node | null): node is HTMLElement =>
  Boolean(
    node &&
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).dataset?.composerBadge === 'true'
  )

const getBadgeSerializedValue = (
  badgeElement: HTMLElement,
  mode: 'submit' | 'display'
) => {
  const kind = badgeElement.dataset.badgeKind
  const label = badgeElement.dataset.badgeLabel ?? ''
  const value = badgeElement.dataset.badgeValue ?? label

  if (mode === 'display') return label
  if (kind === 'skill' || kind === 'slash') return value

  const path = badgeElement.dataset.badgePath ?? value
  const lineStart = badgeElement.dataset.badgeLineStart
  const lineEnd = badgeElement.dataset.badgeLineEnd
  if (lineStart && lineEnd) {
    return `@${path} (${lineStart}-${lineEnd})`
  }
  return `@${path}`
}

const serializeNode = (
  node: Node,
  mode: 'submit' | 'display',
  isRoot = false
): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as HTMLElement
  const tagName = (node as HTMLElement).tagName
  if (tagName === 'BR') {
    return '\n'
  }

  if (isBadgeElement(element)) {
    return getBadgeSerializedValue(element, mode)
  }

  const childNodes = Array.from((node as HTMLElement).childNodes)
  const childText = childNodes
    .map((child) => serializeNode(child, mode))
    .join('')

  if (isRoot) return childText

  if (tagName === 'DIV' || tagName === 'P') {
    return `${childText}\n`
  }

  return childText
}

const serializeEditor = (editor: HTMLDivElement, mode: 'submit' | 'display') =>
  Array.from(editor.childNodes)
    .map((node) => serializeNode(node, mode, false))
    .join('')
    .replace(/\u00A0/g, ' ')

const getComposerHasContent = (editor: HTMLDivElement) => {
  const serialized = serializeEditor(editor, 'display')
  return (
    serialized.trim().length > 0 ||
    editor.querySelector('[data-composer-badge="true"]') !== null
  )
}

const setCaret = (node: Node, offset: number) => {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

const cloneSelectionRange = (editor: HTMLDivElement) => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return null

  return range.cloneRange()
}

const restoreSelectionRange = (
  editor: HTMLDivElement,
  range: Range | null | undefined
) => {
  if (!range) return false
  if (!editor.contains(range.startContainer)) return false

  const selection = window.getSelection()
  if (!selection) return false

  editor.focus()
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

const placeCaretAtEnd = (editor: HTMLDivElement) => {
  editor.focus()
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

const getSelectionTextContext = (
  editor: HTMLDivElement
): ActiveTokenContext | null => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return null

  let textNode: Text | null = null
  let offset = range.startOffset

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    textNode = range.startContainer as Text
  } else if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const element = range.startContainer as HTMLElement
    const previousNode = element.childNodes[offset - 1] ?? null
    const currentNode = element.childNodes[offset] ?? null
    if (currentNode?.nodeType === Node.TEXT_NODE) {
      textNode = currentNode as Text
      offset = 0
    } else if (previousNode?.nodeType === Node.TEXT_NODE) {
      textNode = previousNode as Text
      offset = (previousNode.textContent ?? '').length
    }
  }

  if (!textNode) return null

  const content = textNode.textContent ?? ''
  const textBeforeCaret = content.slice(0, offset)

  const slashMatch = textBeforeCaret.match(/(?:^|\s)(\/[^\s]*)$/)
  if (slashMatch?.[1]) {
    const token = slashMatch[1]
    return {
      kind: 'slash',
      query: token.slice(1),
      textNode,
      tokenStart: textBeforeCaret.lastIndexOf(token),
      caretOffset: offset
    }
  }

  const mentionMatch = textBeforeCaret.match(/(?:^|\s)(@[^\s@]*)$/)
  if (mentionMatch?.[1]) {
    const token = mentionMatch[1]
    return {
      kind: 'mention',
      query: token.slice(1),
      textNode,
      tokenStart: textBeforeCaret.lastIndexOf(token),
      caretOffset: offset
    }
  }

  return null
}

const createBadgeElement = (badge: ComposerBadge) => {
  const wrapper = document.createElement('span')
  wrapper.contentEditable = 'false'
  wrapper.dataset.composerBadge = 'true'
  wrapper.dataset.badgeId = badge.id
  wrapper.dataset.badgeKind = badge.kind
  wrapper.dataset.badgeLabel = badge.label
  wrapper.dataset.badgeValue = badge.value
  wrapper.className =
    'group mx-0.5 inline-flex h-7 max-w-full select-none items-center gap-2 rounded-md border border-[#3d444d] bg-[#0d1117] pl-1.5 pr-2.5 align-middle text-xs text-[#c9d1d9] transition-colors hover:border-[#4b5560] hover:bg-[#11161d]'

  if (badge.kind === 'file') {
    wrapper.dataset.badgePath = badge.path
    if (badge.lineStart)
      wrapper.dataset.badgeLineStart = String(badge.lineStart)
    if (badge.lineEnd) wrapper.dataset.badgeLineEnd = String(badge.lineEnd)
  }

  const iconWrap = document.createElement('span')
  iconWrap.className = 'relative flex h-3.5 w-3.5 items-center justify-center'

  const primaryIcon = document.createElement('span')
  primaryIcon.className = 'group-hover:hidden'
  if (badge.kind === 'skill') {
    primaryIcon.className += ' text-[11px] font-semibold text-[#58a6ff]'
    primaryIcon.textContent = '@'
  } else if (badge.kind === 'slash') {
    primaryIcon.className += ' text-[11px] font-semibold text-[#58a6ff]'
    primaryIcon.textContent = '/'
  } else {
    primaryIcon.innerHTML = FILE_ICON_SVG
  }

  const removeIcon = document.createElement('span')
  removeIcon.className = 'hidden group-hover:inline-flex'
  removeIcon.dataset.badgeRemove = 'true'
  removeIcon.innerHTML = X_ICON_SVG

  const label = document.createElement('span')
  label.className = 'truncate'
  label.textContent = badge.label

  iconWrap.append(primaryIcon, removeIcon)
  wrapper.append(iconWrap, label)
  return wrapper
}

const removeBadgeElement = (
  editor: HTMLDivElement,
  badgeElement: HTMLElement
) => {
  const previousSibling = badgeElement.previousSibling
  const nextSibling = badgeElement.nextSibling

  badgeElement.remove()

  if (
    previousSibling?.nodeType === Node.TEXT_NODE &&
    nextSibling?.nodeType === Node.TEXT_NODE
  ) {
    ;(previousSibling as Text).textContent =
      ((previousSibling as Text).textContent ?? '') +
      ((nextSibling as Text).textContent ?? '')
    nextSibling.remove()
    setCaret(
      previousSibling,
      ((previousSibling as Text).textContent ?? '').length
    )
  } else if (nextSibling?.nodeType === Node.TEXT_NODE) {
    setCaret(nextSibling, 0)
  } else if (previousSibling?.nodeType === Node.TEXT_NODE) {
    setCaret(
      previousSibling,
      ((previousSibling as Text).textContent ?? '').length
    )
  } else {
    const textNode = document.createTextNode('')
    if (nextSibling) {
      editor.insertBefore(textNode, nextSibling)
    } else {
      editor.appendChild(textNode)
    }
    setCaret(textNode, 0)
  }

  editor.normalize()
  editor.focus()
}

const replaceActiveTokenWithBadge = (
  editor: HTMLDivElement,
  context: ActiveTokenContext,
  badge: ComposerBadge
) => {
  const fullText = context.textNode.textContent ?? ''
  const before = fullText.slice(0, context.tokenStart)
  const after = fullText.slice(context.caretOffset)

  context.textNode.textContent = before
  const badgeElement = createBadgeElement(badge)
  context.textNode.parentNode?.insertBefore(
    badgeElement,
    context.textNode.nextSibling
  )

  const trailingText =
    after.startsWith(' ') || after.length === 0 ? after : ` ${after}`
  const trailingNode = document.createTextNode(trailingText || ' ')
  badgeElement.parentNode?.insertBefore(trailingNode, badgeElement.nextSibling)

  editor.normalize()
  setCaret(trailingNode, Math.min(1, trailingNode.textContent?.length ?? 0))
  editor.focus()
}

const insertBadgeAtSelection = (
  editor: HTMLDivElement,
  badge: ComposerBadge,
  preservedRange?: Range | null
) => {
  if (!restoreSelectionRange(editor, preservedRange)) {
    if (preservedRange) {
      placeCaretAtEnd(editor)
    }
  }

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    placeCaretAtEnd(editor)
  }

  const nextSelection = window.getSelection()
  if (!nextSelection || nextSelection.rangeCount === 0) return false

  const range = nextSelection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) {
    placeCaretAtEnd(editor)
  }

  const finalSelection = window.getSelection()
  if (!finalSelection || finalSelection.rangeCount === 0) return false

  const finalRange = finalSelection.getRangeAt(0)
  if (!editor.contains(finalRange.startContainer)) return false

  finalRange.deleteContents()

  const badgeElement = createBadgeElement(badge)
  const trailingNode = document.createTextNode(' ')
  finalRange.insertNode(trailingNode)
  finalRange.insertNode(badgeElement)

  editor.normalize()
  setCaret(trailingNode, 1)
  editor.focus()
  return true
}

const insertTextAtSelection = (editor: HTMLDivElement, text: string) => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    editor.appendChild(document.createTextNode(text))
    placeCaretAtEnd(editor)
    return
  }

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) {
    editor.appendChild(document.createTextNode(text))
    placeCaretAtEnd(editor)
    return
  }

  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  setCaret(textNode, text.length)
  editor.normalize()
  editor.focus()
}

const clearEditor = (editor: HTMLDivElement) => {
  editor.innerHTML = ''
  const textNode = document.createTextNode('')
  editor.appendChild(textNode)
  setCaret(textNode, 0)
}

const getBadgeBeforeCaret = (editor: HTMLDivElement) => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return null

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    if (range.startOffset !== 0) return null
    const previousSibling = range.startContainer.previousSibling
    return isBadgeElement(previousSibling) ? previousSibling : null
  }

  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const element = range.startContainer as HTMLElement
    const previousSibling = element.childNodes[range.startOffset - 1] ?? null
    return isBadgeElement(previousSibling) ? previousSibling : null
  }

  return null
}

export function Input({
  onSend,
  isLoading,
  skillLibrary,
  models,
  currentModel,
  onModelChange,
  searchFiles,
  detectSnippet
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
    setWorkspaceView,
    skillsRefreshNonce
  } = useStore()
  const { addMessage, initialize } = useChatActions()
  const [selectedAgent] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const [slashCatalog, setSlashCatalog] = useState<SlashCatalogSnapshot>(
    DEFAULT_SLASH_CATALOG
  )
  const [activeSlashIndex, setActiveSlashIndex] = useState(0)
  const [fileSuggestions, setFileSuggestions] = useState<
    WorkspaceFileSearchEntry[]
  >([])
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [isModelPending, setIsModelPending] = useState(false)
  const [activeToken, setActiveToken] = useState<ActiveTokenContext | null>(
    null
  )
  const [composerHasContent, setComposerHasContent] = useState(false)
  const [serializedMessage, setSerializedMessage] = useState('')
  const editorRef = useRef<HTMLDivElement | null>(null)
  const mentionRequestIdRef = useRef(0)
  const fileSearchCacheRef = useRef<Map<string, WorkspaceFileSearchEntry[]>>(
    new Map()
  )
  const canUseRemoteRun = Boolean(selectedAgent || teamId)

  const setEditorNode = useCallback(
    (node: HTMLDivElement | null) => {
      editorRef.current = node
      chatInputRef.current = node
    },
    [chatInputRef]
  )

  const syncComposerState = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    setSerializedMessage(serializeEditor(editor, 'submit'))
    setComposerHasContent(getComposerHasContent(editor))
    setActiveToken(getSelectionTextContext(editor))
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (editor.childNodes.length === 0) {
      clearEditor(editor)
    }
    syncComposerState()
  }, [syncComposerState])

  useEffect(() => {
    if (!chatInputSeed) return

    const editor = editorRef.current
    if (!editor) return

    clearEditor(editor)
    insertTextAtSelection(editor, chatInputSeed)
    clearChatInputSeed()
    requestAnimationFrame(() => {
      placeCaretAtEnd(editor)
      syncComposerState()
    })
  }, [chatInputSeed, chatInputSeedNonce, clearChatInputSeed, syncComposerState])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const nextCatalog = await getSlashCatalogAPI(
          selectedEndpoint,
          authToken
        )
        if (!cancelled) {
          setSlashCatalog({
            ...DEFAULT_SLASH_CATALOG,
            ...nextCatalog,
            commands:
              nextCatalog.commands.length > 0
                ? nextCatalog.commands
                : DEFAULT_SLASH_CATALOG.commands
          })
        }
      } catch {
        if (!cancelled) setSlashCatalog(DEFAULT_SLASH_CATALOG)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedEndpoint, authToken, skillsRefreshNonce])

  const fallbackSkillEntries = useMemo(
    () => buildFallbackSkillEntries(skillLibrary),
    [skillLibrary]
  )

  const mergedSlashCatalog = useMemo<SlashCatalogSnapshot>(() => {
    const skillMap = new Map<string, SlashCatalogEntry>()
    for (const entry of [...slashCatalog.skills, ...fallbackSkillEntries]) {
      skillMap.set(entry.name, entry)
    }

    return {
      ...slashCatalog,
      skills: [...skillMap.values()]
    }
  }, [fallbackSkillEntries, slashCatalog])

  const slashQuery =
    activeToken?.kind === 'slash' ? activeToken.query.toLowerCase() : ''
  const mentionQuery =
    activeToken?.kind === 'mention' ? activeToken.query : null
  const showSlashCatalog = activeToken?.kind === 'slash'
  const showFileSuggestions = activeToken?.kind === 'mention'

  const filteredSlashEntries = useMemo(() => {
    if (!showSlashCatalog) return []

    const entries = [
      ...mergedSlashCatalog.commands,
      ...mergedSlashCatalog.skills
    ]
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
  }, [mergedSlashCatalog, showSlashCatalog, slashQuery])

  const filteredPlugins = useMemo(() => {
    if (!showSlashCatalog) return []

    return mergedSlashCatalog.plugins.filter((plugin) => {
      if (!slashQuery) return true
      return (
        plugin.name.toLowerCase().includes(slashQuery) ||
        plugin.description.toLowerCase().includes(slashQuery)
      )
    })
  }, [mergedSlashCatalog.plugins, showSlashCatalog, slashQuery])

  const availableModels = useMemo(() => {
    const uniqueModels = Array.from(
      new Set([currentModel, selectedModel, ...models].filter(Boolean))
    )
    return uniqueModels.length > 0 ? uniqueModels : ['Modelo']
  }, [currentModel, models, selectedModel])

  const canSubmit =
    composerHasContent &&
    !isLoading &&
    (canUseRemoteRun || serializedMessage.trim().startsWith('/'))

  useEffect(() => {
    setActiveSlashIndex(0)
  }, [slashQuery])

  useEffect(() => {
    setActiveFileIndex(0)
  }, [mentionQuery])

  useEffect(() => {
    if (!showFileSuggestions || mentionQuery === null) {
      setFileSuggestions([])
      return
    }

    const cached = fileSearchCacheRef.current.get(mentionQuery)
    if (cached) {
      setFileSuggestions(cached)
      return
    }

    const requestId = mentionRequestIdRef.current + 1
    mentionRequestIdRef.current = requestId

    const timeoutId = window.setTimeout(() => {
      void searchFiles(mentionQuery)
        .then((response) => {
          if (mentionRequestIdRef.current !== requestId) return
          const nextItems = response.items.slice(0, MAX_VISIBLE_FILE_RESULTS)
          fileSearchCacheRef.current.set(mentionQuery, nextItems)
          setFileSuggestions(nextItems)
        })
        .catch(() => {
          if (mentionRequestIdRef.current !== requestId) return
          setFileSuggestions([])
        })
    }, 120)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [mentionQuery, searchFiles, showFileSuggestions])

  const maybeHandleLocalSlashCommand = useCallback(
    async (message: string) => {
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
      }

      if (normalized === '/help') {
        postLocalReply(
          [
            buildCatalogMessage(
              'Commands',
              mergedSlashCatalog.commands.slice(0, 12),
              'No commands available.'
            ),
            '',
            buildCatalogMessage(
              'Skills',
              mergedSlashCatalog.skills.slice(0, 12),
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
            mergedSlashCatalog.skills,
            'No skills available in this workspace.'
          )
        )
        return true
      }

      if (normalized === '/plugin' || normalized === '/plugins') {
        postLocalReply(
          mergedSlashCatalog.plugins.length > 0
            ? [
                '## Plugins',
                '',
                ...mergedSlashCatalog.plugins.map(
                  (plugin) =>
                    `- \`${plugin.name}\` ${plugin.enabled ? '(enabled)' : '(disabled)'} ${plugin.description}`
                )
              ].join('\n')
            : 'No plugins detected in the current OpenClaude installation.'
        )
        return true
      }

      return false
    },
    [addMessage, mergedSlashCatalog]
  )

  const handleSelectSlashEntry = useCallback(
    (entry: SlashCatalogEntry) => {
      const editor = editorRef.current
      if (!editor || !activeToken || activeToken.kind !== 'slash') return

      replaceActiveTokenWithBadge(editor, activeToken, {
        id: `${entry.kind}:${entry.name}:${Date.now()}`,
        kind: entry.kind === 'skill' ? 'skill' : 'slash',
        label: entry.kind === 'skill' ? entry.name : entry.slash,
        value: entry.slash
      })

      requestAnimationFrame(syncComposerState)
    },
    [activeToken, syncComposerState]
  )

  const handleSelectFileSuggestion = useCallback(
    (entry: WorkspaceFileSearchEntry) => {
      const editor = editorRef.current
      if (!editor || !activeToken || activeToken.kind !== 'mention') return

      replaceActiveTokenWithBadge(editor, activeToken, {
        id: `file:${entry.path}:${Date.now()}`,
        kind: 'file',
        label: entry.name,
        value: entry.path,
        path: entry.path
      })

      requestAnimationFrame(syncComposerState)
    },
    [activeToken, syncComposerState]
  )

  const handleSubmit = useCallback(async () => {
    const editor = editorRef.current
    if (!editor || !composerHasContent || isLoading) return

    const currentMessage = serializeEditor(editor, 'submit').trim()
    if (!currentMessage) return

    if (await maybeHandleLocalSlashCommand(currentMessage)) {
      clearEditor(editor)
      syncComposerState()
      return
    }

    if (!canUseRemoteRun) {
      toast.error(
        'Aguarde a inicializacao do runtime antes de enviar mensagens.'
      )
      return
    }

    const previousHtml = editor.innerHTML
    clearEditor(editor)
    syncComposerState()

    try {
      await onSend(currentMessage)
    } catch (error) {
      editor.innerHTML = previousHtml
      syncComposerState()
      placeCaretAtEnd(editor)
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar a mensagem'
      )
    }
  }, [
    canUseRemoteRun,
    composerHasContent,
    isLoading,
    maybeHandleLocalSlashCommand,
    onSend,
    syncComposerState
  ])

  const handleModelChange = useCallback(
    async (modelName: string) => {
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
    },
    [
      authToken,
      currentModel,
      initialize,
      onModelChange,
      selectedEndpoint,
      setSelectedModel,
      setWorkspaceView
    ]
  )

  const handlePaste = useCallback(
    async (event: ClipboardEvent<HTMLDivElement>) => {
      const pastedText = event.clipboardData.getData('text/plain')
      if (!pastedText) return

      if (pastedText.trim().length < 12 || !pastedText.includes('\n')) {
        return
      }

      event.preventDefault()
      const editor = editorRef.current
      const preservedRange = editor ? cloneSelectionRange(editor) : null
      try {
        const response = await detectSnippet(pastedText)
        const match = response.match
        if (match && editor) {
          insertBadgeAtSelection(editor, {
            id: `snippet:${match.path}:${match.line_start}-${match.line_end}`,
            kind: 'file',
            label: formatBadgeLabel({
              name: match.name,
              lineStart: match.line_start,
              lineEnd: match.line_end
            }),
            value: match.path,
            path: match.path,
            lineStart: match.line_start,
            lineEnd: match.line_end
          }, preservedRange)
          requestAnimationFrame(syncComposerState)
          return
        }
      } catch {
        // fall through
      }

      if (editor) {
        restoreSelectionRange(editor, preservedRange)
        insertTextAtSelection(editor, pastedText)
        requestAnimationFrame(syncComposerState)
      }
    },
    [detectSnippet, syncComposerState]
  )

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (showSlashCatalog && filteredSlashEntries.length > 0) {
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
      }

      if (showFileSuggestions && fileSuggestions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActiveFileIndex((current) =>
            current === fileSuggestions.length - 1 ? 0 : current + 1
          )
          return
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActiveFileIndex((current) =>
            current === 0 ? fileSuggestions.length - 1 : current - 1
          )
          return
        }

        if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
          event.preventDefault()
          handleSelectFileSuggestion(fileSuggestions[activeFileIndex]!)
          return
        }
      }

      if (event.key === 'Backspace' && !isLoading && editorRef.current) {
        const badgeBeforeCaret = getBadgeBeforeCaret(editorRef.current)
        if (badgeBeforeCaret) {
          event.preventDefault()
          removeBadgeElement(editorRef.current, badgeBeforeCaret)
          requestAnimationFrame(syncComposerState)
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
    },
    [
      activeFileIndex,
      activeSlashIndex,
      fileSuggestions,
      filteredSlashEntries,
      handleSelectFileSuggestion,
      handleSelectSlashEntry,
      handleSubmit,
      isLoading,
      showFileSuggestions,
      showSlashCatalog,
      syncComposerState
    ]
  )

  const handleEditorMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      const removeTrigger = target.closest('[data-badge-remove="true"]')
      if (!removeTrigger || !editorRef.current) return

      event.preventDefault()
      const badgeElement = removeTrigger.closest('[data-composer-badge="true"]')
      if (badgeElement instanceof HTMLElement) {
        removeBadgeElement(editorRef.current, badgeElement)
        requestAnimationFrame(syncComposerState)
      }
    },
    [syncComposerState]
  )

  const handleSurfaceMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (
        target.dataset.composerSurface === 'true' ||
        target.dataset.composerEditor === 'true'
      ) {
        requestAnimationFrame(() => {
          editorRef.current?.focus()
          if (document.getSelection()?.rangeCount === 0 && editorRef.current) {
            placeCaretAtEnd(editorRef.current)
          }
        })
      }
    },
    []
  )

  return (
    <div className="shrink-0 bg-[#0d1117] px-4 py-4">
      <div className="mx-auto max-w-4xl">
        <div className="relative rounded-xl border border-[#30363d] bg-[#161b22]">
          {showSlashCatalog &&
          (filteredSlashEntries.length > 0 || filteredPlugins.length > 0) ? (
            <div className="absolute inset-x-3 bottom-full z-30 mb-3 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22]">
              <div className="border-b border-[#30363d] px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                Slash catalog
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {filteredSlashEntries.map((entry, index) => (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      handleSelectSlashEntry(entry)
                    }}
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

          {!showSlashCatalog &&
          showFileSuggestions &&
          fileSuggestions.length > 0 ? (
            <div className="absolute inset-x-3 bottom-full z-30 mb-3 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22]">
              <div className="border-b border-[#30363d] px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                Arquivos do projeto
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {fileSuggestions.map((entry, index) => (
                  <button
                    key={entry.path}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      handleSelectFileSuggestion(entry)
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition-colors',
                      index === activeFileIndex
                        ? 'bg-[#0f1a2b] text-[#f0f6fc]'
                        : 'text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#f0f6fc]'
                    )}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[#7d8590]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-[#f0f6fc]">
                        {entry.name}
                      </div>
                      <div className="truncate text-[#7d8590]">
                        {entry.path}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="px-4 pb-3 pt-4">
            <div
              data-composer-surface="true"
              onMouseDown={handleSurfaceMouseDown}
              className="relative h-fit rounded-md"
            >
              {!composerHasContent ? (
                <div className="pointer-events-none absolute left-0 top-0 text-sm leading-7 text-[#7d8590]">
                  Pergunte algo, digite / para skills ou @ para arquivos
                </div>
              ) : null}

              <div
                ref={setEditorNode}
                data-composer-editor="true"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onInput={syncComposerState}
                onKeyDown={handleEditorKeyDown}
                onKeyUp={syncComposerState}
                onMouseUp={syncComposerState}
                onFocus={syncComposerState}
                onPaste={(event) => {
                  void handlePaste(event)
                }}
                onMouseDown={handleEditorMouseDown}
                className="h-fit overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-sm leading-7 text-[#e6edf3] outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between px-4 pb-3 pt-1">
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
