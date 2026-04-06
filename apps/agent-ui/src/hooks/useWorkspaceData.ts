'use client'

import { useCallback } from 'react'

import { toast } from 'sonner'

import {
  assignSessionToTopicAPI,
  createTopicAPI,
  detachSessionFromTopicsAPI,
  getTopicsAPI,
  getWorkspaceContextAPI
} from '@/api/integration'
import { useStore } from '@/store'

const useWorkspaceData = () => {
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const setWorkspaceContext = useStore((state) => state.setWorkspaceContext)
  const setTopics = useStore((state) => state.setTopics)
  const setSelectedTopicId = useStore((state) => state.setSelectedTopicId)
  const setIsWorkspaceContextLoading = useStore(
    (state) => state.setIsWorkspaceContextLoading
  )
  const setIsTopicsLoading = useStore((state) => state.setIsTopicsLoading)

  const refreshWorkspaceContext = useCallback(async () => {
    setIsWorkspaceContextLoading(true)
    try {
      const context = await getWorkspaceContextAPI(selectedEndpoint, authToken)
      setWorkspaceContext(context)
      return context
    } catch (error) {
      setWorkspaceContext(null)
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to load workspace context'
      )
      return null
    } finally {
      setIsWorkspaceContextLoading(false)
    }
  }, [
    authToken,
    selectedEndpoint,
    setIsWorkspaceContextLoading,
    setWorkspaceContext
  ])

  const refreshTopics = useCallback(async () => {
    setIsTopicsLoading(true)
    try {
      const response = await getTopicsAPI(selectedEndpoint, authToken)
      setTopics(response.items)

      const currentTopicId = useStore.getState().selectedTopicId
      if (currentTopicId) {
        const stillExists = response.items.some((item) => item.id === currentTopicId)
        if (!stillExists) {
          setSelectedTopicId(null)
        }
      }

      return response.items
    } catch (error) {
      setTopics([])
      toast.error(error instanceof Error ? error.message : 'Failed to load topics')
      return []
    } finally {
      setIsTopicsLoading(false)
    }
  }, [authToken, selectedEndpoint, setIsTopicsLoading, setSelectedTopicId, setTopics])

  const createTopic = useCallback(
    async (payload: { name: string; description?: string }) => {
      const response = await createTopicAPI(selectedEndpoint, payload, authToken)
      setTopics(response.items)
      setSelectedTopicId(response.item.id)
      return response.item
    },
    [authToken, selectedEndpoint, setSelectedTopicId, setTopics]
  )

  const assignSessionToTopic = useCallback(
    async (topicId: string, sessionId: string) => {
      const response = await assignSessionToTopicAPI(
        selectedEndpoint,
        topicId,
        sessionId,
        authToken
      )
      setTopics(response.items)
      return response.items
    },
    [authToken, selectedEndpoint, setTopics]
  )

  const detachSessionFromTopics = useCallback(
    async (sessionId: string) => {
      const response = await detachSessionFromTopicsAPI(
        selectedEndpoint,
        sessionId,
        authToken
      )
      setTopics(response.items)
      return response.items
    },
    [authToken, selectedEndpoint, setTopics]
  )

  const clearWorkspaceData = useCallback(() => {
    setWorkspaceContext(null)
    setTopics([])
    setSelectedTopicId(null)
    setIsWorkspaceContextLoading(false)
    setIsTopicsLoading(false)
  }, [
    setIsTopicsLoading,
    setIsWorkspaceContextLoading,
    setSelectedTopicId,
    setTopics,
    setWorkspaceContext
  ])

  return {
    refreshWorkspaceContext,
    refreshTopics,
    createTopic,
    assignSessionToTopic,
    detachSessionFromTopics,
    clearWorkspaceData
  }
}

export default useWorkspaceData
