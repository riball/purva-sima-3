import React from 'react'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

/**
 * Global light/dark switch. Rendered once, fixed to the viewport, so it is
 * reachable from every tab (including the landing page) rather than being
 * tucked inside the slide-out Navbar, which is closed by default.
 */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'

  return (
    <button
      onClick={toggleTheme}
      title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      style={{
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: 1000,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid var(--glass-border)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        borderRadius: 'var(--radius-md)',
        transition: 'all 0.2s',
        boxShadow: 'var(--glass-shadow)',
      }}
      className="hover:scale-105 active:scale-95"
    >
      {isLight ? <Moon size={20} /> : <Sun size={20} />}
    </button>
  )
}
