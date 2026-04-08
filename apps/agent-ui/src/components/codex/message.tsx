"use client"

import { CheckCircle, Clipboard, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react"
import { useState } from "react"

import { MarkdownContent } from "@/components/ui/MarkdownContent"
import { cn } from "@/lib/utils"

export interface FileChange {
  filename: string
  action: "created" | "modified" | "deleted"
  additions?: number
  deletions?: number
  patch?: string
}

export interface CodeBlock {
  language: string
  filename?: string
  code: string
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
  fileChanges?: FileChange[]
  codeBlocks?: CodeBlock[]
}

interface MessageProps {
  message: Message
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === "user"
  const [copiedCode, setCopiedCode] = useState<number | null>(null)

  const copyCode = async (code: string, index: number) => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(index)
    window.setTimeout(() => setCopiedCode(null), 1800)
  }

  return (
    <div className="px-6 py-5">
      <div className={cn("mx-auto flex max-w-4xl flex-col", isUser ? "items-end" : "items-start")}>
        <div className="mb-2 px-1 text-[11px] uppercase tracking-[0.14em] text-[#7d8590]">
          {isUser ? "you" : "openclaude"} • {message.timestamp}
        </div>

        {isUser ? (
          <div className="max-w-[84%] rounded-lg border border-[#1f6feb33] bg-[#0f1a2b] px-4 py-3 text-sm text-[#e6edf3]">
            <MarkdownContent
              content={message.content}
              className="[&_p]:leading-7 [&_ul]:text-[#e6edf3] [&_ol]:text-[#e6edf3]"
            />
          </div>
        ) : (
          <div className="max-w-[84%] px-1 text-sm text-[#c9d1d9]">
            <MarkdownContent
              content={message.content}
              className="[&_p]:leading-7 [&_ul]:text-[#c9d1d9] [&_ol]:text-[#c9d1d9]"
            />
          </div>
        )}

        {message.fileChanges && message.fileChanges.length > 0 ? (
          <div className="mt-4 w-full max-w-4xl overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22]">
            <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
              <div className="text-sm text-[#c9d1d9]">
                {message.fileChanges.length} arquivos alterados
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-[#7d8590] transition-colors hover:text-[#f0f6fc]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Desfazer</span>
              </button>
            </div>

            <div className="divide-y divide-[#30363d]">
              {message.fileChanges.map((file, index) => (
                <div
                  key={`${file.filename}-${index}`}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-[#c9d1d9]"
                >
                  <FileActionIcon action={file.action} />
                  <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                  <span className="text-xs uppercase tracking-[0.12em] text-[#7d8590]">
                    {file.action === "created"
                      ? "Criado"
                      : file.action === "deleted"
                        ? "Excluído"
                        : "Editado"}
                  </span>
                  {file.additions ? (
                    <span className="text-sm font-medium text-[#3fb950]">+{file.additions}</span>
                  ) : null}
                  {file.deletions ? (
                    <span className="text-sm font-medium text-[#f85149]">-{file.deletions}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
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
                    <span>{copiedCode === index ? "Copiado" : "Copiar"}</span>
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

function FileActionIcon({ action }: { action: string }) {
  switch (action) {
    case "created":
      return <Plus className="h-4 w-4 text-[#3fb950]" />
    case "deleted":
      return <Trash2 className="h-4 w-4 text-[#f85149]" />
    default:
      return <Pencil className="h-4 w-4 text-[#7d8590]" />
  }
}
