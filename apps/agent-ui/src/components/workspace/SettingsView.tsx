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
}

const PROFILE_OPTIONS = [
  {
    value: 'anthropic',
    label: 'Anthropic first-party',
    defaultModel: 'claude-sonnet-4-6'
  },
  {
    value: 'openai',
    label: 'OpenAI-compatible',
    defaultModel: 'gpt-4.1-mini'
  },
  { value: 'ollama', label: 'Ollama local', defaultModel: 'qwen2.5-coder:7b' },
  {
    value: 'gemini',
    label: 'Gemini OpenAI-compatible',
    defaultModel: 'gemini-2.0-flash'
  },
  { value: 'codex', label: 'Codex', defaultModel: 'codexplan' },
  {
    value: 'atomic-chat',
    label: 'Atomic Chat local',
    defaultModel: 'llama3:8b'
  }
]

const ROUTER_MODE_OPTIONS = [
  { value: 'inherit', label: 'Inherit runtime profile' },
  { value: 'explicit', label: 'Use explicit router model' }
]

const GEMINI_AUTH_OPTIONS = [
  { value: 'api-key', label: 'API key' },
  { value: 'access-token', label: 'Access token' },
  { value: 'adc', label: 'ADC' }
]

const inputClassName =
  'h-10 w-full rounded-xl border border-primary/10 bg-background-secondary px-3 text-sm text-secondary outline-none transition-colors placeholder:text-muted focus:border-primary/30'

const fieldLabelClassName = 'mb-2 text-[11px] uppercase text-muted'

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
    if (
      draft?.runtime.profile === 'anthropic' &&
      snapshot?.runtime.profile === 'anthropic' &&
      snapshot.runtime.source === 'claude-config'
    ) {
      return 'Inherited from Claude Code login'
    }

    return (
      snapshot?.runtime.api_key_masked || 'Leave blank to keep current secret'
    )
  }, [
    draft?.runtime.profile,
    snapshot?.runtime.api_key_masked,
    snapshot?.runtime.profile,
    snapshot?.runtime.source
  ])

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

  const handleProfileChange = (profile: string) => {
    const provider = snapshot?.providers.find((item) => item.id === profile)
    const profileOption = PROFILE_OPTIONS.find((item) => item.value === profile)
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
                  : profileOption?.defaultModel || current.runtime.model,
              base_url:
                provider?.base_url ||
                provider?.default_base_url ||
                current.runtime.base_url
            }
          }
        : current
    )
  }

  const handleSave = async () => {
    if (!draft) return

    const payload: IntegrationConfigPayload = {
      runtime: {
        profile: draft.runtime.profile,
        model: draft.runtime.model,
        base_url: draft.runtime.base_url,
        gemini_auth_mode: draft.runtime.gemini_auth_mode,
        chatgpt_account_id: draft.runtime.chatgpt_account_id || undefined,
        ...(draft.runtime.api_key ? { api_key: draft.runtime.api_key } : {})
      },
      router: {
        mode: draft.router.mode,
        provider_name: draft.router.provider_name || undefined,
        ...(draft.router.mode === 'explicit'
          ? {
              model_id: draft.router.model_id,
              base_url: draft.router.base_url,
              ...(draft.router.api_key ? { api_key: draft.router.api_key } : {})
            }
          : {})
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
          Configure the OpenClaude runtime profile, keep the local router in
          sync and inspect which platform capabilities were adapted into this
          local fork.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6 grid gap-3 md:grid-cols-4">
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
              Storage
            </div>
            <div className="text-sm font-medium text-secondary">
              {snapshot.status.agentos_db}
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
                    <SelectTrigger className="rounded-xl border-primary/10 bg-background-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROFILE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
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
                      <SelectTrigger className="rounded-xl border-primary/10 bg-background-secondary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GEMINI_AUTH_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
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
                    <SelectTrigger className="rounded-xl border-primary/10 bg-background-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROUTER_MODE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
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
