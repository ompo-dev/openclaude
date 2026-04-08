import { Bot, Clipboard, FilePenLine, Plus, Trash2, User } from 'lucide-react'
import { useState, memo } from 'react'

import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { useStore } from '@/store'
import type { ChatMessage } from '@/types/os'

import AgentThinkingLoader from './AgentThinkingLoader'
import Audios from './Multimedia/Audios'
import Images from './Multimedia/Images'
import Videos from './Multimedia/Videos'

interface MessageProps {
  message: ChatMessage
}

const formatTimestamp = (createdAt?: number) => {
  if (!createdAt) return ''

  return new Date(createdAt * 1000).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

const FileActionIcon = ({ kind }: { kind: string }) => {
  if (kind === 'added' || kind === 'new') {
    return <Plus className="h-3 w-3 text-emerald-500" />
  }

  if (kind === 'deleted') {
    return <Trash2 className="h-3 w-3 text-rose-500" />
  }

  return <FilePenLine className="h-3 w-3 text-muted" />
}

const WorkspaceChangeSummary = ({ message }: MessageProps) => {
  const workspaceSnapshot = message.workspace_snapshot
  const changedFiles = workspaceSnapshot?.changed_files ?? []

  if (!workspaceSnapshot || changedFiles.length === 0) {
    return null
  }

  const totalAdditions =
    workspaceSnapshot.total_insertions ??
    changedFiles.reduce((sum, file) => sum + (file.insertions ?? 0), 0)
  const totalDeletions =
    workspaceSnapshot.total_deletions ??
    changedFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0)

  return (
    <div className="mt-3 border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted">
          {workspaceSnapshot.changed_file_count} arquivos alterados
        </span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-emerald-500">+{totalAdditions}</span>
          <span className="text-rose-500">-{totalDeletions}</span>
        </div>
      </div>
      <div className="divide-y divide-border">
        {changedFiles.map((file) => (
          <details key={`${file.path}-${file.kind}`} className="group">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent">
              <FileActionIcon kind={file.kind} />
              <span className="flex-1 truncate text-left">{file.path}</span>
              {typeof file.insertions === 'number' && file.insertions > 0 ? (
                <span className="text-emerald-500">+{file.insertions}</span>
              ) : null}
              {typeof file.deletions === 'number' && file.deletions > 0 ? (
                <span className="text-rose-500">-{file.deletions}</span>
              ) : null}
            </summary>
            {file.patch_preview ? (
              <pre className="overflow-x-auto border-t border-border bg-muted px-3 py-2 text-xs text-secondary">
                <code>{file.patch_preview}</code>
              </pre>
            ) : null}
          </details>
        ))}
      </div>
    </div>
  )
}

const AgentMessage = ({ message }: MessageProps) => {
  const { streamingErrorMessage } = useStore()
  const [copied, setCopied] = useState(false)

  let messageContent

  if (message.streamingError) {
    messageContent = (
      <p className="text-destructive">
        Oops! Something went wrong while streaming.{' '}
        {streamingErrorMessage || 'Please try refreshing the page or try again later.'}
      </p>
    )
  } else if (message.content) {
    messageContent = (
      <>
        <MarkdownRenderer>{message.content}</MarkdownRenderer>
        {message.videos && message.videos.length > 0 && (
          <Videos videos={message.videos} />
        )}
        {message.images && message.images.length > 0 && (
          <Images images={message.images} />
        )}
        {message.audio && message.audio.length > 0 && <Audios audio={message.audio} />}
        <WorkspaceChangeSummary message={message} />
      </>
    )
  } else if (message.response_audio?.transcript) {
    messageContent = (
      <>
        <MarkdownRenderer>{message.response_audio.transcript}</MarkdownRenderer>
        {message.response_audio.content && (
          <Audios audio={[message.response_audio]} />
        )}
        <WorkspaceChangeSummary message={message} />
      </>
    )
  } else {
    messageContent = <AgentThinkingLoader />
  }

  return (
    <div className="bg-card py-3">
      <div className="mx-auto max-w-3xl px-4">
        <div className="flex gap-3">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted">
            <Bot className="h-3.5 w-3.5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs text-muted">openclaude</span>
              <span className="text-xs text-muted">
                {formatTimestamp(message.created_at)}
              </span>
              {message.content ? (
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(message.content)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    } catch {}
                  }}
                  className="ml-auto text-muted transition-colors hover:text-secondary"
                  title="Copiar mensagem"
                >
                  <Clipboard className="h-3 w-3" />
                </button>
              ) : null}
            </div>

            <div className="text-xs leading-relaxed text-secondary">
              {messageContent}
            </div>
            {copied ? (
              <div className="mt-1 text-[10px] text-muted">copiado</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

const UserMessage = memo(({ message }: MessageProps) => {
  return (
    <div className="py-3">
      <div className="mx-auto max-w-3xl px-4">
        <div className="flex gap-3">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted">
            <User className="h-3.5 w-3.5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs text-muted">voce</span>
              <span className="text-xs text-muted">
                {formatTimestamp(message.created_at)}
              </span>
            </div>

            <div className="whitespace-pre-wrap text-xs leading-relaxed text-secondary">
              {message.content}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

AgentMessage.displayName = 'AgentMessage'
UserMessage.displayName = 'UserMessage'

export { AgentMessage, UserMessage }
