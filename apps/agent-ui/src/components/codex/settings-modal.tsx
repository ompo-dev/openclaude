"use client"

import { X } from "lucide-react"

import { useTheme } from "./theme-provider"

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  models: string[]
  currentModel: string
}

export function SettingsModal({
  isOpen,
  onClose,
  models,
  currentModel
}: SettingsModalProps) {
  const { theme, setTheme, themes } = useTheme()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative bg-card border border-border w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="text-sm">Configuracoes</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <span className="text-xs text-muted-foreground block mb-2">Tema</span>
            <div className="grid grid-cols-5 gap-2">
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex flex-col items-center gap-1 p-2 border ${
                    theme === t.id ? "border-primary" : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <div
                    className="w-6 h-6 border border-border"
                    style={{ backgroundColor: t.preview }}
                  />
                  <span className="text-xs">{t.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs text-muted-foreground block mb-2">Modelo padrao</span>
            <select className="w-full p-2 bg-muted border border-border text-sm focus:outline-none" defaultValue={currentModel}>
              {models.map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
          </div>

          <div>
            <span className="text-xs text-muted-foreground block mb-2">Qualidade padrao</span>
            <select className="w-full p-2 bg-muted border border-border text-sm focus:outline-none" defaultValue="Altissimo">
              <option>Altissimo</option>
              <option>Alto</option>
              <option>Medio</option>
              <option>Rapido</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Mostrar terminal por padrao</span>
            <div className="w-8 h-4 bg-muted flex items-center px-0.5 cursor-pointer">
              <div className="w-3 h-3 bg-primary" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Confirmacao antes de commit</span>
            <div className="w-8 h-4 bg-primary flex items-center justify-end px-0.5 cursor-pointer">
              <div className="w-3 h-3 bg-background" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
