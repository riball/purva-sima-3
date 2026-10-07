import React, { useState, useEffect } from 'react'
import { FileText, Plus, Upload, AlertTriangle, BarChart3, TrendingUp } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import LineChartCarbon from '../common/charts/LineChartCarbon'
import CategoryBarChart from '../common/charts/CategoryBarChart'

/**
 * "Phase 5" -- Certificate of Payment (quarterly bill) PDFs, compared
 * against the same Phase 3 baseline every other bill is compared
 * against. Deliberately NOT its own state or its own backend namespace:
 * every call here hits the exact same /phase3/projects/{id}/bills and
 * /phase3/projects/{id}/dashboard endpoints Phase 3 already uses (see
 * app/api/phase3.py's upload_bill -- a .pdf upload there is parsed by
 * app/services/phase3_cop_engine.py, everything else about it is
 * identical to an .xlsx bill). This screen is a dedicated, PDF-focused
 * lens on that same data: quarterly Certificate of Payment ingestion,
 * plus the graphs Phase 3's own table view doesn't render.
 */
export default function Phase5View() {
  const { activeCompanyId, activeProjectId, addToast } = useProject()

  const [dashboard, setDashboard] = useState(null)
  const [bills, setBills] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const [showBillModal, setShowBillModal] = useState(false)
  const [billPeriod, setBillPeriod] = useState('')
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [billStatedPct, setBillStatedPct] = useState('')
  const [billFile, setBillFile] = useState(null)
  const [isLoggingBill, setIsLoggingBill] = useState(false)

  useEffect(() => {
    if (!activeProjectId) return
    loadData()
  }, [activeProjectId, activeCompanyId])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const dash = await api.getDashboard(activeProjectId, activeCompanyId)
      setDashboard(dash)
      const bList = await api.getBills(activeProjectId, activeCompanyId)
      setBills(bList)
    } catch (err) {
      console.log('No dashboard yet for project:', err.message)
      setDashboard(null)
      setBills([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogBillSubmit = async (e) => {
    e.preventDefault()
    if (!billFile) {
      addToast('Please select a Certificate of Payment PDF', 'error')
      return
    }
    if (!billFile.name.toLowerCase().endsWith('.pdf')) {
      addToast('Phase 5 expects a .pdf Certificate of Payment (for an Excel BOQ-shaped bill, use Phase 3 instead)', 'error')
      return
    }

    setIsLoggingBill(true)
    try {
      await api.logBill(activeProjectId, {
        companyId: activeCompanyId,
        period: billPeriod.trim() || billDate,
        billedDate: billDate,
        file: billFile,
        statedPercentComplete: billStatedPct ? Number(billStatedPct) : undefined,
      })
      addToast(`Logged Certificate of Payment for ${billPeriod || billDate}`, 'success')
      setShowBillModal(false)
      setBillFile(null)
      setBillPeriod('')
      loadData()
    } catch (err) {
      addToast(`Failed to log bill: ${err.message}`, 'error')
    } finally {
      setIsLoggingBill(false)
    }
  }

  const copBills = bills.filter((b) => b.bill_source === 'pdf_cop')
  const latestCopBill = copBills.length > 0 ? copBills[copBills.length - 1] : null
  const baselineTonnes = dashboard?.baseline ? dashboard.baseline.total_gwp_kg_co2e / 1000 : null

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Header Banner */}
      <div
        className="glass-panel"
        style={{
          padding: '24px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderLeft: '4px solid #38bdf8',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="badge badge-cyan">Phase 5</span>
            <span style={{ fontSize: '0.8125rem', color: '#38bdf8', fontWeight: 600 }}>
              Quarterly Bill Reconciliation
            </span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc' }}>
            Certificate of Payment vs Baseline
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', maxWidth: 640 }}>
            Upload each quarter's Certificate of Payment (the "Cummulative Quanity Summary" PDF) — every Item Code is matched
            against the same emission-factor dataset a Work Order upload uses, and compared against this project's Phase 3 baseline.
          </p>
        </div>

        {dashboard?.baseline && (
          <button onClick={() => setShowBillModal(true)} className="btn-primary" style={{ fontSize: '0.8125rem' }}>
            <Plus size={15} />
            <span>Log Certificate of Payment</span>
          </button>
        )}
      </div>

      {!dashboard?.baseline ? (
        <div
          className="glass-panel"
          style={{ padding: 30, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
        >
          <AlertTriangle size={32} color="#f59e0b" />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc' }}>
            No Baseline Recorded For This Project Yet
          </h3>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', maxWidth: 440 }}>
            Phase 5 compares every Certificate of Payment against the same baseline Phase 3 uses. Set the project baseline
            from the Phase 3 tab first, then come back here to log quarterly bills.
          </p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <StatCard
              title="Billed to Date"
              value={dashboard.billed_to_date_gwp_kg_co2e ? (dashboard.billed_to_date_gwp_kg_co2e / 1000).toFixed(1) : '0.0'}
              unit="tCO₂e"
              subtitle={`Latest period: ${dashboard.latest_period || 'None yet'}`}
              accent="cyan"
              badge={copBills.length > 0 ? `${copBills.length} COP bill${copBills.length === 1 ? '' : 's'}` : 'Pending'}
              badgeType="cyan"
            />
            <StatCard
              title="Project Completion"
              value={dashboard.percent_complete ? `${dashboard.percent_complete.toFixed(1)}%` : '0%'}
              subtitle={dashboard.percent_complete_source?.replace(/_/g, ' ') || 'Awaiting bills'}
              accent="mint"
              badge="Progress"
              badgeType="mint"
            />
            <StatCard
              title="Projected at Completion"
              value={
                dashboard.projected_total_gwp_kg_co2e
                  ? (dashboard.projected_total_gwp_kg_co2e / 1000).toFixed(1)
                  : (dashboard.baseline.total_gwp_kg_co2e / 1000).toFixed(1)
              }
              unit="tCO₂e"
              subtitle={
                dashboard.projected_vs_baseline_pct !== null && dashboard.projected_vs_baseline_pct !== undefined
                  ? `${dashboard.projected_vs_baseline_pct > 0 ? '+' : ''}${dashboard.projected_vs_baseline_pct.toFixed(1)}% vs Baseline`
                  : 'At baseline estimate'
              }
              accent={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'amber' : 'lime'}
              badge={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'Exceeding' : 'On Track'}
              badgeType={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'amber' : 'lime'}
            />
            {latestCopBill?.cost_per_kg_co2e_to_date && (
              <StatCard
                title="Cost per kg CO₂e"
                value={`₹${latestCopBill.cost_per_kg_co2e_to_date.toFixed(1)}`}
                subtitle="Latest COP bill value / gwp"
                accent="cyan"
                badge="Efficiency"
                badgeType="cyan"
              />
            )}
          </div>

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1.3fr) minmax(320px, 1fr)', gap: 24, alignItems: 'start' }}>
            <div className="glass-panel" style={{ padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <TrendingUp size={16} color="#3182CE" />
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>
                  Cumulative Carbon vs Baseline
                </h3>
              </div>
              <LineChartCarbon points={dashboard.points} baselineTonnes={baselineTonnes} />
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: '0.72rem', color: '#94a3b8' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 14, height: 2, background: '#3182CE', display: 'inline-block', borderRadius: 2 }} />
                  Billed cumulative
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 14, height: 0, borderTop: '2px dashed #f59e0b', display: 'inline-block' }} />
                  Baseline
                </span>
              </div>
            </div>

            <div className="glass-panel" style={{ padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <BarChart3 size={16} color="#38bdf8" />
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>
                  Latest COP · Carbon by Material
                </h3>
              </div>
              {latestCopBill ? (
                <CategoryBarChart categories={latestCopBill.category_breakdown || []} />
              ) : (
                <div style={{ padding: '20px 0', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>
                  Log a Certificate of Payment to see its material breakdown here.
                </div>
              )}
            </div>
          </div>

          {/* Bills table */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc', marginBottom: 14 }}>
              All Logged Bills (Phase 3 + Phase 5)
            </h3>
            {bills.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '8px 12px' }}>Period</th>
                      <th style={{ padding: '8px 12px' }}>Billed Date</th>
                      <th style={{ padding: '8px 12px' }}>Source</th>
                      <th style={{ padding: '8px 12px' }}>GWP to Date (tCO₂e)</th>
                      <th style={{ padding: '8px 12px' }}>Billed Value</th>
                      <th style={{ padding: '8px 12px' }}>Lines Computed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '0.8125rem' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: '#f8fafc' }}>{b.period}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{b.billed_date}</td>
                        <td style={{ padding: '8px 12px' }}>
                          {b.bill_source === 'pdf_cop' ? (
                            <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                              <FileText size={11} /> COP PDF
                            </span>
                          ) : (
                            <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>Excel BOQ</span>
                          )}
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: '#3182CE', fontWeight: 600 }}>
                          {(b.total_gwp_kg_co2e_to_date / 1000).toFixed(1)}
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                          ₹{(b.total_value_to_date / 100000).toFixed(1)}L
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: '#94a3b8' }}>
                          {b.n_lines_computed}/{b.n_lines_total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                No bills logged yet. Click "Log Certificate of Payment" above to record the first quarter.
              </p>
            )}
          </div>
        </>
      )}

      {/* Log COP Bill Modal */}
      {showBillModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>
              Log Certificate of Payment
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginBottom: 18 }}>
              Upload the quarter's Certificate of Payment PDF. Item Codes in its "Cummulative Quanity Summary" table are matched
              against this company's emission-factor dataset automatically.
            </p>

            <form onSubmit={handleLogBillSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Period Label</label>
                  <input
                    type="text"
                    placeholder="e.g. 2025-Q3, Oct-2025"
                    value={billPeriod}
                    onChange={(e) => setBillPeriod(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Billed Date</label>
                  <input
                    type="date"
                    required
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Stated % Complete <span className="form-label-optional">(Optional)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  placeholder="e.g. 35.0 (derived from value if omitted)"
                  value={billStatedPct}
                  onChange={(e) => setBillStatedPct(e.target.value)}
                  className="form-input"
                />
              </div>

              <div
                style={{
                  border: '2px dashed rgba(56, 189, 248, 0.3)', borderRadius: 'var(--radius-md)', padding: 20,
                  textAlign: 'center', background: 'rgba(9, 16, 11, 0.6)',
                }}
              >
                <input
                  type="file"
                  id="cop-bill-file-input"
                  accept=".pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => setBillFile(e.target.files[0] || null)}
                />
                <label
                  htmlFor="cop-bill-file-input"
                  style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                >
                  <Upload size={20} color="#38bdf8" />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#f8fafc' }}>
                    {billFile ? billFile.name : 'Select Certificate of Payment (.pdf)'}
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setShowBillModal(false)} className="btn-secondary" disabled={isLoggingBill}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isLoggingBill || !billFile}>
                  {isLoggingBill ? 'Parsing & Computing...' : 'Log Certificate of Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
