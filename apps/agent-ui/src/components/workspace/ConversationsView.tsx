'use client'

import { useMemo } from 'react'

import { useQueryState } from 'nuqs'

import SessionItem from '@/components/chat/Sidebar/Sessions/SessionItem'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import useSessionLoader from '@/hooks/useSessionLoader'
import { useStore } from '@/store'

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
  const [sessionId] = useQueryState('session')
  const {
    mode,
    sessionsData,
    isSessionsLoading,
    selectedEndpoint,
    selectedModel
  } = useStore()
  const { getSessions } = useSessionLoader()

  const title = useMemo(() => {
    if (mode === 'team') return teamId || 'No team selected'
    return agentId || 'No agent selected'
  }, [agentId, mode, teamId])

  const handleRefresh = async () => {
    await getSessions({
      entityType: mode,
      agentId,
      teamId,
      dbId
    })
  }

  const hasSelection = Boolean((agentId || teamId) && dbId)

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
          Sessoes locais do OpenClaude Web
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Reabra runs anteriores, revise o modelo efetivo e mantenha o
          historico do OpenClaude acessivel pela interface web.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6 grid gap-3 md:grid-cols-4">
          <StatCard label="Mode" value={mode} />
          <StatCard label="Selected" value={title} />
          <StatCard label="Session Count" value={sessionsData?.length ?? 0} />
          <StatCard label="Model" value={selectedModel || 'pending'} />
        </div>

        <SectionCard
          title="Stored Sessions"
          description="As sessoes abaixo sao as mesmas expostas no sidebar, mas em um espaco maior para navegacao e revisao."
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
              Selecione um agente ou team conectado para listar as sessoes.
            </div>
          ) : sessionsData && sessionsData.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {sessionsData.map((entry) => (
                <SessionItem
                  key={entry.session_id}
                  currentSessionId={sessionId}
                  isSelected={sessionId === entry.session_id}
                  onSessionClick={() => undefined}
                  session_id={entry.session_id}
                  session_name={entry.session_name}
                  created_at={entry.created_at}
                  updated_at={entry.updated_at}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-primary/10 px-4 py-8 text-sm text-muted">
              Nenhuma sessao encontrada para o endpoint {selectedEndpoint}.
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

export default ConversationsView
