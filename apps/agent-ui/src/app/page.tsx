'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryState } from 'nuqs'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

import ChatSessionSync from '@/components/chat/ChatSessionSync'
import { CommitModal } from '@/components/codex/commit-modal'
import { DiffViewer } from '@/components/codex/diff-viewer'
import { Header } from '@/components/codex/header'
import { Input } from '@/components/codex/input'
import { Message, type FileChange, type Message as CodexMessage } from '@/components/codex/message'
import { Sidebar } from '@/components/codex/sidebar'
import { Terminal } from '@/components/codex/terminal'
import { ThemeProvider } from '@/components/codex/theme-provider'
import SettingsView from '@/components/workspace/SettingsView'
import {
  completeTerminalCommandAPI,
  commitGitChangesAPI,
  getGitOverviewAPI,
  getIntegrationConfigAPI,
  getOpenWithTargetsAPI,
  getTerminalSnapshotAPI,
  launchOpenWithTargetAPI,
  openFileInEditorAPI,
  pickWorkspaceFolderAPI,
  revertGitFilesAPI,
  resizeTerminalAPI,
  runTerminalCommandAPI,
  sendTerminalInputAPI,
  unstageGitFilesAPI
} from '@/api/integration'
import useAIChatStreamHandler from '@/hooks/useAIStreamHandler'
import useChatActions from '@/hooks/useChatActions'
import useSessionLoader from '@/hooks/useSessionLoader'
import useWorkspaceData from '@/hooks/useWorkspaceData'
import { useStore } from '@/store'
import type {
  GitOverview,
  IntegrationSnapshot,
  OpenWithTarget,
  TerminalSnapshot,
  WorkspaceChangedFile
} from '@/types/integration'

function formatRelativeAge(createdAt?: number) {
  if (!createdAt) return ''

  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - createdAt)
  const deltaMinutes = Math.floor(deltaSeconds / 60)
  const deltaHours = Math.floor(deltaMinutes / 60)
  const deltaDays = Math.floor(deltaHours / 24)

  if (deltaDays >= 1) return `${deltaDays} d`
  if (deltaHours >= 1) return `${deltaHours} h`
  if (deltaMinutes >= 1) return `${deltaMinutes} m`
  return 'now'
}

function mapChangedFileAction(kind: string): FileChange['action'] {
  const normalized = kind.toLowerCase()
  if (
    normalized.includes('add') ||
    normalized.includes('new') ||
    normalized === 'a' ||
    normalized === '??'
  ) {
    return 'created'
  }
  if (normalized.includes('delete') || normalized === 'd') {
    return 'deleted'
  }
  return 'modified'
}

function mapWorkspaceFilesToChanges(files: WorkspaceChangedFile[]): FileChange[] {
  return files.map((file) => ({
    filename: file.path,
    action: mapChangedFileAction(file.kind),
    additions: file.insertions ?? 0,
    deletions: file.deletions ?? 0,
    patch: file.patch_preview ?? undefined
  }))
}

function AppBootstrapSync() {
  const searchParams = useSearchParams()
  const workspacePath = searchParams.get('workspace')
  const endpointFromQuery = searchParams.get('endpoint')
  const hydrated = useStore((state) => state.hydrated)
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const setSelectedEndpoint = useStore((state) => state.setSelectedEndpoint)
  const syncedWorkspaceRef = useRef<string | null>(null)
  const initializedEndpointRef = useRef<string | null>(null)
  const syncedEndpointRef = useRef<string | null>(null)
  const [sessionId, setSessionId] = useQueryState('session')
  const { initialize } = useChatActions()
  const { syncWorkspaceTarget } = useWorkspaceData()
  const expectedEndpoint =
    endpointFromQuery ||
    process.env.NEXT_PUBLIC_AGENT_OS_ENDPOINT ||
    'http://localhost:7777'

  useEffect(() => {
    if (!hydrated) return
    if (syncedEndpointRef.current === expectedEndpoint) return

    syncedEndpointRef.current = expectedEndpoint
    if (selectedEndpoint !== expectedEndpoint) {
      setSelectedEndpoint(expectedEndpoint)
    }
  }, [expectedEndpoint, hydrated, selectedEndpoint, setSelectedEndpoint])

  useEffect(() => {
    if (!hydrated || !selectedEndpoint) return
    if (selectedEndpoint !== expectedEndpoint) return
    if (initializedEndpointRef.current === selectedEndpoint) return

    initializedEndpointRef.current = selectedEndpoint
    void initialize()
  }, [expectedEndpoint, hydrated, initialize, selectedEndpoint])

  useEffect(() => {
    if (!hydrated) return
    if (!workspacePath || syncedWorkspaceRef.current === workspacePath) return

    syncedWorkspaceRef.current = workspacePath
    void syncWorkspaceTarget(workspacePath).then((response) => {
      const suggestedSessionId = response?.topic?.session_ids?.[0]
      if (!sessionId && suggestedSessionId) {
        void setSessionId(suggestedSessionId)
      }
    })
  }, [hydrated, sessionId, setSessionId, syncWorkspaceTarget, workspacePath])

  return null
}

function CodexApp() {
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const mode = useStore((state) => state.mode)
  const messages = useStore((state) => state.messages)
  const isLoading = useStore((state) => state.isStreaming)
  const sessionsData = useStore((state) => state.sessionsData)
  const topics = useStore((state) => state.topics)
  const workspaceContext = useStore((state) => state.workspaceContext)
  const selectedTopicId = useStore((state) => state.selectedTopicId)
  const setSelectedTopicId = useStore((state) => state.setSelectedTopicId)
  const primeChatInput = useStore((state) => state.primeChatInput)
  const branches = useStore((state) => state.branches)
  const isBranchesLoading = useStore((state) => state.isBranchesLoading)
  const workspaceView = useStore((state) => state.workspaceView)
  const setWorkspaceView = useStore((state) => state.setWorkspaceView)
  const [agentId] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const [dbId] = useQueryState('db_id')
  const [sessionId, setSessionId] = useQueryState('session')
  const { clearChat, focusChatInput, initialize } = useChatActions()
  const { handleStreamResponse } = useAIChatStreamHandler()
  const { getSession } = useSessionLoader()
  const {
    createBranch,
    switchBranch,
    syncWorkspaceTarget,
    refreshWorkspaceContext,
    refreshBranches,
    refreshTopics
  } = useWorkspaceData()

  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalMinimized, setTerminalMinimized] = useState(false)
  const [commitModalOpen, setCommitModalOpen] = useState(false)
  const [diffViewerOpen, setDiffViewerOpen] = useState(false)
  const [gitOverview, setGitOverview] = useState<GitOverview | null>(null)
  const [terminalSnapshot, setTerminalSnapshot] = useState<TerminalSnapshot | null>(null)
  const [integrationSnapshot, setIntegrationSnapshot] =
    useState<IntegrationSnapshot | null>(null)
  const [openWithTargets, setOpenWithTargets] = useState<OpenWithTarget[]>([])
  const [terminalPollUntil, setTerminalPollUntil] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const terminalLastSignatureRef = useRef<string>('')
  const terminalStablePollsRef = useRef(0)
  const terminalLastResizeRef = useRef<string>('')

  const extendTerminalPolling = useCallback((durationMs: number) => {
    const target = Date.now() + durationMs
    setTerminalPollUntil((current) => (current > target ? current : target))
  }, [])

  const currentTopic = useMemo(() => {
    if (selectedTopicId) {
      const exact = topics.find((topic) => topic.id === selectedTopicId)
      if (exact) return exact
    }

    const currentProjectRoot = workspaceContext?.project_root
    return topics.find((topic) => topic.project_root === currentProjectRoot) ?? null
  }, [selectedTopicId, topics, workspaceContext?.project_root])

  const currentSession = useMemo(
    () => (sessionsData ?? []).find((session) => session.session_id === sessionId) ?? null,
    [sessionId, sessionsData]
  )

  const currentProjectId = useMemo(() => {
    if (selectedTopicId && topics.some((topic) => topic.id === selectedTopicId)) {
      return selectedTopicId
    }

    return (
      topics.find((topic) => topic.project_root === workspaceContext?.project_root)?.id ??
      null
    )
  }, [selectedTopicId, topics, workspaceContext?.project_root])

  useEffect(() => {
    if (!topics.length) return

    const nextExpanded = topics
      .filter(
        (topic) =>
          topic.id === selectedTopicId ||
          topic.project_root === workspaceContext?.project_root
      )
      .map((topic) => topic.id)

    if (nextExpanded.length === 0) return

    setExpandedProjectIds((current) => {
      const merged = new Set(current)
      nextExpanded.forEach((id) => merged.add(id))
      return [...merged]
    })
  }, [selectedTopicId, topics, workspaceContext?.project_root])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const loadRuntimeData = useCallback(async () => {
    try {
      const [git, terminal, integration, openWith] = await Promise.all([
        getGitOverviewAPI(selectedEndpoint, authToken),
        getTerminalSnapshotAPI(selectedEndpoint, authToken),
        getIntegrationConfigAPI(selectedEndpoint, authToken),
        getOpenWithTargetsAPI(selectedEndpoint, authToken)
      ])

      setGitOverview(git)
      setTerminalSnapshot(terminal)
      setIntegrationSnapshot(integration)
      setOpenWithTargets(openWith.items)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao carregar o workspace web'
      )
    }
  }, [authToken, selectedEndpoint])

  useEffect(() => {
    void loadRuntimeData()
  }, [
    loadRuntimeData,
    workspaceContext?.branch,
    workspaceContext?.changed_file_count,
    workspaceContext?.project_root
  ])

  const projects = useMemo(() => {
    const entries = sessionsData ?? []

    return topics.map((topic) => ({
      id: topic.id,
      name: topic.repo_name || topic.name,
      projectRoot: topic.project_root,
      isExpanded: expandedProjectIds.includes(topic.id),
      topics: entries
        .filter((entry) => topic.session_ids.includes(entry.session_id))
        .map((entry) => ({
          id: entry.session_id,
          title: entry.session_name,
          updatedAt: formatRelativeAge(entry.updated_at ?? entry.created_at)
        }))
      }))
  }, [expandedProjectIds, sessionsData, topics])

  const visibleMessages = useMemo(() => {
    if (!isLoading) return messages
    if (messages.length === 0) return messages

    const last = messages[messages.length - 1]
    if (last.role === 'agent' && !last.content) {
      return messages.slice(0, -1)
    }
    return messages
  }, [isLoading, messages])

  const codexMessages = useMemo<CodexMessage[]>(
    () =>
      visibleMessages.map((message, index) => ({
        id: `${message.role}-${message.created_at}-${index}`,
        role: message.role === 'user' ? 'user' : 'assistant',
        content:
          message.content ||
          message.response_audio?.transcript ||
          (message.streamingError ? 'Oops! Something went wrong while streaming.' : ''),
        timestamp: new Date(message.created_at * 1000).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        fileChanges: message.workspace_snapshot?.changed_files
          ? mapWorkspaceFilesToChanges(message.workspace_snapshot.changed_files)
          : undefined
      })),
    [visibleMessages]
  )

  const allFileChanges = useMemo(
    () => mapWorkspaceFilesToChanges(workspaceContext?.changed_files ?? []),
    [workspaceContext?.changed_files]
  )

  const totalAdditions =
    gitOverview?.summary.total_insertions ??
    workspaceContext?.total_insertions ??
    allFileChanges.reduce((sum, file) => sum + (file.additions || 0), 0)
  const totalDeletions =
    gitOverview?.summary.total_deletions ??
    workspaceContext?.total_deletions ??
    allFileChanges.reduce((sum, file) => sum + (file.deletions || 0), 0)

  const preferredOpenWithTarget = useMemo(() => {
    const preferred = openWithTargets.find((target) => target.installed && target.preferred)
    return preferred ?? openWithTargets.find((target) => target.installed) ?? null
  }, [openWithTargets])

  const modelOptions = useMemo(
    () =>
      integrationSnapshot?.native_settings.agent_models.map((entry) => entry.name) ?? [
        integrationSnapshot?.runtime.model ||
          useStore.getState().selectedModel ||
          'Modelo'
      ],
    [integrationSnapshot]
  )

  const handleTopicSelect = useCallback(
    async (targetSessionId: string, projectId: string) => {
      const topic = topics.find((item) => item.id === projectId)
      if (!topic) return

      if (topic.project_root !== workspaceContext?.project_root) {
        const nextWorkspace = await syncWorkspaceTarget(topic.project_root, false)
        if (!nextWorkspace) return
      }

      if (!(agentId || teamId || dbId)) return

      setWorkspaceView('chat')
      setSelectedTopicId(projectId)
      await getSession(
        {
          entityType: mode,
          agentId,
          teamId,
          dbId: dbId ?? ''
        },
        targetSessionId
      )
      await setSessionId(targetSessionId)
    },
    [
      agentId,
      dbId,
      getSession,
      mode,
      setSelectedTopicId,
      setSessionId,
      setWorkspaceView,
      teamId,
      topics,
      workspaceContext?.project_root,
      syncWorkspaceTarget
    ]
  )

  const handleAddTopic = useCallback(async () => {
    try {
      const folderSelection = await pickWorkspaceFolderAPI(
        selectedEndpoint,
        { title: 'Selecione uma pasta para criar um tópico' },
        authToken
      )
      if (folderSelection.cancelled || !folderSelection.path) return

      const nextWorkspace = await syncWorkspaceTarget(folderSelection.path, true)
      if (!nextWorkspace?.topic) return

      setWorkspaceView('chat')
      setExpandedProjectIds((current) => [...new Set([...current, nextWorkspace.topic!.id])])
      setSelectedTopicId(nextWorkspace.topic.id)
      clearChat()
      await setSessionId(null)
      focusChatInput()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao criar tópico')
    }
  }, [
    authToken,
    clearChat,
    focusChatInput,
    selectedEndpoint,
    setSelectedTopicId,
    setSessionId,
    setWorkspaceView,
    syncWorkspaceTarget
  ])

  const handleNewConversation = useCallback(
    async (projectId: string) => {
      const topic = topics.find((item) => item.id === projectId)
      if (!topic) return

      if (topic.project_root !== workspaceContext?.project_root) {
        const nextWorkspace = await syncWorkspaceTarget(topic.project_root, false)
        if (!nextWorkspace) return
      }

      setWorkspaceView('chat')
      setSelectedTopicId(projectId)
      clearChat()
      await setSessionId(null)
      focusChatInput()
    },
    [
      clearChat,
      focusChatInput,
      setSelectedTopicId,
      setSessionId,
      setWorkspaceView,
      syncWorkspaceTarget,
      topics,
      workspaceContext?.project_root
    ]
  )

  const handleToggleProject = useCallback((projectId: string) => {
    setExpandedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    )
  }, [])

  const handleUseSkill = useCallback(
    (slash: string) => {
      setWorkspaceView('chat')
      primeChatInput(slash)
      focusChatInput()
    },
    [focusChatInput, primeChatInput, setWorkspaceView]
  )

  const handleSendMessage = useCallback(
    async (content: string) => {
      await handleStreamResponse(content)
      await Promise.all([
        loadRuntimeData(),
        refreshWorkspaceContext(),
        refreshBranches(),
        refreshTopics()
      ])
    },
    [
      handleStreamResponse,
      loadRuntimeData,
      refreshBranches,
      refreshTopics,
      refreshWorkspaceContext
    ]
  )

  const handleSendTerminalInput = useCallback(
    async (data: string) => {
      const nextSnapshot = await sendTerminalInputAPI(selectedEndpoint, data, authToken)
      setTerminalSnapshot(nextSnapshot)
      terminalLastSignatureRef.current = ''
      terminalStablePollsRef.current = 0

      if (nextSnapshot.interactive) {
        extendTerminalPolling(15000)
      } else {
        setTerminalPollUntil(0)
      }
    },
    [authToken, extendTerminalPolling, selectedEndpoint]
  )

  const handleRunTerminalCommand = useCallback(
    async (command: string) => {
      const nextSnapshot = await runTerminalCommandAPI(selectedEndpoint, command, authToken)
      setTerminalSnapshot(nextSnapshot)
      terminalLastSignatureRef.current = ''
      terminalStablePollsRef.current = 0

      if (nextSnapshot.interactive) {
        extendTerminalPolling(20000)
      } else {
        setTerminalPollUntil(0)
      }
    },
    [authToken, extendTerminalPolling, selectedEndpoint]
  )

  const handleCompleteTerminalCommand = useCallback(
    (command: string) => completeTerminalCommandAPI(selectedEndpoint, command, authToken),
    [authToken, selectedEndpoint]
  )

  const handleResizeTerminal = useCallback(
    async (dimensions: { cols: number; rows: number }) => {
      if (!terminalSnapshot?.interactive) return

      const signature = `${dimensions.cols}x${dimensions.rows}`
      if (terminalLastResizeRef.current === signature) return
      terminalLastResizeRef.current = signature

      const nextSnapshot = await resizeTerminalAPI(selectedEndpoint, dimensions, authToken)
      setTerminalSnapshot(nextSnapshot)
      terminalLastSignatureRef.current = ''
      terminalStablePollsRef.current = 0
      if (nextSnapshot.interactive) {
        extendTerminalPolling(8000)
      }
    },
    [authToken, extendTerminalPolling, selectedEndpoint, terminalSnapshot?.interactive]
  )

  useEffect(() => {
    if (!terminalOpen || terminalMinimized) return

    let cancelled = false
    void getTerminalSnapshotAPI(selectedEndpoint, authToken)
      .then((nextSnapshot) => {
        if (!cancelled) {
          terminalLastSignatureRef.current = ''
          terminalStablePollsRef.current = 0
          setTerminalSnapshot(nextSnapshot)
          if (!nextSnapshot.interactive) {
            setTerminalPollUntil(0)
          }
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [authToken, extendTerminalPolling, selectedEndpoint, terminalMinimized, terminalOpen])

  useEffect(() => {
    if (
      !terminalOpen ||
      terminalMinimized ||
      (!terminalSnapshot?.interactive && terminalPollUntil <= 0)
    ) {
      return
    }

    let disposed = false
    let timeoutId: number | null = null

    const buildSnapshotSignature = (snapshot: TerminalSnapshot) => {
      const entries = snapshot.entries ?? []
      const last = entries[entries.length - 1]
      return [
        snapshot.cwd,
        snapshot.shell,
        entries.length,
        last?.id ?? '',
        last?.text?.length ?? 0
      ].join('|')
    }

    const tick = async () => {
      if (disposed) return
      try {
        const nextSnapshot = await getTerminalSnapshotAPI(selectedEndpoint, authToken)
        if (!disposed) {
          const signature = buildSnapshotSignature(nextSnapshot)
          if (signature === terminalLastSignatureRef.current) {
            terminalStablePollsRef.current += 1
          } else {
            terminalLastSignatureRef.current = signature
            terminalStablePollsRef.current = 0
            setTerminalSnapshot(nextSnapshot)
          }
        }
      } catch {}

      const shouldContinue =
        Date.now() < terminalPollUntil && terminalStablePollsRef.current < 4

      if (!disposed && shouldContinue) {
        timeoutId = window.setTimeout(() => {
          void tick()
        }, 450)
      }
    }

    void tick()

    return () => {
      disposed = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [
    authToken,
    selectedEndpoint,
    terminalMinimized,
    terminalOpen,
    terminalSnapshot?.interactive,
    terminalPollUntil
  ])

  const handleCommit = useCallback(
    async (payload: {
      message?: string
      includeUnstaged: boolean
      action: 'commit' | 'commit-push' | 'commit-pr'
      isDraft: boolean
    }) => {
      await commitGitChangesAPI(
        selectedEndpoint,
        {
          message: payload.message,
          include_untracked: payload.includeUnstaged,
          action:
            payload.action === 'commit'
              ? 'commit'
              : payload.action === 'commit-push'
                ? 'commit_and_push'
                : 'commit_and_create_pr',
          draft: payload.isDraft
        },
        authToken
      )
      setCommitModalOpen(false)
      await Promise.all([
        loadRuntimeData(),
        refreshWorkspaceContext(),
        refreshBranches(),
        refreshTopics(),
        initialize()
      ])
    },
    [
      authToken,
      initialize,
      loadRuntimeData,
      refreshBranches,
      refreshTopics,
      refreshWorkspaceContext,
      selectedEndpoint
    ]
  )

  const handleSwitchBranch = useCallback(
    async (branchName: string) => {
      if (branchName === workspaceContext?.branch) return
      await switchBranch(branchName)
      await Promise.all([
        loadRuntimeData(),
        refreshWorkspaceContext(),
        refreshBranches(),
        refreshTopics()
      ])
    },
    [
      loadRuntimeData,
      refreshBranches,
      refreshTopics,
      refreshWorkspaceContext,
      switchBranch,
      workspaceContext?.branch
    ]
  )

  const handleCreateBranch = useCallback(
    async (branchName: string) => {
      const result = await createBranch({
        branchName,
        startPoint: workspaceContext?.branch || undefined,
        switch: true
      })

      if (result) {
        toast.success(`Branch ${branchName} criada`)
        await Promise.all([
          loadRuntimeData(),
          refreshWorkspaceContext(),
          refreshBranches(),
          refreshTopics()
        ])
      }
    },
    [
      createBranch,
      loadRuntimeData,
      refreshBranches,
      refreshTopics,
      refreshWorkspaceContext,
      workspaceContext?.branch
    ]
  )

  const handleExternalOpen = useCallback(async () => {
    if (!preferredOpenWithTarget) return
    await launchOpenWithTargetAPI(selectedEndpoint, preferredOpenWithTarget.id, authToken)
  }, [authToken, preferredOpenWithTarget, selectedEndpoint])

  const handleOpenFileInEditor = useCallback(
    async (filePath: string) => {
      await openFileInEditorAPI(selectedEndpoint, filePath, authToken)
    },
    [authToken, selectedEndpoint]
  )

  const handleRevertFiles = useCallback(
    async (filePaths: string[]) => {
      await revertGitFilesAPI(selectedEndpoint, filePaths, authToken)
      await Promise.all([
        loadRuntimeData(),
        refreshWorkspaceContext(),
        refreshBranches(),
        refreshTopics()
      ])
    },
    [
      authToken,
      loadRuntimeData,
      refreshBranches,
      refreshTopics,
      refreshWorkspaceContext,
      selectedEndpoint
    ]
  )

  const handleUnstageFiles = useCallback(
    async (filePaths: string[]) => {
      await unstageGitFilesAPI(selectedEndpoint, filePaths, authToken)
      await Promise.all([
        loadRuntimeData(),
        refreshWorkspaceContext(),
        refreshBranches(),
        refreshTopics()
      ])
    },
    [
      authToken,
      loadRuntimeData,
      refreshBranches,
      refreshTopics,
      refreshWorkspaceContext,
      selectedEndpoint
    ]
  )

  return (
    <ThemeProvider>
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar
          projects={projects}
          currentSessionId={sessionId || null}
          currentProjectId={currentProjectId}
          onTopicSelect={handleTopicSelect}
          onNewConversation={(projectId) => {
            void handleNewConversation(projectId)
          }}
          onAddProjectTopic={() => {
            void handleAddTopic()
          }}
          onUseSkill={handleUseSkill}
          onToggleProject={handleToggleProject}
          onOpenSettings={() => setWorkspaceView('settings')}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {workspaceView === 'settings' ? (
            <SettingsView />
          ) : (
            <>
              <Header
                title={currentSession?.session_name || 'Nova conversa'}
                projectName={currentTopic?.repo_name || workspaceContext?.repo_name || 'openclaude'}
                filesChanged={allFileChanges.length}
                additions={totalAdditions}
                deletions={totalDeletions}
                branch={workspaceContext?.branch || 'main'}
                branches={branches.map((entry) => entry.name)}
                isBranchLoading={isBranchesLoading}
                isTerminalOpen={terminalOpen && !terminalMinimized}
                isReviewOpen={diffViewerOpen}
                openExternalLabel={preferredOpenWithTarget?.label || 'Abrir'}
                onBranchChange={(branchName) => {
                  void handleSwitchBranch(branchName)
                }}
                onCreateBranch={(branchName) => {
                  void handleCreateBranch(branchName)
                }}
                onCommitClick={() => setCommitModalOpen(true)}
                onReviewClick={() => setDiffViewerOpen((current) => !current)}
                onTerminalToggle={() => {
                  if (terminalOpen && terminalMinimized) {
                    setTerminalMinimized(false)
                  } else {
                    setTerminalOpen(!terminalOpen)
                    setTerminalMinimized(false)
                  }
                }}
                onOpenExternal={() => {
                  void handleExternalOpen()
                }}
                onRefresh={() => {
                  void Promise.all([
                    loadRuntimeData(),
                    refreshWorkspaceContext(),
                    refreshBranches(),
                    refreshTopics()
                  ])
                }}
              />

              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex-1 overflow-y-auto">
                    {codexMessages.length === 0 ? (
                      <div className="flex h-full items-center justify-center px-6">
                        <div className="max-w-md text-center">
                          <div className="text-sm font-medium text-[#f0f6fc]">
                            Nenhuma mensagem ainda
                          </div>
                          <div className="mt-2 text-sm text-[#7d8590]">
                            Comece a conversa para usar as ferramentas, editar arquivos e operar este workspace na web.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {codexMessages.map((message) => (
                          <Message key={message.id} message={message} />
                        ))}

                        {isLoading ? (
                          <div className="border-t border-[#30363d] bg-[#0d1117] px-6 py-4 text-sm text-[#7d8590]">
                            processando...
                          </div>
                        ) : null}

                        <div ref={messagesEndRef} />
                      </>
                    )}
                  </div>

                  <Input
                    onSend={(content) => {
                      void handleSendMessage(content)
                    }}
                    isLoading={isLoading}
                    branch={workspaceContext?.branch || 'main'}
                    models={modelOptions}
                    currentModel={
                      integrationSnapshot?.runtime.model ||
                      useStore.getState().selectedModel ||
                      'Modelo'
                    }
                  />

                  <Terminal
                    isOpen={terminalOpen}
                    onClose={() => setTerminalOpen(false)}
                    onMinimize={() => setTerminalMinimized(!terminalMinimized)}
                    isMinimized={terminalMinimized}
                    entries={terminalSnapshot?.entries ?? []}
                    cwd={
                      terminalSnapshot?.cwd ||
                      workspaceContext?.workspace_root ||
                      'C:\\Projects\\Teste\\openclaude'
                    }
                    shellName={terminalSnapshot?.shell || 'PowerShell'}
                    interactive={Boolean(terminalSnapshot?.interactive)}
                    activeCommand={terminalSnapshot?.active_command ?? null}
                    onSendInput={(data) => {
                      void handleSendTerminalInput(data)
                    }}
                    onRunCommand={(command) => {
                      void handleRunTerminalCommand(command)
                    }}
                    onComplete={handleCompleteTerminalCommand}
                    onResize={(dimensions) => {
                      void handleResizeTerminal(dimensions)
                    }}
                  />
                </div>

                <DiffViewer
                  isOpen={diffViewerOpen}
                  onClose={() => setDiffViewerOpen(false)}
                  fileChanges={allFileChanges}
                  files={workspaceContext?.changed_files ?? []}
                  onOpenInEditor={(filePath) => {
                    void handleOpenFileInEditor(filePath)
                  }}
                  onRevertFiles={(filePaths) => {
                    void handleRevertFiles(filePaths)
                  }}
                  onUnstageFiles={(filePaths) => {
                    void handleUnstageFiles(filePaths)
                  }}
                />
              </div>
            </>
          )}
        </div>

        <CommitModal
          isOpen={commitModalOpen}
          onClose={() => setCommitModalOpen(false)}
          fileChanges={allFileChanges}
          additions={totalAdditions}
          deletions={totalDeletions}
          branch={workspaceContext?.branch || 'main'}
          branches={branches.map((entry) => entry.name)}
          onBranchChange={(branchName) => {
            void handleSwitchBranch(branchName)
          }}
          onCommit={(payload) => {
            void handleCommit(payload)
          }}
        />
      </div>
    </ThemeProvider>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AppBootstrapSync />
      <ChatSessionSync />
      <CodexApp />
    </Suspense>
  )
}
