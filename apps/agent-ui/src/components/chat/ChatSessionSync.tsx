'use client'

import { useEffect } from 'react'

import { useQueryState } from 'nuqs'

import useSessionLoader from '@/hooks/useSessionLoader'
import { useStore } from '@/store'

const ChatSessionSync = () => {
  const [agentId] = useQueryState('agent', {
    parse: (value: string | null) => value || undefined,
    history: 'push'
  })
  const [teamId] = useQueryState('team')
  const [sessionId] = useQueryState('session')
  const [dbId] = useQueryState('db_id')

  const {
    selectedEndpoint,
    mode,
    isEndpointLoading,
    hydrated,
    setSessionsData
  } = useStore()
  const { getSessions, getSession } = useSessionLoader()

  useEffect(() => {
    if (hydrated && sessionId && selectedEndpoint && (agentId || teamId)) {
      const entityType = agentId ? 'agent' : 'team'
      void getSession({ entityType, agentId, teamId, dbId }, sessionId)
    }
  }, [
    agentId,
    dbId,
    getSession,
    hydrated,
    selectedEndpoint,
    sessionId,
    teamId
  ])

  useEffect(() => {
    if (!selectedEndpoint || isEndpointLoading) return

    if (!(agentId || teamId || dbId)) {
      setSessionsData([])
      return
    }

    setSessionsData([])
    void getSessions({
      entityType: mode,
      agentId,
      teamId,
      dbId
    })
  }, [
    agentId,
    dbId,
    getSessions,
    isEndpointLoading,
    mode,
    selectedEndpoint,
    setSessionsData,
    teamId
  ])

  return null
}

export default ChatSessionSync
