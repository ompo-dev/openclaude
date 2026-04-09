export interface IntegrationStatus {
  workspace_root: string
  agno_state_dir: string
  agentos_db: string
  openclaude_built: boolean
  profile_detected: boolean
  resolved_model: string | null
  resolved_base_url: string | null
  runtime_profile: string | null
  router_mode: string | null
  tool_count: number
  repo_name?: string | null
  branch?: string | null
  is_dirty?: boolean
  changed_file_count?: number
  topic_count?: number
}

export interface RuntimeProfileSnapshot {
  profile: string
  label: string
  source: string
  created_at: string | null
  model: string
  base_url: string
  api_key_masked: string | null
  api_key_configured: boolean
  gemini_auth_mode: string | null
  chatgpt_account_id: string | null
}

export interface RouterSnapshot {
  mode: string
  source: string
  model_id: string | null
  base_url: string | null
  provider_name: string
  api_key_masked: string | null
  api_key_configured: boolean
  effective_model_id: string | null
  effective_base_url: string | null
  effective_provider: string | null
}

export interface ProviderStatus {
  id: string
  label: string
  active: boolean
  default_base_url: string
  base_url: string
  status: string
  models: string[]
}

export interface ToolCatalogEntry {
  id: string
  name: string
  label: string
  source: string
}

export interface PlatformFeature {
  id: string
  label: string
  enabled: boolean
  notes: string
}

export interface AgentModelEntry {
  name: string
  base_url: string
  api_key_masked: string | null
  api_key_configured: boolean
}

export interface AgentRoutingEntry {
  key: string
  model: string
}

export interface NativeSettingsSnapshot {
  config_home: string
  settings_path: string
  exists: boolean
  source: string
  cowork_mode: boolean
  agent_models: AgentModelEntry[]
  agent_routing: AgentRoutingEntry[]
  recommended_routing_keys: string[]
}

export interface IntegrationSnapshot {
  status: IntegrationStatus
  runtime: RuntimeProfileSnapshot
  router: RouterSnapshot
  native_settings: NativeSettingsSnapshot
  providers: ProviderStatus[]
  tools: {
    count: number
    access_mode: string
    summary: string
    items: ToolCatalogEntry[]
  }
  platform_features: PlatformFeature[]
}

export interface RuntimeConfigPayload {
  profile: string
  model: string
  base_url: string
  api_key?: string
  gemini_auth_mode?: string
  chatgpt_account_id?: string
}

export interface RouterConfigPayload {
  mode: string
  model_id?: string
  base_url?: string
  api_key?: string
  provider_name?: string
}

export interface IntegrationConfigPayload {
  runtime: RuntimeConfigPayload
  router: RouterConfigPayload
  native_settings?: {
    agent_models: {
      name: string
      base_url: string
      api_key?: string
    }[]
    agent_routing: Record<string, string>
  }
}

export interface SlashCatalogEntry {
  id: string
  name: string
  slash: string
  kind: 'command' | 'skill'
  source: string
  loaded_from: string | null
  description: string
  aliases: string[]
}

export interface SlashPluginEntry {
  id: string
  name: string
  description: string
  source: string
  enabled: boolean
  builtin: boolean
}

export interface SlashCatalogSnapshot {
  generated_at: string
  commands: SlashCatalogEntry[]
  skills: SlashCatalogEntry[]
  plugins: SlashPluginEntry[]
}

export interface InstalledSkillRecord {
  name: string
  path: string
  scope: string
  agents: string[]
  active: boolean
  slash: string
  description: string
  loaded_from: string | null
}

export interface SkillsSnapshot {
  generated_at: string
  workspace_root: string
  project_root: string
  items: InstalledSkillRecord[]
}

export interface SkillsMutationResponse extends SkillsSnapshot {
  output: string
}

export interface SkillLibraryEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
}

export interface SkillLibrarySnapshot {
  root: string
  items: SkillLibraryEntry[]
}

export interface SkillFileSnapshot {
  root: string
  path: string
  content: string
  updated_at: string
  format?: 'markdown' | 'yaml' | 'svg' | 'text' | 'image' | 'code'
  media_type?: string | null
  encoding?: 'utf-8' | 'base64'
  preview_data_url?: string | null
  editable?: boolean
}

export interface TopicRecord {
  id: string
  name: string
  slug: string
  kind?: string | null
  description?: string | null
  project_root: string
  repo_name: string
  branch?: string | null
  created_at: string
  updated_at: string
  session_ids: string[]
}

export interface TopicMutationResponse {
  item: TopicRecord
  items: TopicRecord[]
}

export interface WorkspaceFileSearchEntry {
  path: string
  name: string
}

export interface WorkspaceFileSearchResponse {
  items: WorkspaceFileSearchEntry[]
}

export interface WorkspaceSnippetMatch {
  path: string
  name: string
  line_start: number
  line_end: number
}

export interface WorkspaceSnippetMatchResponse {
  match: WorkspaceSnippetMatch | null
}

export interface WorkspaceChangedFile {
  path: string
  kind: string
  tracked: boolean
  staged_status?: string | null
  unstaged_status?: string | null
  insertions?: number | null
  deletions?: number | null
  patch_preview?: string | null
  patch_truncated: boolean
}

export interface WorkspaceContext {
  workspace_root: string
  project_root: string
  project_label: string
  repo_root?: string | null
  repo_name: string
  origin_url?: string | null
  branch?: string | null
  head?: string | null
  upstream?: string | null
  ahead: number
  behind: number
  is_git_repo: boolean
  is_dirty: boolean
  changed_file_count: number
  total_insertions?: number
  total_deletions?: number
  staged_file_count?: number
  unstaged_file_count?: number
  untracked_file_count?: number
  topic_count: number
  changed_files: WorkspaceChangedFile[]
}

export interface WorkspaceBranch {
  name: string
  short_name: string
  kind: 'local' | 'remote'
  current: boolean
}

export interface BranchListResponse {
  items: WorkspaceBranch[]
  current_branch: string | null
  project_root: string
  repo_name?: string | null
}

export interface WorkspaceBootstrapResponse {
  workspace: WorkspaceContext
  topic: TopicRecord | null
  topics: TopicRecord[]
  branches: BranchListResponse
}

export interface GitOverview {
  workspace: WorkspaceContext
  summary: {
    changed_file_count: number
    total_insertions: number
    total_deletions: number
    staged_file_count: number
    unstaged_file_count: number
    untracked_file_count: number
  }
  actions: {
    can_commit: boolean
    can_push: boolean
    can_create_pr: boolean
    gh_available: boolean
  }
}

export interface GitCommitResult extends WorkspaceBootstrapResponse {
  commit_message: string
  push?: {
    branch?: string | null
    upstream?: string | null
  } | null
  pull_request?: {
    url?: string | null
    draft: boolean
    base?: string | null
  } | null
  git: GitOverview
}

export interface OpenWithTarget {
  id: string
  label: string
  description: string
  installed: boolean
  preferred: boolean
}

export interface OpenWithTargetsResponse {
  items: OpenWithTarget[]
}

export interface OpenWithLaunchResponse {
  target: string
  label: string
  workspace: string
}

export interface OpenEditorLaunchResponse {
  target: string
  label: string
  path: string
}

export interface FolderPickerResponse {
  path: string | null
  cancelled: boolean
}

export interface TerminalEntry {
  id: string
  kind: 'command' | 'output'
  text: string
  created_at: string
  exit_code?: number
  success?: boolean
  raw?: boolean
}

export interface TerminalSnapshot {
  cwd: string
  shell: string
  entries: TerminalEntry[]
  last_exit_code?: number
  success?: boolean
  interactive: boolean
  active_command?: string | null
}

export interface TerminalCompletionSnapshot {
  cwd: string
  replacement_index: number
  replacement_length: number
  matches: string[]
}

export interface GitCommitPayload {
  message?: string
  include_untracked?: boolean
  action?: 'commit' | 'commit_and_push' | 'commit_and_create_pr'
  draft?: boolean
}
