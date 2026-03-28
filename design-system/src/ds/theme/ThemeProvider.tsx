import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type DsTheme = 'light' | 'dark'

type ThemeContextValue = {
  theme: DsTheme
  setTheme: (theme: DsTheme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({
  initialTheme = 'light',
  children,
}: {
  initialTheme?: DsTheme
  children: React.ReactNode
}) {
  const [theme, setThemeState] = useState<DsTheme>(initialTheme)

  const setTheme = useCallback((next: DsTheme) => {
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  )

  return (
    <ThemeContext.Provider value={value}>
      <div data-ds-theme={theme}>{children}</div>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}
