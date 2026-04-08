'use client'

import { useCallback } from 'react'

import { toast } from 'sonner'

import {
  createBranchAPI,
  assignSessionToTopicAPI,
  createTopicAPI,
  detachSessionFromTopicsAPI,
  getBranchesAPI,
  getWorkspaceBootstrapAPI,
  getTopicsAPI,
  getWorkspaceContextAPI,
  setWorkspaceTargetAPI,
  switchBranchAPI
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
  const setBranches = useStore((state) => state.setBranches)
  const setIsBranchesLoading = useStore((state) => state.setIsBranchesLoading)

  const applyWorkspaceBootstrap = useCallback(
    (
      response: Awaited<ReturnType<typeof getWorkspaceBootstrapAPI>> | null,
      options?: { preserveTopicSelection?: boolean }
    ) => {
      if (!response) return null

      setWorkspaceContext(response.workspace)
      setTopics(response.topics)
      setBranches(response.branches.items)

      const preserveTopicSelection = options?.preserveTopicSelection ?? false
      if (!preserveTopicSelection) {
        setSelectedTopicId(response.topic?.id ?? null)
      } else {
        const currentTopicId = useStore.getState().selectedTopicId
        if (
          currentTopicId &&
          response.topics.some((topic) => topic.id === currentTopicId)
        ) {
          setSelectedTopicId(currentTopicId)
        } else {
          setSelectedTopicId(response.topic?.id ?? null)
        }
      }

      return response
    },
    [setBranches, setSelectedTopicId, setTopics, setWorkspaceContext]
  )

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

  const refreshBranches = useCallback(async () => {
    setIsBranchesLoading(true)
    try {
      const response = await getBranchesAPI(selectedEndpoint, authToken)
      setBranches(response.items)
      return response
    } catch (error) {
      setBranches([])
      toast.error(error instanceof Error ? error.message : 'Failed to load branches')
      return null
    } finally {
      setIsBranchesLoading(false)
    }
  }, [authToken, selectedEndpoint, setBranches, setIsBranchesLoading])

  const bootstrapWorkspace = useCallback(async () => {
    setIsWorkspaceContextLoading(true)
    setIsTopicsLoading(true)
    setIsBranchesLoading(true)
    try {
      const response = await getWorkspaceBootstrapAPI(selectedEndpoint, authToken)
      return applyWorkspaceBootstrap(response)
    } catch (error) {
      setWorkspaceContext(null)
      setTopics([])
      setBranches([])
      toast.error(
        error instanceof Error ? error.message : 'Failed to bootstrap workspace'
      )
      return null
    } finally {
      setIsWorkspaceContextLoading(false)
      setIsTopicsLoading(false)
      setIsBranchesLoading(false)
    }
  }, [
    applyWorkspaceBootstrap,
    authToken,
    selectedEndpoint,
    setBranches,
    setIsBranchesLoading,
    setIsTopicsLoading,
    setIsWorkspaceContextLoading,
    setTopics,
    setWorkspaceContext
  ])

  const syncWorkspaceTarget = useCallback(
    async (workspacePath: string, createTopic = true) => {
      setIsWorkspaceContextLoading(true)
      setIsTopicsLoading(true)
      setIsBranchesLoading(true)
      try {
        const response = await setWorkspaceTargetAPI(
          selectedEndpoint,
          {
            path: workspacePath,
            create_topic: createTopic
          },
          authToken
        )
        return applyWorkspaceBootstrap(response)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to switch workspace context'
        )
        return null
      } finally {
        setIsWorkspaceContextLoading(false)
        setIsTopicsLoading(false)
        setIsBranchesLoading(false)
      }
    },
    [
      applyWorkspaceBootstrap,
      authToken,
      selectedEndpoint,
      setIsBranchesLoading,
      setIsTopicsLoading,
      setIsWorkspaceContextLoading
    ]
  )

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
    setBranches([])
    setSelectedTopicId(null)
    setIsWorkspaceContextLoading(false)
    setIsTopicsLoading(false)
    setIsBranchesLoading(false)
  }, [
    setBranches,
    setIsBranchesLoading,
    setIsTopicsLoading,
    setIsWorkspaceContextLoading,
    setSelectedTopicId,
    setTopics,
    setWorkspaceContext
  ])

  const switchBranch = useCallback(
    async (branchName: string) => {
      setIsWorkspaceContextLoading(true)
      setIsTopicsLoading(true)
      setIsBranchesLoading(true)
      try {
        const response = await switchBranchAPI(
          selectedEndpoint,
          branchName,
          authToken
        )
        return applyWorkspaceBootstrap(response)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to switch branch')
        return null
      } finally {
        setIsWorkspaceContextLoading(false)
        setIsTopicsLoading(false)
        setIsBranchesLoading(false)
      }
    },
    [
      applyWorkspaceBootstrap,
      authToken,
      selectedEndpoint,
      setIsBranchesLoading,
      setIsTopicsLoading,
      setIsWorkspaceContextLoading
    ]
  )

  const createBranch = useCallback(
    async (payload: { branchName: string; startPoint?: string; switch?: boolean }) => {
      setIsWorkspaceContextLoading(true)
      setIsTopicsLoading(true)
      setIsBranchesLoading(true)
      try {
        const response = await createBranchAPI(
          selectedEndpoint,
          {
            branch_name: payload.branchName,
            start_point: payload.startPoint,
            switch: payload.switch
          },
          authToken
        )
        return applyWorkspaceBootstrap(response)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to create branch')
        return null
      } finally {
        setIsWorkspaceContextLoading(false)
        setIsTopicsLoading(false)
        setIsBranchesLoading(false)
      }
    },
    [
      applyWorkspaceBootstrap,
      authToken,
      selectedEndpoint,
      setIsBranchesLoading,
      setIsTopicsLoading,
      setIsWorkspaceContextLoading
    ]
  )

  return {
    bootstrapWorkspace,
    refreshWorkspaceContext,
    refreshBranches,
    refreshTopics,
    syncWorkspaceTarget,
    createTopic,
    createBranch,
    switchBranch,
    assignSessionToTopic,
    detachSessionFromTopics,
    clearWorkspaceData
  }
}

export default useWorkspaceData
