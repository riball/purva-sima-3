import React, { useState, useEffect, useRef } from 'react'
import { AlertTriangle, Download, Printer, ShieldCheck, FileText, Lock } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import ProjectSwitcher from '../hub/ProjectSwitcher'
import { downloadCsv } from '../../utils/csvExport'

/**
 * Phase 7 -- Reports & Audits.
 *
 * A new page the source design never had an equivalent for -- the plan's
 * own description is "CSV export + printable summary (pure frontend)
 * built from already-fetched dashboard/bills/audit-log data." Nothing
 * here computes anything new: every figure is read straight from the
 * same real Phase 3 (/dashboard, /bills) and Phase 4 (/current-state,
 * /audit-log) endpoints ProjectDashboard.jsx already uses, for the
 * currently selected project. Two real, working capabilities, both
 * entirely client-side:
 *   1. CSV export of the bills table and the confirmed-substitution
 *      audit trail -- built from the arrays already in state, no new
 *      backend endpoint.
 *   2. A "Print / Save as PDF" button (window.print()) against a
 *      dedicated print stylesheet (see index.css's @media print block)
 *      that hides the app chrome and forces light, high-contrast colors
 *      regardless of the active theme.
 *
 * Audit content is confirmed-substitution events only, same restriction
 * ProjectDashboard.jsx's own Audit section already documents (only a
 * BOQ-sourced baseline's propose/confirm/reject/audit-log flow is
 * supported in this pass) -- this page shows the identical boqOnlyRestriction
 * banner rather than silently exporting an empty or misleading CSV.
 */

export default function ReportsView() {
  const { activeCompanyId, activeProjectId, activeProject, addToast } = useProject()

  const [dashboard, setDashboard] = useState(null)
  const [bills, setBills] = useState([])
  const [currentState, setCurrentState] = useState(null)
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
      setCurrentState(null)
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

      // Same reliable signal ProjectDashboard.jsx's Alternatives/Audit
      // sections use -- GET .../current-state has no BOQ-only restriction
      // of its own (only propose/confirm/reject do), so checking
      // dashboard.baseline.source_type is the one field that's always
      // there and always accurate.
      const restricted = dash?.baseline?.source_type !== 'boq'
      setBoqOnlyRestriction(restricted)

      if (!restricted) {
        try {
          const state = await api.getCurrentState(activeProjectId, activeCompanyId)
          if (activeProjectIdRef.current !== requestedProjectId) return
          setCurrentState(state)
          const audit = await api.getAuditLog(activeProjectId, activeCompanyId)
          if (activeProjectIdRef.current !== requestedProjectId) return
          setAuditLog(audit)
        } catch (err) {
          if (activeProjectIdRef.current !== requestedProjectId) return
          setCurrentState(null)
          setAuditLog([])
        }
      } else {
        setCurrentState(null)
        setAuditLog([])
      }
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      setDashboard(null)
      setBills([])
      setCurrentState(null)
      setAuditLog([])
    } finally {
      if (activeProjectIdRef.current === requestedProjectId) setIsLoading(false)
    }
  }

  const projectName = activeProject?.project_name || activeProjectId || 'project'
  const safeFileStem = String(projectName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project'

  const handleExportBillsCsv = () => {
    if (bills.length === 0) {
      addToast('No bills logged yet for this project -- nothing to export.', 'info')
      return
    }
    downloadCsv(
      `${safeFileStem}-bills-${new Date().toISOString().split('T')[0]}.csv`,
      ['Period', 'Billed Date', 'Source', 'Quantity Basis', 'GWP to Date (tCO2e)', 'Billed Value (INR)', 'Stated % Complete', 'Lines Computed', 'Lines Total'],
      bills.map((b) => [
        b.period,
        b.billed_date,
        b.bill_source === 'pdf_cop' ? 'Certificate of Payment (PDF)' : 'Excel BOQ',
        b.quantity_basis === 'present' ? 'This period only' : 'Cumulative to date',
        (b.total_gwp_kg_co2e_to_date / 1000).toFixed(2),
        b.total_value_to_date,
        b.stated_percent_complete ?? '',
        b.n_lines_computed,
        b.n_lines_total,
      ])
    )
  }

  const handleExportAuditCsv = () => {
    if (auditLog.length === 0) {
      addToast('No confirmed modifications in the audit trail yet -- nothing to export.', 'info')
      return
    }
    downloadCsv(
      `${safeFileStem}-audit-log-${new Date().toISOString().split('T')[0]}.csv`,
      ['Confirmed At', 'Substitution', 'User %', 'Delta %', 'GWP Before (tCO2e)', 'GWP After (tCO2e)'],
      auditLog.map((log) => [
        new Date(log.confirmed_at).toISOString(),
        log.label,
        log.user_pct,
        // delta_pct comes back as a positive reduction magnitude (the
        // audit table on screen prefixes it with "-" for the same reason)
        // -- negate it here too so the CSV isn't the one place this
        // report shows an emissions cut as a bare positive number.
        `-${log.delta_pct.toFixed(2)}`,
        (log.total_gwp_kg_co2e_before / 1000).toFixed(2),
        (log.total_gwp_kg_co2e_after / 1000).toFixed(2),
      ])
    )
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header -- project switcher + export/print actions. Hidden entirely
          when printing (.no-print), since none of these controls belong
          on the printed page itself. */}
      <div className="glass-panel no-print" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <ProjectSwitcher />
          <div>
            <span className="badge badge-lime">Reports & Audits</span>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', maxWidth: 480, marginTop: 4 }}>
              A CSV export and a printable summary for this project, built from its real dashboard, bills, and audit-trail data.
            </p>
          </div>
        </div>

        {activeProjectId && dashboard?.baseline && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={handleExportBillsCsv} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
              <Download size={15} />
              <span>Export Bills CSV</span>
            </button>
            {!boqOnlyRestriction && (
              <button onClick={handleExportAuditCsv} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
                <Download size={15} />
                <span>Export Audit CSV</span>
              </button>
            )}
            <button onClick={handlePrint} className="btn-primary" style={{ fontSize: '0.8125rem' }}>
              <Printer size={15} />
              <span>Print / Save as PDF</span>
            </button>
          </div>
        )}
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
          Loading report data…
        </div>
      ) : !dashboard?.baseline ? (
        <div className="glass-panel" style={{ padding: 30, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <AlertTriangle size={32} color="var(--accent-amber)" />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>No Fixed Baseline Recorded Yet</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', maxWidth: 440 }}>
            This project has no reportable data yet -- record a baseline from the Projects & Detail or Carbon Tracking screen first.
          </p>
        </div>
      ) : (
        /* Printable report body. Everything below is what actually ends
           up on the printed page -- see index.css's @media print block
           for the chrome-hiding/color-forcing rules that apply here. */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="glass-panel" style={{ padding: '24px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
              <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: 'var(--text-primary)' }}>{projectName}</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Report generated {new Date().toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: '0.8125rem' }}>
              <span className={`badge ${dashboard.baseline.is_estimated ? 'badge-amber' : 'badge-mint'}`}>
                {dashboard.baseline.is_estimated ? 'Estimated Baseline' : `Priced Baseline (${dashboard.baseline.source_type.toUpperCase()})`}
              </span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                Recorded {new Date(dashboard.baseline.recorded_at).toLocaleDateString()} from {dashboard.baseline.source_file}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <StatCard
              title="Baseline"
              value={(dashboard.baseline.total_gwp_kg_co2e / 1000).toFixed(1)}
              unit="tCO₂e"
              subtitle="Fixed benchmark every bill is measured against"
              accent="lime"
            />
            <StatCard
              title="Billed to Date"
              value={
                dashboard.latest_bill_quantity_basis === 'present'
                  ? (dashboard.latest_bill_gwp_kg_co2e ? (dashboard.latest_bill_gwp_kg_co2e / 1000).toFixed(1) : '0.0')
                  : (dashboard.billed_to_date_gwp_kg_co2e ? (dashboard.billed_to_date_gwp_kg_co2e / 1000).toFixed(1) : '0.0')
              }
              unit="tCO₂e"
              subtitle={`Latest period: ${dashboard.latest_period || 'None yet'}`}
              accent="amber"
            />
            <StatCard
              title="Project Completion"
              value={dashboard.percent_complete ? `${dashboard.percent_complete.toFixed(1)}%` : '0%'}
              subtitle={dashboard.percent_complete_source?.replace(/_/g, ' ') || 'Awaiting bills'}
              accent="mint"
            />
            <StatCard
              title="Projected at Completion"
              value={dashboard.projected_total_gwp_kg_co2e ? (dashboard.projected_total_gwp_kg_co2e / 1000).toFixed(1) : (dashboard.baseline.total_gwp_kg_co2e / 1000).toFixed(1)}
              unit="tCO₂e"
              subtitle={
                dashboard.projected_vs_baseline_pct !== null && dashboard.projected_vs_baseline_pct !== undefined
                  ? `${dashboard.projected_vs_baseline_pct > 0 ? '+' : ''}${dashboard.projected_vs_baseline_pct.toFixed(1)}% vs Baseline`
                  : 'At baseline estimate'
              }
              accent={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'amber' : 'lime'}
            />
          </div>

          {currentState && !boqOnlyRestriction && (
            <div className="glass-panel" style={{ padding: 20 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
                Baseline vs Current Carbon (after confirmed substitutions)
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Baseline: <strong className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{(currentState.baseline_total_gwp_kg_co2e / 1000).toFixed(1)} tCO₂e</strong>
                </span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Current: <strong className="tabular-nums" style={{ color: currentState.total_delta_pct <= 0 ? 'var(--accent-lime)' : 'var(--accent-rose)' }}>{(currentState.current_total_gwp_kg_co2e / 1000).toFixed(1)} tCO₂e</strong>
                </span>
                <span className="tabular-nums badge badge-mint" style={{ fontSize: '0.78rem' }}>
                  {currentState.total_delta_pct > 0 ? '+' : ''}{currentState.total_delta_pct.toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          {/* Bills table */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <FileText size={16} color="var(--accent-lime)" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Logged Bills ({bills.length})</h3>
            </div>
            {bills.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(var(--c-blue), 0.15)', color: 'var(--accent-lime)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '8px 12px' }}>Period</th>
                      <th style={{ padding: '8px 12px' }}>Billed Date</th>
                      <th style={{ padding: '8px 12px' }}>Source</th>
                      <th style={{ padding: '8px 12px' }}>GWP to Date (tCO₂e)</th>
                      <th style={{ padding: '8px 12px' }}>Billed Value</th>
                      <th style={{ padding: '8px 12px' }}>% Complete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(var(--c-overlay), 0.04)', fontSize: '0.8125rem' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{b.period}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)' }}>{b.billed_date}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)' }}>
                          {b.bill_source === 'pdf_cop' ? 'COP PDF' : 'Excel BOQ'}{b.quantity_basis === 'present' ? ' (present period only)' : ''}
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--accent-lime)', fontWeight: 600 }}>
                          {(b.total_gwp_kg_co2e_to_date / 1000).toFixed(1)}
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>₹{(b.total_value_to_date / 100000).toFixed(1)}L</td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--accent-lime)' }}>
                          {b.stated_percent_complete ? `${b.stated_percent_complete.toFixed(1)}%` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No bills logged yet.</p>
            )}
          </div>

          {/* Audit trail */}
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Permanent Audit Trail</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Append-only record of confirmed engineering modifications</span>
              </div>
              <span className="badge badge-mint"><ShieldCheck size={12} /> Tamper Proof</span>
            </div>

            {boqOnlyRestriction ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '0.8125rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                <Lock size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  No audit trail is available for this project -- it requires a BOQ-sourced baseline. This project's baseline was recorded from a{' '}
                  {dashboard.baseline.source_type === 'wo' ? 'Work Order' : dashboard.baseline.source_type === 'phase1_estimate' ? 'Conceptual Estimate' : dashboard.baseline.source_type}.
                </span>
              </div>
            ) : auditLog.length === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No confirmed modifications yet.</p>
            ) : (
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}
