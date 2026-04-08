"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

export type Theme = "github-dark"

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  themes: { id: Theme; name: string; preview: string }[]
}

const themes: { id: Theme; name: string; preview: string }[] = [
  { id: "github-dark", name: "GitHub Dark", preview: "#0d1117" }
]

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("github-dark")

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      themes
    }),
    [theme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
