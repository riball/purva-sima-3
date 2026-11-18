import React, { useMemo } from 'react'

// Same fixed categorical hue assignment as CategoryBarChart -- deliberately
// duplicated rather than imported, so each stays a simple, independent
// presentational component.
// Exported so other charts needing the same fixed categorical hue
// assignment (e.g. PortfolioOverview's Material Distribution pie / Largest
// Contributor column) reuse this exact mapping rather than redefining their
// own -- dataviz: "color follows the entity," never reassigned per screen.
// Fixed-order nominal categorical assignment -- see index.css's own
// `--chart-cat-*` comment for why these come from the dataviz skill's
// validated default theme (blue/orange/aqua/yellow/magenta/green)
// rather than a literal copy of the mockup's near-monochrome green+tan
// shades: 6 material categories are genuinely nominal identity (swapping
// their order changes nothing), and the mockup's own hues, when run
// through the skill's validator, fail its hard normal-vision-separation
// gate (worst adjacent pair well under the required threshold) -- two
// categories a reader, colorblind or not, could not reliably tell apart
// by color alone. Order is fixed and never reassigned per screen
// (dataviz: "color follows the entity").
export const CATEGORY_COLORS = {
  concrete: 'var(--chart-cat-1)',
  reinforcement_steel: 'var(--chart-cat-2)',
  structural_steel: 'var(--chart-cat-3)',
  aluminium: 'var(--chart-cat-4)',
  glass: 'var(--chart-cat-5)',
  brickwork: 'var(--chart-cat-6)',
  blockwork_aac: 'var(--chart-cat-6)',
}
export const FALLBACK_COLOR = 'var(--text-tertiary)'
export const CATEGORY_LABELS = {
  concrete: 'Concrete',
  reinforcement_steel: 'Reinforcement Steel',
  structural_steel: 'Structural Steel',
  aluminium: 'Aluminium',
  glass: 'Glass',
  brickwork: 'Brickwork',
  blockwork_aac: 'AAC Blockwork',
}

/**
 * UX refinement: "do not want only the latest bill displayed here, add all
 * the previous bills and show the latest bill contribution in a different
 * color/shade." Replaces the old CategoryBarChart usage in TrackingChatHub
 * (which only ever rendered the single latest bill's own category_breakdown)
 * with a two-segment stacked bar per category: a dimmed segment for
 * everything logged before the latest bill, and a full-saturation segment
 * for what the latest bill itself added -- same hue per category throughout
 * (dataviz: "color follows the entity"), the two segments the ONLY thing
 * that differs between them, so identity (which material) and recency
 * (previous vs. latest) are never confused for each other.
 *
 * This has to be basis-aware, not a naive sum of every bill's own
 * category_breakdown -- a CUMULATIVE bill's breakdown already includes
 * every prior bill's quantities (summing them would double, triple,
 * quadruple-count the same material), while a PRESENT-basis bill's
 * breakdown is genuinely just that one period's own quantity (those DO
 * need to be summed to get a running total). See phase3.BillPeriod's own
 * quantity_basis docstring, and TrackingChatHub's existing
 * cumulativePoints/presentOnlyPoints split, for the same distinction
 * applied elsewhere in this file.
 *
 * bills: the full, oldest-first bills array (same shape TrackingChatHub
 * already loads via api.getBills) -- not just the latest one.
 */
export default function MaterialBreakdownChart({ bills = [] }) {
  const { rows, latest } = useMemo(() => aggregateCategories(bills), [bills])

  if (rows.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
        No category breakdown available yet.
      </div>
    )
  }

  const maxVal = Math.max(...rows.map((r) => r.total)) || 1

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'color-mix(in srgb, var(--text-tertiary) 45%, var(--bg-secondary))' }} />
          Previous bills
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--text-tertiary)' }} />
          Latest bill{latest?.period ? ` (${latest.period})` : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((row) => {
          const color = CATEGORY_COLORS[row.category] || FALLBACK_COLOR
          const dimColor = `color-mix(in srgb, ${color} 45%, var(--bg-secondary))`
          const label = CATEGORY_LABELS[row.category] || (row.category ? row.category.replace(/_/g, ' ') : 'Uncategorized')
          const pctOfMax = (row.total / maxVal) * 100
          const previousShare = row.total > 0 ? (row.previous / row.total) * 100 : 0
          const latestShare = row.total > 0 ? (row.latestContribution / row.total) * 100 : 0

          return (
            <div key={row.category || label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.75rem', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'capitalize' }}>{label}</span>
                <span className="tabular-nums" style={{ color, fontWeight: 700 }}>
                  {(row.total / 1000).toFixed(1)} t
                  {row.latestContribution > 0 && (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                      {' '}
                      (+{(row.latestContribution / 1000).toFixed(1)} t latest)
                    </span>
                  )}
                </span>
              </div>
              <div
                style={{
                  width: `${Math.max(pctOfMax, 2)}%`,
                  height: 10,
                  borderRadius: 999,
                  background: 'rgba(var(--c-overlay),0.05)',
                  overflow: 'hidden',
                  display: 'flex',
                  gap: row.previous > 0 && row.latestContribution > 0 ? 2 : 0,
                }}
              >
                {row.previous > 0 && (
                  <div
                    title={`Previous bills: ${(row.previous / 1000).toFixed(1)} t`}
                    style={{ width: `${previousShare}%`, height: '100%', background: dimColor, transition: 'width 0.4s ease' }}
                  />
                )}
                {row.latestContribution > 0 && (
                  <div
                    title={`Latest bill: ${(row.latestContribution / 1000).toFixed(1)} t`}
                    style={{ width: `${latestShare}%`, height: '100%', borderRadius: row.previous > 0 ? '0 999px 999px 0' : 999, background: color, transition: 'width 0.4s ease' }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Exported for PortfolioOverview's cross-project aggregation (each
// project's own per-category totals, summed into the portfolio-wide
// Material Distribution pie, and the source of its "Largest Contributor"
// cell) -- the cumulative-vs-present-basis handling below is subtle (see
// the comments inside) and deliberately not re-derived a second time.
export function aggregateCategories(bills) {
  const validBills = (bills || []).filter(Boolean)
  if (validBills.length === 0) return { rows: [], latest: null }

  const latest = validBills[validBills.length - 1]
  const previousBills = validBills.slice(0, -1)
  const latestBasis = latest.quantity_basis === 'present' ? 'present' : 'cummulative'
  const latestCats = latest.category_breakdown || []

  // category -> { previous, total }
  const totals = new Map()
  const ensure = (cat) => {
    if (!totals.has(cat)) totals.set(cat, { previous: 0, total: 0 })
    return totals.get(cat)
  }

  if (latestBasis === 'cummulative') {
    // The latest bill's own figure is already a running total, so "what
    // came before" is the nearest earlier bill that actually recorded a
    // breakdown (walking backwards past any older xlsx_boq-sourced bill,
    // which never carried category_breakdown at all) -- never a sum
    // across every prior bill, which would double-count everything that
    // earlier bill already included.
    const priorWithBreakdown = [...previousBills].reverse().find((b) => b.category_breakdown && b.category_breakdown.length > 0)
    if (latestCats.length > 0) {
      latestCats.forEach((c) => {
        ensure(c.category).total = c.gwp_kg_co2e || 0
      })
      if (priorWithBreakdown) {
        priorWithBreakdown.category_breakdown.forEach((c) => {
          const row = ensure(c.category)
          row.previous = c.gwp_kg_co2e || 0
        })
      }
    } else if (priorWithBreakdown) {
      // The latest bill itself didn't carry a category breakdown (e.g. an
      // xlsx_boq-sourced bill, which never records one) -- rather than
      // going blank, fall back to the nearest earlier bill that did, with
      // no "latest" highlight since there's no new per-category figure to
      // compare it against.
      priorWithBreakdown.category_breakdown.forEach((c) => {
        ensure(c.category).total = c.gwp_kg_co2e || 0
      })
    }
  } else {
    // Present-basis: every period's figure is genuinely its own quantity,
    // never a running total, so "previous" really is the sum of every
    // earlier present-basis bill's own figure (only present-basis bills --
    // mixing in a stray cumulative-basis bill's already-inclusive total
    // would reintroduce the same double-count this is trying to avoid).
    previousBills
      .filter((b) => b.quantity_basis === 'present')
      .forEach((b) => {
        ;(b.category_breakdown || []).forEach((c) => {
          ensure(c.category).previous += c.gwp_kg_co2e || 0
        })
      })
    latestCats.forEach((c) => {
      const row = ensure(c.category)
      row.total = row.previous + (c.gwp_kg_co2e || 0)
    })
  }

  const rows = Array.from(totals.entries())
    .map(([category, { previous, total }]) => {
      const clampedPrevious = Math.max(0, Math.min(previous, total))
      return {
        category,
        previous: clampedPrevious,
        latestContribution: Math.max(0, total - clampedPrevious),
        total,
      }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)

  return { rows, latest }
}
