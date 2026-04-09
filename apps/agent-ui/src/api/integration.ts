import {
  BranchListResponse,
  GitCommitPayload,
  GitCommitResult,
  FolderPickerResponse,
  GitOverview,
  IntegrationConfigPayload,
  IntegrationSnapshot,
  TopicMutationResponse,
  SkillFileSnapshot,
  SkillLibrarySnapshot,
  OpenEditorLaunchResponse,
  OpenWithLaunchResponse,
  OpenWithTargetsResponse,
  SkillsMutationResponse,
  SkillsSnapshot,
  SlashCatalogSnapshot,
  TerminalSnapshot,
  TerminalCompletionSnapshot,
  TopicRecord,
  WorkspaceFileSearchResponse,
  WorkspaceSnippetMatchResponse,
  WorkspaceBootstrapResponse,
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

export const getInstalledSkillsAPI = async (
  endpoint: string,
  authToken?: string
): Promise<SkillsSnapshot> => {
  const response = await fetch(`${endpoint}/integration/skills`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load installed skills')
  }

  return response.json()
}

export const getSkillLibraryAPI = async (
  endpoint: string,
  authToken?: string
): Promise<SkillLibrarySnapshot> => {
  const response = await fetch(`${endpoint}/integration/skills/library`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load skills library')
  }

  return response.json()
}

export const getSkillFileAPI = async (
  endpoint: string,
  path: string,
  authToken?: string
): Promise<SkillFileSnapshot> => {
  const response = await fetch(
    `${endpoint}/integration/skills/file?path=${encodeURIComponent(path)}`,
    {
      method: 'GET',
      headers: createHeaders(authToken)
    }
  )

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load skill file')
  }

  return response.json()
}

export const saveSkillFileAPI = async (
  endpoint: string,
  payload: { path: string; content: string },
  authToken?: string
): Promise<SkillFileSnapshot> => {
  const response = await fetch(`${endpoint}/integration/skills/file`, {
    method: 'PUT',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to save skill file')
  }

  return response.json()
}

export const installSkillsAPI = async (
  endpoint: string,
  payload: { source: string; skills?: string[] },
  authToken?: string
): Promise<SkillsMutationResponse> => {
  const response = await fetch(`${endpoint}/integration/skills/install`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to install skills')
  }

  return response.json()
}

export const removeSkillsAPI = async (
  endpoint: string,
  payload: { skills: string[] },
  authToken?: string
): Promise<SkillsMutationResponse> => {
  const response = await fetch(`${endpoint}/integration/skills/remove`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to remove skills')
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

export const getWorkspaceBootstrapAPI = async (
  endpoint: string,
  authToken?: string
): Promise<WorkspaceBootstrapResponse> => {
  const response = await fetch(`${endpoint}/integration/workspace-bootstrap`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load workspace bootstrap')
  }

  return response.json()
}

export const setWorkspaceTargetAPI = async (
  endpoint: string,
  payload: { path: string; create_topic?: boolean },
  authToken?: string
): Promise<WorkspaceBootstrapResponse> => {
  const response = await fetch(`${endpoint}/integration/workspace-target`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to set workspace target')
  }

  return response.json()
}

export const getBranchesAPI = async (
  endpoint: string,
  authToken?: string
): Promise<BranchListResponse> => {
  const response = await fetch(`${endpoint}/integration/branches`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load branches')
  }

  return response.json()
}

export const switchBranchAPI = async (
  endpoint: string,
  branchName: string,
  authToken?: string
): Promise<WorkspaceBootstrapResponse> => {
  const response = await fetch(`${endpoint}/integration/branches/switch`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ branch_name: branchName })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to switch branch')
  }

  return response.json()
}

export const createBranchAPI = async (
  endpoint: string,
  payload: { branch_name: string; start_point?: string; switch?: boolean },
  authToken?: string
): Promise<WorkspaceBootstrapResponse> => {
  const response = await fetch(`${endpoint}/integration/branches/create`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to create branch')
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

export const getGitOverviewAPI = async (
  endpoint: string,
  authToken?: string
): Promise<GitOverview> => {
  const response = await fetch(`${endpoint}/integration/git/overview`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load git overview')
  }

  return response.json()
}

export const commitGitChangesAPI = async (
  endpoint: string,
  payload: GitCommitPayload,
  authToken?: string
): Promise<GitCommitResult> => {
  const response = await fetch(`${endpoint}/integration/git/commit`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to commit changes')
  }

  return response.json()
}

export const revertGitFilesAPI = async (
  endpoint: string,
  filePaths: string[],
  authToken?: string
): Promise<GitOverview> => {
  const response = await fetch(`${endpoint}/integration/git/files/revert`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ file_paths: filePaths })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to revert files')
  }

  return response.json()
}

export const unstageGitFilesAPI = async (
  endpoint: string,
  filePaths: string[],
  authToken?: string
): Promise<GitOverview> => {
  const response = await fetch(`${endpoint}/integration/git/files/unstage`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ file_paths: filePaths })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to unstage files')
  }

  return response.json()
}

export const getOpenWithTargetsAPI = async (
  endpoint: string,
  authToken?: string
): Promise<OpenWithTargetsResponse> => {
  const response = await fetch(`${endpoint}/integration/open-with`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load external app targets')
  }

  return response.json()
}

export const launchOpenWithTargetAPI = async (
  endpoint: string,
  targetId: string,
  authToken?: string
): Promise<OpenWithLaunchResponse> => {
  const response = await fetch(`${endpoint}/integration/open-with`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ target_id: targetId })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to open external app')
  }

  return response.json()
}

export const openFileInEditorAPI = async (
  endpoint: string,
  filePath: string,
  authToken?: string
): Promise<OpenEditorLaunchResponse> => {
  const response = await fetch(`${endpoint}/integration/editor/open`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ file_path: filePath })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to open file in editor')
  }

  return response.json()
}

export const pickWorkspaceFolderAPI = async (
  endpoint: string,
  payload?: { title?: string },
  authToken?: string
): Promise<FolderPickerResponse> => {
  const response = await fetch(`${endpoint}/integration/folder-picker`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload ?? {})
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to open folder picker')
  }

  return response.json()
}

export const getTerminalSnapshotAPI = async (
  endpoint: string,
  authToken?: string
): Promise<TerminalSnapshot> => {
  const response = await fetch(`${endpoint}/integration/terminal`, {
    method: 'GET',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to load terminal history')
  }

  return response.json()
}

export const runTerminalCommandAPI = async (
  endpoint: string,
  command: string,
  authToken?: string
): Promise<TerminalSnapshot> => {
  const response = await fetch(`${endpoint}/integration/terminal/run`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ command })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to run terminal command')
  }

  return response.json()
}

export const completeTerminalCommandAPI = async (
  endpoint: string,
  command: string,
  authToken?: string
): Promise<TerminalCompletionSnapshot> => {
  const response = await fetch(`${endpoint}/integration/terminal/complete`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ command })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to complete terminal command')
  }

  return response.json()
}

export const sendTerminalInputAPI = async (
  endpoint: string,
  data: string,
  authToken?: string
): Promise<TerminalSnapshot> => {
  const response = await fetch(`${endpoint}/integration/terminal/input`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ data })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to send terminal input')
  }

  return response.json()
}

export const resizeTerminalAPI = async (
  endpoint: string,
  payload: { cols: number; rows: number },
  authToken?: string
): Promise<TerminalSnapshot> => {
  const response = await fetch(`${endpoint}/integration/terminal/resize`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to resize terminal')
  }

  return response.json()
}

export const createTopicAPI = async (
  endpoint: string,
  payload: { name: string; description?: string },
  authToken?: string
): Promise<TopicMutationResponse> => {
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

export const updateTopicAPI = async (
  endpoint: string,
  topicId: string,
  payload: { name: string },
  authToken?: string
): Promise<TopicMutationResponse> => {
  const response = await fetch(`${endpoint}/integration/topics/${topicId}`, {
    method: 'PUT',
    headers: createHeaders(authToken),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to update topic')
  }

  return response.json()
}

export const deleteTopicAPI = async (
  endpoint: string,
  topicId: string,
  authToken?: string
): Promise<{ items: TopicRecord[] }> => {
  const response = await fetch(`${endpoint}/integration/topics/${topicId}`, {
    method: 'DELETE',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to delete topic')
  }

  return response.json()
}

export const openTopicInExplorerAPI = async (
  endpoint: string,
  topicId: string,
  authToken?: string
): Promise<{ target: string; path: string }> => {
  const response = await fetch(`${endpoint}/integration/topics/${topicId}/open`, {
    method: 'POST',
    headers: createHeaders(authToken)
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to open topic in explorer')
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

export const searchWorkspaceFilesAPI = async (
  endpoint: string,
  query: string,
  authToken?: string
): Promise<WorkspaceFileSearchResponse> => {
  const response = await fetch(
    `${endpoint}/integration/files/search?query=${encodeURIComponent(query)}`,
    {
      method: 'GET',
      headers: createHeaders(authToken)
    }
  )

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to search workspace files')
  }

  return response.json()
}

export const detectWorkspaceSnippetAPI = async (
  endpoint: string,
  snippet: string,
  authToken?: string
): Promise<WorkspaceSnippetMatchResponse> => {
  const response = await fetch(`${endpoint}/integration/files/detect-snippet`, {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ snippet })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Failed to detect snippet source')
  }

  return response.json()
}
