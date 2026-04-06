'use client'

import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import useWorkspaceData from '@/hooks/useWorkspaceData'
import { useStore } from '@/store'

import SectionCard from './SectionCard'

const StatCard = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
    <div className="mb-1 text-[11px] uppercase text-muted">{label}</div>
    <div className="text-sm font-medium text-secondary">{value}</div>
  </div>
)

const ProjectView = () => {
  const workspaceContext = useStore((state) => state.workspaceContext)
  const isWorkspaceContextLoading = useStore(
    (state) => state.isWorkspaceContextLoading
  )
  const selectedTopicId = useStore((state) => state.selectedTopicId)
  const topics = useStore((state) => state.topics)
  const { refreshWorkspaceContext } = useWorkspaceData()

  const activeTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId) ?? null,
    [selectedTopicId, topics]
  )

  const handleRefresh = async () => {
    await refreshWorkspaceContext()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-primary/10 px-8 py-6">
        <div className="mb-2 flex items-center gap-2">
          <Icon type="nextjs" size="xs" />
          <span className="text-xs font-medium uppercase text-primary">
            Project
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-secondary">
          Contexto do workspace
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Branch ativa, repositório, arquivos alterados e um preview do diff
          atual para acompanhar o que o OpenClaude Web está mudando.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6 grid gap-3 md:grid-cols-4">
          <StatCard
            label="Repository"
            value={workspaceContext?.repo_name || 'workspace'}
          />
          <StatCard label="Branch" value={workspaceContext?.branch || 'n/a'} />
          <StatCard
            label="Changes"
            value={workspaceContext?.changed_file_count ?? 0}
          />
          <StatCard label="Topics" value={topics.length} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
          <SectionCard
            title="Workspace Scope"
            description="O modo web herda o mesmo workspace local do OpenClaude CLI e usa esse contexto para sessões, tópicos e alterações."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isWorkspaceContextLoading}
                className="rounded-xl"
              >
                <Icon type="refresh" size="xs" />
                Refresh
              </Button>
            }
          >
            <div className="grid gap-3 text-sm text-muted">
              <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
                <div className="mb-1 text-[11px] uppercase">Project Root</div>
                <div className="break-all text-secondary">
                  {workspaceContext?.project_root || 'Unavailable'}
                </div>
              </div>
              <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
                <div className="mb-1 text-[11px] uppercase">Remote</div>
                <div className="break-all text-secondary">
                  {workspaceContext?.origin_url || 'No origin configured'}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
                  <div className="mb-1 text-[11px] uppercase">Commit</div>
                  <div className="text-secondary">
                    {workspaceContext?.head || 'Unavailable'}
                  </div>
                </div>
                <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
                  <div className="mb-1 text-[11px] uppercase">Tracking</div>
                  <div className="text-secondary">
                    {workspaceContext?.upstream || 'No upstream'}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
                <div className="mb-1 text-[11px] uppercase">Active Topic</div>
                <div className="text-secondary">
                  {activeTopic
                    ? `${activeTopic.name} (${activeTopic.session_ids.length} sessions)`
                    : 'No topic selected'}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Current Changes"
            description="Os previews abaixo mostram o estado atual do worktree. Use isso para auditar o que foi alterado pelo agente web."
          >
            {workspaceContext?.changed_files?.length ? (
              <div className="space-y-4">
                {workspaceContext.changed_files.map((file) => (
                  <article
                    key={file.path}
                    className="rounded-xl border border-primary/10 bg-background-secondary"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 px-4 py-3">
                      <div>
                        <div className="text-sm font-medium text-secondary">
                          {file.path}
                        </div>
                        <div className="mt-1 text-[11px] uppercase text-muted">
                          {file.kind}
                          {typeof file.insertions === 'number'
                            ? ` • +${file.insertions}`
                            : ''}
                          {typeof file.deletions === 'number'
                            ? ` / -${file.deletions}`
                            : ''}
                        </div>
                      </div>
                      <div className="text-[11px] uppercase text-muted">
                        {file.tracked ? 'tracked' : 'untracked'}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      {file.patch_preview ? (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-background px-4 py-3 text-xs text-muted">
                          {file.patch_preview}
                        </pre>
                      ) : (
                        <div className="rounded-xl border border-dashed border-primary/10 px-4 py-6 text-xs text-muted">
                          No preview available for this file yet.
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-primary/10 px-4 py-8 text-sm text-muted">
                Nenhum arquivo alterado no worktree atual.
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

export default ProjectView
