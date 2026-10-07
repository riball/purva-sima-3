import React from 'react'

export default function StatCard({
  title,
  value,
  unit = '',
  subtitle = '',
  badge = null,
  badgeType = 'lime', // lime, mint, amber, cyan, muted
  icon: Icon = null,
  accent = 'lime',
}) {
  const accentGlow = {
    lime: 'rgba(49, 130, 206, 0.08)',
    mint: 'rgba(49, 130, 206, 0.08)',
    amber: 'rgba(245, 158, 11, 0.08)',
    cyan: 'rgba(56, 189, 248, 0.08)',
  }[accent] || 'rgba(49, 130, 206, 0.08)'

  const accentColor = {
    lime: '#3182CE',
    mint: '#3182CE',
    amber: '#fbbf24',
    cyan: '#38bdf8',
  }[accent] || '#3182CE'

  return (
    <div
      className="glass-panel"
      style={{
        padding: '20px 22px',
        position: 'relative',
        overflow: 'hidden',
        background: `radial-gradient(circle at top right, ${accentGlow}, var(--glass-bg) 60%)`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8' }}>
          {title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {badge && <span className={`badge badge-${badgeType}`}>{badge}</span>}
          {Icon && (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: accentColor,
              }}
            >
              <Icon size={16} />
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span className="tabular-nums" style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc', lineHeight: 1.1 }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#3182CE' }}>
            {unit}
          </span>
        )}
      </div>

      {subtitle && (
        <span style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.3 }}>
          {subtitle}
        </span>
      )}
    </div>
  )
}
