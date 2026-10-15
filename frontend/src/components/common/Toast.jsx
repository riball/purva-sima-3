import React from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { useProject } from '../../context/ProjectContext'

export default function ToastContainer() {
  const { toasts, removeToast } = useProject()

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success'
        const isError = toast.type === 'error'

        return (
          <div
            key={toast.id}
            className="animate-fade-in"
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 18px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(var(--c-surf-3), 0.95)',
              backdropFilter: 'blur(16px)',
              border: `1px solid ${isSuccess ? 'rgba(var(--c-blue), 0.4)' : isError ? 'rgba(var(--c-rose), 0.4)' : 'rgba(var(--c-blue), 0.3)'}`,
              boxShadow: '0 12px 32px rgba(var(--c-black), 0.6)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
              maxWidth: 420,
            }}
          >
            {isSuccess && <CheckCircle2 size={18} color="var(--accent-lime)" />}
            {isError && <AlertCircle size={18} color="var(--accent-rose)" />}
            {!isSuccess && !isError && <Info size={18} color="var(--accent-cyan)" />}

            <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.message}</span>

            {toast.action && (
              <button
                onClick={() => {
                  toast.action.onClick?.()
                  removeToast(toast.id)
                }}
                style={{
                  background: 'rgba(var(--c-blue), 0.15)',
                  border: '1px solid rgba(var(--c-blue), 0.35)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent-lime)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {toast.action.label}
              </button>
            )}

            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 2,
              }}
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
