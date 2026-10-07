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
              background: 'rgba(14, 25, 18, 0.95)',
              backdropFilter: 'blur(16px)',
              border: `1px solid ${isSuccess ? 'rgba(49, 130, 206, 0.4)' : isError ? 'rgba(244, 63, 94, 0.4)' : 'rgba(49, 130, 206, 0.3)'}`,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
              color: '#f8fafc',
              fontSize: '0.875rem',
              maxWidth: 420,
            }}
          >
            {isSuccess && <CheckCircle2 size={18} color="#3182CE" />}
            {isError && <AlertCircle size={18} color="#f43f5e" />}
            {!isSuccess && !isError && <Info size={18} color="#38bdf8" />}

            <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.message}</span>

            {toast.action && (
              <button
                onClick={() => {
                  toast.action.onClick?.()
                  removeToast(toast.id)
                }}
                style={{
                  background: 'rgba(49, 130, 206, 0.15)',
                  border: '1px solid rgba(49, 130, 206, 0.35)',
                  borderRadius: 'var(--radius-sm)',
                  color: '#3182CE',
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
                color: '#64748b',
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
