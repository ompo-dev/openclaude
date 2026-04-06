'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'

import { toast } from 'sonner'

import {
  getIntegrationConfigAPI,
  saveIntegrationConfigAPI
} from '@/api/integration'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import useChatActions from '@/hooks/useChatActions'
import { getProviderIcon } from '@/lib/modelProvider'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import {
  IntegrationConfigPayload,
  IntegrationSnapshot,
  ProviderStatus
} from '@/types/integration'

import SectionCard from './SectionCard'

type AgentModelDraft = {
  id: string
  name: string
  base_url: string
  api_key: string
  api_key_masked: string | null
  api_key_configured: boolean
}

type AgentRoutingDraft = {
  id: string
  key: string
  model: string
}

type DraftState = {
  runtime: {
    profile: string
    model: string
    base_url: string
    api_key: string
    gemini_auth_mode: string
    chatgpt_account_id: string
  }
  router: {
    mode: string
    model_id: string
    base_url: string
    api_key: string
    provider_name: string
  }
  native_settings: {
    agent_models: AgentModelDraft[]
    agent_routing: AgentRoutingDraft[]
  }
}

const PROFILE_OPTIONS = [
  ['anthropic', 'Anthropic first-party', 'claude-sonnet-4-6'],
  ['openai', 'OpenAI-compatible', 'gpt-4.1-mini'],
  ['ollama', 'Ollama local', 'qwen2.5-coder:7b'],
  ['gemini', 'Gemini OpenAI-compatible', 'gemini-2.0-flash'],
  ['codex', 'Codex', 'codexplan'],
  ['atomic-chat', 'Atomic Chat local', 'llama3:8b']
] as const

const ROUTER_MODE_OPTIONS = [
  ['inherit', 'Inherit runtime profile'],
  ['explicit', 'Use explicit router model']
] as const

const GEMINI_AUTH_OPTIONS = [
  ['api-key', 'API key'],
  ['access-token', 'Access token'],
  ['adc', 'ADC']
] as const

const inputClassName =
  'h-10 w-full rounded-xl border border-primary/10 bg-background-secondary px-3 text-sm text-secondary outline-none transition-colors placeholder:text-muted focus:border-primary/30'

const fieldLabelClassName = 'mb-2 text-[11px] uppercase text-muted'

const createDraftId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`

const buildDraft = (snapshot: IntegrationSnapshot): DraftState => ({
  runtime: {
    profile: snapshot.runtime.profile,
    model: snapshot.runtime.model,
    base_url: snapshot.runtime.base_url,
    api_key: '',
    gemini_auth_mode: snapshot.runtime.gemini_auth_mode || 'api-key',
    chatgpt_account_id: snapshot.runtime.chatgpt_account_id || ''
  },
  router: {
    mode: snapshot.router.mode,
    model_id:
      snapshot.router.model_id || snapshot.router.effective_model_id || '',
    base_url:
      snapshot.router.base_url || snapshot.router.effective_base_url || '',
    api_key: '',
    provider_name: snapshot.router.provider_name || 'OpenAI-Compatible'
  },
  native_settings: {
    agent_models: snapshot.native_settings.agent_models.map((entry) => ({
      id: createDraftId(),
      name: entry.name,
      base_url: entry.base_url,
      api_key: '',
      api_key_masked: entry.api_key_masked,
      api_key_configured: entry.api_key_configured
    })),
    agent_routing: snapshot.native_settings.agent_routing.map((entry) => ({
      id: createDraftId(),
      key: entry.key,
      model: entry.model
    }))
  }
})

const Field = ({
  label,
  children
}: {
  label: string
  children: ReactNode
}) => (
  <label className="block">
    <div className={fieldLabelClassName}>{label}</div>
    {children}
  </label>
)

const StatusBadge = ({ value }: { value: string }) => (
  <span
    className={cn(
      'inline-flex rounded-full px-2.5 py-1 text-[11px] uppercase tracking-wide',
      value === 'active' && 'bg-primary/15 text-primary',
      value === 'connected' && 'bg-positive/15 text-positive',
      value === 'offline' && 'bg-destructive/15 text-destructive',
      value === 'manual' && 'bg-background-secondary text-muted'
    )}
  >
    {value}
  </span>
)

const ProviderCard = ({ provider }: { provider: ProviderStatus }) => {
  const icon = getProviderIcon(provider.label)

  return (
    <div className="rounded-xl border border-primary/10 bg-background-secondary p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon ? <Icon type={icon} size="xs" /> : <Icon type="agent" size="xs" />}
          <div>
            <div className="text-sm font-medium text-secondary">
              {provider.label}
            </div>
            <div className="text-xs text-muted">{provider.base_url}</div>
          </div>
        </div>
        <StatusBadge value={provider.status} />
      </div>
      <div className="text-xs text-muted">
        {provider.models.length > 0
          ? provider.models.join(', ')
          : 'No models detected yet'}
      </div>
    </div>
  )
}

const SettingsView = () => {
  const { selectedEndpoint, authToken } = useStore()
  const { initialize } = useChatActions()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)

  const currentProvider = useMemo(
    () =>
      snapshot?.providers.find(
        (provider) => provider.id === draft?.runtime.profile
      ),
    [draft?.runtime.profile, snapshot?.providers]
  )

  const configuredAgentModels = useMemo(
    () =>
      draft?.native_settings.agent_models
        .map((entry) => entry.name.trim())
        .filter(
          (entry, index, collection) =>
            entry.length > 0 && collection.indexOf(entry) === index
        ) || [],
    [draft?.native_settings.agent_models]
  )

  const routingKeySuggestions = useMemo(() => {
    if (!snapshot || !draft) return []

    return Array.from(
      new Set([
        ...snapshot.native_settings.recommended_routing_keys,
        ...draft.native_settings.agent_routing
          .map((entry) => entry.key.trim())
          .filter(Boolean)
      ])
    )
  }, [draft, snapshot])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const nextSnapshot = await getIntegrationConfigAPI(selectedEndpoint, authToken)
      setSnapshot(nextSnapshot)
      setDraft(buildDraft(nextSnapshot))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to load config'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEndpoint, authToken])

  const runtimeDescription = useMemo(() => {
    switch (snapshot?.runtime.source) {
      case 'claude-config':
        return 'This runtime is inheriting the Claude Code login from your local config directory. Leave the credential blank to keep using the same Anthropic account that powers the CLI.'
      case 'profile-file':
        return 'This profile is persisted in .openclaude-profile.json and is reused by the native OpenClaude runtime invoked from the web UI.'
      case 'environment':
        return 'This runtime is currently being resolved from environment variables inherited by the web process.'
      default:
        return 'Configure the OpenClaude runtime profile and keep the local web router aligned with the same provider stack used by the CLI.'
    }
  }, [snapshot?.runtime.source])

  const runtimeCredentialPlaceholder = useMemo(() => {
    if (!snapshot || !draft) {
      return 'Leave blank to keep current secret'
    }

    if (
      draft.runtime.profile === 'anthropic' &&
      snapshot.runtime.profile === 'anthropic' &&
      snapshot.runtime.source === 'claude-config'
    ) {
      return 'Inherited from Claude Code login'
    }

    return (
      snapshot.runtime.api_key_masked || 'Leave blank to keep current secret'
    )
  }, [
    draft,
    snapshot,
  ])

  const handleRuntimeField = (
    field: keyof DraftState['runtime'],
    value: string
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            runtime: {
              ...current.runtime,
              [field]: value
            }
          }
        : current
    )
  }

  const handleRouterField = (
    field: keyof DraftState['router'],
    value: string
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            router: {
              ...current.router,
              [field]: value
            }
          }
        : current
    )
  }

  const handleAgentModelField = (
    rowId: string,
    field: keyof AgentModelDraft,
    value: string
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            native_settings: {
              ...current.native_settings,
              agent_models: current.native_settings.agent_models.map((entry) =>
                entry.id === rowId
                  ? {
                      ...entry,
                      [field]: value
                    }
                  : entry
              )
            }
          }
        : current
    )
  }

  const handleRoutingField = (
    rowId: string,
    field: keyof AgentRoutingDraft,
    value: string
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            native_settings: {
              ...current.native_settings,
              agent_routing: current.native_settings.agent_routing.map((entry) =>
                entry.id === rowId
                  ? {
                      ...entry,
                      [field]: value
                    }
                  : entry
              )
            }
          }
        : current
    )
  }

  const handleProfileChange = (profile: string) => {
    const provider = snapshot?.providers.find((item) => item.id === profile)
    const profileOption = PROFILE_OPTIONS.find((item) => item[0] === profile)

    setDraft((current) =>
      current
        ? {
            ...current,
            runtime: {
              ...current.runtime,
              profile,
              model:
                current.runtime.profile === profile
                  ? current.runtime.model
                  : profileOption?.[2] || current.runtime.model,
              base_url:
                provider?.base_url ||
                provider?.default_base_url ||
                current.runtime.base_url
            }
          }
        : current
    )
  }

  const addAgentModel = () => {
    setDraft((current) =>
      current
        ? {
            ...current,
            native_settings: {
              ...current.native_settings,
              agent_models: [
                ...current.native_settings.agent_models,
                {
                  id: createDraftId(),
                  name: '',
                  base_url: '',
                  api_key: '',
                  api_key_masked: null,
                  api_key_configured: false
                }
              ]
            }
          }
        : current
    )
  }

  const removeAgentModel = (rowId: string) => {
    setDraft((current) => {
      if (!current) return current

      const removedModel = current.native_settings.agent_models.find(
        (entry) => entry.id === rowId
      )

      return {
        ...current,
        native_settings: {
          ...current.native_settings,
          agent_models: current.native_settings.agent_models.filter(
            (entry) => entry.id !== rowId
          ),
          agent_routing: current.native_settings.agent_routing.map((entry) =>
            removedModel?.name.trim() === entry.model
              ? {
                  ...entry,
                  model: ''
                }
              : entry
          )
        }
      }
    })
  }

  const addRoutingRule = () => {
    setDraft((current) =>
      current
        ? {
            ...current,
            native_settings: {
              ...current.native_settings,
              agent_routing: [
                ...current.native_settings.agent_routing,
                {
                  id: createDraftId(),
                  key: '',
                  model: ''
                }
              ]
            }
          }
        : current
    )
  }

  const removeRoutingRule = (rowId: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            native_settings: {
              ...current.native_settings,
              agent_routing: current.native_settings.agent_routing.filter(
                (entry) => entry.id !== rowId
              )
            }
          }
        : current
    )
  }

  const handleSave = async () => {
    if (!draft) return

    const currentDraft = draft
    const payload: IntegrationConfigPayload = {
      runtime: {
        profile: currentDraft.runtime.profile,
        model: currentDraft.runtime.model,
        base_url: currentDraft.runtime.base_url,
        gemini_auth_mode: currentDraft.runtime.gemini_auth_mode,
        chatgpt_account_id: currentDraft.runtime.chatgpt_account_id || undefined,
        ...(currentDraft.runtime.api_key
          ? { api_key: currentDraft.runtime.api_key }
          : {})
      },
      router: {
        mode: currentDraft.router.mode,
        provider_name: currentDraft.router.provider_name || undefined,
        ...(currentDraft.router.mode === 'explicit'
          ? {
              model_id: currentDraft.router.model_id,
              base_url: currentDraft.router.base_url,
              ...(currentDraft.router.api_key
                ? { api_key: currentDraft.router.api_key }
                : {})
            }
          : {})
      },
      native_settings: {
        agent_models: currentDraft.native_settings.agent_models
          .map((entry) => ({
            name: entry.name.trim(),
            base_url: entry.base_url.trim(),
            ...(entry.api_key ? { api_key: entry.api_key } : {})
          }))
          .filter((entry) => entry.name && entry.base_url),
        agent_routing: currentDraft.native_settings.agent_routing.reduce<Record<string, string>>(
          (collection, entry) => {
            const key = entry.key.trim()
            const model = entry.model.trim()
            if (key && model) {
              collection[key] = model
            }
            return collection
          },
          {}
        )
      }
    }

    setSaving(true)
    try {
      const nextSnapshot = await saveIntegrationConfigAPI(
        selectedEndpoint,
        payload,
        authToken
      )
      setSnapshot(nextSnapshot)
      setDraft(buildDraft(nextSnapshot))
      await initialize()
      toast.success('Integration settings saved')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save config'
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading || !snapshot || !draft) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Loading integration settings...
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-primary/10 px-8 py-6">
        <div className="mb-2 flex items-center gap-2">
          <Icon type="hammer" size="xs" />
          <span className="text-xs font-medium uppercase text-primary">
            Settings
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-secondary">
          OpenClaude Web configuration
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Configure the OpenClaude runtime profile, the local router and the
          native model registry used by OpenClaude itself.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6 grid gap-3 md:grid-cols-5">
          <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
            <div className="mb-1 text-[11px] uppercase text-muted">Runtime</div>
            <div className="text-sm font-medium text-secondary">
              {snapshot.runtime.label}
            </div>
          </div>
          <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
            <div className="mb-1 text-[11px] uppercase text-muted">
              Effective Router
            </div>
            <div className="text-sm font-medium text-secondary">
              {snapshot.router.effective_model_id || 'pending'}
            </div>
          </div>
          <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
            <div className="mb-1 text-[11px] uppercase text-muted">
              Tool Catalog
            </div>
            <div className="text-sm font-medium text-secondary">
              {snapshot.tools.count} native tools
            </div>
          </div>
          <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
            <div className="mb-1 text-[11px] uppercase text-muted">
              Agent Models
            </div>
            <div className="text-sm font-medium text-secondary">
              {snapshot.native_settings.agent_models.length} configured
            </div>
          </div>
          <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
            <div className="mb-1 text-[11px] uppercase text-muted">
              Settings File
            </div>
            <div className="text-sm font-medium text-secondary">
              {snapshot.native_settings.exists ? 'Detected' : 'Will be created'}
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <div className="space-y-6">
            <SectionCard
              title="OpenClaude Runtime"
              description={runtimeDescription}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Profile">
                  <Select
                    value={draft.runtime.profile}
                    onValueChange={handleProfileChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROFILE_OPTIONS.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Model">
                  <input
                    className={inputClassName}
                    value={draft.runtime.model}
                    onChange={(event) =>
                      handleRuntimeField('model', event.target.value)
                    }
                    placeholder="qwen2.5-coder:7b"
                  />
                </Field>
                <Field label="Base URL">
                  <input
                    className={inputClassName}
                    value={draft.runtime.base_url}
                    onChange={(event) =>
                      handleRuntimeField('base_url', event.target.value)
                    }
                    placeholder={currentProvider?.default_base_url}
                  />
                </Field>
                <Field label="API Key">
                  <input
                    className={inputClassName}
                    type="password"
                    value={draft.runtime.api_key}
                    onChange={(event) =>
                      handleRuntimeField('api_key', event.target.value)
                    }
                    placeholder={runtimeCredentialPlaceholder}
                  />
                </Field>
                {draft.runtime.profile === 'gemini' ? (
                  <Field label="Gemini Auth">
                    <Select
                      value={draft.runtime.gemini_auth_mode}
                      onValueChange={(value) =>
                        handleRuntimeField('gemini_auth_mode', value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GEMINI_AUTH_OPTIONS.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                {draft.runtime.profile === 'codex' ? (
                  <Field label="ChatGPT Account ID">
                    <input
                      className={inputClassName}
                      value={draft.runtime.chatgpt_account_id}
                      onChange={(event) =>
                        handleRuntimeField(
                          'chatgpt_account_id',
                          event.target.value
                        )
                      }
                      placeholder="Required for Codex-backed sessions"
                    />
                  </Field>
                ) : null}
              </div>

              {draft.runtime.profile === 'anthropic' &&
              snapshot.runtime.profile === 'anthropic' &&
              snapshot.runtime.source === 'claude-config' ? (
                <div className="mt-4 rounded-xl border border-primary/10 bg-background-secondary px-4 py-3 text-sm text-muted">
                  Claude Code login detected from the local config directory
                  (`~/.openclaude` or legacy `~/.claude`). The web runtime is
                  inheriting that same Anthropic session automatically.
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Web Router"
              description="The router can inherit the runtime profile or use a dedicated OpenAI-compatible model just for orchestration in the web shell."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Mode">
                  <Select
                    value={draft.router.mode}
                    onValueChange={(value) => handleRouterField('mode', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROUTER_MODE_OPTIONS.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Provider Label">
                  <input
                    className={inputClassName}
                    value={draft.router.provider_name}
                    onChange={(event) =>
                      handleRouterField('provider_name', event.target.value)
                    }
                    placeholder="OpenAI-Compatible"
                  />
                </Field>
                {draft.router.mode === 'explicit' ? (
                  <>
                    <Field label="Router Model ID">
                      <input
                        className={inputClassName}
                        value={draft.router.model_id}
                        onChange={(event) =>
                          handleRouterField('model_id', event.target.value)
                        }
                        placeholder="gpt-4.1-mini"
                      />
                    </Field>
                    <Field label="Router Base URL">
                      <input
                        className={inputClassName}
                        value={draft.router.base_url}
                        onChange={(event) =>
                          handleRouterField('base_url', event.target.value)
                        }
                        placeholder="https://api.openai.com/v1"
                      />
                    </Field>
                    <Field label="Router API Key">
                      <input
                        className={inputClassName}
                        type="password"
                        value={draft.router.api_key}
                        onChange={(event) =>
                          handleRouterField('api_key', event.target.value)
                        }
                        placeholder={
                          snapshot.router.api_key_masked ||
                          'Leave blank to keep current secret'
                        }
                      />
                    </Field>
                  </>
                ) : null}
              </div>

              <div className="mt-4 rounded-xl border border-primary/10 bg-background-secondary px-4 py-3 text-sm text-muted">
                Effective router: {snapshot.router.effective_provider || 'pending'} /{' '}
                {snapshot.router.effective_model_id || 'pending'}
              </div>
            </SectionCard>

            <SectionCard
              title="Agent Models"
              description="These entries are saved into the native OpenClaude settings file so subagent routing and quick runtime switching use the same model registry."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addAgentModel}
                  className="rounded-xl"
                >
                  <Icon type="plus-icon" size="xs" />
                  Add Model
                </Button>
              }
            >
              <div className="mb-4 rounded-xl border border-primary/10 bg-background-secondary px-4 py-3 text-sm text-muted">
                Settings path: {snapshot.native_settings.settings_path}
              </div>
              <div className="space-y-3">
                {draft.native_settings.agent_models.length > 0 ? (
                  draft.native_settings.agent_models.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-primary/10 bg-background-secondary p-4"
                    >
                      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr,1.3fr,1fr,auto]">
                        <Field label="Model Name">
                          <input
                            className={inputClassName}
                            value={entry.name}
                            onChange={(event) =>
                              handleAgentModelField(
                                entry.id,
                                'name',
                                event.target.value
                              )
                            }
                            placeholder="deepseek-chat"
                          />
                        </Field>
                        <Field label="Base URL">
                          <input
                            className={inputClassName}
                            value={entry.base_url}
                            onChange={(event) =>
                              handleAgentModelField(
                                entry.id,
                                'base_url',
                                event.target.value
                              )
                            }
                            placeholder="https://api.deepseek.com/v1"
                          />
                        </Field>
                        <Field label="API Key">
                          <input
                            className={inputClassName}
                            type="password"
                            value={entry.api_key}
                            onChange={(event) =>
                              handleAgentModelField(
                                entry.id,
                                'api_key',
                                event.target.value
                              )
                            }
                            placeholder={
                              entry.api_key_masked ||
                              'Leave blank to keep current secret'
                            }
                          />
                        </Field>
                        <div className="flex items-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 rounded-xl px-3 text-destructive hover:text-destructive"
                            onClick={() => removeAgentModel(entry.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                      <div className="text-xs text-muted">
                        {entry.api_key_configured || entry.api_key_masked
                          ? 'Existing secret is preserved when this field stays blank.'
                          : 'No secret stored for this model yet.'}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-primary/10 px-4 py-6 text-sm text-muted">
                    No agent models saved yet. Add OpenAI-compatible model endpoints here to reuse them in routing and in the sidebar quick switcher.
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Agent Routing"
              description="Map subagent roles to saved model names exactly like the native OpenClaude settings schema."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addRoutingRule}
                  className="rounded-xl"
                >
                  <Icon type="plus-icon" size="xs" />
                  Add Rule
                </Button>
              }
            >
              <div className="mb-4 flex flex-wrap gap-2">
                {routingKeySuggestions.map((key) => (
                  <span
                    key={key}
                    className="rounded-full border border-primary/10 bg-background-secondary px-3 py-1.5 text-xs text-secondary"
                  >
                    {key}
                  </span>
                ))}
              </div>
              <div className="space-y-3">
                {draft.native_settings.agent_routing.length > 0 ? (
                  draft.native_settings.agent_routing.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-primary/10 bg-background-secondary p-4"
                    >
                      <div className="grid gap-4 md:grid-cols-[1fr,1fr,auto]">
                        <Field label="Route Key">
                          <input
                            className={inputClassName}
                            value={entry.key}
                            onChange={(event) =>
                              handleRoutingField(
                                entry.id,
                                'key',
                                event.target.value
                              )
                            }
                            placeholder="Explore"
                          />
                        </Field>
                        <Field label="Target Model">
                          {configuredAgentModels.length > 0 ? (
                            <Select
                              value={entry.model}
                              onValueChange={(value) =>
                                handleRoutingField(entry.id, 'model', value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a saved model" />
                              </SelectTrigger>
                              <SelectContent>
                                {configuredAgentModels.map((modelName) => (
                                  <SelectItem key={modelName} value={modelName}>
                                    {modelName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <input
                              className={inputClassName}
                              value={entry.model}
                              onChange={(event) =>
                                handleRoutingField(
                                  entry.id,
                                  'model',
                                  event.target.value
                                )
                              }
                              placeholder="gpt-4o"
                            />
                          )}
                        </Field>
                        <div className="flex items-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 rounded-xl px-3 text-destructive hover:text-destructive"
                            onClick={() => removeRoutingRule(entry.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-primary/10 px-4 py-6 text-sm text-muted">
                    No routing rules yet. Add entries like `Explore`, `Plan`, `general-purpose`, `frontend-dev` and `default`.
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              title="Detected Providers"
              description="These cards show which local backends are reachable and which profile is currently active."
            >
              <div className="space-y-3">
                {snapshot.providers.map((provider) => (
                  <ProviderCard key={provider.id} provider={provider} />
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="OpenClaude Toolchain"
              description={snapshot.tools.summary}
            >
              <div className="max-h-80 overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {snapshot.tools.items.map((tool) => (
                    <span
                      key={tool.id}
                      className="rounded-full border border-primary/10 bg-background-secondary px-3 py-1.5 text-xs text-secondary"
                    >
                      {tool.label}
                    </span>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Platform Features Adapted"
              description="This section tracks what we brought from the upstream platform docs into the local fork, without changing the OpenClaude workflow."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-xl"
                >
                  <Icon type="save" size="xs" />
                  {saving ? 'Saving...' : 'Save Settings'}
                </Button>
              }
            >
              <div className="space-y-3">
                {snapshot.platform_features.map((feature) => (
                  <div
                    key={feature.id}
                    className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-secondary">
                        {feature.label}
                      </div>
                      <StatusBadge
                        value={feature.enabled ? 'active' : 'manual'}
                      />
                    </div>
                    <div className="text-xs text-muted">{feature.notes}</div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsView
