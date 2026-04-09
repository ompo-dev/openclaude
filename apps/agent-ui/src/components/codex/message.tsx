'use client'

import { CheckCircle, Clipboard } from 'lucide-react'
import { useState } from 'react'

import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { cn } from '@/lib/utils'
import type { WorkspaceChangedFile } from '@/types/integration'

import type { FileChange } from './diff-types'
import { MessageDiff } from './message-diff'

export type { FileChange } from './diff-types'

export interface CodeBlock {
  language: string
  filename?: string
  code: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  fileChanges?: FileChange[]
  workspaceFiles?: WorkspaceChangedFile[]
  codeBlocks?: CodeBlock[]
}

interface MessageProps {
  message: Message
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === 'user'
  const [copiedCode, setCopiedCode] = useState<number | null>(null)

  const copyCode = async (code: string, index: number) => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(index)
    window.setTimeout(() => setCopiedCode(null), 1800)
  }

  return (
    <div className="px-6 py-5">
      <div
        className={cn(
          'mx-auto flex max-w-4xl flex-col',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        <div className="mb-2 px-1 text-[11px] uppercase tracking-[0.14em] text-[#7d8590]">
          {isUser ? 'you' : 'openclaude'} • {message.timestamp}
        </div>

        {isUser ? (
          <div className="max-w-[84%] rounded-lg border border-[#1f6feb33] bg-[#0f1a2b] px-4 py-3 text-sm text-[#e6edf3]">
            <MarkdownContent
              content={message.content}
              className="[&_p]:leading-7 [&_ul]:text-[#e6edf3] [&_ol]:text-[#e6edf3]"
            />
          </div>
        ) : message.content ? (
          <div className="max-w-[84%] px-1 text-sm text-[#c9d1d9]">
            <MarkdownContent
              content={message.content}
              className="[&_p]:leading-7 [&_ul]:text-[#c9d1d9] [&_ol]:text-[#c9d1d9]"
            />
          </div>
        ) : null}

        {!isUser && message.workspaceFiles && message.workspaceFiles.length > 0 ? (
          <MessageDiff files={message.workspaceFiles} />
        ) : null}

        {message.codeBlocks && message.codeBlocks.length > 0 ? (
          <div className="mt-4 w-full max-w-4xl space-y-4">
            {message.codeBlocks.map((block, index) => (
              <div
                key={`${block.filename || block.language}-${index}`}
                className="overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22]"
              >
                <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
                  <span className="text-sm text-[#c9d1d9]">
                    {block.filename || block.language}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyCode(block.code, index)}
                    className="inline-flex items-center gap-1 text-xs text-[#7d8590] transition-colors hover:text-[#f0f6fc]"
                  >
                    {copiedCode === index ? (
                      <CheckCircle className="h-3.5 w-3.5" />
                    ) : (
                      <Clipboard className="h-3.5 w-3.5" />
                    )}
                    <span>{copiedCode === index ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>

                <pre className="overflow-x-auto bg-[#0d1117] px-4 py-4 text-[12px] leading-6 text-[#c9d1d9]">
                  <code>{block.code}</code>
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
