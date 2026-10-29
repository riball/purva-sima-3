import React from 'react'

export default function StatCard({
  title,
  value,
  unit = '',
  subtitle = '',
  badge = null,
  badgeType = 'lime', // lime, mint, amber, violet, muted
  icon: Icon = null,
  accent = 'lime',
}) {
  // "shades of green and colour close to green" -- lime/mint are the
  // mockup's own two green steps; violet is its sampled clay/taupe tone
  // (see index.css's --accent-violet comment), used for reference/
  // secondary data rather than a 4th green so adjacent cards in a row
  // stay visually distinguishable without reaching for an off-palette
  // hue like the old cyan. amber stays reserved for its warning meaning.
  // The default (unrecognized accent) falls through to --c-blue, which
  // is itself the brand green now, not literal blue -- see that token's
  // own comment in index.css.
  const accentGlow = {
    lime: 'rgba(var(--c-blue), 0.08)',
    mint: 'rgba(var(--c-blue), 0.08)',
    amber: 'rgba(var(--c-amber), 0.08)',
    violet: 'rgba(var(--c-violet), 0.08)',
  }[accent] || 'rgba(var(--c-blue), 0.08)'

  const accentColor = {
    lime: 'var(--accent-lime)',
    mint: 'var(--accent-mint)',
    amber: 'var(--accent-amber-light)',
    violet: 'var(--accent-violet)',
  }[accent] || 'var(--accent-lime)'

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
        <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
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
                background: 'rgba(var(--c-overlay), 0.05)',
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
        <span className="tabular-nums" style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--accent-lime)' }}>
            {unit}
          </span>
        )}
      </div>

      {subtitle && (
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
          {subtitle}
        </span>
      )}
    </div>
  )
}
