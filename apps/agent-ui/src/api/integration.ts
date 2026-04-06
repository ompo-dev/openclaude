import {
  IntegrationConfigPayload,
  IntegrationSnapshot
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
