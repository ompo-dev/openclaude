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

export interface IntegrationSnapshot {
  status: IntegrationStatus
  runtime: RuntimeProfileSnapshot
  router: RouterSnapshot
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
}
