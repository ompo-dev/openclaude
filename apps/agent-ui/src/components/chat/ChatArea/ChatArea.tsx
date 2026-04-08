'use client'

import { useCallback, useState } from 'react'

import ChatInput from './ChatInput'
import ChatHeader from './ChatHeader'
import MessageArea from './MessageArea'
import TerminalPanel from './TerminalPanel'
import WorkspaceInspector from './WorkspaceInspector'
import { useStore } from '@/store'
import SettingsView from '@/components/workspace/SettingsView'
import useWorkspaceData from '@/hooks/useWorkspaceData'

const ChatArea = () => {
  const workspaceView = useStore((state) => state.workspaceView)
  const [isTerminalOpen, setIsTerminalOpen] = useState(false)
  const [isChangesOpen, setIsChangesOpen] = useState(false)
  const { refreshWorkspaceContext, refreshBranches } = useWorkspaceData()

  const refreshAfterTerminalCommand = useCallback(async () => {
    await Promise.all([refreshWorkspaceContext(), refreshBranches()])
  }, [refreshBranches, refreshWorkspaceContext])

  if (workspaceView === 'settings') {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <SettingsView />
      </main>
    )
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <ChatHeader
        isTerminalOpen={isTerminalOpen}
        onToggleTerminal={() => setIsTerminalOpen((current) => !current)}
        isChangesOpen={isChangesOpen}
        onToggleChanges={() => setIsChangesOpen((current) => !current)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageArea />
          <ChatInput />
          {isTerminalOpen ? (
            <TerminalPanel
              onClose={() => setIsTerminalOpen(false)}
              onCommandComplete={refreshAfterTerminalCommand}
            />
          ) : null}
        </div>
        {isChangesOpen ? (
          <WorkspaceInspector onClose={() => setIsChangesOpen(false)} />
        ) : null}
      </div>
    </main>
  )
}

export default ChatArea
