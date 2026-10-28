import React, { useState, useEffect } from 'react'
import { ArrowLeft, FileSpreadsheet, FileText, Lightbulb, AlertTriangle } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import RadialGauge from '../common/RadialGauge'
import CategoryBarChart from '../common/charts/CategoryBarChart'

// Coverage's fixed six-reason exclusion taxonomy (app/services/coverage.py),
// given a readable label here rather than the raw snake_case reason string.
const REASON_LABELS = {
  unclassified: 'Not recognized as a material line item',
  not_contributing: 'Flagged as non-material (service / labour / admin / land)',
  needs_review: 'Classification pending review',
  no_emission_factor: 'No emission factor available yet for this category',
  unhandled_unit: "This row's unit/shape has no conversion formula yet",
  no_quantity: 'No usable quantity on this line',
}

const FLOOR_AREA_BASIS_LABELS = {
  built_up_total: 'Total Built-Up Area (BUA)',
  net_internal_gia: 'Net Internal / Gross Internal Area (GIA)',
  carpet_saleable: 'Carpet / Saleable Area',
  other: 'Other basis',
}

const thStyle = { textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.66rem', letterSpacing: '0.04em' }
const thStyleRight = { ...thStyle, textAlign: 'right' }
const tdStyle = { padding: '8px 10px', color: 'var(--text-secondary)' }
const tdStyleRight = { ...tdStyle, textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }

/**
 * UX fix: "View Dashboard" on a BOQ/Work Order upload result used to open
 * as a small modal popup overlaying the Analyze-a-BOQ screen -- the user
 * asked for "a new page full screen showing the whole page to be
 * dashboard, not opening a small pop up". This is that full-screen page
 * (wired into App.jsx's VIEW_COMPONENTS as the 'job-dashboard' view,
 * reached via JobResultsCompare.jsx's "View Dashboard" button calling
 * navigate('job-dashboard') after handing the job+result to
 * ProjectContext). "Back to Analyze a BOQ" returns the same way every
 * other screen navigates, by calling navigate('analyze-boq') -- there's
 * still no router in this app, just the one currentView string.
 *
 * The content itself (KPI row, coverage gauges, material-wise carbon
 * contribution chart, hotspot callout, honesty audit, top line items
 * table) is unchanged from the previous modal -- only the chrome around
 * it changed from a fixed-position overlay to a normal full-width page,
 * matching every other screen's layout (glass-panel header + sections).
 */
export default function JobDashboardPage() {
  const { dashboardJob: job, dashboardResult: result, navigate } = useProject()

  // Hotspot callout -- the verified substitution catalog's real
  // base_category values (e.g. "rcc", "reinforcement_steel",
  // "brickwork") already line up with the exact same category strings
  // this result's line items and by_category totals use (see
  // substitution_engine.py: `li.category != base_category`), so the
  // top-carbon category here can be matched straight against a real
  // catalog entry -- no invented "switch to X and save Y%" copy, only
  // whichever real, verified alternative (if any) actually exists for
  // whichever category is actually this upload's biggest contributor.
  const [catalog, setCatalog] = useState([])
  useEffect(() => {
    let cancelled = false
    api.getBoqCatalog().then((cat) => { if (!cancelled) setCatalog(cat) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!job || !result) {
    // Reached directly (e.g. a page refresh) with nothing to show --
    // send the user back to where this data would have come from
    // rather than rendering a blank page.
    return (
      <div className="glass-panel" style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <span>No upload result is currently open.</span>
        <button onClick={() => navigate('analyze-boq')} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
          <ArrowLeft size={14} /> Back to Analyze a BOQ
        </button>
      </div>
    )
  }

  const isBoq = job.kind === 'boq'
  const nComputed = isBoq ? result.n_lines_computed : result.n_line_items_computed
  const nTotal = isBoq ? result.n_lines_total : result.n_line_items_parsed
  const lineItems = result.line_items || []

  const topLines = [...lineItems]
    .filter((li) => li.gwp_kg_co2e != null)
    .sort((a, b) => b.gwp_kg_co2e - a.gwp_kg_co2e)
    .slice(0, 15)

  const topCategory = result.by_category && result.by_category.length > 0
    ? [...result.by_category].sort((a, b) => b.gwp_kg_co2e - a.gwp_kg_co2e)[0]
    : null
  const hotspotMatch = topCategory ? catalog.find((c) => c.base_category === topCategory.category) : null

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div
        className="glass-panel"
        style={{ padding: '22px 26px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', borderLeft: '4px solid var(--accent-mint)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(var(--c-blue),0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-lime)', flexShrink: 0 }}>
            {isBoq ? <FileSpreadsheet size={20} /> : <FileText size={20} />}
          </div>
          <div>
            <span className="badge badge-mint" style={{ fontSize: '0.65rem' }}>{isBoq ? 'Bill of Quantities' : 'Work Order'}</span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>{job.source_filename}</h2>
          </div>
        </div>
        <button onClick={() => navigate('analyze-boq')} className="btn-secondary" style={{ fontSize: '0.8125rem', flexShrink: 0 }}>
          <ArrowLeft size={14} /> Back to Analyze a BOQ
        </button>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <StatCard
          title="Total Carbon"
          value={result.total_gwp_tonnes_co2e?.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          unit="t CO2e"
          accent="mint"
        />
        <StatCard
          title="Carbon / m²"
          value={result.gwp_per_sqm != null ? result.gwp_per_sqm.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
          unit="kg CO2e/m²"
          accent="cyan"
        />
        <StatCard
          title="Carbon / sqft"
          value={result.gwp_per_sqft != null ? result.gwp_per_sqft.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
          unit="kg CO2e/sqft"
          accent="cyan"
        />
        <StatCard title="Lines Computed" value={`${nComputed ?? '—'}`} unit={nTotal != null ? `of ${nTotal}` : ''} accent="amber" />
      </div>

      {result.floor_area_sqm != null && (
        <div
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-tertiary)',
            padding: '10px 14px',
            background: 'rgba(var(--c-blue),0.06)',
            border: '1px solid rgba(var(--c-blue),0.15)',
            borderRadius: 'var(--radius-md)',
            lineHeight: 1.5,
          }}
        >
          Carbon-per-area figures above are divided by{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{result.floor_area_sqm.toLocaleString()} m²</strong>{' '}
          ({FLOOR_AREA_BASIS_LABELS[result.floor_area_basis] || result.floor_area_basis || 'basis not specified'})
          {result.floor_area_basis_note ? ` — ${result.floor_area_basis_note}` : ''}
        </div>
      )}

      {/* Coverage + material breakdown */}
      <div className="glass-panel" style={{ padding: 24, display: 'grid', gridTemplateColumns: 'minmax(200px, 300px) 1fr', gap: 28 }}>
        <div>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Coverage</h4>
          {result.coverage ? (
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              <RadialGauge percentage={result.coverage.coverage_pct} size={96} strokeWidth={8} label="Total Value" color="var(--accent-lime)" />
              <RadialGauge percentage={result.coverage.top5_coverage_pct} size={96} strokeWidth={8} label="Top 5 Materials" color="var(--accent-cyan)" />
            </div>
          ) : (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No coverage data for this result.</p>
          )}
        </div>
        <div>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Material-Wise Carbon Contribution</h4>
          <CategoryBarChart categories={result.by_category} />
        </div>
      </div>

      {/* Hotspot callout -- a real catalog match for the top-carbon
          category, or an honest "nothing in the catalog yet" note.
          Never shown at all when this upload's biggest category has
          no real catalog entry, rather than falling back to generic
          advice. */}
      {topCategory && (
        <div
          className="glass-panel"
          style={{ padding: 18, borderLeft: `4px solid ${hotspotMatch ? 'var(--accent-amber)' : 'var(--text-muted)'}` }}
        >
          {hotspotMatch ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Lightbulb size={16} color="var(--accent-amber-light)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Lower-Carbon Opportunity: {topCategory.category.replace(/_/g, ' ')}
                </span>
                <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>
                  {topCategory.pct_of_total.toFixed(1)}% of this upload's total carbon
                </span>
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 6 }}>
                <strong>{hotspotMatch.substitute_label}</strong> is a verified alternative for this category
                (up to {hotspotMatch.max_recommended_pct}% substitution recommended).
              </p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>{hotspotMatch.reasoning}</p>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Try it in the What-If Substitution Sandbox (on the Analyze a BOQ screen), or propose it directly from a project's Alternatives tab once this upload is recorded as a baseline.
              </p>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={15} color="var(--text-muted)" />
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{topCategory.category.replace(/_/g, ' ')}</strong> is this upload's
                biggest carbon contributor ({topCategory.pct_of_total.toFixed(1)}% of total) -- no verified lower-carbon
                alternative is in the catalog for this category yet.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Honesty audit -- what wasn't computed, and why */}
      {result.coverage?.excluded_by_reason?.length > 0 && (
        <div className="glass-panel" style={{ padding: 22 }}>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>What Wasn't Computed, and Why</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.coverage.excluded_by_reason.map((ex) => (
              <div
                key={ex.reason}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.78rem', padding: '8px 12px', background: 'rgba(var(--c-overlay),0.03)', borderRadius: 'var(--radius-sm)' }}
              >
                <span style={{ color: 'var(--text-tertiary)' }}>{REASON_LABELS[ex.reason] || ex.reason}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {ex.line_item_count} line{ex.line_item_count === 1 ? '' : 's'} · ₹{ex.value_excluded.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top contributing line items */}
      {topLines.length > 0 && (
        <div className="glass-panel" style={{ padding: 22 }}>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
            Top {topLines.length} Contributing Line Items
          </h4>
          <div style={{ overflowX: 'auto', border: '1px solid rgba(var(--c-overlay),0.06)', borderRadius: 'var(--radius-md)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(var(--c-overlay),0.08)' }}>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyleRight}>Quantity</th>
                  <th style={thStyleRight}>Carbon (t CO2e)</th>
                </tr>
              </thead>
              <tbody>
                {topLines.map((li, idx) => {
                  const description = li.enriched_description || li.description || li.code || `Row ${li.row ?? idx + 1}`
                  const category = li.category || li.material_category || '—'
                  const uom = li.uom || li.unit || ''
                  return (
                    <tr key={idx} style={{ borderBottom: idx === topLines.length - 1 ? 'none' : '1px solid rgba(var(--c-overlay),0.04)' }}>
                      <td style={tdStyle}>{description}</td>
                      <td style={{ ...tdStyle, textTransform: 'capitalize' }}>{category.replace(/_/g, ' ')}</td>
                      <td style={tdStyleRight}>{li.qty != null ? li.qty.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} {uom}</td>
                      <td style={tdStyleRight}>{(li.gwp_kg_co2e / 1000).toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
