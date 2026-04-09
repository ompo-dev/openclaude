import { useCallback } from 'react'
import { getSessionAPI, getAllSessionsAPI } from '@/api/os'
import { useStore } from '../store'
import { toast } from 'sonner'
import { ChatMessage, ToolCall, ReasoningMessage, ChatEntry } from '@/types/os'
import { getJsonMarkdown } from '@/lib/utils'

interface SessionResponse {
  session_id: string
  agent_id: string
  user_id: string | null
  runs?: ChatEntry[]
  memory: {
    runs?: ChatEntry[]
    chats?: ChatEntry[]
  }
  agent_data: Record<string, unknown>
  chat_history?: Array<{
    role: 'user' | 'system' | 'tool' | 'assistant'
    content: string
    created_at: number
  }>
  value?: ChatEntry[]
}

interface LoaderArgs {
  entityType: 'agent' | 'team' | null
  agentId?: string | null
  teamId?: string | null
  dbId: string | null
}

interface SessionRunEntry {
  run_input?: string | object | null
  content?: string | object | null
  created_at: number
  tools?: ToolCall[]
  extra_data?: ChatMessage['extra_data']
  images?: ChatMessage['images']
  videos?: ChatMessage['videos']
  audio?: ChatMessage['audio']
  response_audio?: ChatMessage['response_audio']
}

const buildToolCalls = (
  tools?: ToolCall[],
  reasoningMessages?: ReasoningMessage[]
) => [
  ...(tools ?? []),
  ...((reasoningMessages ?? []).reduce((acc: ToolCall[], msg) => {
    if (msg.role === 'tool') {
      acc.push({
        role: msg.role,
        content: msg.content,
        tool_call_id: msg.tool_call_id ?? '',
        tool_name: msg.tool_name ?? '',
        tool_args: msg.tool_args ?? {},
        tool_call_error: msg.tool_call_error ?? false,
        metrics: msg.metrics ?? { time: 0 },
        created_at: msg.created_at ?? Math.floor(Date.now() / 1000)
      })
    }
    return acc
  }, [] as ToolCall[]))
]

const normalizeSessionMessages = (
  response: SessionResponse | ChatEntry[] | Record<string, unknown>[] | null
): ChatMessage[] => {
  if (!response) return []

  if (Array.isArray(response)) {
    return response.flatMap((rawRun) => {
      const run = rawRun as unknown as SessionRunEntry &
        Partial<{
          message: ChatEntry['message']
          response: ChatEntry['response']
        }>
      const result: ChatMessage[] = []

      if ('run_input' in run) {
        result.push({
          role: 'user',
          content:
            typeof run.run_input === 'string'
              ? run.run_input
              : run.run_input
                ? getJsonMarkdown(run.run_input as object)
                : '',
          created_at: run.created_at
        })

        const toolCalls = buildToolCalls(
          run.tools,
          run.extra_data?.reasoning_messages
        )

        result.push({
          role: 'agent',
          content:
            typeof run.content === 'string'
              ? run.content
              : run.content
                ? getJsonMarkdown(run.content)
                : '',
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          extra_data: run.extra_data,
          images: run.images,
          videos: run.videos,
          audio: run.audio,
          response_audio: run.response_audio,
          created_at: run.created_at
        })
        return result
      }

      if ('message' in run && run.message) {
        const message = run.message as ChatEntry['message']
        result.push({
          role: message.role === 'assistant' ? 'agent' : message.role,
          content: message.content ?? '',
          created_at: message.created_at
        })
      }

      if ('response' in run && run.response) {
        const responseMessage = run.response as ChatEntry['response']
        const toolCalls = buildToolCalls(
          responseMessage.tools,
          responseMessage.extra_data?.reasoning_messages
        )
        result.push({
          role: 'agent',
          content:
            typeof responseMessage.content === 'string'
              ? responseMessage.content
              : responseMessage.content
                ? getJsonMarkdown(responseMessage.content as object)
                : '',
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          extra_data: responseMessage.extra_data,
          images: responseMessage.images,
          videos: responseMessage.videos,
          audio: responseMessage.audio,
          response_audio: responseMessage.response_audio,
          created_at: responseMessage.created_at
        })
      }

      return result
    })
  }

  if (Array.isArray(response.value)) {
    return normalizeSessionMessages(response.value)
  }

  if (Array.isArray(response.runs)) {
    return normalizeSessionMessages(response.runs)
  }

  if (Array.isArray(response.memory?.runs)) {
    return normalizeSessionMessages(response.memory.runs)
  }

  if (Array.isArray(response.memory?.chats)) {
    return normalizeSessionMessages(response.memory.chats)
  }

  if (Array.isArray(response.chat_history)) {
    return response.chat_history
      .filter((entry) => entry.role !== 'system')
      .map((entry) => ({
        role: entry.role === 'assistant' ? 'agent' : entry.role,
        content:
          typeof entry.content === 'string'
            ? entry.content
            : getJsonMarkdown(entry.content),
        created_at: entry.created_at
      }))
  }

  return []
}

const useSessionLoader = () => {
  const setMessages = useStore((state) => state.setMessages)
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const setIsSessionsLoading = useStore((state) => state.setIsSessionsLoading)
  const setSessionsData = useStore((state) => state.setSessionsData)

  const getSessions = useCallback(
    async ({ entityType, agentId, teamId, dbId }: LoaderArgs) => {
      const selectedId = entityType === 'agent' ? agentId : teamId
      if (!selectedEndpoint || !entityType || !selectedId || !dbId) return

      try {
        setIsSessionsLoading(true)

        const sessions = await getAllSessionsAPI(
          selectedEndpoint,
          entityType,
          selectedId,
          dbId,
          authToken
        )
        setSessionsData(sessions.data ?? [])
      } catch {
        toast.error('Error loading sessions')
        setSessionsData([])
      } finally {
        setIsSessionsLoading(false)
      }
    },
    [selectedEndpoint, authToken, setSessionsData, setIsSessionsLoading]
  )

  const getSession = useCallback(
    async (
      { entityType, agentId, teamId, dbId }: LoaderArgs,
      sessionId: string
    ) => {
      const selectedId = entityType === 'agent' ? agentId : teamId
      if (
        !selectedEndpoint ||
        !sessionId ||
        !entityType ||
        !selectedId ||
        !dbId
      )
        return

      try {
        const response = await getSessionAPI(
          selectedEndpoint,
          entityType,
          sessionId,
          dbId,
          authToken
        )
        const processedMessages = normalizeSessionMessages(
          response as SessionResponse | ChatEntry[]
        )

        setMessages(processedMessages)
        return processedMessages
      } catch {
        return null
      }
    },
    [selectedEndpoint, authToken, setMessages]
  )

  return { getSession, getSessions }
}

export default useSessionLoader
