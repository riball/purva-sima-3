import React from 'react'

/**
 * Simple two-or-more-bar magnitude comparison -- e.g. Baseline vs
 * Current carbon state (Phase 4). A comparison of totals is a bar
 * chart, never a line (there's no time axis here) -- see dataviz
 * guidance: "two measures -> two bars, not a line pretending to be one."
 * items: [{ label, value, color }]
 */
export default function CompareBars({ items = [], height = 150 }) {
  if (!items || items.length === 0) return null
  const maxVal = Math.max(...items.map((i) => i.value), 1)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, height, padding: '0 8px' }}>
      {items.map((it) => {
        const pct = (it.value / maxVal) * 100
        return (
          <div
            key={it.label}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end' }}
          >
            <span className="tabular-nums" style={{ fontSize: '0.8125rem', fontWeight: 700, color: it.color, marginBottom: 6 }}>
              {(it.value / 1000).toFixed(1)} t
            </span>
            <div
              style={{
                width: '56%',
                maxWidth: 72,
                height: `${Math.max(pct, 3)}%`,
                background: it.color,
                borderRadius: '6px 6px 2px 2px',
                transition: 'height 0.4s ease',
              }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 8, textAlign: 'center' }}>{it.label}</span>
          </div>
        )
      })}
    </div>
  )
}
