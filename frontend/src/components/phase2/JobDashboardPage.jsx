import React, { useState, useEffect } from 'react'
import { ArrowLeft, FileSpreadsheet, FileText, Lightbulb, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import RadialGauge from '../common/RadialGauge'
import CategoryBarChart from '../common/charts/CategoryBarChart'
import MaterialSearchPanel from '../common/MaterialSearchPanel'

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
 * dashboard, not opening a small pop up". This is that full-screen page,
 * routed at /uploads/:jobId (see App.jsx's path map), reached via
 * JobResultsCompare.jsx's "View Dashboard" button calling
 * navigate(`/uploads/${job.job_id}`) after handing the job+result to
 * ProjectContext as a same-tab fast path. "Back to Analyze a BOQ"
 * navigates to /analyze-boq, same as every other screen.
 *
 * Real app routing (Phase C, Part C): unlike before, this page is NOT
 * solely reliant on that ProjectContext fast path -- a direct link (e.g.
 * the Project Dashboard's "View Upload Results" button), a refresh, or
 * Back/Forward land here with only the URL's :jobId to go on, so this
 * component fetches the job+result itself when the context doesn't
 * already have a matching one (see the routeJobId effect below).
 *
 * The content itself (KPI row, coverage gauges, material-wise carbon
 * contribution chart, hotspot callout, honesty audit, top line items
 * table) is unchanged from the previous modal -- only the chrome around
 * it changed from a fixed-position overlay to a normal full-width page,
 * matching every other screen's layout (glass-panel header + sections).
 */
export default function JobDashboardPage() {
  const { dashboardJob, dashboardResult, activeCompanyId } = useProject()
  const navigate = useNavigate()
  const { jobId: routeJobId } = useParams()

  // Real app routing (Phase C, Part C): this page used to rely entirely
  // on ProjectContext's dashboardJob/dashboardResult (set by whichever
  // "View Dashboard" click got here). That's kept as a same-tab fast
  // path -- no extra fetch when a caller already has the data in hand --
  // but a direct link (Part B's new "View Upload Results" button), a
  // browser refresh, or the Back/Forward buttons land here with context
  // empty (or stale, from a PREVIOUS job) and only the URL's :jobId to
  // go on. When the context's job doesn't match the route param, fetch
  // it directly -- the same two calls JobResultsCompare.jsx's own
  // openDashboard already makes.
  const [fetchedJob, setFetchedJob] = useState(null)
  const [fetchedResult, setFetchedResult] = useState(null)
  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const job = dashboardJob && dashboardJob.job_id === routeJobId ? dashboardJob : fetchedJob
  const result = job === dashboardJob ? dashboardResult : fetchedResult

  useEffect(() => {
    if (!routeJobId) return
    if (dashboardJob && dashboardJob.job_id === routeJobId) return // fast path already has it
    let cancelled = false
    setIsFetching(true)
    setFetchError(null)
    Promise.all([
      api.getJob(routeJobId, activeCompanyId),
      api.getJobResult(routeJobId, activeCompanyId),
    ]).then(([j, r]) => {
      if (cancelled) return
      setFetchedJob(j)
      setFetchedResult(r)
    }).catch((err) => {
      if (cancelled) return
      setFetchError(err.message || 'Could not load this upload.')
    }).finally(() => {
      if (!cancelled) setIsFetching(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeJobId, activeCompanyId, dashboardJob?.job_id])

  // UX refinement (Phase C, Part A): "i cant see which are those lines" --
  // which reason bucket's row (if any) is expanded to show its matching
  // line_items underneath. Null = all collapsed.
  const [expandedReason, setExpandedReason] = useState(null)

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

  if (isFetching) {
    return (
      <div className="glass-panel" style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Loading upload result…
      </div>
    )
  }

  if (!job || !result) {
    // Reached directly with nothing to show (no route param, a job that
    // no longer exists, or the fetch above failed) -- send the user back
    // to where this data would have come from rather than rendering a
    // blank page.
    return (
      <div className="glass-panel" style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <span>{fetchError || 'No upload result is currently open.'}</span>
        <button onClick={() => navigate('/analyze-boq')} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
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
        <button onClick={() => navigate('/analyze-boq')} className="btn-secondary" style={{ fontSize: '0.8125rem', flexShrink: 0 }}>
          <ArrowLeft size={14} /> Back to Analyze a BOQ
        </button>
      </div>

      {/* Which sheets / files fed this result (BOQ only) + overlap cautions */}
      {isBoq && (result.warnings?.length > 0 || result.sources?.length > 1) && (
        <div className="glass-panel" style={{ padding: 20 }}>
          {result.warnings?.length > 0 && (
            <div style={{ border: '1px solid rgba(var(--c-amber), 0.45)', background: 'rgba(var(--c-amber), 0.08)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: result.sources?.length > 1 ? 14 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                <AlertTriangle size={14} style={{ color: 'var(--accent-amber)' }} /> Possible double counting
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {result.sources?.length > 1 && (
            <>
              <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Sheets Included in This Result</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(var(--c-overlay),0.08)' }}>
                      <th style={thStyle}>File</th>
                      <th style={thStyle}>Sheet</th>
                      <th style={thStyleRight}>Lines</th>
                      <th style={thStyleRight}>Computed</th>
                      <th style={thStyleRight}>Carbon (tCO₂e)</th>
                      <th style={thStyleRight}>Value (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sources.map((src, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(var(--c-overlay),0.04)' }}>
                        <td style={tdStyle}>{src.source_file}</td>
                        <td style={tdStyle}>{src.sheet_name}</td>
                        <td style={tdStyleRight}>{src.n_lines_total}</td>
                        <td style={tdStyleRight}>{src.n_lines_computed}</td>
                        <td style={tdStyleRight}>{(src.total_gwp_kg_co2e / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td style={tdStyleRight}>{src.total_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

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

      {/* Coverage + material breakdown.
          Three distinct things live here, named precisely so they are
          never mistaken for each other:
          - "Coverage" gauges: % of this upload's priced VALUE that got
            classified+computed at all (left gauge), and, separately, how
            much of that value sits in the fixed, generic five-category
            set this app always tracks (right gauge -- see coverage.py's
            TOP5_MATERIAL_CATEGORIES comment: concrete, reinforcement
            steel, structural steel, aluminium, glass, same set on every
            project, regardless of what actually dominates THIS BOQ).
            Relabeled "Construction Top Materials" (the user's own term)
            instead of the old, misleading "Top 5 Materials" -- that name
            made it sound like a ranking of this BOQ's own top
            contributors, which is a different, newly-added thing (next
            column).
          - "Top Materials -- This BOQ": genuinely data-driven, per-upload
            -- whichever categories actually carry the most carbon in
            THIS specific result, straight from result.by_category
            (already computed server-side, no new backend logic needed).
            A BOQ dominated by e.g. masonry would show masonry at #1 here
            even though it's nowhere in the fixed set above.
          - The full "Material-Wise Carbon Contribution" chart: every
            category, not just the top few -- unchanged from before. */}
      <div className="glass-panel" style={{ padding: 24, display: 'grid', gridTemplateColumns: 'minmax(190px, 260px) minmax(220px, 320px) 1fr', gap: 28 }}>
        <div>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Coverage</h4>
          {result.coverage ? (
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              <RadialGauge percentage={result.coverage.coverage_pct} size={96} strokeWidth={8} label="Total Value" color="var(--accent-lime)" />
              <RadialGauge percentage={result.coverage.top5_coverage_pct} size={96} strokeWidth={8} label="Construction Top Materials" color="var(--accent-cyan)" />
            </div>
          ) : (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No coverage data for this result.</p>
          )}
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.45 }}>
            "Construction Top Materials" is a fixed industry-standard set (concrete, reinforcement steel,
            structural steel, aluminium, glass) tracked the same way on every project -- not specific to this BOQ.
          </p>
        </div>
        <div>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Top Materials -- This BOQ</h4>
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.45 }}>
            Ranked by actual carbon contribution in this specific upload -- not the fixed set at left.
          </p>
          <CategoryBarChart categories={result.by_category} limit={5} />
        </div>
        <div>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Material-Wise Carbon Contribution</h4>
          <CategoryBarChart categories={result.by_category} />
        </div>
      </div>

      {/* Search every material with a stored emission factor -- not just
          this BOQ's top 5 or the categories that happened to appear.
          result.all_materials (engine.py's ALL_MATERIAL_CATEGORIES,
          cross-joined with this upload's own by_category totals) covers
          every category the backend can compute, including a real,
          honest zero for one that simply isn't in this BOQ at all. */}
      {result.all_materials && result.all_materials.length > 0 && (
        <div className="glass-panel" style={{ padding: 24 }}>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Search All Materials</h4>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 14 }}>
            Every material category with a stored emission factor in the backend, and how much it contributes in this BOQ specifically.
          </p>
          <MaterialSearchPanel materials={result.all_materials} lineItems={lineItems} />
        </div>
      )}

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
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>What Wasn't Computed, and Why</h4>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 10 }}>Click a reason to see the actual lines behind it.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.coverage.excluded_by_reason.map((ex) => {
              const isOpen = expandedReason === ex.reason
              // Same cross-engine field-accessor pattern the Top
              // Contributing Line Items table below already uses --
              // reused, not reinvented. li.exclusion_reason is the one
              // new per-line field this drill-down depends on (see
              // engine.py/wo_carbon_engine.py).
              const matchingLines = isOpen ? lineItems.filter((li) => li.exclusion_reason === ex.reason) : []
              return (
                <div key={ex.reason} style={{ background: 'rgba(var(--c-overlay),0.03)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  <button
                    onClick={() => setExpandedReason(isOpen ? null : ex.reason)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                      fontSize: '0.78rem', padding: '8px 12px', width: '100%', background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {REASON_LABELS[ex.reason] || ex.reason}
                    </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {ex.line_item_count} line{ex.line_item_count === 1 ? '' : 's'} · ₹{ex.value_excluded.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ maxHeight: 280, overflowY: 'auto', borderTop: '1px solid rgba(var(--c-overlay),0.06)' }}>
                      {matchingLines.length === 0 ? (
                        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', padding: '10px 14px' }}>
                          No matching lines found on this result (the summary count above may be stale -- try re-running this upload).
                        </p>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(var(--c-overlay),0.06)' }}>
                              <th style={{ ...thStyle, fontSize: '0.62rem' }}>Description</th>
                              <th style={{ ...thStyle, fontSize: '0.62rem' }}>Category</th>
                              <th style={{ ...thStyleRight, fontSize: '0.62rem' }}>Qty</th>
                              <th style={{ ...thStyle, fontSize: '0.62rem' }}>Why</th>
                            </tr>
                          </thead>
                          <tbody>
                            {matchingLines.map((li, idx) => {
                              const description = (li.source_sheet && result.sources?.length > 1 ? `[${li.source_sheet}] ` : '') + (li.enriched_description || li.description || li.code || `Row ${li.row ?? idx + 1}`)
                              const category = li.category || li.material_category || '—'
                              const uom = li.uom || li.unit || ''
                              return (
                                <tr key={idx} style={{ borderBottom: idx === matchingLines.length - 1 ? 'none' : '1px solid rgba(var(--c-overlay),0.04)' }}>
                                  <td style={{ ...tdStyle, fontSize: '0.72rem' }}>{description}</td>
                                  <td style={{ ...tdStyle, fontSize: '0.72rem', textTransform: 'capitalize' }}>{category.replace(/_/g, ' ')}</td>
                                  <td style={{ ...tdStyleRight, fontSize: '0.72rem' }}>{li.qty != null ? li.qty.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} {uom}</td>
                                  <td style={{ ...tdStyle, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{li.basis_note}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
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
                  const description = (li.source_sheet && result.sources?.length > 1 ? `[${li.source_sheet}] ` : '') + (li.enriched_description || li.description || li.code || `Row ${li.row ?? idx + 1}`)
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
