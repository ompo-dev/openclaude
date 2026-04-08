import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import {
  AgentDetails,
  SessionEntry,
  TeamDetails,
  type ChatMessage
} from '@/types/os'
import {
  TopicRecord,
  WorkspaceBranch,
  WorkspaceContext
} from '@/types/integration'

const DEFAULT_ENDPOINT =
  process.env.NEXT_PUBLIC_AGENT_OS_ENDPOINT || 'http://localhost:7777'

interface Store {
  hydrated: boolean
  setHydrated: () => void
  streamingErrorMessage: string
  setStreamingErrorMessage: (streamingErrorMessage: string) => void
  endpoints: {
    endpoint: string
    id__endpoint: string
  }[]
  setEndpoints: (
    endpoints: {
      endpoint: string
      id__endpoint: string
    }[]
  ) => void
  isStreaming: boolean
  setIsStreaming: (isStreaming: boolean) => void
  isEndpointActive: boolean
  setIsEndpointActive: (isActive: boolean) => void
  isEndpointLoading: boolean
  setIsEndpointLoading: (isLoading: boolean) => void
  messages: ChatMessage[]
  setMessages: (
    messages: ChatMessage[] | ((prevMessages: ChatMessage[]) => ChatMessage[])
  ) => void
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>
  chatInputSeed: string | null
  chatInputSeedNonce: number
  primeChatInput: (value: string) => void
  clearChatInputSeed: () => void
  selectedEndpoint: string
  setSelectedEndpoint: (selectedEndpoint: string) => void
  authToken: string
  setAuthToken: (authToken: string) => void
  agents: AgentDetails[]
  setAgents: (agents: AgentDetails[]) => void
  teams: TeamDetails[]
  setTeams: (teams: TeamDetails[]) => void
  selectedModel: string
  setSelectedModel: (model: string) => void
  mode: 'agent' | 'team'
  setMode: (mode: 'agent' | 'team') => void
  sessionsData: SessionEntry[] | null
  setSessionsData: (
    sessionsData:
      | SessionEntry[]
      | ((prevSessions: SessionEntry[] | null) => SessionEntry[] | null)
  ) => void
  isSessionsLoading: boolean
  setIsSessionsLoading: (isSessionsLoading: boolean) => void
  workspaceView: 'chat' | 'project' | 'conversations' | 'settings'
  setWorkspaceView: (
    workspaceView: 'chat' | 'project' | 'conversations' | 'settings'
  ) => void
  workspaceContext: WorkspaceContext | null
  setWorkspaceContext: (
    workspaceContext: WorkspaceContext | null
  ) => void
  isWorkspaceContextLoading: boolean
  setIsWorkspaceContextLoading: (isLoading: boolean) => void
  topics: TopicRecord[]
  setTopics: (
    topics: TopicRecord[] | ((prevTopics: TopicRecord[]) => TopicRecord[])
  ) => void
  isTopicsLoading: boolean
  setIsTopicsLoading: (isLoading: boolean) => void
  selectedTopicId: string | null
  setSelectedTopicId: (selectedTopicId: string | null) => void
  branches: WorkspaceBranch[]
  setBranches: (
    branches:
      | WorkspaceBranch[]
      | ((prevBranches: WorkspaceBranch[]) => WorkspaceBranch[])
  ) => void
  isBranchesLoading: boolean
  setIsBranchesLoading: (isLoading: boolean) => void
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      streamingErrorMessage: '',
      setStreamingErrorMessage: (streamingErrorMessage) =>
        set(() => ({ streamingErrorMessage })),
      endpoints: [],
      setEndpoints: (endpoints) => set(() => ({ endpoints })),
      isStreaming: false,
      setIsStreaming: (isStreaming) => set(() => ({ isStreaming })),
      isEndpointActive: false,
      setIsEndpointActive: (isActive) =>
        set(() => ({ isEndpointActive: isActive })),
      isEndpointLoading: true,
      setIsEndpointLoading: (isLoading) =>
        set(() => ({ isEndpointLoading: isLoading })),
      messages: [],
      setMessages: (messages) =>
        set((state) => ({
          messages:
            typeof messages === 'function' ? messages(state.messages) : messages
        })),
      chatInputRef: { current: null },
      chatInputSeed: null,
      chatInputSeedNonce: 0,
      primeChatInput: (value) =>
        set(() => ({
          chatInputSeed: value,
          chatInputSeedNonce: Date.now()
        })),
      clearChatInputSeed: () =>
        set(() => ({
          chatInputSeed: null
        })),
      selectedEndpoint: DEFAULT_ENDPOINT,
      setSelectedEndpoint: (selectedEndpoint) =>
        set(() => ({ selectedEndpoint })),
      authToken: '',
      setAuthToken: (authToken) => set(() => ({ authToken })),
      agents: [],
      setAgents: (agents) => set({ agents }),
      teams: [],
      setTeams: (teams) => set({ teams }),
      selectedModel: '',
      setSelectedModel: (selectedModel) => set(() => ({ selectedModel })),
      mode: 'agent',
      setMode: (mode) => set(() => ({ mode })),
      sessionsData: null,
      setSessionsData: (sessionsData) =>
        set((state) => ({
          sessionsData:
            typeof sessionsData === 'function'
              ? sessionsData(state.sessionsData)
              : sessionsData
        })),
      isSessionsLoading: false,
      setIsSessionsLoading: (isSessionsLoading) =>
        set(() => ({ isSessionsLoading })),
      workspaceView: 'chat',
      setWorkspaceView: (workspaceView) => set(() => ({ workspaceView })),
      workspaceContext: null,
      setWorkspaceContext: (workspaceContext) =>
        set(() => ({ workspaceContext })),
      isWorkspaceContextLoading: false,
      setIsWorkspaceContextLoading: (isWorkspaceContextLoading) =>
        set(() => ({ isWorkspaceContextLoading })),
      topics: [],
      setTopics: (topics) =>
        set((state) => ({
          topics: typeof topics === 'function' ? topics(state.topics) : topics
        })),
      isTopicsLoading: false,
      setIsTopicsLoading: (isTopicsLoading) =>
        set(() => ({ isTopicsLoading })),
      selectedTopicId: null,
      setSelectedTopicId: (selectedTopicId) =>
        set(() => ({ selectedTopicId })),
      branches: [],
      setBranches: (branches) =>
        set((state) => ({
          branches:
            typeof branches === 'function' ? branches(state.branches) : branches
        })),
      isBranchesLoading: false,
      setIsBranchesLoading: (isBranchesLoading) =>
        set(() => ({ isBranchesLoading }))
    }),
    {
      name: 'endpoint-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedEndpoint: state.selectedEndpoint,
        workspaceView: state.workspaceView,
        selectedTopicId: state.selectedTopicId
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated?.()
      }
    }
  )
)
