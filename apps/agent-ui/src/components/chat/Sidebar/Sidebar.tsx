'use client'

import { Clock, Grid2X2, Plus, Settings } from 'lucide-react'

import useChatActions from '@/hooks/useChatActions'
import { useStore } from '@/store'

import TopicTree from './TopicTree'

const Sidebar = () => {
  const { clearChat, focusChatInput } = useChatActions()
  const setWorkspaceView = useStore((state) => state.setWorkspaceView)

  const handleNewChat = () => {
    setWorkspaceView('chat')
    clearChat()
    focusChatInput()
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between border-b border-border p-3">
        <button
          onClick={handleNewChat}
          className="flex items-center gap-2 text-xs text-muted transition-colors hover:text-secondary"
        >
          <Plus className="h-3 w-3" />
          <span>Novo topico</span>
        </button>
        <div className="flex items-center gap-1">
          <button className="p-1 text-muted transition-colors hover:text-secondary">
            <Grid2X2 className="h-3 w-3" />
          </button>
          <button className="p-1 text-muted transition-colors hover:text-secondary">
            <Clock className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <div className="px-3 py-1 text-xs text-muted">Topicos</div>
        <TopicTree />
      </div>

      <div className="border-t border-border p-3">
        <button
          onClick={() => setWorkspaceView('settings')}
          className="flex items-center gap-2 text-xs text-muted transition-colors hover:text-secondary"
        >
          <Settings className="h-3 w-3" />
          <span>Configuracoes</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
