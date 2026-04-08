"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react"

import { getSlashCatalogAPI } from "@/api/integration"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"
import type { SlashCatalogSnapshot } from "@/types/integration"

interface Topic {
  id: string
  title: string
  updatedAt: string
}

interface Project {
  id: string
  name: string
  projectRoot: string
  isExpanded: boolean
  topics: Topic[]
}

interface SidebarProps {
  projects: Project[]
  currentSessionId: string | null
  currentProjectId: string | null
  onTopicSelect: (topicId: string, projectId: string) => void
  onNewConversation: (projectId: string) => void
  onAddProjectTopic: () => void
  onUseSkill: (slash: string) => void
  onToggleProject: (projectId: string) => void
  onOpenSettings: () => void
}

export function Sidebar({
  projects,
  currentSessionId,
  currentProjectId,
  onTopicSelect,
  onNewConversation,
  onAddProjectTopic,
  onUseSkill,
  onToggleProject,
  onOpenSettings,
}: SidebarProps) {
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const [slashCatalog, setSlashCatalog] = useState<SlashCatalogSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const nextCatalog = await getSlashCatalogAPI(selectedEndpoint, authToken)
        if (!cancelled) setSlashCatalog(nextCatalog)
      } catch {
        if (!cancelled) setSlashCatalog(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authToken, selectedEndpoint])

  const visibleSkills = useMemo(() => slashCatalog?.skills ?? [], [slashCatalog?.skills])

  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-[#30363d] bg-[#0d1117]">
      <div className="border-b border-[#30363d] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7d8590]">
            Tópicos
          </div>
          <button
            type="button"
            onClick={onAddProjectTopic}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22] text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
            title="Adicionar tópico"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-[#30363d] px-4 py-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#f0f6fc]">
          <Sparkles className="h-4 w-4 text-[#58a6ff]" />
          <span>Habilidades / skills</span>
        </div>

        {visibleSkills.length > 0 ? (
          <div className="space-y-1">
            {visibleSkills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => onUseSkill(`${skill.slash} `)}
                className="w-full rounded-md border border-[#21262d] bg-[#161b22] px-3 py-2 text-left transition-colors hover:border-[#30363d] hover:bg-[#1b222c]"
              >
                <div className="truncate text-xs font-medium text-[#f0f6fc]">
                  {skill.slash}
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#7d8590]">
                  {skill.description || "Skill carregada neste workspace."}
                </div>
                {skill.loaded_from ? (
                  <div className="mt-2 truncate text-[10px] uppercase tracking-[0.08em] text-[#58a6ff]">
                    {skill.loaded_from}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-[#30363d] px-3 py-3 text-xs text-[#7d8590]">
            Nenhuma skill detectada ainda.
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {projects.length === 0 ? (
          <div className="px-2 py-3 text-xs italic text-[#7d8590]">
            Nenhum tópico ainda.
          </div>
        ) : (
          projects.map((project) => (
            <div key={project.id} className="mb-2">
              <button
                type="button"
                onClick={() => onToggleProject(project.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                  currentProjectId === project.id
                    ? "bg-[#161b22] text-[#f0f6fc]"
                    : "text-[#c9d1d9] hover:bg-[#161b22] hover:text-[#f0f6fc]"
                )}
              >
                {project.isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-[#7d8590]" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-[#7d8590]" />
                )}
                {project.isExpanded ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-[#7d8590]" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-[#7d8590]" />
                )}
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
              </button>

              {project.isExpanded ? (
                <div className="ml-5 mt-1 space-y-1">
                  {project.topics.length > 0 ? (
                    project.topics.map((topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => onTopicSelect(topic.id, project.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                          currentSessionId === topic.id
                            ? "bg-[#0f1a2b] text-[#f0f6fc]"
                            : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3]"
                        )}
                      >
                        <FileText className="h-3 w-3 shrink-0 text-[#7d8590]" />
                        <span className="min-w-0 flex-1 truncate">{topic.title}</span>
                        {topic.updatedAt ? (
                          <span className="shrink-0 text-[10px] uppercase text-[#7d8590]">
                            {topic.updatedAt}
                          </span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div className="px-2.5 py-1 text-xs italic text-[#7d8590]">
                      Nenhuma conversa
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => onNewConversation(project.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-[#c9d1d9] transition-colors hover:bg-[#161b22] hover:text-[#f0f6fc]"
                  >
                    <Plus className="h-3 w-3 shrink-0 text-[#7d8590]" />
                    <span>Nova conversa</span>
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-[#30363d] p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-[#7d8590] transition-colors hover:bg-[#161b22] hover:text-[#f0f6fc]"
        >
          <Settings className="h-3.5 w-3.5" />
          <span>Configurações</span>
        </button>
      </div>
    </aside>
  )
}
