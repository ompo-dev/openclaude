'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Edit3, Eye, Image as ImageIcon, Save } from 'lucide-react'

import { MarkdownContent } from '@/components/ui/MarkdownContent'
import type { SkillFileSnapshot } from '@/types/integration'

interface SkillsViewProps {
  file: SkillFileSnapshot | null
  isLoading: boolean
  isSaving: boolean
  onSave: (content: string) => void | Promise<void>
}

type HighlightToken = {
  text: string
  className: string
}

type ViewMode = 'preview' | 'edit'
type SkillFormat = 'markdown' | 'yaml' | 'svg' | 'text' | 'image' | 'code'

const buttonClassName =
  'inline-flex h-9 items-center gap-2 rounded-md border border-[#30363d] bg-[#161b22] px-3 text-xs font-medium text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc] disabled:opacity-45'

const LANGUAGE_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'implements',
  'in',
  'interface',
  'let',
  'new',
  'null',
  'return',
  'switch',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'while'
])

const LANGUAGE_TYPES = new Set([
  'Array',
  'Promise',
  'Record',
  'any',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'unknown',
  'void'
])

const TOKEN_PATTERN =
  /(\/\/.*$|#.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g

const YAML_SCALAR_PATTERN =
  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|\b[A-Za-z_][A-Za-z0-9_.-]*\b)/gi

const INLINE_MARKDOWN_PATTERN =
  /(`[^`]*`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~)/g

const XML_TOKEN_PATTERN =
  /(<!--.*?-->|<\/?[\w:.-]+|\/?>|[\w:.-]+(?=\=)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g

const detectMarkdown = (path: string | null | undefined, content: string) => {
  if (path && /\.(md|mdx)$/i.test(path)) return true

  const trimmed = content.trim()
  if (!trimmed) return false

  return (
    /^---\s*\r?\n[\s\S]*?\r?\n---\s*/.test(trimmed) ||
    /^\s{0,3}#{1,6}\s+/m.test(trimmed) ||
    /^\s*[-*+]\s+/m.test(trimmed) ||
    /^\s*\d+\.\s+/m.test(trimmed) ||
    /^\s*```/m.test(trimmed)
  )
}

const splitFrontmatter = (content: string) => {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: '', body: content }
  }

  return {
    frontmatter: match[1] ?? '',
    body: match[2] ?? ''
  }
}

const tokenizeCode = (content: string): HighlightToken[] => {
  const tokens: HighlightToken[] = []
  let cursor = 0

  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0
    const token = match[0]

    if (index > cursor) {
      tokens.push({ text: content.slice(cursor, index), className: 'text-[#e6edf3]' })
    }

    let className = 'text-[#e6edf3]'
    if (token.startsWith('//') || token.startsWith('#') || token.startsWith('/*')) {
      className = 'text-[#8b949e]'
    } else if (
      token.startsWith('"') ||
      token.startsWith("'") ||
      token.startsWith('`')
    ) {
      className = 'text-[#a5d6ff]'
    } else if (/^\d/.test(token)) {
      className = 'text-[#79c0ff]'
    } else if (LANGUAGE_KEYWORDS.has(token)) {
      className = 'text-[#d2a8ff]'
    } else if (LANGUAGE_TYPES.has(token)) {
      className = 'text-[#ffa657]'
    }

    tokens.push({ text: token, className })
    cursor = index + token.length
  }

  if (cursor < content.length) {
    tokens.push({ text: content.slice(cursor), className: 'text-[#e6edf3]' })
  }

  return tokens.length > 0 ? tokens : [{ text: content || ' ', className: 'text-[#e6edf3]' }]
}

const tokenizeMarkdownInline = (content: string): HighlightToken[] => {
  const tokens: HighlightToken[] = []
  let cursor = 0

  const pushPlain = (value: string) => {
    if (!value) return
    tokens.push({ text: value, className: 'text-[#c9d1d9]' })
  }

  for (const match of content.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const index = match.index ?? 0
    const token = match[0]

    if (index > cursor) {
      pushPlain(content.slice(cursor, index))
    }

    if (token.startsWith('`')) {
      tokens.push({ text: token, className: 'text-[#79c0ff]' })
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (linkMatch) {
        tokens.push({ text: '[', className: 'text-[#8b949e]' })
        tokens.push({ text: linkMatch[1], className: 'text-[#58a6ff]' })
        tokens.push({ text: '](', className: 'text-[#8b949e]' })
        tokens.push({ text: linkMatch[2], className: 'text-[#a5d6ff]' })
        tokens.push({ text: ')', className: 'text-[#8b949e]' })
      } else {
        tokens.push({ text: token, className: 'text-[#58a6ff]' })
      }
    } else {
      const marker =
        token.startsWith('**') || token.startsWith('__') || token.startsWith('~~')
          ? token.slice(0, 2)
          : token.slice(0, 1)
      const inner = token.slice(marker.length, token.length - marker.length)
      tokens.push({ text: marker, className: 'text-[#d2a8ff]' })
      tokens.push({ text: inner, className: 'text-[#c9d1d9]' })
      tokens.push({ text: marker, className: 'text-[#d2a8ff]' })
    }

    cursor = index + token.length
  }

  if (cursor < content.length) {
    pushPlain(content.slice(cursor))
  }

  return tokens.length > 0 ? tokens : [{ text: content || ' ', className: 'text-[#c9d1d9]' }]
}

const tokenizeFrontmatterLine = (line: string): HighlightToken[] => {
  if (!line.trim()) return [{ text: ' ', className: 'text-[#8b949e]' }]
  if (line.trim() === '---') return [{ text: line, className: 'text-[#8b949e]' }]

  const match = /^(\s*)([A-Za-z0-9_-]+)(\s*:\s*)(.*)$/.exec(line)
  if (!match) return tokenizeMarkdownInline(line)

  return [
    { text: match[1], className: 'text-[#8b949e]' },
    { text: match[2], className: 'text-[#ffa657]' },
    { text: match[3], className: 'text-[#8b949e]' },
    ...tokenizeMarkdownInline(match[4])
  ]
}

const tokenizeMarkdownLine = (
  line: string,
  state: { inFrontmatter: boolean; inFence: boolean }
): HighlightToken[] => {
  if (state.inFrontmatter) {
    const tokens = tokenizeFrontmatterLine(line)
    if (line.trim() === '---') state.inFrontmatter = false
    return tokens
  }

  if (line.trim() === '---') {
    state.inFrontmatter = true
    return [{ text: line, className: 'text-[#8b949e]' }]
  }

  if (/^\s*```/.test(line)) {
    state.inFence = !state.inFence
    return [{ text: line, className: 'text-[#ffa657]' }]
  }

  if (state.inFence) return tokenizeCode(line)

  const headingMatch = /^(\s{0,3})(#{1,6})(\s+)(.*)$/.exec(line)
  if (headingMatch) {
    return [
      { text: headingMatch[1], className: 'text-[#8b949e]' },
      { text: headingMatch[2], className: 'text-[#d2a8ff]' },
      { text: headingMatch[3], className: 'text-[#8b949e]' },
      ...tokenizeMarkdownInline(headingMatch[4]).map((token) => ({
        ...token,
        className: token.className === 'text-[#c9d1d9]' ? 'text-[#f0f6fc]' : token.className
      }))
    ]
  }

  const listMatch = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/.exec(line)
  if (listMatch) {
    return [
      { text: listMatch[1], className: 'text-[#8b949e]' },
      { text: listMatch[2], className: 'text-[#58a6ff]' },
      { text: listMatch[3], className: 'text-[#8b949e]' },
      ...tokenizeMarkdownInline(listMatch[4])
    ]
  }

  const quoteMatch = /^(\s*>+\s?)(.*)$/.exec(line)
  if (quoteMatch) {
    return [
      { text: quoteMatch[1], className: 'text-[#8b949e]' },
      ...tokenizeMarkdownInline(quoteMatch[2])
    ]
  }

  if (/^\s*---+\s*$/.test(line) || /^\s*\*\*\*+\s*$/.test(line)) {
    return [{ text: line, className: 'text-[#8b949e]' }]
  }

  return tokenizeMarkdownInline(line)
}

const tokenizeYamlInline = (content: string): HighlightToken[] => {
  const tokens: HighlightToken[] = []
  let cursor = 0

  for (const match of content.matchAll(YAML_SCALAR_PATTERN)) {
    const index = match.index ?? 0
    const token = match[0]

    if (index > cursor) {
      tokens.push({ text: content.slice(cursor, index), className: 'text-[#c9d1d9]' })
    }

    let className = 'text-[#c9d1d9]'
    if (token.startsWith('"') || token.startsWith("'")) {
      className = 'text-[#a5d6ff]'
    } else if (/^\d/.test(token)) {
      className = 'text-[#79c0ff]'
    } else if (/^(true|false|null)$/i.test(token)) {
      className = 'text-[#ffa657]'
    } else {
      className = 'text-[#c9d1d9]'
    }

    tokens.push({ text: token, className })
    cursor = index + token.length
  }

  if (cursor < content.length) {
    tokens.push({ text: content.slice(cursor), className: 'text-[#c9d1d9]' })
  }

  return tokens.length > 0 ? tokens : [{ text: content || ' ', className: 'text-[#c9d1d9]' }]
}

const tokenizeYamlLine = (line: string): HighlightToken[] => {
  if (!line.trim()) return [{ text: ' ', className: 'text-[#8b949e]' }]
  if (line.trim() === '---' || line.trim() === '...') {
    return [{ text: line, className: 'text-[#8b949e]' }]
  }

  const commentIndex = line.indexOf('#')
  const body = commentIndex >= 0 ? line.slice(0, commentIndex) : line
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : ''
  const keyMatch = /^(\s*)(-\s+)?([A-Za-z0-9_.-]+)(\s*:\s*)(.*)$/.exec(body)

  const tokens: HighlightToken[] = []
  if (keyMatch) {
    tokens.push({ text: keyMatch[1], className: 'text-[#8b949e]' })
    if (keyMatch[2]) {
      tokens.push({ text: keyMatch[2], className: 'text-[#58a6ff]' })
    }
    tokens.push({ text: keyMatch[3], className: 'text-[#ffa657]' })
    tokens.push({ text: keyMatch[4], className: 'text-[#8b949e]' })
    tokens.push(...tokenizeYamlInline(keyMatch[5]))
  } else {
    tokens.push(...tokenizeYamlInline(body))
  }

  if (comment) {
    tokens.push({ text: comment, className: 'text-[#8b949e]' })
  }

  return tokens
}

const tokenizeSvgLine = (line: string): HighlightToken[] => {
  const tokens: HighlightToken[] = []
  let cursor = 0

  for (const match of line.matchAll(XML_TOKEN_PATTERN)) {
    const index = match.index ?? 0
    const token = match[0]

    if (index > cursor) {
      tokens.push({ text: line.slice(cursor, index), className: 'text-[#c9d1d9]' })
    }

    let className = 'text-[#c9d1d9]'
    if (token.startsWith('<!--')) {
      className = 'text-[#8b949e]'
    } else if (
      token.startsWith('</') ||
      token.startsWith('<') ||
      token === '/>' ||
      token === '>'
    ) {
      className = 'text-[#d2a8ff]'
    } else if (token.startsWith('"') || token.startsWith("'")) {
      className = 'text-[#a5d6ff]'
    } else if (/^[\w:.-]+$/.test(token)) {
      className = 'text-[#ffa657]'
    }

    tokens.push({ text: token, className })
    cursor = index + token.length
  }

  if (cursor < line.length) {
    tokens.push({ text: line.slice(cursor), className: 'text-[#c9d1d9]' })
  }

  return tokens.length > 0 ? tokens : [{ text: line || ' ', className: 'text-[#c9d1d9]' }]
}

const renderTokenLine = (tokens: HighlightToken[], key: string) => (
  <div key={key} className="whitespace-pre font-mono text-[13px] leading-6">
    {tokens.map((token, index) => (
      <span key={`${key}:${index}:${token.text}`} className={token.className}>
        {token.text || ' '}
      </span>
    ))}
  </div>
)

const buildMarkdownEditorLines = (content: string) => {
  const state = { inFrontmatter: false, inFence: false }
  return content.split(/\r?\n/).map((line) => tokenizeMarkdownLine(line, state))
}

const buildYamlEditorLines = (content: string) =>
  content.split(/\r?\n/).map((line) => tokenizeYamlLine(line))

const buildSvgEditorLines = (content: string) =>
  content.split(/\r?\n/).map((line) => tokenizeSvgLine(line))

const buildCodeEditorLines = (content: string) =>
  content.split(/\r?\n/).map((line) => tokenizeCode(line))

const getResolvedFormat = (
  file: SkillFileSnapshot,
  content: string
): SkillFormat => {
  if (file.format) return file.format
  if (detectMarkdown(file.path, content)) return 'markdown'

  const lowerPath = file.path.toLowerCase()
  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) return 'yaml'
  if (lowerPath.endsWith('.svg')) return 'svg'
  if (lowerPath.endsWith('.txt') || lowerPath.endsWith('.text') || lowerPath.endsWith('.log')) {
    return 'text'
  }
  if (/\.(png|jpg|jpeg|gif|webp|bmp|ico)$/i.test(lowerPath)) return 'image'
  return 'code'
}

const renderSyntaxPanel = (lines: HighlightToken[][]) => (
  <div className="overflow-x-auto px-4 py-4">
    {lines.map((tokens, index) => renderTokenLine(tokens, `preview:${index}`))}
  </div>
)

export default function SkillsView({
  file,
  isLoading,
  isSaving,
  onSave
}: SkillsViewProps) {
  const [draft, setDraft] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const backdropRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setDraft(file?.content ?? '')
    if (file?.format === 'text') {
      setViewMode('edit')
      return
    }
    setViewMode('preview')
  }, [file?.content, file?.format, file?.path])

  const resolvedFormat = useMemo<SkillFormat>(
    () => (file ? getResolvedFormat(file, draft) : 'text'),
    [draft, file]
  )
  const markdownParts = useMemo(() => splitFrontmatter(draft), [draft])
  const editable = file?.editable ?? (resolvedFormat !== 'image')

  const editorLines = useMemo(() => {
    switch (resolvedFormat) {
      case 'markdown':
        return buildMarkdownEditorLines(draft)
      case 'yaml':
        return buildYamlEditorLines(draft)
      case 'svg':
        return buildSvgEditorLines(draft)
      case 'code':
        return buildCodeEditorLines(draft)
      default:
        return []
    }
  }, [draft, resolvedFormat])

  const syncScroll = () => {
    if (!textareaRef.current || !backdropRef.current) return
    backdropRef.current.scrollTop = textareaRef.current.scrollTop
    backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#7d8590]">
        Carregando skill...
      </div>
    )
  }

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="text-sm font-medium text-[#f0f6fc]">Selecione um arquivo de skill</div>
          <div className="mt-2 text-sm text-[#7d8590]">
            Abra um arquivo na arvore de skills da sidebar para visualizar ou editar.
          </div>
        </div>
      </div>
    )
  }

  const hasChanges = editable && draft !== file.content
  const supportsPreview = resolvedFormat !== 'text'

  return (
    <div className="flex h-full flex-col bg-[#0d1117]">
      <div className="border-b border-[#30363d] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#f0f6fc]">{file.path}</div>
            <div className="mt-1 text-xs text-[#7d8590]">
              Atualizado em {new Date(file.updated_at).toLocaleString('pt-BR')}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-[#30363d] bg-[#0d1117] p-1">
              {supportsPreview ? (
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors ${
                    viewMode === 'preview'
                      ? 'bg-[#21262d] text-[#f0f6fc]'
                      : 'text-[#8b949e] hover:text-[#f0f6fc]'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Visualizar
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => editable && setViewMode('edit')}
                disabled={!editable}
                className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors ${
                  viewMode === 'edit'
                    ? 'bg-[#21262d] text-[#f0f6fc]'
                    : 'text-[#8b949e] hover:text-[#f0f6fc]'
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                <Edit3 className="h-3.5 w-3.5" />
                Editar
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                void onSave(draft)
              }}
              disabled={!hasChanges || isSaving}
              className={buttonClassName}
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-5">
        {viewMode === 'preview' ? (
          <div className="h-full overflow-auto rounded-lg border border-[#30363d] bg-[#0d1117]">
            {resolvedFormat === 'image' ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 px-6 py-8">
                {file.preview_data_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file.preview_data_url}
                    alt={file.path}
                    className="max-h-[70vh] max-w-full rounded-lg border border-[#30363d] bg-white object-contain"
                  />
                ) : (
                  <div className="flex items-center gap-2 text-sm text-[#7d8590]">
                    <ImageIcon className="h-4 w-4" />
                    Preview indisponivel para esta imagem.
                  </div>
                )}
              </div>
            ) : resolvedFormat === 'markdown' ? (
              <div className="mx-auto max-w-4xl px-6 py-6 text-[#c9d1d9]">
                {markdownParts.frontmatter ? (
                  <div className="mb-6 overflow-hidden rounded-lg border border-[#30363d] bg-[#11161d]">
                    <div className="border-b border-[#30363d] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7d8590]">
                      Frontmatter
                    </div>
                    {renderSyntaxPanel(buildYamlEditorLines(markdownParts.frontmatter))}
                  </div>
                ) : null}

                <MarkdownContent
                  content={markdownParts.body || draft}
                  className="[&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-[#f0f6fc] [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[#f0f6fc] [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[#f0f6fc] [&_li]:text-[#c9d1d9] [&_p]:text-[#c9d1d9]"
                />
              </div>
            ) : resolvedFormat === 'svg' ? (
              <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
                {file.preview_data_url ? (
                  <div className="flex items-center justify-center rounded-lg border border-[#30363d] bg-[#11161d] p-6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={file.preview_data_url}
                      alt={file.path}
                      className="max-h-[320px] max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-[#7d8590]">
                    <ImageIcon className="h-4 w-4" />
                    Preview indisponivel para este SVG.
                  </div>
                )}
              </div>
            ) : resolvedFormat === 'yaml' ? (
              <div className="mx-auto max-w-5xl px-6 py-6">
                <div className="overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117]">
                  {renderSyntaxPanel(buildYamlEditorLines(draft))}
                </div>
              </div>
            ) : resolvedFormat === 'text' ? (
              <div className="mx-auto max-w-5xl px-6 py-6">
                <pre className="whitespace-pre-wrap break-words rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-4 font-mono text-[13px] leading-6 text-[#c9d1d9]">
                  {draft}
                </pre>
              </div>
            ) : (
              <div className="mx-auto max-w-5xl px-6 py-6">
                <div className="overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117]">
                  {renderSyntaxPanel(buildCodeEditorLines(draft))}
                </div>
              </div>
            )}
          </div>
        ) : editable && (resolvedFormat === 'markdown' || resolvedFormat === 'yaml' || resolvedFormat === 'svg' || resolvedFormat === 'code') ? (
          <div className="relative h-full overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117]">
            <div ref={backdropRef} className="pointer-events-none absolute inset-0 overflow-auto">
              <div className="min-h-full min-w-full px-4 py-4">
                {editorLines.map((tokens, index) =>
                  renderTokenLine(tokens, `editor:${index}`)
                )}
              </div>
            </div>

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              wrap="off"
              className="absolute inset-0 h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-6 text-transparent caret-[#e6edf3] outline-none selection:bg-[#264f78] [&::-webkit-resizer]:hidden"
            />
          </div>
        ) : editable ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none rounded-lg border border-[#30363d] bg-[#0d1117] p-4 font-mono text-[13px] leading-6 text-[#e6edf3] outline-none placeholder:text-[#7d8590] focus:border-[#1f6feb]"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-[#30363d] bg-[#0d1117] px-6 text-sm text-[#7d8590]">
            Este tipo de arquivo e somente leitura na web.
          </div>
        )}
      </div>
    </div>
  )
}
