import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'eca-theme'

const ThemeContext = createContext(null)

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage can throw (private browsing, blocked storage) -- fall
    // through to the system preference instead of crashing the app.
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light')
    } else {
      // 'dark' is the default (:root with no attribute), so just drop it
      // rather than carrying a redundant data-theme="dark" around.
      root.removeAttribute('data-theme')
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Ignore -- the in-memory state still drives this session correctly,
      // it just won't be remembered on next visit.
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
