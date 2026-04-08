"use client"

import { useEffect, useState } from "react"
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  X
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { FileChange } from "./message"

type CommitAction = "commit" | "commit-push" | "commit-pr"

interface CommitModalProps {
  isOpen: boolean
  onClose: () => void
  fileChanges: FileChange[]
  additions: number
  deletions: number
  branch: string
  branches: string[]
  onBranchChange: (branch: string) => void
  onCommit: (payload: {
    message?: string
    includeUnstaged: boolean
    action: CommitAction
    isDraft: boolean
  }) => void | Promise<void>
}

const actions: Array<{
  id: CommitAction
  label: string
  description?: string
  icon: typeof GitCommitHorizontal
}> = [
  { id: "commit", label: "Commit", icon: GitCommitHorizontal },
  { id: "commit-push", label: "Fazer commit e efetuar push", icon: ArrowUp },
  {
    id: "commit-pr",
    label: "Fazer commit e criar PR",
    description: "Exige o GitHub CLI",
    icon: GitPullRequest
  }
]

export function CommitModal({
  isOpen,
  onClose,
  fileChanges,
  additions,
  deletions,
  branch,
  branches,
  onBranchChange,
  onCommit
}: CommitModalProps) {
  const [message, setMessage] = useState("")
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [selectedAction, setSelectedAction] = useState<CommitAction>("commit")
  const [isDraft, setIsDraft] = useState(false)
  const [showBranchMenu, setShowBranchMenu] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    setMessage("")
    setIncludeUnstaged(true)
    setSelectedAction("commit")
    setIsDraft(false)
    setShowBranchMenu(false)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="w-full max-w-[640px] overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-[#30363d] px-5 py-4">
          <div>
            <div className="text-base font-semibold text-[#f0f6fc]">
              Fazer commit das suas alterações
            </div>
            <div className="mt-1 text-sm text-[#7d8590]">
              Revise a branch, a mensagem e o próximo passo antes de concluir.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#7d8590] transition-colors hover:text-[#f0f6fc]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="grid gap-4 md:grid-cols-[1fr,auto]">
            <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                Alterações
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm text-[#c9d1d9]">
                <span>{fileChanges.length} arquivos</span>
                <span className="font-medium text-[#3fb950]">+{additions}</span>
                <span className="font-medium text-[#f85149]">-{deletions}</span>
              </div>
            </div>

            <div className="relative rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                Branch
              </div>
              <button
                type="button"
                onClick={() => setShowBranchMenu((current) => !current)}
                className="mt-2 inline-flex items-center gap-2 text-sm text-[#f0f6fc]"
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span>{branch}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#7d8590]" />
              </button>

              {showBranchMenu ? (
                <div className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                  <div className="max-h-64 overflow-y-auto p-1.5">
                    {branches.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setShowBranchMenu(false)
                          onBranchChange(item)
                        }}
                        className={cn(
                          "block w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
                          item === branch
                            ? "bg-[#0f1a2b] text-[#58a6ff]"
                            : "text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#f0f6fc]"
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <label className="flex items-center gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-3">
            <button
              type="button"
              onClick={() => setIncludeUnstaged((current) => !current)}
              className={cn(
                "flex h-5 w-9 items-center rounded-full px-0.5 transition-colors",
                includeUnstaged
                  ? "justify-end bg-[#1f6feb]"
                  : "justify-start bg-[#30363d]"
              )}
            >
              <span className="h-4 w-4 rounded-full bg-white" />
            </button>
            <div>
              <div className="text-sm text-[#f0f6fc]">Incluir não marcados para commit</div>
              <div className="text-xs text-[#7d8590]">
                Inclui arquivos não staged no commit final.
              </div>
            </div>
          </label>

          <label className="block">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
                Mensagem do commit
              </span>
              <span className="text-xs text-[#7d8590]">
                Deixe vazio para gerar automaticamente
              </span>
            </div>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="feat: ajusta a shell web do openclaude"
              className="h-28 w-full resize-none rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm text-[#e6edf3] outline-none placeholder:text-[#7d8590] focus:border-[#1f6feb]"
            />
          </label>

          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-[#7d8590]">
              Próximos passos
            </div>
            <div className="space-y-2">
              {actions.map((action) => {
                const ActionIcon = action.icon
                const isActive = selectedAction === action.id

                return (
                  <label
                    key={action.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
                      isActive
                        ? "border-[#1f6feb] bg-[#0f1a2b]"
                        : "border-[#30363d] bg-[#0d1117] hover:bg-[#11161d]"
                    )}
                  >
                    <input
                      type="radio"
                      name="commit-action"
                      checked={isActive}
                      onChange={() => setSelectedAction(action.id)}
                      className="sr-only"
                    />
                    <div
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-full border",
                        isActive
                          ? "border-[#58a6ff] text-[#58a6ff]"
                          : "border-[#7d8590] text-transparent"
                      )}
                    >
                      {isActive ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                    </div>
                    <ActionIcon className="h-4 w-4 text-[#7d8590]" />
                    <div>
                      <div className="text-sm text-[#f0f6fc]">{action.label}</div>
                      {action.description ? (
                        <div className="text-xs text-[#7d8590]">{action.description}</div>
                      ) : null}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#30363d] px-5 py-4">
          <label className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsDraft((current) => !current)}
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full border",
                isDraft
                  ? "border-[#58a6ff] bg-[#1f6feb] text-white"
                  : "border-[#7d8590] text-transparent"
              )}
            >
              {isDraft ? <CheckCircle2 className="h-3 w-3" /> : null}
            </button>
            <div>
              <div className="text-sm text-[#f0f6fc]">Draft</div>
              <div className="text-xs text-[#7d8590]">
                Marca o PR como rascunho quando essa opção existir.
              </div>
            </div>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#30363d] bg-[#161b22] px-4 py-2 text-sm text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                void onCommit({
                  message: message.trim() || undefined,
                  includeUnstaged,
                  action: selectedAction,
                  isDraft
                })
              }}
              className="rounded-md border border-[#2f6f3e] bg-[#238636] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2ea043]"
            >
              Continuar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
