'use client'

import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQueryState } from 'nuqs'
import { toast } from 'sonner'

import useChatActions from '@/hooks/useChatActions'
import useSessionLoader from '@/hooks/useSessionLoader'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

const formatRelativeAge = (createdAt?: number) => {
  if (!createdAt) return ''

  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - createdAt)
  const deltaMinutes = Math.floor(deltaSeconds / 60)
  const deltaHours = Math.floor(deltaMinutes / 60)
  const deltaDays = Math.floor(deltaHours / 24)

  if (deltaDays >= 1) return `${deltaDays} d`
  if (deltaHours >= 1) return `${deltaHours} h`
  if (deltaMinutes >= 1) return `${deltaMinutes} m`
  return 'NOW'
}

const TopicTree = () => {
  const workspaceContext = useStore((state) => state.workspaceContext)
  const topics = useStore((state) => state.topics)
  const selectedTopicId = useStore((state) => state.selectedTopicId)
  const setSelectedTopicId = useStore((state) => state.setSelectedTopicId)
  const sessionsData = useStore((state) => state.sessionsData)
  const mode = useStore((state) => state.mode)
  const setWorkspaceView = useStore((state) => state.setWorkspaceView)
  const [expandedTopicIds, setExpandedTopicIds] = useState<string[]>([])
  const [agentId] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const [dbId] = useQueryState('db_id')
  const [sessionId, setSessionId] = useQueryState('session')
  const { clearChat, focusChatInput } = useChatActions()
  const { getSession } = useSessionLoader()

  const sortedTopics = useMemo(() => {
    const currentProjectRoot = workspaceContext?.project_root
    return [...topics].sort((left, right) => {
      const leftCurrent = left.project_root === currentProjectRoot
      const rightCurrent = right.project_root === currentProjectRoot
      if (leftCurrent !== rightCurrent) {
        return leftCurrent ? -1 : 1
      }
      return left.repo_name.localeCompare(right.repo_name)
    })
  }, [topics, workspaceContext?.project_root])

  const sessionsByTopic = useMemo(() => {
    const entries = sessionsData ?? []
    return new Map(
      topics.map((topic) => [
        topic.id,
        entries.filter((entry) => topic.session_ids.includes(entry.session_id))
      ])
    )
  }, [sessionsData, topics])

  useEffect(() => {
    if (!sortedTopics.length) return

    const defaultExpandedIds = sortedTopics
      .filter(
        (topic) =>
          topic.id === selectedTopicId ||
          topic.project_root === workspaceContext?.project_root
      )
      .map((topic) => topic.id)

    if (defaultExpandedIds.length === 0) return

    setExpandedTopicIds((current) => {
      const next = new Set(current)
      defaultExpandedIds.forEach((id) => next.add(id))
      return [...next]
    })
  }, [selectedTopicId, sortedTopics, workspaceContext?.project_root])

  const openSession = async (targetSessionId: string) => {
    if (!(agentId || teamId || dbId)) return

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
    setWorkspaceView('chat')
    focusChatInput()
  }

  const toggleTopic = (topicId: string) => {
    setExpandedTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((id) => id !== topicId)
        : [...current, topicId]
    )
  }

  const handleNewConversation = (topicId: string, projectRoot: string) => {
    if (projectRoot !== workspaceContext?.project_root) {
      toast.info('Abra /web dentro deste projeto para continuar neste topico.')
      return
    }

    setSelectedTopicId(topicId)
    clearChat()
    setWorkspaceView('chat')
    focusChatInput()
  }

  if (sortedTopics.length === 0) {
    return <div className="px-3 py-1 text-xs italic text-muted">Nenhum topico</div>
  }

  return (
    <div>
      {sortedTopics.map((topic) => {
        const topicSessions = sessionsByTopic.get(topic.id) ?? []
        const isExpanded = expandedTopicIds.includes(topic.id)

        return (
          <div key={topic.id}>
            <button
              type="button"
              onClick={() => toggleTopic(topic.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted transition-colors hover:bg-accent hover:text-secondary"
            >
              {isExpanded ? (
                <ChevronDown className="h-2.5 w-2.5" />
              ) : (
                <ChevronRight className="h-2.5 w-2.5" />
              )}
              {isExpanded ? (
                <FolderOpen className="h-3 w-3 shrink-0" />
              ) : (
                <Folder className="h-3 w-3 shrink-0" />
              )}
              <span className="flex-1 truncate text-left">{topic.repo_name}</span>
            </button>

            {isExpanded ? (
              <div className="ml-4">
                {topicSessions.length === 0 ? (
                  <div className="px-3 py-1 text-xs italic text-muted">
                    Nenhuma conversa
                  </div>
                ) : (
                  topicSessions.map((entry) => {
                    const isCurrentSession = sessionId === entry.session_id

                    return (
                      <button
                        key={entry.session_id}
                        type="button"
                        onClick={() => {
                          if (topic.project_root !== workspaceContext?.project_root) {
                            toast.info(
                              'Abra /web dentro deste projeto para continuar nesta conversa.'
                            )
                            return
                          }

                          setSelectedTopicId(topic.id)
                          void openSession(entry.session_id)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors',
                          isCurrentSession
                            ? 'bg-accent text-secondary'
                            : 'text-muted hover:bg-accent hover:text-secondary'
                        )}
                      >
                        <FileText className="h-2.5 w-2.5 shrink-0" />
                        <span className="flex-1 truncate text-left">
                          {entry.session_name}
                        </span>
                        <span className="shrink-0 text-[10px] uppercase text-muted">
                          {formatRelativeAge(entry.updated_at ?? entry.created_at)}
                        </span>
                      </button>
                    )
                  })
                )}

                <button
                  type="button"
                  onClick={() =>
                    handleNewConversation(topic.id, topic.project_root)
                  }
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted transition-colors hover:bg-accent hover:text-secondary"
                >
                  <FileText className="h-2.5 w-2.5 shrink-0" />
                  <span className="flex-1 text-left">Nova conversa</span>
                </button>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export default TopicTree
