"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { SkillLibraryEntry } from "@/types/integration"

interface Topic {
  id: string
  title: string
  updatedAt: string
  pinned?: boolean
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
  currentSkillFilePath: string | null
  pinnedSessionIds: string[]
  skillLibrary: SkillLibraryEntry[]
  isSkillsLoading: boolean
  onTopicSelect: (topicId: string, projectId: string) => void
  onNewConversation: (projectId: string) => void
  onAddProjectTopic: () => void
  onDeleteConversation: (sessionId: string) => void
  onTogglePinnedConversation: (sessionId: string) => void
  onOpenSkillFile: (path: string) => void
  onRefreshSkills: () => void
  onToggleProject: (projectId: string) => void
  onOpenTopicInExplorer: (topicId: string) => void
  onRenameTopic: (topicId: string) => void
  onDeleteTopic: (topicId: string) => void
  onOpenSettings: () => void
}

type SkillFolderNode = {
  type: "folder"
  id: string
  label: string
  children: SkillTreeNode[]
}

type SkillFileNode = {
  type: "file"
  id: string
  label: string
  path: string
}

type SkillTreeNode = SkillFolderNode | SkillFileNode

const sortTreeNodes = (nodes: SkillTreeNode[]): SkillTreeNode[] =>
  [...nodes]
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "folder" ? -1 : 1
      }
      return left.label.localeCompare(right.label, "pt-BR", {
        sensitivity: "base",
      })
    })
    .map((node) =>
      node.type === "folder"
        ? {
            ...node,
            children: sortTreeNodes(node.children),
          }
        : node
    )

const buildSkillTree = (items: SkillLibraryEntry[]): SkillTreeNode[] => {
  const rootChildren: SkillTreeNode[] = []

  const ensureFolder = (
    children: SkillTreeNode[],
    label: string,
    parentId: string
  ) => {
    const folderId = `${parentId}/${label}`
    const existing = children.find(
      (child): child is SkillFolderNode =>
        child.type === "folder" && child.label === label
    )
    if (existing) return existing

    const created: SkillFolderNode = {
      type: "folder",
      id: folderId,
      label,
      children: [],
    }
    children.push(created)
    return created
  }

  items
    .filter((item) => item.path && item.name)
    .forEach((item) => {
      const segments = item.path.split("/").filter(Boolean)
      if (segments.length === 0) return

      let currentChildren = rootChildren
      let parentId = "skills"

      segments.slice(0, -1).forEach((segment) => {
        const folder = ensureFolder(currentChildren, segment, parentId)
        currentChildren = folder.children
        parentId = folder.id
      })

      if (item.kind === "directory") {
        ensureFolder(
          currentChildren,
          segments[segments.length - 1] || item.name,
          parentId
        )
        return
      }

      currentChildren.push({
        type: "file",
        id: `file:${item.path}`,
        label: segments[segments.length - 1] || item.name,
        path: item.path,
      })
    })

  return sortTreeNodes(rootChildren)
}

function SkillsTree({
  nodes,
  expandedFolders,
  onToggleFolder,
  currentSkillFilePath,
  onOpenSkillFile,
}: {
  nodes: SkillTreeNode[]
  expandedFolders: Record<string, boolean>
  onToggleFolder: (folderId: string) => void
  currentSkillFilePath: string | null
  onOpenSkillFile: (path: string) => void
}) {
  const renderNode = (node: SkillTreeNode, depth: number) => {
    if (node.type === "folder") {
      const isOpen = expandedFolders[node.id] ?? false
      return (
        <div key={node.id}>
          <button
            type="button"
            onClick={() => onToggleFolder(node.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[#c9d1d9] transition-colors hover:bg-[#161b22] hover:text-[#f0f6fc]"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#7d8590]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#7d8590]" />
            )}
            {isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#7d8590]" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-[#7d8590]" />
            )}
            <span className="min-w-0 flex-1 truncate">{node.label}</span>
          </button>

          {isOpen ? (
            <div className="space-y-0.5">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      )
    }

    const isActive = currentSkillFilePath === node.path
    return (
      <button
        key={node.id}
        type="button"
        onClick={() => onOpenSkillFile(node.path)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
          isActive
            ? "bg-[#0f1a2b] text-[#f0f6fc]"
            : "text-[#c9d1d9] hover:bg-[#161b22] hover:text-[#f0f6fc]"
        )}
        style={{ paddingLeft: `${28 + depth * 14}px` }}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-[#7d8590]" />
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </button>
    )
  }

  return <div className="space-y-0.5">{nodes.map((node) => renderNode(node, 0))}</div>
}

export function Sidebar({
  projects,
  currentSessionId,
  currentProjectId,
  currentSkillFilePath,
  pinnedSessionIds,
  skillLibrary,
  isSkillsLoading,
  onTopicSelect,
  onNewConversation,
  onAddProjectTopic,
  onDeleteConversation,
  onTogglePinnedConversation,
  onOpenSkillFile,
  onRefreshSkills,
  onToggleProject,
  onOpenTopicInExplorer,
  onRenameTopic,
  onDeleteTopic,
  onOpenSettings,
}: SidebarProps) {
  const [expandedSkillFolders, setExpandedSkillFolders] = useState<
    Record<string, boolean>
  >({})
  const [topicMenuId, setTopicMenuId] = useState<string | null>(null)

  const skillTree = useMemo(() => buildSkillTree(skillLibrary), [skillLibrary])

  const toggleSkillFolder = useCallback((folderId: string) => {
    setExpandedSkillFolders((current) => ({
      ...current,
      [folderId]: !(current[folderId] ?? false),
    }))
  }, [])

  const closeTopicMenu = useCallback(() => {
    setTopicMenuId(null)
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('[data-topic-menu-root="true"]')) return
      setTopicMenuId(null)
    }

    window.addEventListener("pointerdown", handlePointerDown)
    return () => window.removeEventListener("pointerdown", handlePointerDown)
  }, [])

  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-[#30363d] bg-[#0d1117]">
      <div className="border-b border-[#30363d] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7d8590]">
            Topicos
          </div>
          <button
            type="button"
            onClick={onAddProjectTopic}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22] text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
            title="Adicionar topico"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-[#30363d] px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-[#f0f6fc]">Skills</div>

          <button
            type="button"
            onClick={onRefreshSkills}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22] text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
            title="Atualizar skills"
            disabled={isSkillsLoading}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isSkillsLoading ? "animate-spin" : "")}
            />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border border-[#21262d] bg-[#0d1117] px-1.5 py-1.5">
          {skillTree.length > 0 ? (
            <SkillsTree
              nodes={skillTree}
              expandedFolders={expandedSkillFolders}
              onToggleFolder={toggleSkillFolder}
              currentSkillFilePath={currentSkillFilePath}
              onOpenSkillFile={onOpenSkillFile}
            />
          ) : (
            <div className="px-2 py-2 text-xs text-[#7d8590]">
              Nenhuma skill encontrada.
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {projects.length === 0 ? (
          <div className="px-2 py-3 text-xs italic text-[#7d8590]">
            Nenhum topico ainda.
          </div>
        ) : (
          projects.map((project) => (
            <div key={project.id} className="mb-2">
              <div className="group relative" data-topic-menu-root="true">
                <button
                  type="button"
                  onClick={() => onToggleProject(project.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 pr-10 text-left text-sm transition-colors",
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

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setTopicMenuId((current) =>
                      current === project.id ? null : project.id
                    )
                  }}
                  className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[#7d8590] opacity-0 transition-all hover:bg-[#21262d] hover:text-[#f0f6fc] group-hover:opacity-100"
                  title="Acoes do topico"
                >
                  <Ellipsis className="h-4 w-4" />
                </button>

                {topicMenuId === project.id ? (
                  <div className="absolute right-1 top-9 z-20 flex w-48 flex-col overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] p-1 shadow-[0_14px_34px_rgba(0,0,0,0.48)]">
                    <button
                      type="button"
                      onClick={() => {
                        closeTopicMenu()
                        onOpenTopicInExplorer(project.id)
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-[#8b949e]" />
                      Abrir no explorer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeTopicMenu()
                        onRenameTopic(project.id)
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
                    >
                      <Pencil className="h-3.5 w-3.5 text-[#8b949e]" />
                      Editar nome
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeTopicMenu()
                        onDeleteTopic(project.id)
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[#ffb4ab] transition-colors hover:bg-[#21262d] hover:text-[#ffd7d2]"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[#f85149]" />
                      Excluir
                    </button>
                  </div>
                ) : null}
              </div>

              {project.isExpanded ? (
                <div className="ml-5 mt-1 space-y-1">
                  {project.topics.length > 0 ? (
                    project.topics.map((topic) => (
                      <div key={topic.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => onTopicSelect(topic.id, project.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-2 pr-16 text-left text-xs transition-colors",
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

                        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onTogglePinnedConversation(topic.id)
                            }}
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[#21262d]",
                              pinnedSessionIds.includes(topic.id)
                                ? "text-[#58a6ff]"
                                : "text-[#7d8590] hover:text-[#f0f6fc]"
                            )}
                            title={
                              pinnedSessionIds.includes(topic.id)
                                ? "Desfixar conversa"
                                : "Fixar conversa"
                            }
                          >
                            <Pin className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onDeleteConversation(topic.id)
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f85149]"
                            title="Excluir conversa"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
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
          <span>Configuracoes</span>
        </button>
      </div>
    </aside>
  )
}
