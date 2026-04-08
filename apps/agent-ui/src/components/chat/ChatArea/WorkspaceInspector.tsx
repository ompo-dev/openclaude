'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'

import { getGitOverviewAPI } from '@/api/integration'
import { useStore } from '@/store'
import { GitOverview } from '@/types/integration'

interface WorkspaceInspectorProps {
  onClose: () => void
}

const WorkspaceInspector = ({ onClose }: WorkspaceInspectorProps) => {
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const workspaceContext = useStore((state) => state.workspaceContext)
  const [gitOverview, setGitOverview] = useState<GitOverview | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)

  const loadOverview = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await getGitOverviewAPI(selectedEndpoint, authToken)
      setGitOverview(response)
      setSelectedFilePath((current) => {
        if (
          current &&
          response.workspace.changed_files.some((file) => file.path === current)
        ) {
          return current
        }
        return response.workspace.changed_files[0]?.path ?? null
      })
      setExpandedFiles(
        new Set(response.workspace.changed_files.map((file) => file.path))
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao carregar as alteracoes do workspace'
      )
    } finally {
      setIsLoading(false)
    }
  }, [authToken, selectedEndpoint])

  useEffect(() => {
    void loadOverview()
  }, [
    loadOverview,
    workspaceContext?.branch,
    workspaceContext?.changed_file_count,
    workspaceContext?.project_root
  ])

  const selectedFile = useMemo(
    () =>
      gitOverview?.workspace.changed_files.find(
        (file) => file.path === selectedFilePath
      ) ?? gitOverview?.workspace.changed_files[0] ?? null,
    [gitOverview?.workspace.changed_files, selectedFilePath]
  )

  const summary = gitOverview?.summary

  return (
    <aside className="hidden w-full max-w-4xl border-l border-border bg-card xl:flex">
      <div className="w-72 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="text-xs">
            <span className="text-muted">
              {summary?.changed_file_count ?? 0} arquivos alterados
            </span>
            <span className="ml-2 text-emerald-500">
              +{summary?.total_insertions ?? 0}
            </span>
            <span className="ml-1 text-rose-500">
              -{summary?.total_deletions ?? 0}
            </span>
          </div>
          <button className="text-xs text-muted hover:text-secondary flex items-center gap-1">
            <RotateCcw className="h-3 w-3" />
            Desfazer
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {gitOverview?.workspace.changed_files?.length ? (
            gitOverview.workspace.changed_files.map((file) => (
              <button
                key={file.path}
                onClick={() => setSelectedFilePath(file.path)}
                className={`w-full px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-accent ${
                  selectedFile?.path === file.path ? 'bg-accent' : ''
                }`}
              >
                <span className="flex-1 truncate text-left">{file.path}</span>
                {file.insertions ? (
                  <span className="text-emerald-500">+{file.insertions}</span>
                ) : null}
                {file.deletions ? (
                  <span className="text-rose-500">-{file.deletions}</span>
                ) : null}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-muted">
              {isLoading
                ? 'Carregando alteracoes...'
                : 'Nenhuma alteracao local neste workspace.'}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border flex items-center justify-between">
          <button className="text-xs text-muted hover:text-secondary flex items-center gap-1">
            <RotateCcw className="h-3 w-3" />
            Reverter tudo
          </button>
          <button className="text-xs text-muted hover:text-secondary">
            Marcar tudo para commit
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-xs text-muted">
            Nao marcadas para commit
            <span className="ml-2 text-secondary">
              {summary?.changed_file_count ?? 0}
            </span>
          </span>
          <div className="flex items-center gap-2">
            {selectedFile ? (
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      selectedFile.patch_preview || selectedFile.path
                    )
                    toast.success('Diff copiado')
                  } catch {
                    toast.error('Falha ao copiar o diff')
                  }
                }}
                className="text-muted transition-colors hover:text-secondary"
              >
                <Copy className="h-4 w-4" />
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="text-muted transition-colors hover:text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {gitOverview?.workspace.changed_files?.map((file) => (
            <div key={file.path} className="border-b border-border">
              <button
                onClick={() =>
                  setExpandedFiles((prev) => {
                    const next = new Set(prev)
                    if (next.has(file.path)) next.delete(file.path)
                    else next.add(file.path)
                    return next
                  })
                }
                className="w-full px-3 py-2 flex items-center gap-2 text-xs hover:bg-accent"
              >
                <span className="flex-1 text-left">{file.path}</span>
                <span className="text-emerald-500">+{file.insertions ?? 0}</span>
                <span className="text-rose-500">-{file.deletions ?? 0}</span>
              </button>

              {expandedFiles.has(file.path) ? (
                <pre className="overflow-x-auto bg-muted px-3 py-2 text-xs text-secondary">
                  <code>
                    {file.patch_preview ||
                      'Sem preview de diff disponivel para este arquivo.'}
                  </code>
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

export default WorkspaceInspector
