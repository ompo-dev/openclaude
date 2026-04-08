'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Ellipsis,
  ExternalLink,
  FileText,
  FolderTree,
  RotateCcw,
  SquareMinus
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { WorkspaceChangedFile } from '@/types/integration'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { FileChange } from './message'

interface DiffViewerProps {
  isOpen: boolean
  onClose: () => void
  fileChanges: FileChange[]
  files: WorkspaceChangedFile[]
  onOpenInEditor: (filePath: string) => void | Promise<void>
  onRevertFiles: (filePaths: string[]) => void | Promise<void>
  onUnstageFiles: (filePaths: string[]) => void | Promise<void>
}

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

type DiffFilterMode = 'staged' | 'unstaged'

type FileTreeNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  children?: FileTreeNode[]
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

const fileStatusLabel = (file: WorkspaceChangedFile) =>
  file.tracked ? 'modified' : 'added'

const getSingleLineNumber = (row: DiffLineRow) =>
  row.newLine ?? row.oldLine ?? null

const buildFileTree = (paths: string[]): FileTreeNode[] => {
  type MutableTreeNode = {
    name: string
    path: string
    kind: 'directory' | 'file'
    children: Map<string, MutableTreeNode>
  }

  const root: MutableTreeNode = {
    name: '',
    path: '',
    kind: 'directory',
    children: new Map()
  }

  for (const rawPath of paths) {
    const normalizedPath = rawPath.replace(/\\/g, '/')
    const segments = normalizedPath.split('/').filter(Boolean)
    let current = root
    let accumulatedPath = ''

    segments.forEach((segment, index) => {
      accumulatedPath = accumulatedPath
        ? `${accumulatedPath}/${segment}`
        : segment
      const isFile = index === segments.length - 1
      const existing = current.children.get(segment)

      if (existing) {
        current = existing
        return
      }

      const nextNode: MutableTreeNode = {
        name: segment,
        path: accumulatedPath,
        kind: isFile ? 'file' : 'directory',
        children: new Map()
      }
      current.children.set(segment, nextNode)
      current = nextNode
    })
  }

  const toArray = (node: MutableTreeNode): FileTreeNode[] =>
    [...node.children.values()]
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === 'directory' ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      })
      .map((child) => ({
        name: child.name,
        path: child.path,
        kind: child.kind,
        children: child.kind === 'directory' ? toArray(child) : undefined
      }))

  return toArray(root)
}

const filterFileTree = (
  nodes: FileTreeNode[],
  query: string
): FileTreeNode[] => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return nodes

  return nodes.flatMap((node) => {
    if (node.kind === 'file') {
      return node.path.toLowerCase().includes(normalizedQuery) ? [node] : []
    }

    const filteredChildren = filterFileTree(
      node.children || [],
      normalizedQuery
    )
    if (
      filteredChildren.length > 0 ||
      node.path.toLowerCase().includes(normalizedQuery)
    ) {
      return [
        {
          ...node,
          children: filteredChildren
        }
      ]
    }

    return []
  })
}

const collectDirectoryPaths = (nodes: FileTreeNode[]): string[] =>
  nodes.flatMap((node) =>
    node.kind === 'directory'
      ? [node.path, ...collectDirectoryPaths(node.children || [])]
      : []
  )

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

export function DiffViewer(props: DiffViewerProps) {
  const {
    isOpen,
    fileChanges,
    files,
    onOpenInEditor,
    onRevertFiles,
    onUnstageFiles
  } = props

  const [expandedFiles, setExpandedFiles] = useState<string[]>([])
  const [menuFilePath, setMenuFilePath] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<DiffFilterMode>('unstaged')
  const [treeOpen, setTreeOpen] = useState(false)
  const [treeFilter, setTreeFilter] = useState('')
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([])

  const stagedFiles = useMemo(
    () =>
      files.filter((file) => file.staged_status && file.staged_status !== ' '),
    [files]
  )
  const unstagedFiles = useMemo(
    () =>
      files.filter(
        (file) => !(file.staged_status && file.staged_status !== ' ')
      ),
    [files]
  )
  const displayedFiles = viewMode === 'staged' ? stagedFiles : unstagedFiles

  useEffect(() => {
    if (
      viewMode === 'staged' &&
      stagedFiles.length === 0 &&
      unstagedFiles.length > 0
    ) {
      setViewMode('unstaged')
    }
  }, [stagedFiles.length, unstagedFiles.length, viewMode])

  useEffect(() => {
    setExpandedFiles((current) => {
      const available = new Set(displayedFiles.map((file) => file.path))
      const next = current.filter((filePath) => available.has(filePath))
      if (next.length > 0) return next
      return displayedFiles[0]?.path ? [displayedFiles[0].path] : []
    })
  }, [displayedFiles])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('[data-diff-menu-root="true"]')) return
      if (event.target.closest('[data-diff-tree-root="true"]')) return
      setMenuFilePath(null)
      setTreeOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const parsedPatches = useMemo(
    () =>
      Object.fromEntries(
        displayedFiles.map((file) => [
          file.path,
          parsePatchBlocks(file.patch_preview)
        ])
      ),
    [displayedFiles]
  )

  const totalAdditions =
    fileChanges.reduce((sum, file) => sum + (file.additions || 0), 0) ||
    displayedFiles.reduce((sum, file) => sum + (file.insertions || 0), 0)
  const totalDeletions =
    fileChanges.reduce((sum, file) => sum + (file.deletions || 0), 0) ||
    displayedFiles.reduce((sum, file) => sum + (file.deletions || 0), 0)

  const bottomActionLabel =
    viewMode === 'staged' ? 'Desmarcar tudo para commit' : 'Reverter tudo'
  const treeNodes = useMemo(
    () => buildFileTree(displayedFiles.map((file) => file.path)),
    [displayedFiles]
  )
  const filteredTreeNodes = useMemo(
    () => filterFileTree(treeNodes, treeFilter),
    [treeFilter, treeNodes]
  )

  useEffect(() => {
    setExpandedDirectories(collectDirectoryPaths(treeNodes))
  }, [treeNodes])

  if (!isOpen) return null

  const handleToggleFile = (filePath: string) => {
    setExpandedFiles((current) =>
      current.includes(filePath)
        ? current.filter((path) => path !== filePath)
        : [...current, filePath]
    )
  }

  const handleBulkAction = () => {
    const filePaths = displayedFiles.map((file) => file.path)
    if (filePaths.length === 0) return

    if (viewMode === 'staged') {
      void onUnstageFiles(filePaths)
      return
    }

    void onRevertFiles(filePaths)
  }

  return (
    <aside className="relative flex h-full w-[760px] min-w-[760px] max-w-[760px] shrink-0 flex-col border-l border-[#30363d] bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-[#30363d] px-4 pb-3 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Select
              value={viewMode}
              onValueChange={(value) => setViewMode(value as DiffFilterMode)}
            >
              <SelectTrigger
                variant="codex"
                className="h-8 min-w-[210px] rounded-md border-0 bg-transparent px-0 py-0 text-[14px] font-semibold text-[#f0f6fc] shadow-none hover:bg-transparent focus:ring-0 focus:ring-offset-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent variant="codex" className="w-[230px]">
                <SelectItem variant="codex" value="staged">
                  Marcadas para commit
                </SelectItem>
                <SelectItem variant="codex" value="unstaged">
                  Nao marcadas para commit
                </SelectItem>
              </SelectContent>
            </Select>
            <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[11px] font-medium text-[#c9d1d9]">
              {displayedFiles.length}
            </span>
            <div className="flex items-center gap-3 text-[13px]">
              <span className="font-medium text-[#3fb950]">
                +{totalAdditions}
              </span>
              <span className="font-medium text-[#f85149]">
                -{totalDeletions}
              </span>
            </div>
          </div>
        </div>

        <div className="relative" data-diff-tree-root="true">
          <button
            type="button"
            onClick={() => setTreeOpen((current) => !current)}
            className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#161b22] hover:text-[#f0f6fc]"
            title="Abrir arvore de arquivos"
          >
            <FolderTree className="h-4 w-4" />
          </button>

          {treeOpen ? (
            <div className="absolute right-0 top-9 z-20 flex h-[520px] w-[280px] flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-[0_14px_34px_rgba(0,0,0,0.48)]">
              <div className="border-b border-[#30363d] p-3">
                <input
                  value={treeFilter}
                  onChange={(event) => setTreeFilter(event.target.value)}
                  placeholder="Filtrar arquivos..."
                  className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-[13px] text-[#e6edf3] outline-none placeholder:text-[#7d8590]"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {filteredTreeNodes.length === 0 ? (
                  <div className="px-2 py-2 text-[13px] text-[#7d8590]">
                    Nenhum arquivo encontrado.
                  </div>
                ) : (
                  <FileTree
                    nodes={filteredTreeNodes}
                    expandedDirectories={expandedDirectories}
                    expandedFiles={expandedFiles}
                    onToggleDirectory={(dirPath) =>
                      setExpandedDirectories((current) =>
                        current.includes(dirPath)
                          ? current.filter((path) => path !== dirPath)
                          : [...current, dirPath]
                      )
                    }
                    onSelectFile={(filePath) => {
                      setExpandedFiles([filePath])
                      setTreeOpen(false)
                    }}
                  />
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-24">
        <div className="space-y-3">
          {displayedFiles.map((file) => {
            const isOpenFile = expandedFiles.includes(file.path)
            const blocks = parsedPatches[file.path] || []
            const hasStagedVersion = Boolean(
              file.staged_status && file.staged_status !== ' '
            )

            return (
              <section key={file.path} className="rounded-xl">
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-1',
                    isOpenFile && 'rounded-b-none border-b-0'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleFile(file.path)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="truncate font-medium text-[#f0f6fc]">
                          {file.path}
                        </span>
                        <span className="font-medium text-[#3fb950]">
                          +{file.insertions || 0}
                        </span>
                        <span className="font-medium text-[#f85149]">
                          -{file.deletions || 0}
                        </span>
                        <span className="text-[#8b949e]">
                          {fileStatusLabel(file)}
                        </span>
                        {file.patch_truncated ? (
                          <span className="text-[#8b949e]">
                            preview truncado
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>

                  <div
                    className="relative flex items-center gap-1"
                    data-diff-menu-root="true"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setMenuFilePath((current) =>
                          current === file.path ? null : file.path
                        )
                      }
                      className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                      title="Acoes do arquivo"
                    >
                      <Ellipsis className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleFile(file.path)}
                      className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                      title={isOpenFile ? 'Fechar arquivo' : 'Abrir arquivo'}
                    >
                      {isOpenFile ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>

                    {menuFilePath === file.path ? (
                      <div className="absolute right-0 top-9 z-20 flex w-52 flex-col overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] p-1 shadow-[0_14px_34px_rgba(0,0,0,0.48)]">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuFilePath(null)
                            void onOpenInEditor(file.path)
                          }}
                          className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                        >
                          <ExternalLink className="h-4 w-4 text-[#8b949e]" />
                          Abrir no editor
                        </button>
                        {hasStagedVersion ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFilePath(null)
                              void onUnstageFiles([file.path])
                            }}
                            className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                          >
                            <SquareMinus className="h-4 w-4 text-[#8b949e]" />
                            Desmarcar para commit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setMenuFilePath(null)
                            void onRevertFiles([file.path])
                          }}
                          className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                        >
                          <RotateCcw className="h-4 w-4 text-[#8b949e]" />
                          Reverter arquivo
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {isOpenFile ? (
                  <div className="overflow-hidden rounded-b-xl border border-t-0 border-[#30363d] bg-[#0d1117]">
                    {blocks.map((block, blockIndex) => {
                      if (block.kind === 'empty') {
                        return (
                          <div
                            key={`empty-${file.path}-${blockIndex}`}
                            className="px-4 py-8 text-sm text-[#8b949e]"
                          >
                            {block.content}
                          </div>
                        )
                      }

                      if (block.kind === 'gap') {
                        return (
                          <div
                            key={`gap-${file.path}-${blockIndex}`}
                            className="flex items-center gap-2 border-y border-[#30363d] bg-[#30363d] px-3 py-2 text-[12px] text-[#c9d1d9]"
                          >
                            <ChevronDown className="h-3.5 w-3.5 text-[#8b949e]" />
                            <span>{block.count} unmodified lines</span>
                          </div>
                        )
                      }

                      return (
                        <section
                          key={`hunk-${file.path}-${blockIndex}`}
                          className="border-b border-[#21262d] last:border-b-0"
                        >
                          <div className="border-b border-[#1b2a41] bg-[#0f2747] px-4 py-2 font-mono text-[12px] text-[#58a6ff]">
                            {block.header}
                          </div>

                          <div className="overflow-x-auto">
                            <div className="min-w-[960px] font-mono text-[12px] leading-6">
                              {block.rows.map((row, rowIndex) => {
                                const displayLine = getSingleLineNumber(row)

                                return (
                                  <div
                                    key={`row-${file.path}-${blockIndex}-${rowIndex}`}
                                    className={cn(
                                      'grid grid-cols-[3px_56px_minmax(0,1fr)] border-b border-[#161b22] last:border-b-0',
                                      row.rowType === 'add' && 'bg-[#12261b]',
                                      row.rowType === 'remove' &&
                                        'bg-[#2a1418]',
                                      row.rowType === 'context' &&
                                        'bg-[#0d1117]'
                                    )}
                                  >
                                    <div
                                      className={cn(
                                        row.rowType === 'add' && 'bg-[#2ea043]',
                                        row.rowType === 'remove' &&
                                          'bg-[#f85149]',
                                        row.rowType === 'context' &&
                                          'bg-transparent'
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
                            </div>
                          </div>
                        </section>
                      )
                    })}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
        <button
          type="button"
          onClick={handleBulkAction}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-[#30363d] bg-[#21262d] px-5 py-2 text-[13px] text-[#c9d1d9] shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-colors hover:bg-[#2b3138]"
        >
          <RotateCcw className="h-3.5 w-3.5 text-[#8b949e]" />
          <span>{bottomActionLabel}</span>
        </button>
      </div>
    </aside>
  )
}

interface FileTreeProps {
  nodes: FileTreeNode[]
  expandedDirectories: string[]
  expandedFiles: string[]
  onToggleDirectory: (path: string) => void
  onSelectFile: (path: string) => void
  depth?: number
}

function FileTree(props: FileTreeProps) {
  const {
    nodes,
    expandedDirectories,
    expandedFiles,
    onToggleDirectory,
    onSelectFile,
    depth = 0
  } = props

  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const isDirectory = node.kind === 'directory'
        const isExpanded = expandedDirectories.includes(node.path)

        if (isDirectory) {
          return (
            <div key={node.path}>
              <button
                type="button"
                onClick={() => onToggleDirectory(node.path)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[#c9d1d9] transition-colors hover:bg-[#21262d]"
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />
                )}
                <span className="truncate font-medium">{node.name}</span>
              </button>

              {isExpanded && node.children?.length ? (
                <FileTree
                  nodes={node.children}
                  expandedDirectories={expandedDirectories}
                  expandedFiles={expandedFiles}
                  onToggleDirectory={onToggleDirectory}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
                />
              ) : null}
            </div>
          )
        }

        const isActive = expandedFiles.includes(node.path)
        return (
          <button
            key={node.path}
            type="button"
            onClick={() => onSelectFile(node.path)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[#c9d1d9] transition-colors hover:bg-[#21262d]',
              isActive && 'bg-[#21262d] text-[#f0f6fc]'
            )}
            style={{ paddingLeft: `${depth * 14 + 28}px` }}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />
            <span className="truncate">{node.name}</span>
          </button>
        )
      })}
    </div>
  )
}
