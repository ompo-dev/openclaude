'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, X } from 'lucide-react'
import type { IDisposable, Terminal as XTermInstance } from 'xterm'

import type { TerminalCompletionSnapshot } from '@/types/integration'

interface TerminalEntry {
  id: string
  kind: 'command' | 'output'
  text: string
  raw?: boolean
}

interface TerminalProps {
  isOpen: boolean
  onClose: () => void
  onMinimize: () => void
  isMinimized: boolean
  entries: TerminalEntry[]
  cwd: string
  shellName: string
  interactive: boolean
  activeCommand?: string | null
  onSendInput: (data: string) => Promise<void> | void
  onRunCommand: (command: string) => Promise<void> | void
  onComplete: (
    command: string
  ) => Promise<TerminalCompletionSnapshot> | TerminalCompletionSnapshot
  onResize?: (dimensions: {
    cols: number
    rows: number
  }) => Promise<void> | void
}

const APPROX_CHAR_WIDTH = 7.4
const APPROX_LINE_HEIGHT = 18
const MAX_COMPLETION_MATCHES = 12

const normalizeForXterm = (value: string) => value.replace(/\r?\n/g, '\r\n')

const isGeneratedTerminalResponse = (data: string) =>
  /^\x1b\[\?[\d;]*c$/.test(data) ||
  /^\x1b\[\d+;\d+R$/.test(data) ||
  /^\x1b\[[IO]$/.test(data)

const formatShellPrompt = (shellName: string, cwd: string) =>
  shellName.toLowerCase().includes('power') ? `PS ${cwd}> ` : `${cwd} $ `

const extractCommandHistory = (
  entries: TerminalEntry[],
  shellName: string,
  cwd: string,
  activeCommand?: string | null
) => {
  const shellPrompt = formatShellPrompt(shellName, cwd)
  const interactivePrompt = activeCommand ? `${activeCommand}> ` : '> '

  return entries
    .filter((entry) => entry.kind === 'command')
    .map((entry) => normalizeForXterm(entry.text).replace(/\r\n/g, '\n').trim())
    .map((line) => {
      if (line.startsWith(shellPrompt.trimEnd())) {
        return line.slice(shellPrompt.trimEnd().length).trim()
      }
      if (line.startsWith(interactivePrompt.trimEnd())) {
        return line.slice(interactivePrompt.trimEnd().length).trim()
      }
      return line
    })
    .filter(Boolean)
}

const applyCompletion = (
  currentValue: string,
  completion: TerminalCompletionSnapshot,
  match: string
) => {
  const before = currentValue.slice(0, completion.replacement_index)
  const after = currentValue.slice(
    completion.replacement_index + completion.replacement_length
  )
  return `${before}${match}${after}`
}

const buildTranscript = (
  entries: TerminalEntry[],
  completionMatches: string[]
) => {
  const chunks: string[] = []

  entries.forEach((entry) => {
    const text = entry.raw ? entry.text : normalizeForXterm(entry.text)
    chunks.push(text)
    if (!text.endsWith('\n') && !text.endsWith('\r')) {
      chunks.push('\r\n')
    }
  })

  if (completionMatches.length > 1) {
    chunks.push(`${completionMatches.join('    ')}\r\n`)
  }

  return chunks.join('')
}

export function Terminal({
  isOpen,
  onClose,
  onMinimize,
  isMinimized,
  entries,
  cwd,
  shellName,
  interactive,
  activeCommand,
  onSendInput,
  onRunCommand,
  onComplete,
  onResize
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTermInstance | null>(null)
  const xtermDisposeRef = useRef<IDisposable[]>([])
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const inputBufferRef = useRef('')
  const cursorIndexRef = useRef(0)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef<number | null>(null)
  const observedResizeRef = useRef<string>('')
  const reportedResizeRef = useRef<string>('')
  const interactiveRef = useRef(interactive)
  const promptRef = useRef('')
  const transcriptRef = useRef('')
  const renderedTranscriptRef = useRef('')
  const renderedInteractiveRef = useRef(false)
  const isWritingRef = useRef(false)
  const inputRequestRef = useRef<Promise<void> | null>(null)
  const completionRequestRef = useRef<Promise<void> | null>(null)
  const renderBaseRef = useRef<(() => void) | null>(null)
  const renderPromptRef = useRef<(() => void) | null>(null)
  const onSendInputRef = useRef(onSendInput)
  const onRunCommandRef = useRef(onRunCommand)
  const onCompleteRef = useRef(onComplete)
  const onResizeRef = useRef(onResize)

  const [inputBuffer, setInputBuffer] = useState('')
  const [cursorIndex, setCursorIndex] = useState(0)
  const [completionMatches, setCompletionMatches] = useState<string[]>([])

  const prompt = useMemo(
    () => formatShellPrompt(shellName, cwd),
    [cwd, shellName]
  )
  const transcript = useMemo(
    () => buildTranscript(entries, completionMatches),
    [completionMatches, entries]
  )

  const syncShellState = useCallback(
    (
      nextBuffer: string,
      nextCursor: number,
      nextHistoryIndex: number | null = historyIndexRef.current,
      clearCompletions = true
    ) => {
      const safeCursor = Math.max(0, Math.min(nextCursor, nextBuffer.length))
      inputBufferRef.current = nextBuffer
      cursorIndexRef.current = safeCursor
      historyIndexRef.current = nextHistoryIndex
      setInputBuffer(nextBuffer)
      setCursorIndex(safeCursor)
      if (clearCompletions) {
        setCompletionMatches([])
      }
    },
    []
  )

  const focusTerminal = useCallback(() => {
    xtermRef.current?.focus()
  }, [])

  useEffect(() => {
    interactiveRef.current = interactive
  }, [interactive])

  useEffect(() => {
    promptRef.current = prompt
  }, [prompt])

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  useEffect(() => {
    onSendInputRef.current = onSendInput
  }, [onSendInput])

  useEffect(() => {
    onRunCommandRef.current = onRunCommand
  }, [onRunCommand])

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

  useEffect(() => {
    historyRef.current = extractCommandHistory(
      entries,
      shellName,
      cwd,
      activeCommand
    )
  }, [activeCommand, cwd, entries, shellName])

  useEffect(() => {
    if (!interactive) {
      return
    }
    syncShellState('', 0, null)
  }, [interactive, syncShellState])

  useEffect(() => {
    if (!isOpen || isMinimized) {
      return
    }

    let disposed = false

    const initialize = async () => {
      const host = containerRef.current
      if (!host || xtermRef.current) {
        return
      }

      const xtermModule = await import('xterm')
      if (disposed || !containerRef.current || xtermRef.current) {
        return
      }

      const term = new xtermModule.Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        allowTransparency: false,
        convertEol: false,
        fontFamily:
          'Geist Mono, ui-monospace, SFMono-Regular, SF Mono, Consolas, Liberation Mono, Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        scrollback: 10000,
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#f0f6fc',
          cursorAccent: '#0d1117',
          selectionBackground: '#264f78',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#c9d1d9',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#f0f6fc'
        }
      })

      term.open(containerRef.current)

      const writeToTerminal = (value: string) => {
        if (!xtermRef.current || !value) {
          return
        }
        isWritingRef.current = true
        xtermRef.current.write(value, () => {
          isWritingRef.current = false
        })
      }

      const updatePromptLine = () => {
        if (!xtermRef.current || interactiveRef.current) {
          return
        }

        const trailingChars =
          inputBufferRef.current.length - cursorIndexRef.current
        writeToTerminal(
          `\r\x1b[2K${promptRef.current}${inputBufferRef.current}${
            trailingChars > 0 ? `\x1b[${trailingChars}D` : ''
          }`
        )
        xtermRef.current.scrollToBottom()
      }

      const renderBase = () => {
        if (!xtermRef.current) {
          return
        }

        const nextTranscript = transcriptRef.current
        const nextInteractive = interactiveRef.current
        const termInstance = xtermRef.current

        if (!nextInteractive) {
          termInstance.reset()
          if (nextTranscript) {
            writeToTerminal(nextTranscript)
          }
          renderedTranscriptRef.current = nextTranscript
          renderedInteractiveRef.current = false
          updatePromptLine()
          return
        }

        const previousTranscript = renderedTranscriptRef.current
        const previousInteractive = renderedInteractiveRef.current

        if (
          !previousInteractive ||
          !nextTranscript.startsWith(previousTranscript)
        ) {
          termInstance.reset()
          if (nextTranscript) {
            writeToTerminal(nextTranscript)
          }
        } else if (nextTranscript.length > previousTranscript.length) {
          writeToTerminal(nextTranscript.slice(previousTranscript.length))
        }

        renderedTranscriptRef.current = nextTranscript
        renderedInteractiveRef.current = true
        termInstance.scrollToBottom()
        termInstance.focus()
      }

      renderPromptRef.current = updatePromptLine
      renderBaseRef.current = renderBase

      const handleShellCompletion = async () => {
        if (completionRequestRef.current) {
          return
        }

        const request = Promise.resolve(
          onCompleteRef.current(inputBufferRef.current)
        )
          .then((completion) => {
            if (completion.matches.length === 1) {
              const nextBuffer = applyCompletion(
                inputBufferRef.current,
                completion,
                completion.matches[0]!
              )
              syncShellState(nextBuffer, nextBuffer.length)
              queueMicrotask(() => renderPromptRef.current?.())
              return
            }

            setCompletionMatches(
              completion.matches.slice(0, MAX_COMPLETION_MATCHES)
            )
          })
          .finally(() => {
            completionRequestRef.current = null
          })

        completionRequestRef.current = request.then(() => undefined)
      }

      const handleShellCommand = async () => {
        if (inputRequestRef.current) {
          return
        }

        const command = inputBufferRef.current
        syncShellState('', 0, null)

        if (!command.trim()) {
          renderBaseRef.current?.()
          return
        }

        const request = Promise.resolve(
          onRunCommandRef.current(command)
        ).finally(() => {
          inputRequestRef.current = null
        })

        inputRequestRef.current = request.then(() => undefined)
      }

      const shellControl = async (data: string) => {
        if (data === '\r') {
          await handleShellCommand()
          return
        }

        if (data === '\t') {
          await handleShellCompletion()
          return
        }

        if (data === '\u0003') {
          syncShellState('', 0, null)
          renderPromptRef.current?.()
          return
        }

        if (data === '\u007f') {
          if (cursorIndexRef.current === 0) {
            return
          }
          const nextBuffer =
            inputBufferRef.current.slice(0, cursorIndexRef.current - 1) +
            inputBufferRef.current.slice(cursorIndexRef.current)
          syncShellState(nextBuffer, cursorIndexRef.current - 1)
          renderPromptRef.current?.()
          return
        }

        if (data === '\u001b[3~') {
          if (cursorIndexRef.current >= inputBufferRef.current.length) {
            return
          }
          const nextBuffer =
            inputBufferRef.current.slice(0, cursorIndexRef.current) +
            inputBufferRef.current.slice(cursorIndexRef.current + 1)
          syncShellState(nextBuffer, cursorIndexRef.current)
          renderPromptRef.current?.()
          return
        }

        if (data === '\u001b[D') {
          syncShellState(
            inputBufferRef.current,
            cursorIndexRef.current - 1,
            historyIndexRef.current,
            false
          )
          renderPromptRef.current?.()
          return
        }

        if (data === '\u001b[C') {
          syncShellState(
            inputBufferRef.current,
            cursorIndexRef.current + 1,
            historyIndexRef.current,
            false
          )
          renderPromptRef.current?.()
          return
        }

        if (data === '\u001b[H' || data === '\u001b[1~') {
          syncShellState(
            inputBufferRef.current,
            0,
            historyIndexRef.current,
            false
          )
          renderPromptRef.current?.()
          return
        }

        if (data === '\u001b[F' || data === '\u001b[4~') {
          syncShellState(
            inputBufferRef.current,
            inputBufferRef.current.length,
            historyIndexRef.current,
            false
          )
          renderPromptRef.current?.()
          return
        }

        if (data === '\u001b[A') {
          const history = historyRef.current
          if (!history.length) {
            return
          }
          const nextIndex =
            historyIndexRef.current === null
              ? history.length - 1
              : Math.max(0, historyIndexRef.current - 1)
          const nextBuffer = history[nextIndex] ?? ''
          syncShellState(nextBuffer, nextBuffer.length, nextIndex)
          renderPromptRef.current?.()
          return
        }

        if (data === '\u001b[B') {
          const history = historyRef.current
          if (!history.length || historyIndexRef.current === null) {
            return
          }
          const nextIndex = historyIndexRef.current + 1
          if (nextIndex >= history.length) {
            syncShellState('', 0, null)
          } else {
            const nextBuffer = history[nextIndex] ?? ''
            syncShellState(nextBuffer, nextBuffer.length, nextIndex)
          }
          renderPromptRef.current?.()
          return
        }

        if (data.startsWith('\u001b')) {
          return
        }

        const nextBuffer =
          inputBufferRef.current.slice(0, cursorIndexRef.current) +
          data +
          inputBufferRef.current.slice(cursorIndexRef.current)
        syncShellState(nextBuffer, cursorIndexRef.current + data.length)
        renderPromptRef.current?.()
      }

      xtermDisposeRef.current.push(
        term.onData((data) => {
          if (isWritingRef.current || isGeneratedTerminalResponse(data)) {
            return
          }
          if (interactiveRef.current) {
            void onSendInputRef.current(data)
            return
          }

          void shellControl(data)
        })
      )

      xtermDisposeRef.current.push(
        term.onResize(({ cols, rows }) => {
          const signature = `${cols}x${rows}`
          if (reportedResizeRef.current === signature) {
            return
          }
          reportedResizeRef.current = signature
          if (interactiveRef.current) {
            void onResizeRef.current?.({ cols, rows })
          }
        })
      )

      resizeObserverRef.current = new ResizeObserver(() => {
        const target = containerRef.current
        const xterm = xtermRef.current
        if (!target || !xterm) {
          return
        }

        const cols = Math.max(
          40,
          Math.floor(target.clientWidth / APPROX_CHAR_WIDTH)
        )
        const rows = Math.max(
          12,
          Math.floor(target.clientHeight / APPROX_LINE_HEIGHT)
        )
        const signature = `${cols}x${rows}`

        if (observedResizeRef.current !== signature) {
          observedResizeRef.current = signature
          xterm.resize(cols, rows)
          if (
            interactiveRef.current &&
            reportedResizeRef.current !== signature
          ) {
            reportedResizeRef.current = signature
            void onResizeRef.current?.({ cols, rows })
          }
        }
      })

      resizeObserverRef.current.observe(containerRef.current)
      xtermRef.current = term
      renderedTranscriptRef.current = ''
      renderedInteractiveRef.current = false
      renderBase()
      focusTerminal()
    }

    void initialize()

    return () => {
      disposed = true
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      xtermDisposeRef.current.forEach((disposable) => disposable.dispose())
      xtermDisposeRef.current = []
      xtermRef.current?.dispose()
      xtermRef.current = null
      renderBaseRef.current = null
      renderPromptRef.current = null
      renderedTranscriptRef.current = ''
      renderedInteractiveRef.current = false
      observedResizeRef.current = ''
      reportedResizeRef.current = ''
    }
  }, [focusTerminal, isMinimized, isOpen, syncShellState])

  useEffect(() => {
    if (!isOpen || isMinimized) {
      return
    }
    renderBaseRef.current?.()
  }, [interactive, isMinimized, isOpen, transcript])

  useEffect(() => {
    if (!isOpen || isMinimized || interactive) {
      return
    }
    renderPromptRef.current?.()
  }, [cursorIndex, inputBuffer, interactive, isMinimized, isOpen, prompt])

  useEffect(() => {
    if (!isOpen || isMinimized) {
      return
    }
    focusTerminal()
  }, [focusTerminal, isMinimized, isOpen])

  if (!isOpen) return null

  if (isMinimized) {
    return (
      <div className="shrink-0 bg-[#0d1117] px-4 py-2">
        <div className="mx-auto flex w-full items-center justify-between">
          <div className="text-xs text-[#7d8590]">
            Terminal - <span className="text-[#c9d1d9]">{shellName}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onMinimize}
              className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shrink-0 border-t border-[#30363d] bg-[#0d1117]">
      <div className="mx-auto w-full">
        <div className="border-x border-[#30363d] bg-[#0d1117]">
          <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
            <div className="flex items-end gap-1">
              <div className="h-fit text-sm font-semibold leading-none text-[#f0f6fc]">
                Terminal
              </div>
              <div className="h-fit text-xs leading-none text-[#7d8590]">
                {shellName} - {cwd}
                {interactive && activeCommand ? ` - ${activeCommand}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onMinimize}
                className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-[#7d8590] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="h-72 px-2 py-2">
            <div className="h-full rounded-md bg-[#0d1117]">
              <div
                ref={containerRef}
                onClick={focusTerminal}
                className="h-full w-full overflow-hidden px-3 py-2 [&_.xterm-viewport]:overflow-y-auto [&_.xterm]:h-full [&_.xterm]:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
