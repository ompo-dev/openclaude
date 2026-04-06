'use client'

import ChatInput from './ChatInput'
import MessageArea from './MessageArea'
import { useStore } from '@/store'
import ConversationsView from '@/components/workspace/ConversationsView'
import ProjectView from '@/components/workspace/ProjectView'
import SettingsView from '@/components/workspace/SettingsView'

const ChatArea = () => {
  const workspaceView = useStore((state) => state.workspaceView)

  if (workspaceView === 'conversations') {
    return (
      <main className="relative m-1.5 flex flex-grow flex-col rounded-xl bg-background">
        <ConversationsView />
      </main>
    )
  }

  if (workspaceView === 'settings') {
    return (
      <main className="relative m-1.5 flex flex-grow flex-col rounded-xl bg-background">
        <SettingsView />
      </main>
    )
  }

  if (workspaceView === 'project') {
    return (
      <main className="relative m-1.5 flex flex-grow flex-col rounded-xl bg-background">
        <ProjectView />
      </main>
    )
  }

  return (
    <main className="relative m-1.5 flex flex-grow flex-col rounded-xl bg-background">
      <MessageArea />
      <div className="sticky bottom-0 ml-9 px-4 pb-2">
        <ChatInput />
      </div>
    </main>
  )
}

export default ChatArea
