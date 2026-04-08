'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  SquareTerminal,
  Upload,
  X
} from 'lucide-react'
import { useQueryState } from 'nuqs'
import { toast } from 'sonner'

import {
  commitGitChangesAPI,
  getGitOverviewAPI,
  getOpenWithTargetsAPI,
  launchOpenWithTargetAPI
} from '@/api/integration'
import useWorkspaceData from '@/hooks/useWorkspaceData'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import {
  GitCommitPayload,
  GitOverview,
  OpenWithTarget
} from '@/types/integration'

const COMMIT_ACTIONS: Array<{
  id: GitCommitPayload['action']
  label: string
  description?: string
  icon: typeof GitCommitHorizontal
}> = [
  {
    id: 'commit',
    label: 'Commit',
    icon: GitCommitHorizontal
  },
  {
    id: 'commit_and_push',
    label: 'Fazer commit e efetuar push',
    icon: Upload
  },
  {
    id: 'commit_and_create_pr',
    label: 'Fazer commit e criar PR',
    description: 'Exige o GitHub CLI (command)',
    icon: Github
  }
]

interface ChatHeaderProps {
  isTerminalOpen: boolean
  onToggleTerminal: () => void
  isChangesOpen: boolean
  onToggleChanges: () => void
}

const pillButtonClass =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-[#34343a] bg-[#17171a] px-3 text-[12px] font-medium text-[#f5f5f6] transition-colors hover:bg-[#1f1f24] hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

const iconButtonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#34343a] bg-[#17171a] text-[#c7c7cf] transition-colors hover:bg-[#1f1f24] hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

const ChatHeader = ({
  isTerminalOpen,
  onToggleTerminal,
  isChangesOpen,
  onToggleChanges
}: ChatHeaderProps) => {
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const workspaceContext = useStore((state) => state.workspaceContext)
  const sessionsData = useStore((state) => state.sessionsData)
  const topics = useStore((state) => state.topics)
  const selectedTopicId = useStore((state) => state.selectedTopicId)
  const branches = useStore((state) => state.branches)
  const isBranchesLoading = useStore((state) => state.isBranchesLoading)
  const setWorkspaceContext = useStore((state) => state.setWorkspaceContext)
  const setTopics = useStore((state) => state.setTopics)
  const setBranches = useStore((state) => state.setBranches)
  const setSelectedTopicId = useStore((state) => state.setSelectedTopicId)
  const [sessionId] = useQueryState('session')
  const [gitOverview, setGitOverview] = useState<GitOverview | null>(null)
  const [openWithTargets, setOpenWithTargets] = useState<OpenWithTarget[]>([])
  const [isCommitOpen, setIsCommitOpen] = useState(false)
  const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false)
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [showCommitBranchMenu, setShowCommitBranchMenu] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [commitAction, setCommitAction] =
    useState<GitCommitPayload['action']>('commit')
  const [isDraftPr, setIsDraftPr] = useState(false)
  const [isLaunchingExternal, setIsLaunchingExternal] = useState(false)
  const [isCommitPending, setIsCommitPending] = useState(false)
  const [isBranchPending, setIsBranchPending] = useState(false)
  const { createBranch, refreshBranches, refreshWorkspaceContext, switchBranch } =
    useWorkspaceData()

  const currentSession = useMemo(
    () =>
      (sessionsData ?? []).find((entry) => entry.session_id === sessionId) ?? null,
    [sessionId, sessionsData]
  )

  const activeTopic = useMemo(() => {
    if (selectedTopicId) {
      const exactTopic = topics.find((topic) => topic.id === selectedTopicId)
      if (exactTopic) return exactTopic
    }

    const projectRoot = workspaceContext?.project_root
    if (!projectRoot) return null

    return topics.find((topic) => topic.project_root === projectRoot) ?? null
  }, [selectedTopicId, topics, workspaceContext?.project_root])

  const preferredOpenWithTarget = useMemo(() => {
    const preferred = openWithTargets.find(
      (target) => target.installed && target.preferred
    )
    return preferred ?? openWithTargets.find((target) => target.installed) ?? null
  }, [openWithTargets])

  const uniqueBranches = useMemo(() => {
    const seen = new Set<string>()
    return branches.filter((branch) => {
      if (seen.has(branch.name)) return false
      seen.add(branch.name)
      return true
    })
  }, [branches])

  const diffSummary = useMemo(() => {
    const summary = gitOverview?.summary
    return {
      insertions: summary?.total_insertions ?? 0,
      deletions: summary?.total_deletions ?? 0,
      changedFiles: summary?.changed_file_count ?? 0
    }
  }, [gitOverview?.summary])

  useEffect(() => {
    let cancelled = false

    const loadGitOverview = async () => {
      try {
        const response = await getGitOverviewAPI(selectedEndpoint, authToken)
        if (!cancelled) {
          setGitOverview(response)
        }
      } catch (error) {
        if (!cancelled) {
          setGitOverview(null)
          toast.error(
            error instanceof Error
              ? error.message
              : 'Falha ao carregar o status do git'
          )
        }
      }
    }

    void loadGitOverview()
    return () => {
      cancelled = true
    }
  }, [
    authToken,
    selectedEndpoint,
    workspaceContext?.branch,
    workspaceContext?.project_root,
    workspaceContext?.changed_file_count
  ])

  useEffect(() => {
    let cancelled = false

    const loadOpenWithTargets = async () => {
      try {
        const response = await getOpenWithTargetsAPI(selectedEndpoint, authToken)
        if (!cancelled) {
          setOpenWithTargets(response.items)
        }
      } catch (error) {
        if (!cancelled) {
          setOpenWithTargets([])
          toast.error(
            error instanceof Error
              ? error.message
              : 'Falha ao carregar os apps externos'
          )
        }
      }
    }

    void loadOpenWithTargets()
    return () => {
      cancelled = true
    }
  }, [authToken, selectedEndpoint])

  const syncGitState = async () => {
    try {
      const [nextOverview] = await Promise.all([
        getGitOverviewAPI(selectedEndpoint, authToken),
        refreshWorkspaceContext(),
        refreshBranches()
      ])
      setGitOverview(nextOverview)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao atualizar o estado do workspace'
      )
    }
  }

  const handleLaunchPreferredTarget = async () => {
    if (!preferredOpenWithTarget?.installed) {
      toast.error('Nenhum app externo disponivel neste ambiente')
      return
    }

    setIsLaunchingExternal(true)
    try {
      const result = await launchOpenWithTargetAPI(
        selectedEndpoint,
        preferredOpenWithTarget.id,
        authToken
      )
      toast.success(`${result.label} aberto no workspace`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao abrir o app externo'
      )
    } finally {
      setIsLaunchingExternal(false)
    }
  }

  const handleSelectBranch = async (value: string) => {
    setShowBranchMenu(false)

    if (value === '__create_branch__') {
      setIsCreateBranchOpen(true)
      return
    }

    if (!value || value === workspaceContext?.branch) {
      return
    }

    setIsBranchPending(true)
    try {
      const result = await switchBranch(value)
      if (result) {
        toast.success(`Branch trocada para ${value}`)
      }
    } finally {
      setIsBranchPending(false)
    }
  }

  const handleCreateBranch = async () => {
    const normalizedBranchName = branchName.trim()
    if (!normalizedBranchName) {
      toast.error('Nome da branch obrigatorio')
      return
    }

    setIsBranchPending(true)
    try {
      const result = await createBranch({
        branchName: normalizedBranchName,
        startPoint: workspaceContext?.branch || undefined,
        switch: true
      })
      if (result) {
        toast.success(`Branch ${normalizedBranchName} criada`)
        setBranchName('')
        setIsCreateBranchOpen(false)
      }
    } finally {
      setIsBranchPending(false)
    }
  }

  const handleCommit = async () => {
    setIsCommitPending(true)
    try {
      const result = await commitGitChangesAPI(
        selectedEndpoint,
        {
          message: commitMessage.trim() || undefined,
          include_untracked: includeUntracked,
          action: commitAction,
          draft: isDraftPr
        },
        authToken
      )

      setWorkspaceContext(result.workspace)
      setBranches(result.branches.items)
      setTopics(result.topics)
      setGitOverview(result.git)
      if (
        selectedTopicId &&
        result.topics.some((topic) => topic.id === selectedTopicId)
      ) {
        setSelectedTopicId(selectedTopicId)
      } else {
        setSelectedTopicId(result.topic?.id ?? null)
      }

      setCommitMessage('')
      setIsCommitOpen(false)
      toast.success(
        result.pull_request?.url
          ? 'Commit criado e PR aberto'
          : result.push
            ? 'Commit criado e push concluido'
            : 'Commit criado'
      )
      await syncGitState()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao concluir o commit'
      )
    } finally {
      setIsCommitPending(false)
    }
  }

  const sessionTitle = currentSession?.session_name || 'Nova conversa'
  const topicLabel = activeTopic?.repo_name || workspaceContext?.repo_name || 'workspace'

  return (
    <>
      <div className="h-10 shrink-0 border-b border-[#232327] bg-background px-4">
        <div className="flex h-full items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-[#f5f5f7]">
                {sessionTitle}
              </span>
              <span className="truncate text-[13px] text-[#8d8d95]">
                {topicLabel}
              </span>
              <span className="text-[12px] text-[#777780]">...</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-[#8b8b92]">
              <span>{workspaceContext?.repo_name || 'workspace'}</span>
              {workspaceContext?.branch ? <span>•</span> : null}
              {workspaceContext?.branch ? <span>{workspaceContext.branch}</span> : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleLaunchPreferredTarget()}
              disabled={!preferredOpenWithTarget?.installed || isLaunchingExternal}
              className={pillButtonClass}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>{preferredOpenWithTarget?.label || 'Abrir'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleTerminal}
              className={cn(
                iconButtonClass,
                isTerminalOpen && 'bg-[#202026] text-white'
              )}
              title="Terminal"
            >
              <SquareTerminal className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={onToggleChanges}
              className={cn(
                pillButtonClass,
                isChangesOpen && 'bg-[#202026] text-white'
              )}
              title="Arquivos alterados"
            >
              <FileCode2 className="h-3.5 w-3.5" />
              <span className="font-medium text-emerald-400">
                +{diffSummary.insertions}
              </span>
              <span className="font-medium text-rose-400">
                -{diffSummary.deletions}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsCommitOpen(true)}
              disabled={!gitOverview?.actions.can_commit}
              className={pillButtonClass}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              <span>Commit</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#8f8f96]" />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowBranchMenu((current) => !current)}
                disabled={!workspaceContext?.is_git_repo || isBranchesLoading || isBranchPending}
                className={pillButtonClass}
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span>{workspaceContext?.branch || 'Sem branch'}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#8f8f96]" />
              </button>

              {showBranchMenu ? (
                <div className="absolute right-0 top-full z-30 mt-2 min-w-[220px] overflow-hidden rounded-2xl border border-[#2d2d33] bg-[#151518] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
                  {uniqueBranches.map((branch) => (
                    <button
                      key={branch.name}
                      type="button"
                      onClick={() => {
                        void handleSelectBranch(branch.name)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors',
                        branch.name === workspaceContext?.branch
                          ? 'bg-white/6 text-white'
                          : 'text-[#cfcfd5] hover:bg-white/6 hover:text-white'
                      )}
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{branch.short_name}</div>
                        <div className="text-[10px] uppercase text-[#8f8f96]">
                          {branch.kind}
                          {branch.current ? ' | atual' : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                  <div className="my-1 h-px bg-white/8" />
                  <button
                    type="button"
                    onClick={() => {
                      void handleSelectBranch('__create_branch__')
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-[#cfcfd5] transition-colors hover:bg-white/6 hover:text-white"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    <span>Nova branch</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {isCommitOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setIsCommitOpen(false)}
          />

          <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-[#2d2d33] bg-[#17171a] text-[#f4f4f6] shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#1f1f22]">
                  <GitCommitHorizontal className="h-4 w-4 text-[#c8c8d0]" />
                </div>
                <span className="text-[15px] font-semibold">
                  Fazer commit das suas alteracoes
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsCommitOpen(false)}
                className="text-[#8f8f96] transition-colors hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-5 pb-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8f8f96]">Branch</span>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowCommitBranchMenu((current) => !current)}
                    className="flex items-center gap-1 text-xs text-white"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    <span>{workspaceContext?.branch || 'sem branch'}</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>

                  {showCommitBranchMenu ? (
                    <div className="absolute right-0 top-full z-30 mt-2 min-w-[200px] overflow-hidden rounded-2xl border border-[#2d2d33] bg-[#151518] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
                      {uniqueBranches.map((branch) => (
                        <button
                          key={branch.name}
                          type="button"
                          onClick={() => {
                            setShowCommitBranchMenu(false)
                            void handleSelectBranch(branch.name)
                          }}
                          className={cn(
                            'block w-full rounded-xl px-3 py-2 text-left text-xs transition-colors',
                            branch.name === workspaceContext?.branch
                              ? 'bg-white/6 text-white'
                              : 'text-[#cfcfd5] hover:bg-white/6 hover:text-white'
                          )}
                        >
                          {branch.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8f8f96]">Alteracoes</span>
                <div className="flex items-center gap-2 text-xs">
                  <span>{diffSummary.changedFiles} arquivos</span>
                  <span className="text-emerald-400">+{diffSummary.insertions}</span>
                  <span className="text-rose-400">-{diffSummary.deletions}</span>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIncludeUntracked((current) => !current)}
                  className={cn(
                    'flex h-5 w-9 items-center rounded-full px-0.5 transition-colors',
                    includeUntracked
                      ? 'justify-end bg-[#2e8cff]'
                      : 'justify-start bg-[#3a3a42]'
                  )}
                >
                  <span className="h-4 w-4 rounded-full bg-white" />
                </button>
                <span className="text-xs text-[#b5b5bc]">
                  Incluir nao marcados para commit
                </span>
              </label>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-[#8f8f96]">Mensagem do commit</span>
                  <span className="text-xs text-[#8f8f96]">Custom instructions</span>
                </div>
                <textarea
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Deixe em branco para gerar uma mensagem automaticamente"
                  className="h-24 w-full resize-none rounded-2xl border border-[#2d2d33] bg-[#111113] p-3 text-sm text-white placeholder:text-[#6f6f78] focus:outline-none"
                />
              </div>

              <div>
                <span className="mb-2 block text-xs text-[#8f8f96]">
                  Proximos passos
                </span>
                <div className="space-y-1">
                  {COMMIT_ACTIONS.map((option) => {
                    const ActionIcon = option.icon
                    const isActive = commitAction === option.id
                    const isDisabled = option.id === 'commit_and_create_pr'

                    return (
                      <label
                        key={option.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 transition-colors',
                          isDisabled
                            ? 'opacity-50'
                            : 'hover:bg-white/4',
                          isActive && 'bg-white/4'
                        )}
                      >
                        <input
                          type="radio"
                          name="commit-action"
                          checked={isActive}
                          onChange={() => setCommitAction(option.id)}
                          className="sr-only"
                        />
                        <div
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded-full border',
                            isActive
                              ? 'border-[#2e8cff] text-[#2e8cff]'
                              : 'border-[#5a5a64] text-transparent'
                          )}
                        >
                          {isActive ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                        </div>
                        <ActionIcon className="h-4 w-4 text-[#8f8f96]" />
                        <div>
                          <div className="text-sm text-white">{option.label}</div>
                          {option.description ? (
                            <div className="text-xs text-[#8f8f96]">
                              {option.description}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex cursor-pointer items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsDraftPr((current) => !current)}
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      isDraftPr
                        ? 'border-[#2e8cff] bg-[#2e8cff] text-white'
                        : 'border-[#5a5a64] text-transparent'
                    )}
                  >
                    {isDraftPr ? <CheckCircle2 className="h-3 w-3" /> : null}
                  </button>
                  <span className="text-xs text-[#b5b5bc]">Draft</span>
                </label>

                <button
                  type="button"
                  onClick={() => void handleCommit()}
                  disabled={!gitOverview?.actions.can_commit || isCommitPending}
                  className="rounded-full bg-[#f3f4f6] px-4 py-1.5 text-sm font-medium text-[#111113] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateBranchOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setIsCreateBranchOpen(false)}
          />

          <div className="relative w-full max-w-sm rounded-[24px] border border-[#2d2d33] bg-[#17171a] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
            <div className="mb-3 text-[15px] font-semibold text-white">
              Criar branch
            </div>
            <div className="mb-2 text-xs text-[#8f8f96]">
              Nome da branch
            </div>
            <input
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreateBranch()
                }
              }}
              placeholder="feature/web-chat"
              className="h-11 w-full rounded-2xl border border-[#2d2d33] bg-[#111113] px-4 text-sm text-white placeholder:text-[#6f6f78] focus:outline-none"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateBranchOpen(false)}
                className="rounded-full border border-[#34343a] bg-[#17171a] px-4 py-1.5 text-sm text-[#d8d8de] transition hover:bg-[#1f1f24]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleCreateBranch()}
                disabled={isBranchPending}
                className="rounded-full bg-[#f3f4f6] px-4 py-1.5 text-sm font-medium text-[#111113] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Criar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default ChatHeader
