"use client"

import { useEffect, useMemo, useState } from "react"
import { Copy, Ellipsis, Expand, FileCode2, RotateCcw, X } from "lucide-react"

import { cn } from "@/lib/utils"
import type { WorkspaceChangedFile } from "@/types/integration"
import type { FileChange } from "./message"

interface DiffViewerProps {
  isOpen: boolean
  onClose: () => void
  fileChanges: FileChange[]
  files: WorkspaceChangedFile[]
}

type ParsedDiffRow =
  | { type: "meta"; content: string }
  | { type: "hunk"; content: string }
  | {
      type: "context" | "add" | "remove"
      content: string
      oldLine: number | null
      newLine: number | null
    }

const parsePatchPreview = (patch: string | null | undefined): ParsedDiffRow[] => {
  if (!patch) return [{ type: "meta", content: "Sem preview de diff disponível para este arquivo." }]

  const rows: ParsedDiffRow[] = []
  const lines = patch.split(/\r?\n/)
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLine = match ? Number(match[1]) : 0
      newLine = match ? Number(match[2]) : 0
      rows.push({ type: "hunk", content: line })
      continue
    }

    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      rows.push({ type: "meta", content: line })
      continue
    }

    if (line.startsWith("+")) {
      rows.push({
        type: "add",
        content: line,
        oldLine: null,
        newLine,
      })
      newLine += 1
      continue
    }

    if (line.startsWith("-")) {
      rows.push({
        type: "remove",
        content: line,
        oldLine,
        newLine: null,
      })
      oldLine += 1
      continue
    }

    rows.push({
      type: "context",
      content: line,
      oldLine,
      newLine,
    })
    oldLine += 1
    newLine += 1
  }

  return rows
}

export function DiffViewer({ isOpen, onClose, fileChanges, files }: DiffViewerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedFile || !files.some((file) => file.path === selectedFile)) {
      setSelectedFile(files[0]?.path || null)
    }
  }, [files, selectedFile])

  const selected = useMemo(
    () => files.find((file) => file.path === selectedFile) ?? files[0] ?? null,
    [files, selectedFile]
  )

  const parsedRows = useMemo(
    () => parsePatchPreview(selected?.patch_preview),
    [selected?.patch_preview]
  )

  if (!isOpen) return null

  const totalAdditions = fileChanges.reduce((sum, file) => sum + (file.additions || 0), 0)
  const totalDeletions = fileChanges.reduce((sum, file) => sum + (file.deletions || 0), 0)

  return (
    <aside className="flex h-full w-[640px] shrink-0 border-l border-[#30363d] bg-[#0d1117]">
      <div className="flex w-[252px] shrink-0 flex-col border-r border-[#30363d] bg-[#0d1117]">
        <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-[#f0f6fc]">
              Não marcadas para commit
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-[#7d8590]">
              <span>{fileChanges.length} arquivos</span>
              <span className="font-medium text-[#3fb950]">+{totalAdditions}</span>
              <span className="font-medium text-[#f85149]">-{totalDeletions}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#161b22] hover:text-[#f0f6fc]"
              title="Mais"
            >
              <Ellipsis className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#161b22] hover:text-[#f0f6fc]"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => setSelectedFile(file.path)}
              className={cn(
                "mb-1 flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                selected?.path === file.path
                  ? "border-[#30363d] bg-[#161b22]"
                  : "border-transparent text-[#c9d1d9] hover:border-[#21262d] hover:bg-[#161b22]"
              )}
            >
              <FileCode2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7d8590]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-[#f0f6fc]">
                  {file.path}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[#7d8590]">
                  <span className="text-[#3fb950]">+{file.insertions || 0}</span>
                  <span className="text-[#f85149]">-{file.deletions || 0}</span>
                  <span>{file.tracked ? "modified" : "added"}</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="border-t border-[#30363d] px-4 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-[#7d8590] transition-colors hover:text-[#f0f6fc]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reverter tudo</span>
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[#30363d] bg-[#0d1117] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#f0f6fc]">
              {selected?.path || "Diff"}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-[#7d8590]">
              <span>{selected?.tracked ? "modified" : selected?.kind || "Sem arquivo selecionado"}</span>
              <span className="font-medium text-[#3fb950]">+{selected?.insertions || 0}</span>
              <span className="font-medium text-[#f85149]">-{selected?.deletions || 0}</span>
              {selected?.patch_truncated ? <span>preview truncado</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#161b22] hover:text-[#f0f6fc]"
              title="Copiar patch"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#161b22] hover:text-[#f0f6fc]"
              title="Expandir"
            >
              <Expand className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#0d1117]">
          <div className="min-w-[720px]">
            {parsedRows.map((row, index) => {
              if (row.type === "meta") {
                return (
                  <div
                    key={`meta-${index}`}
                    className="border-b border-[#161b22] bg-[#0d1117] px-4 py-2 font-mono text-[12px] text-[#7d8590]"
                  >
                    {row.content || " "}
                  </div>
                )
              }

              if (row.type === "hunk") {
                return (
                  <div
                    key={`hunk-${index}`}
                    className="border-b border-[#1b2a41] bg-[#0f1a2b] px-4 py-2 font-mono text-[12px] text-[#58a6ff]"
                  >
                    {row.content}
                  </div>
                )
              }

              return (
                <div
                  key={`line-${index}`}
                  className={cn(
                    "grid grid-cols-[72px_72px_minmax(0,1fr)] border-b border-[#161b22] font-mono text-[12px] leading-6",
                    row.type === "add" && "bg-[#0f2419] text-[#e6edf3]",
                    row.type === "remove" && "bg-[#2d1117] text-[#e6edf3]",
                    row.type === "context" && "bg-[#0d1117] text-[#c9d1d9]"
                  )}
                >
                  <div className="border-r border-[#161b22] px-3 text-right text-[#7d8590]">
                    {row.oldLine ?? ""}
                  </div>
                  <div className="border-r border-[#161b22] px-3 text-right text-[#7d8590]">
                    {row.newLine ?? ""}
                  </div>
                  <pre className="overflow-x-auto px-4 py-1">
                    <code>{row.content || " "}</code>
                  </pre>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}
