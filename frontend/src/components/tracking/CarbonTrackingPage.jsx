import React, { useState, useEffect, useRef, useMemo } from 'react'
import { AlertTriangle, Activity, ShieldCheck, Lock } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import { originLabel } from '../../utils/projectOrigin'
import StatCard from '../common/StatCard'
import ProjectSwitcher from '../hub/ProjectSwitcher'
import MaterialBreakdownChart from '../common/charts/MaterialBreakdownChart'
import CarbonDataExplorer from '../charts/CarbonDataExplorer'
import { EstimatedMaterialBreakdownDonut, EstimateBadge } from '../project/ProjectDashboard'

/**
 * Carbon Tracking -- the nav item previously pointed straight at
 * ProjectDashboard (App.jsx's `tracking: ProjectDashboard`), making it
 * indistinguishable from the Projects menu's own dashboard. This page is
 * the carbon-only slice the user asked for: a project switcher, the
 * carbon summary stat strip, the cumulative-vs-baseline trajectory chart,
 * the material breakdown, and the same confirmed-substitution ledger
 * Reports & Audits already shows -- no Material Composition detail
 * table, no Bills management, no Alternatives workflow, no settings.
 *
 * Modeled on the mockup's CarbonTrackingPage.tsx chrome, but every number
 * here is read straight from the same real `/dashboard` + `/bills` (+
 * `/audit-log`) data ProjectDashboard.jsx and ReportsView.jsx already
 * fetch -- nothing new computed, nothing fabricated. Two things the
 * mockup has are deliberately omitted (per the approved plan):
 *  - The "Life-Cycle Stage" chart -- the mockup hardcodes 41/44/9/6%
 *    splits with no backing data source anywhere in this app.
 *  - The fixed "Carbon Copilot" chat bar -- the mockup's is a mocked,
 *    keyword-matched fake chat with no real backend to wire it to.
 */

function MilestoneLedger({ auditLog, boqOnlyRestriction, sourceType }) {
  if (boqOnlyRestriction) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '0.8125rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        <Lock size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          No milestone ledger is available for this project -- it requires a BOQ or Work Order baseline. This project's baseline was recorded from a{' '}
          {sourceType === 'phase1_estimate' ? 'Conceptual Estimate' : sourceType}.
        </span>
      </div>
    )
  }
  if (!auditLog || auditLog.length === 0) {
    return <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No confirmed modifications yet.</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(var(--c-blue), 0.15)', color: 'var(--accent-lime)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <th style={{ padding: '8px 12px' }}>Confirmed At</th>
            <th style={{ padding: '8px 12px' }}>Substitution</th>
            <th style={{ padding: '8px 12px' }}>Delta</th>
            <th style={{ padding: '8px 12px' }}>Before (tCO₂e)</th>
            <th style={{ padding: '8px 12px' }}>After (tCO₂e)</th>
          </tr>
        </thead>
        <tbody>
          {auditLog.map((log) => (
            <tr key={log.id} style={{ borderBottom: '1px solid rgba(var(--c-overlay), 0.04)', fontSize: '0.8125rem' }}>
              <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)' }}>{new Date(log.confirmed_at).toLocaleString()}</td>
              <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{log.label} ({log.user_pct}%)</td>
              <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--accent-lime)', fontWeight: 600 }}>-{log.delta_pct.toFixed(1)}%</td>
              <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{(log.total_gwp_kg_co2e_before / 1000).toFixed(1)}</td>
              <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{(log.total_gwp_kg_co2e_after / 1000).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CarbonTrackingPage() {
  const { activeCompanyId, activeProjectId, activeProject, navigate } = useProject()

  const [dashboard, setDashboard] = useState(null)
  const [bills, setBills] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [boqOnlyRestriction, setBoqOnlyRestriction] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const activeProjectIdRef = useRef(activeProjectId)
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  useEffect(() => {
    if (!activeProjectId) {
      setDashboard(null)
      setBills([])
      setAuditLog([])
      return
    }
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, activeCompanyId])

  const loadAll = async () => {
    const requestedProjectId = activeProjectId
    setIsLoading(true)
    try {
      const dash = await api.getDashboard(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setDashboard(dash)
      const bList = await api.getBills(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setBills(bList)

      const restricted = dash?.baseline?.source_type !== 'boq' && dash?.baseline?.source_type !== 'wo'
      setBoqOnlyRestriction(restricted)
      if (!restricted) {
        try {
          const audit = await api.getAuditLog(activeProjectId, activeCompanyId)
          if (activeProjectIdRef.current !== requestedProjectId) return
          setAuditLog(audit)
        } catch (err) {
          if (activeProjectIdRef.current !== requestedProjectId) return
          setAuditLog([])
        }
      } else {
        setAuditLog([])
      }
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      console.log('No dashboard yet for project:', err.message)
      setDashboard(null)
      setBills([])
      setAuditLog([])
    } finally {
      if (activeProjectIdRef.current === requestedProjectId) setIsLoading(false)
    }
  }

  const baselineTonnes = dashboard?.baseline ? dashboard.baseline.total_gwp_kg_co2e / 1000 : null
  const projectedTonnes = dashboard?.projected_total_gwp_kg_co2e ? dashboard.projected_total_gwp_kg_co2e / 1000 : null
  const isExceedingBaseline = dashboard?.projected_vs_baseline_pct != null && dashboard.projected_vs_baseline_pct > 0

  const dashboardPoints = dashboard?.points || []
  const cumulativePoints = dashboardPoints.filter((p) => p.quantity_basis !== 'present')
  const presentOnlyPoints = dashboardPoints.filter((p) => p.quantity_basis === 'present')

  // Same progressive baseline/projected formula ProjectDashboard.jsx
  // applies -- phase3.compute_dashboard()'s latest-only figure, extended
  // here to every cumulative point so the trajectory line isn't flat.
  const progressiveSeries = useMemo(() => {
    const baselineSeries = []
    const projectedSeries = []
    const baseline = dashboard?.baseline
    for (const p of cumulativePoints) {
      let percentComplete = p.stated_percent_complete
      if (percentComplete == null && baseline?.total_value) {
        percentComplete = Math.min((p.total_value_to_date / baseline.total_value) * 100, 999)
      }
      if (percentComplete != null && baseline?.total_gwp_kg_co2e) {
        baselineSeries.push({ period: p.period, value: (baseline.total_gwp_kg_co2e * (percentComplete / 100)) / 1000 })
      }
      if (percentComplete && percentComplete > 0) {
        projectedSeries.push({ period: p.period, value: (p.total_gwp_kg_co2e_to_date / (percentComplete / 100)) / 1000 })
      }
    }
    return { baselineSeries, projectedSeries }
  }, [cumulativePoints, dashboard])

  // Same synthetic "estimate bill" ProjectDashboard.jsx builds -- client
  // side only, never sent to the backend -- so a project tracked from a
  // Conceptual Estimate with no real bills yet still shows a material
  // breakdown here, clearly tagged as an estimate.
  const estimateBill = useMemo(() => {
    const baseline = dashboard?.baseline
    if (!baseline?.is_estimated || !baseline.material_breakdown || baseline.material_breakdown.length === 0) return null
    return {
      quantity_basis: 'cummulative',
      category_breakdown: baseline.material_breakdown,
      period: 'Conceptual Estimate',
      billed_date: baseline.recorded_at,
    }
  }, [dashboard])

  // Carbon intensity -- prefer the backend's own benchmark-comparison
  // figure (dashboard.projected_carbon_per_sqm) when available; otherwise
  // a direct baseline total / floor area fallback, never fabricated.
  const carbonIntensity = dashboard?.projected_carbon_per_sqm != null
    ? dashboard.projected_carbon_per_sqm
    : dashboard?.baseline?.floor_area_sqm
    ? dashboard.baseline.total_gwp_kg_co2e / dashboard.baseline.floor_area_sqm
    : null

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="glass-panel" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <ProjectSwitcher />
          <div>
            <span className="badge badge-lime">Carbon Tracking</span>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', maxWidth: 480, marginTop: 4 }}>
              The carbon-only view of this project's real tracking data -- trajectory, material breakdown, and the confirmed-modification ledger.
            </p>
          </div>
        </div>
      </div>

      {!activeProjectId ? (
        <div className="glass-panel" style={{ padding: 36, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={28} color="var(--accent-amber)" />
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>No project selected</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', maxWidth: 420 }}>
            Use the project switcher above to pick or search for a project by name.
          </p>
        </div>
      ) : isLoading && !dashboard ? (
        <div className="glass-panel" style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          Loading tracking data…
        </div>
      ) : !dashboard?.baseline ? (
        <div className="glass-panel" style={{ padding: 30, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <AlertTriangle size={32} color="var(--accent-amber)" />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>No Fixed Baseline Recorded Yet</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', maxWidth: 440 }}>
            This project has nothing to track yet -- record a baseline from the Project Dashboard or the Analyze a BOQ/Work Order page first.
          </p>
          <button onClick={() => navigate('project-dashboard')} className="btn-primary" style={{ marginTop: 6 }}>
            Go to Project Dashboard
          </button>
        </div>
      ) : (
        <>
          {/* Baseline status strip */}
          <div style={{ background: 'rgba(var(--c-surf-5), 0.75)', border: '1px solid rgba(var(--c-blue), 0.16)', borderRadius: 'var(--radius-md)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {originLabel(activeProject?.baseline_source_type) && (
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent-mint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {originLabel(activeProject?.baseline_source_type)}
                </span>
              )}
              <span className={`badge ${dashboard.baseline.is_estimated ? 'badge-amber' : 'badge-mint'}`}>
                {dashboard.baseline.is_estimated ? 'Estimated Baseline' : `Priced Baseline (${dashboard.baseline.source_type.toUpperCase()})`}
              </span>
              <span style={{ color: 'var(--text-tertiary)' }}>Recorded {new Date(dashboard.baseline.recorded_at).toLocaleDateString()} from {dashboard.baseline.source_file}</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)' }}>{bills.length} {bills.length === 1 ? 'Bill' : 'Bills'} Logged</span>
          </div>

          {/* Carbon summary stat strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <StatCard
              title="Baseline Target"
              value={baselineTonnes != null ? baselineTonnes.toFixed(1) : '-'}
              unit="tCO₂e"
              subtitle={dashboard.baseline.is_estimated ? 'Estimated, from Phase 1' : `Priced (${dashboard.baseline.source_type.toUpperCase()})`}
              accent="mint"
              badge={dashboard.baseline.is_estimated ? 'Estimated' : 'Priced'}
              badgeType={dashboard.baseline.is_estimated ? 'amber' : 'mint'}
            />
            <StatCard
              title="Cumulative Incurred"
              value={dashboard.billed_to_date_gwp_kg_co2e ? (dashboard.billed_to_date_gwp_kg_co2e / 1000).toFixed(1) : '0.0'}
              unit="tCO₂e"
              subtitle={`Latest period: ${dashboard.latest_period || 'None yet'}`}
              accent="amber"
              badge={!dashboard.latest_period ? 'Pending' : 'Cumulative'}
              badgeType="amber"
            />
            <StatCard
              title="Projected Final"
              value={projectedTonnes != null ? projectedTonnes.toFixed(1) : (baselineTonnes != null ? baselineTonnes.toFixed(1) : '-')}
              unit="tCO₂e"
              subtitle={
                dashboard.projected_vs_baseline_pct != null
                  ? `${dashboard.projected_vs_baseline_pct > 0 ? '+' : ''}${dashboard.projected_vs_baseline_pct.toFixed(1)}% vs Baseline`
                  : 'At baseline estimate'
              }
              accent={isExceedingBaseline ? 'amber' : 'lime'}
              badge={isExceedingBaseline ? 'Exceeding' : 'On Track'}
              badgeType={isExceedingBaseline ? 'amber' : 'lime'}
            />
            <StatCard
              title="Carbon Intensity"
              value={carbonIntensity != null ? carbonIntensity.toFixed(1) : '-'}
              unit="kgCO₂e/m²"
              subtitle={dashboard.benchmark_available ? `Typical is ${dashboard.typical_carbon_per_sqm?.toFixed(1)} kg/m² (${dashboard.benchmark_floor_band_used})` : 'No benchmark available for this project'}
              accent="violet"
              badge="Intensity"
              badgeType="violet"
            />
            <StatCard
              title="Physical Progress"
              value={dashboard.percent_complete ? `${dashboard.percent_complete.toFixed(1)}%` : '0%'}
              subtitle={dashboard.percent_complete_source?.replace(/_/g, ' ') || 'Awaiting bills'}
              accent="mint"
              badge="Progress"
              badgeType="mint"
            />
            <StatCard
              title="Benchmark Status"
              value={isExceedingBaseline ? 'Exceeding' : 'On Track'}
              subtitle={
                dashboard.benchmark_available
                  ? `${dashboard.projected_carbon_per_sqm?.toFixed(1) || '-'} kg/m² vs typical ${dashboard.typical_carbon_per_sqm?.toFixed(1) || '-'} kg/m²`
                  : 'No benchmark available for this project'
              }
              accent={isExceedingBaseline ? 'amber' : 'lime'}
              badge={isExceedingBaseline ? 'Over' : 'Within'}
              badgeType={isExceedingBaseline ? 'amber' : 'lime'}
              icon={Activity}
            />
          </div>

          {/* Trajectory chart */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Cumulative vs Baseline Trajectory</h3>
            {bills.length === 0 && dashboard.baseline?.is_estimated ? (
              <EstimateBadge text="From the locked Conceptual Estimate -- no bills logged yet, so there's no real trajectory to plot yet." />
            ) : (
              <CarbonDataExplorer
                cumulativePoints={cumulativePoints}
                presentOnlyPoints={presentOnlyPoints}
                baselineTonnes={baselineTonnes}
                projectedTonnes={projectedTonnes}
                baselineSeries={progressiveSeries.baselineSeries}
                projectedSeries={progressiveSeries.projectedSeries}
                isExceedingBaseline={isExceedingBaseline}
                height={380}
              />
            )}
          </div>

          {/* Material breakdown */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Material Breakdown</h3>
            {bills.length > 0 ? (
              <MaterialBreakdownChart bills={bills} />
            ) : estimateBill ? (
              <>
                <EstimateBadge />
                <EstimatedMaterialBreakdownDonut
                  materialBreakdown={estimateBill.category_breakdown}
                  totalCarbonKg={dashboard.baseline?.total_gwp_kg_co2e}
                />
              </>
            ) : (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Add a bill to see its material breakdown here.</p>
            )}
          </div>

          {/* Milestone ledger -- the same confirmed-substitution audit
              trail Reports & Audits shows, styled as a chronological
              ledger rather than a report table. */}
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Milestone Ledger</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Append-only record of confirmed engineering modifications</span>
              </div>
              <span className="badge badge-mint"><ShieldCheck size={12} /> Tamper Proof</span>
            </div>
            <MilestoneLedger auditLog={auditLog} boqOnlyRestriction={boqOnlyRestriction} sourceType={dashboard.baseline.source_type} />
          </div>
        </>
      )}
    </div>
  )
}
