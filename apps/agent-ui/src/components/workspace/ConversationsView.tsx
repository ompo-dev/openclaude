'use client'

import { useMemo, useState } from 'react'

import { useQueryState } from 'nuqs'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import useSessionLoader from '@/hooks/useSessionLoader'
import useWorkspaceData from '@/hooks/useWorkspaceData'
import { useStore } from '@/store'
import { SessionEntry } from '@/types/os'

import SectionCard from './SectionCard'

const StatCard = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
    <div className="mb-1 text-[11px] uppercase text-muted">{label}</div>
    <div className="text-sm font-medium text-secondary">{value}</div>
  </div>
)

const ConversationsView = () => {
  const [agentId] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const [dbId] = useQueryState('db_id')
  const [sessionId, setSessionId] = useQueryState('session')
  const {
    mode,
    sessionsData,
    isSessionsLoading,
    selectedEndpoint,
    selectedModel,
    topics,
    selectedTopicId,
    setSelectedTopicId,
    workspaceContext,
    setWorkspaceView
  } = useStore()
  const { getSessions, getSession } = useSessionLoader()
  const { createTopic, assignSessionToTopic } = useWorkspaceData()
  const [topicName, setTopicName] = useState('')
  const [topicDescription, setTopicDescription] = useState('')
  const [isCreatingTopic, setIsCreatingTopic] = useState(false)

  const handleRefresh = async () => {
    await getSessions({
      entityType: mode,
      agentId,
      teamId,
      dbId
    })
  }

  const hasSelection = Boolean((agentId || teamId) && dbId)

  const sessionTopicMap = useMemo(() => {
    const map = new Map<string, string>()
    topics.forEach((topic) => {
      topic.session_ids.forEach((linkedSessionId) => {
        map.set(linkedSessionId, topic.id)
      })
    })
    return map
  }, [topics])

  const groupedSessions = useMemo(() => {
    const sessions = sessionsData ?? []
    const groups = topics
      .map((topic) => ({
        topic,
        sessions: sessions.filter((entry) => sessionTopicMap.get(entry.session_id) === topic.id)
      }))
      .filter((group) => group.sessions.length > 0)

    const unassigned = sessions.filter((entry) => !sessionTopicMap.has(entry.session_id))

    return { groups, unassigned }
  }, [sessionTopicMap, sessionsData, topics])

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId) ?? null,
    [selectedTopicId, topics]
  )

  const openSession = async (entry: SessionEntry) => {
    if (!hasSelection) return

    await getSession(
      {
        entityType: mode,
        agentId,
        teamId,
        dbId: dbId ?? ''
      },
      entry.session_id
    )
    setSessionId(entry.session_id)
    setWorkspaceView('chat')
  }

  const handleCreateTopic = async () => {
    if (!topicName.trim()) {
      toast.error('Topic name is required')
      return
    }

    setIsCreatingTopic(true)
    try {
      await createTopic({
        name: topicName.trim(),
        description: topicDescription.trim() || undefined
      })
      setTopicName('')
      setTopicDescription('')
      toast.success('Topic created')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create topic')
    } finally {
      setIsCreatingTopic(false)
    }
  }

  const handleAttachToSelectedTopic = async (entry: SessionEntry) => {
    if (!selectedTopicId) {
      toast.error('Select a topic first')
      return
    }

    try {
      await assignSessionToTopic(selectedTopicId, entry.session_id)
      toast.success(`Attached to ${selectedTopic?.name || 'topic'}`)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to attach session to topic'
      )
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-primary/10 px-8 py-6">
        <div className="mb-2 flex items-center gap-2">
          <Icon type="sheet" size="xs" />
          <span className="text-xs font-medium uppercase text-primary">
            Conversations
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-secondary">
          Topics and project sessions
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Group sessions by project topic, keep branch context visible and reopen
          previous coding runs from the same workspace.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6 grid gap-3 md:grid-cols-4">
          <StatCard label="Mode" value={mode} />
          <StatCard
            label="Repository"
            value={workspaceContext?.repo_name || 'workspace'}
          />
          <StatCard label="Topics" value={topics.length} />
          <StatCard label="Model" value={selectedModel || 'pending'} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.3fr]">
          <SectionCard
            title="Topic Scope"
            description="New chats inherit the selected topic so related sessions stay grouped by the same project thread."
          >
            <div className="mb-4 space-y-3">
              <label className="block">
                <div className="mb-2 text-[11px] uppercase text-muted">Name</div>
                <input
                  value={topicName}
                  onChange={(event) => setTopicName(event.target.value)}
                  placeholder="Example: Agent UI parity"
                  className="h-10 w-full rounded-xl border border-primary/10 bg-background-secondary px-3 text-sm text-secondary outline-none transition-colors placeholder:text-muted focus:border-primary/30"
                />
              </label>
              <label className="block">
                <div className="mb-2 text-[11px] uppercase text-muted">
                  Description
                </div>
                <textarea
                  value={topicDescription}
                  onChange={(event) => setTopicDescription(event.target.value)}
                  placeholder="Optional scope for this project thread"
                  className="min-h-24 w-full rounded-xl border border-primary/10 bg-background-secondary px-3 py-2 text-sm text-secondary outline-none transition-colors placeholder:text-muted focus:border-primary/30"
                />
              </label>
              <Button
                size="sm"
                onClick={handleCreateTopic}
                disabled={isCreatingTopic}
                className="rounded-xl"
              >
                <Icon type="plus-icon" size="xs" />
                Create Topic
              </Button>
            </div>

            <div className="space-y-3">
              {topics.length > 0 ? (
                topics.map((topic) => {
                  const active = topic.id === selectedTopicId
                  return (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => setSelectedTopicId(active ? null : topic.id)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? 'border-primary/20 bg-primary/10'
                          : 'border-primary/10 bg-background-secondary hover:bg-background-secondary/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-secondary">
                          {topic.name}
                        </div>
                        <div className="text-[11px] uppercase text-muted">
                          {topic.session_ids.length} sessions
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] uppercase text-muted">
                        {topic.branch || workspaceContext?.branch || 'workspace'}
                      </div>
                      {topic.description ? (
                        <p className="mt-2 text-sm text-muted">
                          {topic.description}
                        </p>
                      ) : null}
                    </button>
                  )
                })
              ) : (
                <div className="rounded-xl border border-dashed border-primary/10 px-4 py-8 text-sm text-muted">
                  No topics yet. Create one to start grouping sessions like a
                  project thread.
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Grouped Sessions"
            description="Sessions stay attached to the selected agent/team but can be organized by project topic."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={!hasSelection || isSessionsLoading}
                className="rounded-xl"
              >
                <Icon type="refresh" size="xs" />
                Refresh
              </Button>
            }
          >
            {!hasSelection ? (
              <div className="rounded-xl border border-dashed border-primary/10 px-4 py-8 text-sm text-muted">
                Select an agent or team to list sessions.
              </div>
            ) : groupedSessions.groups.length > 0 ||
              groupedSessions.unassigned.length > 0 ? (
              <div className="space-y-6">
                {groupedSessions.groups.map(({ topic, sessions }) => (
                  <div key={topic.id}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium uppercase text-primary">
                          {topic.name}
                        </div>
                        <div className="text-xs text-muted">
                          {topic.branch || workspaceContext?.branch || 'workspace'}
                        </div>
                      </div>
                      <div className="text-[11px] uppercase text-muted">
                        {sessions.length} sessions
                      </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {sessions.map((entry) => (
                        <article
                          key={entry.session_id}
                          className={`rounded-xl border p-4 ${
                            sessionId === entry.session_id
                              ? 'border-primary/20 bg-primary/10'
                              : 'border-primary/10 bg-background-secondary'
                          }`}
                        >
                          <div className="mb-3">
                            <div className="text-sm font-medium text-secondary">
                              {entry.session_name}
                            </div>
                            <div className="mt-1 text-[11px] uppercase text-muted">
                              Session {entry.session_id.slice(0, 8)}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void openSession(entry)}
                            className="rounded-xl"
                          >
                            Open Session
                          </Button>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}

                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium uppercase text-primary">
                        Unassigned
                      </div>
                      <div className="text-xs text-muted">
                        Sessions without a project topic
                      </div>
                    </div>
                    <div className="text-[11px] uppercase text-muted">
                      {groupedSessions.unassigned.length} sessions
                    </div>
                  </div>
                  {groupedSessions.unassigned.length > 0 ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {groupedSessions.unassigned.map((entry) => (
                        <article
                          key={entry.session_id}
                          className="rounded-xl border border-primary/10 bg-background-secondary p-4"
                        >
                          <div className="mb-3">
                            <div className="text-sm font-medium text-secondary">
                              {entry.session_name}
                            </div>
                            <div className="mt-1 text-[11px] uppercase text-muted">
                              Session {entry.session_id.slice(0, 8)}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void openSession(entry)}
                              className="rounded-xl"
                            >
                              Open Session
                            </Button>
                            {selectedTopicId ? (
                              <Button
                                size="sm"
                                onClick={() => void handleAttachToSelectedTopic(entry)}
                                className="rounded-xl"
                              >
                                Attach to {selectedTopic?.name || 'topic'}
                              </Button>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-primary/10 px-4 py-8 text-sm text-muted">
                      Every listed session is already grouped into a topic.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-primary/10 px-4 py-8 text-sm text-muted">
                No sessions found for endpoint {selectedEndpoint}.
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

export default ConversationsView
