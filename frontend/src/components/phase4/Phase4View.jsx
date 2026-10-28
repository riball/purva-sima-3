import React, { useState, useEffect, useRef } from 'react'
import { SlidersHorizontal, CheckCircle2, XCircle, AlertTriangle, ShieldCheck, History, ArrowDown, FileCheck } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import CompareBars from '../common/charts/CompareBars'

export default function Phase4View() {
  const { activeCompanyId, activeProjectId, projects, addToast } = useProject()

  const [currentState, setCurrentState] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [catalog, setCatalog] = useState([])
  const [selectedSubId, setSelectedSubId] = useState('steel_ifc_to_ars_eaf_recycled')
  const [sliderPct, setSliderPct] = useState(50)
  const [isProposing, setIsProposing] = useState(false)
  const [isProcessingAction, setIsProcessingAction] = useState(false)

  // Stale-response guard (same bug/fix as TrackingChatHub.jsx's
  // loadData): loadPhase4Data() is async and can still be in flight when
  // the user switches to a different project, so a slow response for the
  // PREVIOUS project can land after the switch and silently overwrite
  // the new project's state/recommendations/audit log with stale data.
  const activeProjectIdRef = useRef(activeProjectId)
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  // Load recommendations & audit log
  useEffect(() => {
    if (!activeProjectId) return

    loadPhase4Data()
    loadCatalog()
  }, [activeProjectId, activeCompanyId])

  const loadPhase4Data = async () => {
    const requestedProjectId = activeProjectId
    try {
      const state = await api.getCurrentState(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setCurrentState(state)
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      console.log('No current state for Phase 4:', err.message)
      setCurrentState(null)
    }

    try {
      const recs = await api.getRecommendations(activeProjectId, null, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setRecommendations(recs)
      const audit = await api.getAuditLog(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setAuditLog(audit)
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      console.log('Phase 4 data not ready:', err.message)
    }
  }

  const loadCatalog = async () => {
    try {
      const cat = await api.getBoqCatalog()
      setCatalog(cat)
    } catch (err) {
      console.warn('Could not load catalog:', err.message)
    }
  }

  // Propose Recommendation
  const handlePropose = async (e) => {
    e.preventDefault()
    if (!selectedSubId || sliderPct <= 0) return

    setIsProposing(true)
    try {
      await api.proposeRecommendation(activeProjectId, selectedSubId, Number(sliderPct), activeCompanyId)
      addToast('Proposed lower-carbon swap with real recomputed delta', 'success')
      loadPhase4Data()
    } catch (err) {
      addToast(`Proposal failed: ${err.message}`, 'error')
    } finally {
      setIsProposing(false)
    }
  }

  // Confirm Recommendation
  const handleConfirm = async (recId) => {
    setIsProcessingAction(true)
    try {
      await api.confirmRecommendation(activeProjectId, recId, activeCompanyId)
      addToast('Confirmed recommendation: project state updated and logged in permanent audit trail', 'success')
      loadPhase4Data()
    } catch (err) {
      addToast(`Confirm failed: ${err.message}`, 'error')
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Reject Recommendation
  const handleReject = async (recId) => {
    setIsProcessingAction(true)
    try {
      await api.rejectRecommendation(activeProjectId, recId, activeCompanyId)
      addToast('Recommendation rejected. No changes made to project numbers.', 'info')
      loadPhase4Data()
    } catch (err) {
      addToast(`Reject failed: ${err.message}`, 'error')
    } finally {
      setIsProcessingAction(false)
    }
  }

  const activeSub = catalog.find((c) => c.id === selectedSubId)

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
          borderLeft: '4px solid var(--accent-lime)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="badge badge-lime">Phase 4</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--accent-lime)', fontWeight: 600 }}>
              Act On It & Audit
            </span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Lower-Carbon Swaps & Immutable Audit Trail
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
            Propose verified substitutions from the catalog. Confirming triggers a real recompute of every affected line item and writes
            to the permanent append-only audit log. Rejecting leaves zero trace.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="badge badge-mint" style={{ fontSize: '0.8rem', padding: '6px 14px' }}>
            <ShieldCheck size={14} />
            <span>Audit Trail Protected</span>
          </span>
        </div>
      </div>

      {/* KPI Stats Row */}
      {currentState && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <StatCard
            title="Baseline Carbon"
            value={(currentState.baseline_total_gwp_kg_co2e / 1000).toFixed(1)}
            unit="tCO₂e"
            subtitle="Original recorded full scope"
            accent="mint"
            badge="Fixed"
            badgeType="mint"
          />
          
          <StatCard
            title="Current Carbon State"
            value={(currentState.current_total_gwp_kg_co2e / 1000).toFixed(1)}
            unit="tCO₂e"
            subtitle={`${currentState.total_delta_kg <= 0 ? 'Saved' : 'Added'} ${(Math.abs(currentState.total_delta_kg) / 1000).toFixed(1)} tonnes (${currentState.total_delta_pct.toFixed(1)}%)`}
            accent={currentState.total_delta_pct <= 0 ? 'lime' : 'amber'}
            badge={currentState.total_delta_pct <= 0 ? 'Reduced' : 'Exceeded'}
            badgeType={currentState.total_delta_pct <= 0 ? 'lime' : 'amber'}
          />

          <StatCard
            title="Confirmed Swaps"
            value={currentState.confirmed_change_count}
            subtitle={`${currentState.pending_recommendation_count} pending review`}
            accent="cyan"
            badge="Audited"
            badgeType="cyan"
          />

          <StatCard
            title="Audit Log Entries"
            value={auditLog.length}
            subtitle="Append-only permanent log"
            accent="amber"
            badge="Immutable"
            badgeType="amber"
          />
        </div>
      )}

      {/* Baseline vs Current carbon comparison */}
      {currentState && (
        <div className="glass-panel" style={{ padding: 22 }}>
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            Baseline vs Current Carbon
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>
            Every confirmed swap recomputes this project's real total — never an estimated delta.
          </p>
          <CompareBars
            items={[
              { label: 'Baseline', value: currentState.baseline_total_gwp_kg_co2e, color: 'var(--accent-amber)' },
              {
                label: 'Current',
                value: currentState.current_total_gwp_kg_co2e,
                color: currentState.total_delta_pct <= 0 ? 'var(--accent-lime)' : 'var(--accent-rose)',
              },
            ]}
          />
        </div>
      )}

      {/* Main Grid: Propose Swaps (Left) + Pending & Audit Log (Right).
          phase4-main-grid class (index.css) collapses this to a single
          stacked column under 640px -- a fixed 2-column explicit template
          like this one can't shrink below its minmax floors or wrap on
          its own, so without this it overflowed ~618px wide at a 390px
          viewport, pushing the whole right panel off-screen. */}
      <div className="phase4-main-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(460px, 1fr) minmax(500px, 1.2fr)', gap: 24, alignItems: 'start' }}>
        
        {/* Left Column: Propose Swaps from Verified Catalog */}
        <div className="glass-panel" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                background: 'rgba(var(--c-blue), 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-lime)',
              }}
            >
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Propose Material Swap
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)' }}>
                Verified supplier & IS-code catalog
              </span>
            </div>
          </div>

          <form onSubmit={handlePropose} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Select Alternative</label>
              <select
                value={selectedSubId}
                onChange={(e) => {
                  setSelectedSubId(e.target.value)
                  const sub = catalog.find((c) => c.id === e.target.value)
                  if (sub && sliderPct > sub.max_recommended_pct) {
                    setSliderPct(sub.max_recommended_pct)
                  }
                }}
                className="form-select"
              >
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.substitute_label} (Max {c.max_recommended_pct}%)
                  </option>
                ))}
              </select>
            </div>

            {/* Alternative Details Card */}
            {activeSub && (
              <div
                style={{
                  background: 'rgba(var(--c-surf-2), 0.7)',
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(var(--c-blue), 0.15)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="badge badge-mint" style={{ fontSize: '0.7rem' }}>
                    {activeSub.evidence_tier.replace(/_/g, ' ')}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                    Target: {activeSub.base_category}
                  </span>
                </div>

                <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.45, marginBottom: 8 }}>
                  {activeSub.reasoning}
                </p>

                {activeSub.structural_caveat && (
                  <div
                    style={{
                      background: 'rgba(var(--c-amber), 0.08)',
                      border: '1px solid rgba(var(--c-amber), 0.25)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      fontSize: '0.75rem',
                      color: 'var(--accent-amber-light)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                    }}
                  >
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{activeSub.structural_caveat}</span>
                  </div>
                )}
              </div>
            )}

            {/* Slider Control */}
            {activeSub && (
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label">Substitution Share</label>
                  <span className="tabular-nums" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                    {sliderPct}%
                  </span>
                </div>

                <input
                  type="range"
                  min="5"
                  max={activeSub.max_recommended_pct}
                  step="5"
                  value={sliderPct}
                  onChange={(e) => setSliderPct(e.target.value)}
                  style={{ width: '100%', accentColor: 'var(--accent-lime)', cursor: 'pointer' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <span>5% min</span>
                  <span>{activeSub.max_recommended_pct}% recommended max</span>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={isProposing}
              style={{ width: '100%', padding: '12px 20px', marginTop: 6 }}
            >
              {isProposing ? 'Recomputing Affected Lines...' : 'Propose Swap for Review'}
            </button>
          </form>
        </div>

        {/* Right Column: Pending Decisions & Immutable Audit Trail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Pending Decisions */}
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Pending Recommendations ({recommendations.filter((r) => r.status === 'pending').length})
              </h3>
              <span className="badge badge-amber">Awaiting Human Decision</span>
            </div>

            {recommendations.filter((r) => r.status === 'pending').length === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                No pending recommendations. Propose an alternative from the catalog on the left to review its real carbon delta.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {recommendations
                  .filter((r) => r.status === 'pending')
                  .map((rec) => (
                    <div
                      key={rec.id}
                      style={{
                        background: 'rgba(var(--c-surf-2), 0.8)',
                        padding: 16,
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid rgba(var(--c-amber), 0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {rec.label} ({rec.user_pct}%)
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                            Affects {rec.affected_line_item_count} line items • Proposed {new Date(rec.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <span className="tabular-nums badge badge-mint" style={{ fontSize: '0.8125rem' }}>
                          -{rec.delta_pct.toFixed(1)}% ({(Math.abs(rec.delta_kg) / 1000).toFixed(1)} t)
                        </span>
                      </div>

                      <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                        {rec.reasoning}
                      </p>

                      {rec.requires_engineering_review && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--accent-amber-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <AlertTriangle size={12} />
                          <span>Structural engineering sign-off required prior to field specification</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px solid rgba(var(--c-overlay), 0.05)' }}>
                        <button
                          onClick={() => handleReject(rec.id)}
                          disabled={isProcessingAction}
                          className="btn-danger"
                        >
                          <XCircle size={14} />
                          <span>Reject Swap</span>
                        </button>
                        <button
                          onClick={() => handleConfirm(rec.id)}
                          disabled={isProcessingAction}
                          className="btn-primary"
                          style={{ padding: '6px 14px', fontSize: '0.8125rem' }}
                        >
                          <CheckCircle2 size={14} />
                          <span>Confirm & Log</span>
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Append-Only Audit Trail */}
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Permanent Audit Trail
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Append-only record of confirmed engineering modifications
                </span>
              </div>
              <span className="badge badge-mint">Tamper Proof</span>
            </div>

            {auditLog.length === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                No confirmed modifications yet. Confirmed recommendations append here permanently.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {auditLog.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      background: 'rgba(var(--c-surf-2), 0.65)',
                      padding: 14,
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid rgba(var(--c-blue), 0.12)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {log.label} ({log.user_pct}%)
                      </span>
                      <span className="tabular-nums" style={{ fontSize: '0.75rem', color: 'var(--accent-lime)', fontWeight: 600 }}>
                        -{log.delta_pct.toFixed(1)}%
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                      <span>Before: {(log.total_gwp_kg_co2e_before / 1000).toFixed(1)} t</span>
                      <span>After: {(log.total_gwp_kg_co2e_after / 1000).toFixed(1)} t</span>
                      <span style={{ color: 'var(--text-muted)' }}>{new Date(log.confirmed_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
