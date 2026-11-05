import React from 'react'
import { materialLabel } from '../materialCategoryLabels'

// Fixed categorical hue assignment, never cycled/recomputed per render --
// same five "top5" categories this app's own backend singles out
// (app/services/coverage.py's TOP5_MATERIAL_CATEGORIES) get a stable
// color each time they appear, on any bill, on any project.
const CATEGORY_COLORS = {
  concrete: 'var(--accent-lime)',
  reinforcement_steel: 'var(--accent-amber)',
  structural_steel: 'var(--accent-cyan)',
  aluminium: 'var(--accent-violet)',
  glass: 'var(--accent-emerald)',
}
const FALLBACK_COLOR = 'var(--text-tertiary)'
// Labels now come from the shared materialCategoryLabels.js map (used by
// the new searchable "every material" list too, see MaterialSearchPanel
// .jsx) instead of a second, narrower copy kept only here -- this covers
// every category boq_carbon's engine can compute (rcc/pcc/brickwork/
// masonry/etc.), not just the fixed top-5 set, so the "Top Materials --
// This BOQ" card (JobDashboardPage.jsx) shows a real label instead of a
// raw category string for anything outside the top-5 set.

/**
 * Horizontal magnitude bars for a by-category GWP breakdown -- direct
 * value+percentage labels on every bar (there are always <=8 categories
 * in practice, so this stays readable without a separate legend).
 * categories: [{ category, gwp_kg_co2e, pct_of_total }]
 *
 * limit: optional -- cap to the top N by gwp_kg_co2e AFTER sorting, for a
 * "top materials in this specific result" widget (see JobDashboardPage's
 * "Top Materials -- This BOQ" card) sitting alongside the uncapped,
 * full-breakdown use of this same component. Omitted/undefined renders
 * every category, unchanged from before this prop existed.
 */
export default function CategoryBarChart({ categories = [], limit }) {
  if (!categories || categories.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
        No category breakdown available for this bill yet.
      </div>
    )
  }

  const rankedAll = [...categories].sort((a, b) => b.gwp_kg_co2e - a.gwp_kg_co2e)
  const sorted = limit != null ? rankedAll.slice(0, limit) : rankedAll
  const maxVal = Math.max(...sorted.map((c) => c.gwp_kg_co2e)) || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sorted.map((c) => {
        const color = CATEGORY_COLORS[c.category] || FALLBACK_COLOR
        const pct = (c.gwp_kg_co2e / maxVal) * 100
        const label = materialLabel(c.category)
        return (
          <div key={c.category || label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'capitalize' }}>{label}</span>
              <span className="tabular-nums" style={{ color, fontWeight: 700 }}>
                {(c.gwp_kg_co2e / 1000).toFixed(1)} t{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  ({(c.pct_of_total ?? 0).toFixed(1)}%)
                </span>
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(var(--c-overlay),0.05)', overflow: 'hidden' }}>
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
