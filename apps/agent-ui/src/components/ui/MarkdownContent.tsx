"use client"

import type { ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface MarkdownContentProps {
  content: string
  className?: string
}

function joinClasses(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ")
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  if (!content.trim()) return null

  return (
    <div
      className={joinClasses(
        "space-y-3 text-sm leading-6 text-inherit [&_a]:text-[#58a6ff] [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[#30363d] [&_blockquote]:pl-4 [&_blockquote]:text-[#9fb3c8] [&_code]:rounded [&_code]:border [&_code]:border-[#30363d] [&_code]:bg-[#11161d] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_em]:text-[#c9d1d9] [&_hr]:border-[#30363d] [&_li]:leading-6 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:m-0 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-[#30363d] [&_pre]:bg-[#0d1117] [&_pre]:p-3 [&_pre_code]:border-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_strong]:text-[#f0f6fc] [&_ul]:list-disc [&_ul]:pl-5",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          p: ({ children }) => <p>{children as ReactNode}</p>
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
