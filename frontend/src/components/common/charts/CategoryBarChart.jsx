import React from 'react'

// Fixed categorical hue assignment, never cycled/recomputed per render --
// same five "top5" categories this app's own backend singles out
// (app/services/coverage.py's TOP5_MATERIAL_CATEGORIES) get a stable
// color each time they appear, on any bill, on any project.
const CATEGORY_COLORS = {
  concrete: '#3182CE',
  reinforcement_steel: '#f59e0b',
  structural_steel: '#38bdf8',
  aluminium: '#a78bfa',
  glass: '#34d399',
}
const FALLBACK_COLOR = '#94a3b8'
const CATEGORY_LABELS = {
  concrete: 'Concrete',
  reinforcement_steel: 'Reinforcement Steel',
  structural_steel: 'Structural Steel',
  aluminium: 'Aluminium',
  glass: 'Glass',
}

/**
 * Horizontal magnitude bars for a by-category GWP breakdown -- direct
 * value+percentage labels on every bar (there are always <=8 categories
 * in practice, so this stays readable without a separate legend).
 * categories: [{ category, gwp_kg_co2e, pct_of_total }]
 */
export default function CategoryBarChart({ categories = [] }) {
  if (!categories || categories.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>
        No category breakdown available for this bill yet.
      </div>
    )
  }

  const sorted = [...categories].sort((a, b) => b.gwp_kg_co2e - a.gwp_kg_co2e)
  const maxVal = Math.max(...sorted.map((c) => c.gwp_kg_co2e)) || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sorted.map((c) => {
        const color = CATEGORY_COLORS[c.category] || FALLBACK_COLOR
        const pct = (c.gwp_kg_co2e / maxVal) * 100
        const label = CATEGORY_LABELS[c.category] || (c.category ? c.category.replace(/_/g, ' ') : 'Uncategorized')
        return (
          <div key={c.category || label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4 }}>
              <span style={{ color: '#cbd5e1', fontWeight: 500, textTransform: 'capitalize' }}>{label}</span>
              <span className="tabular-nums" style={{ color, fontWeight: 700 }}>
                {(c.gwp_kg_co2e / 1000).toFixed(1)} t{' '}
                <span style={{ color: '#64748b', fontWeight: 400 }}>
                  ({(c.pct_of_total ?? 0).toFixed(1)}%)
                </span>
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(pct, 2)}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: color,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
