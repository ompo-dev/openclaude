'use client'

import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

const VIEW_ITEMS = [
  {
    id: 'chat',
    label: 'Chat',
    icon: 'agent'
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'sheet'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'hammer'
  }
] as const

const WorkspaceViewSelector = () => {
  const { workspaceView, setWorkspaceView } = useStore()

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase text-primary">Workspace</div>
      <div className="grid grid-cols-3 gap-2">
        {VIEW_ITEMS.map((item) => {
          const active = workspaceView === item.id
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              onClick={() => setWorkspaceView(item.id)}
              className={cn(
                'h-10 rounded-xl border border-primary/10 bg-accent text-[11px] uppercase text-muted hover:bg-accent/80',
                active && 'border-primary/20 bg-primary/10 text-primary'
              )}
            >
              <Icon type={item.icon} size="xxs" />
              {item.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export default WorkspaceViewSelector
