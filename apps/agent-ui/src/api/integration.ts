import {
  IntegrationConfigPayload,
  IntegrationSnapshot,
  SlashCatalogSnapshot,
  TopicRecord,
  WorkspaceContext
} from '@/types/integration'

const createHeaders = (authToken?: string): HeadersInit => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  return headers
}

export const getIntegrationConfigAPI = async (
  endpoint: string,
  authToken?: string
): Promise<IntegrationSnapshot> => {
  const response = await fetch(`${endpoint}/integration/config`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load integration config')
  }

  return response.json()
}

export const saveIntegrationConfigAPI = async (
  endpoint: string,
  payload: IntegrationConfigPayload,
  authToken?: string
): Promise<IntegrationSnapshot> => {
  const response = await fetch(`${endpoint}/integration/config`, {
    method: 'PUT',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to save integration config')
  }

  return response.json()
}

export const activateNamedModelAPI = async (
  endpoint: string,
  modelName: string,
  authToken?: string
): Promise<IntegrationSnapshot> => {
  const response = await fetch(`${endpoint}/integration/activate-model`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ model_name: modelName })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to activate model')
  }

  return response.json()
}

export const getSlashCatalogAPI = async (
  endpoint: string,
  authToken?: string
): Promise<SlashCatalogSnapshot> => {
  const response = await fetch(`${endpoint}/integration/slash-catalog`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load slash catalog')
  }

  return response.json()
}

export const getWorkspaceContextAPI = async (
  endpoint: string,
  authToken?: string
): Promise<WorkspaceContext> => {
  const response = await fetch(`${endpoint}/integration/workspace`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load workspace context')
  }

  return response.json()
}

export const getTopicsAPI = async (
  endpoint: string,
  authToken?: string
): Promise<{ items: TopicRecord[] }> => {
  const response = await fetch(`${endpoint}/integration/topics`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load topics')
  }

  return response.json()
}

export const createTopicAPI = async (
  endpoint: string,
  payload: { name: string; description?: string },
  authToken?: string
): Promise<{ item: TopicRecord; items: TopicRecord[] }> => {
  const response = await fetch(`${endpoint}/integration/topics`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to create topic')
  }

  return response.json()
}

export const assignSessionToTopicAPI = async (
  endpoint: string,
  topicId: string,
  sessionId: string,
  authToken?: string
): Promise<{ items: TopicRecord[] }> => {
  const response = await fetch(
    `${endpoint}/integration/topics/${topicId}/sessions`,
    {
      method: 'POST',
      headers: createHeaders(authToken),
      body: JSON.stringify({ session_id: sessionId })
    }
  )

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to assign session to topic')
  }

  return response.json()
}

export const detachSessionFromTopicsAPI = async (
  endpoint: string,
  sessionId: string,
  authToken?: string
): Promise<{ items: TopicRecord[] }> => {
  const response = await fetch(
    `${endpoint}/integration/topic-links/${sessionId}`,
    {
      method: 'DELETE',
      headers: createHeaders(authToken)
    }
  )

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to detach session from topics')
  }

  return response.json()
}
