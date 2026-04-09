'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { WorkspaceChangedFile } from '@/types/integration'

type DiffLineRow = {
  rowType: 'add' | 'remove' | 'context'
  oldLine: number | null
  newLine: number | null
  content: string
}

type DiffBlock =
  | {
      kind: 'hunk'
      header: string
      rows: DiffLineRow[]
    }
  | {
      kind: 'gap'
      count: number
    }
  | {
      kind: 'empty'
      content: string
    }

type HighlightToken = {
  text: string
  className: string
}

interface MessageDiffProps {
  files: WorkspaceChangedFile[]
}

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

const getSingleLineNumber = (row: DiffLineRow) =>
  row.newLine ?? row.oldLine ?? null

const tokenizeCode = (content: string): HighlightToken[] => {
  const tokens: HighlightToken[] = []
  let cursor = 0

  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0
    const token = match[0]

    if (index > cursor) {
      tokens.push({
        text: content.slice(cursor, index),
        className: 'text-[#e6edf3]'
      })
    }

    let className = 'text-[#e6edf3]'
    if (
      token.startsWith('//') ||
      token.startsWith('#') ||
      token.startsWith('/*')
    ) {
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
    tokens.push({
      text: content.slice(cursor),
      className: 'text-[#e6edf3]'
    })
  }

  return tokens.length > 0
    ? tokens
    : [{ text: content || ' ', className: 'text-[#e6edf3]' }]
}

const parsePatchBlocks = (patch: string | null | undefined): DiffBlock[] => {
  if (!patch) {
    return [
      {
        kind: 'empty',
        content: 'Sem preview de diff disponivel para este arquivo.'
      }
    ]
  }

  const lines = patch.split(/\r?\n/)
  const blocks: DiffBlock[] = []

  let currentHunk: Extract<DiffBlock, { kind: 'hunk' }> | null = null
  let oldLine = 0
  let newLine = 0
  let previousOldEnd: number | null = null
  let previousNewEnd: number | null = null

  const flushCurrentHunk = () => {
    if (currentHunk && currentHunk.rows.length > 0) {
      blocks.push(currentHunk)
    }
    currentHunk = null
  }

  for (const line of lines) {
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      continue
    }

    if (line.startsWith('@@')) {
      flushCurrentHunk()

      const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      const nextOldStart = match ? Number(match[1]) : 0
      const nextNewStart = match ? Number(match[3]) : 0

      if (previousOldEnd !== null && previousNewEnd !== null) {
        const skippedOld = Math.max(nextOldStart - previousOldEnd, 0)
        const skippedNew = Math.max(nextNewStart - previousNewEnd, 0)
        const skippedLines = Math.max(skippedOld, skippedNew)

        if (skippedLines > 0) {
          blocks.push({ kind: 'gap', count: skippedLines })
        }
      }

      oldLine = nextOldStart
      newLine = nextNewStart
      currentHunk = {
        kind: 'hunk',
        header: line,
        rows: []
      }
      continue
    }

    if (!currentHunk) {
      continue
    }

    if (line.startsWith('\\')) {
      currentHunk.rows.push({
        rowType: 'context',
        oldLine: null,
        newLine: null,
        content: line
      })
      continue
    }

    if (line.startsWith('+')) {
      currentHunk.rows.push({
        rowType: 'add',
        oldLine: null,
        newLine,
        content: line.slice(1)
      })
      newLine += 1
      previousOldEnd = oldLine
      previousNewEnd = newLine
      continue
    }

    if (line.startsWith('-')) {
      currentHunk.rows.push({
        rowType: 'remove',
        oldLine,
        newLine: null,
        content: line.slice(1)
      })
      oldLine += 1
      previousOldEnd = oldLine
      previousNewEnd = newLine
      continue
    }

    currentHunk.rows.push({
      rowType: 'context',
      oldLine,
      newLine,
      content: line.startsWith(' ') ? line.slice(1) : line
    })
    oldLine += 1
    newLine += 1
    previousOldEnd = oldLine
    previousNewEnd = newLine
  }

  flushCurrentHunk()

  if (blocks.length === 0) {
    return [
      {
        kind: 'empty',
        content: 'Nao foi possivel montar um diff legivel para este arquivo.'
      }
    ]
  }

  return blocks
}

export function MessageDiff({ files }: MessageDiffProps) {
  const [expandedFiles, setExpandedFiles] = useState<string[]>(
    files[0]?.path ? [files[0].path] : []
  )

  const parsedPatches = useMemo(
    () =>
      Object.fromEntries(
        files.map((file) => [file.path, parsePatchBlocks(file.patch_preview)])
      ),
    [files]
  )

  const totalAdditions = files.reduce(
    (sum, file) => sum + (file.insertions || 0),
    0
  )
  const totalDeletions = files.reduce(
    (sum, file) => sum + (file.deletions || 0),
    0
  )

  const toggleFile = (filePath: string) => {
    setExpandedFiles((current) =>
      current.includes(filePath)
        ? current.filter((path) => path !== filePath)
        : [...current, filePath]
    )
  }

  return (
    <div className="mt-4 w-full max-w-4xl overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117]">
      <div className="flex items-center gap-2 border-b border-[#30363d] px-4 py-3">
        <span className="text-sm font-semibold text-[#f0f6fc]">
          {files.length === 1
            ? '1 arquivo alterado'
            : `${files.length} arquivos alterados`}
        </span>
        <span className="text-sm font-medium text-[#3fb950]">
          +{totalAdditions}
        </span>
        <span className="text-sm font-medium text-[#f85149]">
          -{totalDeletions}
        </span>
      </div>

      <div className="space-y-3 p-3">
        {files.map((file) => {
          const isOpen = expandedFiles.includes(file.path)
          const blocks = parsedPatches[file.path] || []

          return (
            <section
              key={file.path}
              className="overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117]"
            >
              <button
                type="button"
                onClick={() => toggleFile(file.path)}
                className={cn(
                  'flex w-full items-center gap-2 px-4 py-3 text-left',
                  isOpen ? 'border-b border-[#30363d]' : ''
                )}
              >
                <span className="text-[#8b949e]">
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#f0f6fc]">
                  {file.path}
                </span>
                <span className="text-sm font-medium text-[#3fb950]">
                  +{file.insertions || 0}
                </span>
                <span className="text-sm font-medium text-[#f85149]">
                  -{file.deletions || 0}
                </span>
              </button>

              {isOpen ? (
                <div className="overflow-x-auto">
                  <div className="min-w-[880px]">
                    {blocks.map((block, blockIndex) => {
                      if (block.kind === 'empty') {
                        return (
                          <div
                            key={`${file.path}-empty-${blockIndex}`}
                            className="px-4 py-8 text-sm text-[#8b949e]"
                          >
                            {block.content}
                          </div>
                        )
                      }

                      if (block.kind === 'gap') {
                        return (
                          <div
                            key={`${file.path}-gap-${blockIndex}`}
                            className="flex items-center gap-2 border-y border-[#30363d] bg-[#21262d] px-3 py-2 text-[12px] text-[#c9d1d9]"
                          >
                            <ChevronDown className="h-3.5 w-3.5 text-[#8b949e]" />
                            <span>{block.count} unmodified lines</span>
                          </div>
                        )
                      }

                      return (
                        <section
                          key={`${file.path}-hunk-${blockIndex}`}
                          className="border-b border-[#21262d] last:border-b-0"
                        >
                          <div className="border-b border-[#1b2a41] bg-[#0f2747] px-4 py-2 font-mono text-[12px] text-[#58a6ff]">
                            {block.header}
                          </div>

                          {block.rows.map((row, rowIndex) => {
                            const displayLine = getSingleLineNumber(row)

                            return (
                              <div
                                key={`${file.path}-row-${blockIndex}-${rowIndex}`}
                                className={cn(
                                  'grid grid-cols-[3px_56px_minmax(0,1fr)] border-b border-[#161b22] font-mono text-[12px] leading-6 last:border-b-0',
                                  row.rowType === 'add' && 'bg-[#12261b]',
                                  row.rowType === 'remove' && 'bg-[#2a1418]',
                                  row.rowType === 'context' && 'bg-[#0d1117]'
                                )}
                              >
                                <div
                                  className={cn(
                                    row.rowType === 'add' && 'bg-[#2ea043]',
                                    row.rowType === 'remove' && 'bg-[#f85149]',
                                    row.rowType === 'context' && 'bg-transparent'
                                  )}
                                />
                                <div className="border-r border-[#21262d] px-3 text-right text-[#6e7681]">
                                  {displayLine ?? ''}
                                </div>
                                <code className="whitespace-pre px-4 [tab-size:2]">
                                  {tokenizeCode(row.content).map(
                                    (token, tokenIndex) => (
                                      <span
                                        key={`${file.path}-${blockIndex}-${rowIndex}-${tokenIndex}`}
                                        className={token.className}
                                      >
                                        {token.text}
                                      </span>
                                    )
                                  )}
                                </code>
                              </div>
                            )
                          })}
                        </section>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}
