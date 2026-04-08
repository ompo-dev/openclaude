'use client'

import { ChevronDown, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { toast } from 'sonner'

import {
  activateNamedModelAPI,
  getIntegrationConfigAPI
} from '@/api/integration'
import useChatActions from '@/hooks/useChatActions'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { IntegrationSnapshot } from '@/types/integration'

const QUALITY_OPTIONS = ['Altissimo', 'Alto', 'Medio', 'Rapido'] as const

interface ChatComposerBarProps {
  onAttachClick?: () => void
}

const ChatComposerBar = ({ onAttachClick }: ChatComposerBarProps) => {
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const setWorkspaceView = useStore((state) => state.setWorkspaceView)
  const selectedModel = useStore((state) => state.selectedModel)
  const [quality, setQuality] =
    useState<(typeof QUALITY_OPTIONS)[number]>('Altissimo')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(true)
  const [isModelPending, setIsModelPending] = useState(false)
  const [integrationSnapshot, setIntegrationSnapshot] =
    useState<IntegrationSnapshot | null>(null)
  const { initialize } = useChatActions()

  const savedModelNames = useMemo(
    () =>
      integrationSnapshot?.native_settings.agent_models
        .map((entry) => entry.name.trim())
        .filter(Boolean)
        .filter(
          (entry, index, collection) => collection.indexOf(entry) === index
        ) ?? [],
    [integrationSnapshot?.native_settings.agent_models]
  )

  const currentModelLabel = useMemo(() => {
    if (integrationSnapshot?.runtime.model) {
      return integrationSnapshot.runtime.model
    }
    return selectedModel || 'Modelo'
  }, [integrationSnapshot?.runtime.model, selectedModel])

  useEffect(() => {
    let cancelled = false

    const loadIntegrationSnapshot = async () => {
      setIsModelLoading(true)
      try {
        const nextSnapshot = await getIntegrationConfigAPI(
          selectedEndpoint,
          authToken
        )
        if (!cancelled) {
          setIntegrationSnapshot(nextSnapshot)
        }
      } catch (error) {
        if (!cancelled) {
          setIntegrationSnapshot(null)
          toast.error(
            error instanceof Error
              ? error.message
              : 'Falha ao carregar os modelos do OpenClaude'
          )
        }
      } finally {
        if (!cancelled) {
          setIsModelLoading(false)
        }
      }
    }

    void loadIntegrationSnapshot()
    return () => {
      cancelled = true
    }
  }, [authToken, selectedEndpoint])

  const handleModelChange = async (modelName: string) => {
    setShowModelMenu(false)
    if (!modelName || modelName === currentModelLabel) {
      return
    }

    if (modelName === '__settings__') {
      setWorkspaceView('settings')
      return
    }

    setIsModelPending(true)
    try {
      const nextSnapshot = await activateNamedModelAPI(
        selectedEndpoint,
        modelName,
        authToken
      )
      setIntegrationSnapshot(nextSnapshot)
      await initialize()
      toast.success(`Modelo ativo: ${modelName}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao trocar de modelo'
      )
    } finally {
      setIsModelPending(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onAttachClick}
        className="flex h-6 w-6 items-center justify-center rounded-full text-[#9e9ea7] transition-colors hover:bg-white/5 hover:text-white"
        title="Adicionar contexto"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowModelMenu((current) => !current)
            setShowQualityMenu(false)
          }}
          disabled={isModelLoading || isModelPending}
          className="flex items-center gap-1 text-xs text-[#b8b8c0] transition-colors hover:text-white disabled:opacity-50"
        >
          <span className="max-w-[160px] truncate">{currentModelLabel}</span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {showModelMenu ? (
          <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[220px] overflow-hidden rounded-2xl border border-[#2d2d33] bg-[#151518] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
            {savedModelNames.map((modelName) => (
              <button
                key={modelName}
                type="button"
                onClick={() => {
                  void handleModelChange(modelName)
                }}
                className={cn(
                  'block w-full rounded-xl px-3 py-2 text-left text-xs transition-colors',
                  modelName === currentModelLabel
                    ? 'bg-white/6 text-white'
                    : 'text-[#cfcfd5] hover:bg-white/6 hover:text-white'
                )}
              >
                {modelName}
              </button>
            ))}
            <div className="my-1 h-px bg-white/8" />
            <button
              type="button"
              onClick={() => {
                void handleModelChange('__settings__')
              }}
              className="block w-full rounded-xl px-3 py-2 text-left text-xs text-[#cfcfd5] transition-colors hover:bg-white/6 hover:text-white"
            >
              Gerenciar modelos
            </button>
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowQualityMenu((current) => !current)
            setShowModelMenu(false)
          }}
          className="flex items-center gap-1 text-xs text-[#b8b8c0] transition-colors hover:text-white"
        >
          <span>{quality}</span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {showQualityMenu ? (
          <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[140px] overflow-hidden rounded-2xl border border-[#2d2d33] bg-[#151518] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
            {QUALITY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setQuality(option)
                  setShowQualityMenu(false)
                }}
                className={cn(
                  'block w-full rounded-xl px-3 py-2 text-left text-xs transition-colors',
                  option === quality
                    ? 'bg-white/6 text-white'
                    : 'text-[#cfcfd5] hover:bg-white/6 hover:text-white'
                )}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default ChatComposerBar
