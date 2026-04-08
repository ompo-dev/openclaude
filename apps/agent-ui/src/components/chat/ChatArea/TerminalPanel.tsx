'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Minus, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  getTerminalSnapshotAPI,
  runTerminalCommandAPI
} from '@/api/integration'
import { useStore } from '@/store'
import { TerminalSnapshot } from '@/types/integration'

interface TerminalPanelProps {
  onClose: () => void
  onCommandComplete?: () => Promise<void> | void
}

const TerminalPanel = ({ onClose, onCommandComplete }: TerminalPanelProps) => {
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const [terminalSnapshot, setTerminalSnapshot] =
    useState<TerminalSnapshot | null>(null)
  const [terminalCommand, setTerminalCommand] = useState('')
  const [isTerminalPending, setIsTerminalPending] = useState(false)

  const loadTerminal = useCallback(async () => {
    try {
      const response = await getTerminalSnapshotAPI(selectedEndpoint, authToken)
      setTerminalSnapshot(response)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao carregar o terminal'
      )
    }
  }, [authToken, selectedEndpoint])

  useEffect(() => {
    void loadTerminal()
  }, [loadTerminal])

  const handleRunTerminalCommand = async () => {
    const normalizedCommand = terminalCommand.trim()
    if (!normalizedCommand) return

    setIsTerminalPending(true)
    try {
      const nextSnapshot = await runTerminalCommandAPI(
        selectedEndpoint,
        normalizedCommand,
        authToken
      )
      setTerminalSnapshot(nextSnapshot)
      setTerminalCommand('')
      await onCommandComplete?.()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao executar o comando'
      )
    } finally {
      setIsTerminalPending(false)
    }
  }

  return (
    <div className="border-border bg-card flex h-48 flex-col border-t">
      <div className="border-border flex h-8 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <span className="text-muted text-xs">Terminal</span>
          <button className="text-secondary flex items-center gap-1 text-xs">
            <span>{terminalSnapshot?.shell || 'PowerShell'}</span>
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button className="text-muted hover:text-secondary p-1 transition-colors">
            <Minus className="h-3 w-3" />
          </button>
          <button
            onClick={onClose}
            className="text-muted hover:text-secondary p-1 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="font-dmmono flex-1 overflow-y-auto p-2 text-xs">
        {terminalSnapshot?.entries?.length ? (
          terminalSnapshot.entries.map((entry) => (
            <div
              key={entry.id}
              className={
                entry.kind === 'command' ? 'text-muted' : 'text-secondary'
              }
            >
              {entry.text}
            </div>
          ))
        ) : (
          <></>
        )}
        <div className="flex items-center">
          <input
            value={terminalCommand}
            onChange={(event) => setTerminalCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleRunTerminalCommand()
              }
            }}
            disabled={isTerminalPending}
            className="text-secondary flex-1 bg-transparent focus:outline-none"
            spellCheck={false}
          />
          <span className="cursor-blink text-secondary">|</span>
        </div>
      </div>
    </div>
  )
}

export default TerminalPanel
