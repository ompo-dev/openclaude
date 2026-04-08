'use client'

import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  SquareTerminal,
  X
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface HeaderProps {
  title: string
  projectName: string
  filesChanged: number
  additions: number
  deletions: number
  branch: string
  branches: string[]
  isBranchLoading?: boolean
  isTerminalOpen?: boolean
  isReviewOpen?: boolean
  openExternalLabel?: string
  onBranchChange: (branchName: string) => void | Promise<void>
  onCreateBranch: (branchName: string) => void | Promise<void>
  onCommitClick: () => void
  onReviewClick: () => void
  onTerminalToggle: () => void
  onOpenExternal?: () => void
  onRefresh?: () => void
}

const controlClass =
  'inline-flex h-8 items-center gap-2 rounded-md border border-[#30363d] bg-[#161b22] px-3 text-xs font-medium text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-45'

const iconControlClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22] text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-45'

export function Header({
  title,
  projectName,
  filesChanged,
  additions,
  deletions,
  branch,
  branches,
  isBranchLoading = false,
  isTerminalOpen = false,
  isReviewOpen = false,
  openExternalLabel = 'Abrir',
  onBranchChange,
  onCreateBranch,
  onCommitClick,
  onReviewClick,
  onTerminalToggle,
  onOpenExternal,
  onRefresh
}: HeaderProps) {
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [isCreatePending, setIsCreatePending] = useState(false)

  const uniqueBranches = useMemo(
    () => Array.from(new Set(branches.filter(Boolean))),
    [branches]
  )

  const handleSelectBranch = async (nextBranch: string) => {
    setShowBranchMenu(false)
    if (!nextBranch || nextBranch === branch) return
    await onBranchChange(nextBranch)
  }

  const handleCreateBranch = async () => {
    const normalized = newBranchName.trim()
    if (!normalized) return

    setIsCreatePending(true)
    try {
      await onCreateBranch(normalized)
      setNewBranchName('')
      setCreateBranchOpen(false)
    } finally {
      setIsCreatePending(false)
    }
  }

  return (
    <>
      <header className="shrink-0 border-b border-[#30363d] bg-[#0d1117] px-3 py-2.5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-end gap-2">
              <h1 className="max-w-[300px] truncate text-[20px] font-semibold tracking-[-0.02em] text-[#f0f6fc]">
                {title}
              </h1>
              <span className="truncate text-sm text-[#7d8590]">
                {projectName} • {branch}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpenExternal}
              disabled={!onOpenExternal}
              className={controlClass}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              <span>{openExternalLabel}</span>
            </button>

            <button
              type="button"
              onClick={onTerminalToggle}
              className={cn(
                iconControlClass,
                isTerminalOpen && 'bg-[#21262d] text-[#f0f6fc]'
              )}
              title="Terminal"
            >
              <SquareTerminal className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={onReviewClick}
              className={cn(
                controlClass,
                isReviewOpen && 'bg-[#21262d] text-[#f0f6fc]'
              )}
              title="Arquivos alterados"
            >
              <FileCode2 className="h-3.5 w-3.5" />
              <span className="font-semibold text-[#3fb950]">+{additions}</span>
              <span className="font-semibold text-[#f85149]">-{deletions}</span>
              <span className="text-[#7d8590]">{filesChanged}</span>
            </button>

            <button
              type="button"
              onClick={onCommitClick}
              className={controlClass}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              <span>Commit</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#7d8590]" />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowBranchMenu((current) => !current)}
                disabled={isBranchLoading}
                className={controlClass}
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span>{branch}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#7d8590]" />
              </button>

              {showBranchMenu ? (
                <div className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                  <div className="border-b border-[#30363d] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                    Branches
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1.5">
                    {uniqueBranches.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          void handleSelectBranch(item)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors',
                          item === branch
                            ? 'bg-[#0f1a2b] text-[#58a6ff]'
                            : 'text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#f0f6fc]'
                        )}
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                        <span className="truncate">{item}</span>
                      </button>
                    ))}
                    <div className="my-1 h-px bg-[#30363d]" />
                    <button
                      type="button"
                      onClick={() => {
                        setShowBranchMenu(false)
                        setCreateBranchOpen(true)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      <span>Nova branch</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onRefresh}
              disabled={!onRefresh}
              className={iconControlClass}
              title="Atualizar"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {createBranchOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-[#f0f6fc]">
                  Criar branch
                </div>
                <div className="text-xs text-[#7d8590]">
                  A nova branch sera criada a partir de {branch}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateBranchOpen(false)}
                className="text-[#7d8590] transition-colors hover:text-[#f0f6fc]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <label className="block">
                <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                  Nome da branch
                </div>
                <input
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleCreateBranch()
                    }
                  }}
                  placeholder="feature/web-shell"
                  className="h-10 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 text-sm text-[#e6edf3] outline-none placeholder:text-[#7d8590] focus:border-[#1f6feb]"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#30363d] px-4 py-3">
              <button
                type="button"
                onClick={() => setCreateBranchOpen(false)}
                className="rounded-md border border-[#30363d] bg-[#161b22] px-4 py-2 text-sm text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCreateBranch()
                }}
                disabled={isCreatePending || !newBranchName.trim()}
                className="rounded-md border border-[#2f6f3e] bg-[#238636] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-45"
              >
                Criar branch
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
