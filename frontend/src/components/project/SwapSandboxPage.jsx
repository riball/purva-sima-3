import React, { useState, useEffect, useRef } from 'react'
import {
  Wand2, ArrowLeft, Sparkles, AlertTriangle, CheckCircle2, XCircle,
  ArrowUpRight, ChevronDown, ChevronUp, Info, Lightbulb, ShieldCheck,
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'

/**
 * Material Swap Sandbox -- a dedicated page for describing an ARBITRARY
 * material swap in plain words ("reduce RCC to 80% and keep the rest
 * M25 with GGBS"), no strict keywords, typo-tolerant. Reached from
 * ProjectDashboard.jsx's Section 5 ("Open Swap Sandbox" button), routed
 * at /projects/:projectId/swap-sandbox (see App.jsx's path map). Like
 * every other full-page view here, it reads WHICH project it's showing
 * from context (activeProjectId/activeCompanyId) -- the route param is
 * synced into that context on mount/change (see the effect below), so a
 * direct link or a refresh on this URL still opens the right project.
 *
 * Every number shown here is a REAL recompute from
 * app/services/boq_carbon/swap_sandbox.py -- an LLM (when configured)
 * only parses the free text into parameters and writes the qualitative
 * advisory text; it never computes or restates a carbon figure itself.
 * A request that can't be resolved into a real swap comes back as
 * needs_clarification instead of a guess, and is never persisted.
 *
 * A real evaluation is persisted backend-side as a Recommendation
 * (source="custom_swap") -- so "Confirm as Beta Project" / "Dismiss"
 * below are the EXACT SAME calls ProjectDashboard.jsx's Section 5 uses
 * for its catalog cards (confirmRecommendationAsBeta / rejectRecommendation),
 * no new confirm/reject logic here.
 */
export default function SwapSandboxPage() {
  const { activeCompanyId, activeProjectId, activeProject, addToast, selectProject, loadProjects } = useProject()
  const navigate = useNavigate()
  const { projectId: routeProjectId } = useParams()

  // Real app routing (Phase C, Part C): keep context's activeProjectId in
  // sync with the URL -- a direct link, a refresh, or Back/Forward on
  // this route still have to land on the right project, not whatever was
  // last selected elsewhere in the app.
  useEffect(() => {
    if (routeProjectId && routeProjectId !== activeProjectId) {
      selectProject(routeProjectId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId])

  const [question, setQuestion] = useState('')
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [currentResult, setCurrentResult] = useState(null) // { evaluation, recommendation } from the most recent /evaluate call
  const [history, setHistory] = useState([]) // past custom_swap Recommendations for this project, newest first
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [isProcessingAction, setIsProcessingAction] = useState(false)
  const [expandedAdvisoryId, setExpandedAdvisoryId] = useState(null) // 'current' or a recommendation id
  const [recentBetaFork, setRecentBetaFork] = useState(null)

  // Same stale-response guard pattern as Phase4View.jsx/TrackingChatHub.jsx:
  // loadHistory() is async and can still be in flight when the user
  // navigates away, so a slow response landing after that shouldn't
  // overwrite a different project's state.
  const activeProjectIdRef = useRef(activeProjectId)
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  useEffect(() => {
    if (!activeProjectId) return
    loadHistory()
  }, [activeProjectId, activeCompanyId])

  const loadHistory = async () => {
    const requestedProjectId = activeProjectId
    setIsLoadingHistory(true)
    try {
      const recs = await api.getRecommendations(activeProjectId, null, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setHistory(
        recs
          .filter((r) => r.source === 'custom_swap')
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      )
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      console.log('Could not load swap sandbox history:', err.message)
    } finally {
      if (activeProjectIdRef.current === requestedProjectId) setIsLoadingHistory(false)
    }
  }

  const handleEvaluate = async (e) => {
    e.preventDefault()
    const q = question.trim()
    if (!q) return

    setIsEvaluating(true)
    setCurrentResult(null)
    try {
      const result = await api.evaluateCustomSwap(activeProjectId, q, activeCompanyId)
      setCurrentResult(result)
      if (!result.evaluation.needs_clarification) {
        setExpandedAdvisoryId('current')
        loadHistory()
      }
    } catch (err) {
      addToast(`Could not evaluate that swap: ${err.message}`, 'error')
    } finally {
      setIsEvaluating(false)
    }
  }

  const handleConfirmAsBeta = async (recId) => {
    setIsProcessingAction(true)
    try {
      const result = await api.confirmRecommendationAsBeta(activeProjectId, recId, activeCompanyId)
      setRecentBetaFork({ newProjectId: result.new_project_id, newProjectName: result.new_project_name })
      addToast(
        `Created "${result.new_project_name}" with the swapped figures — this project's own numbers are unchanged.`,
        'success',
        8000,
        { label: 'View Beta Project', onClick: () => navigate(`/projects/${result.new_project_id}`) }
      )
      if (currentResult?.recommendation?.id === recId) {
        setCurrentResult(null)
      }
      loadHistory()
      loadProjects(activeCompanyId) // so the Directory's Beta section picks up the new twin immediately
    } catch (err) {
      addToast(`Could not create Beta scenario: ${err.message}`, 'error')
    } finally {
      setIsProcessingAction(false)
    }
  }

  const handleReject = async (recId) => {
    setIsProcessingAction(true)
    try {
      await api.rejectRecommendation(activeProjectId, recId, activeCompanyId)
      addToast('Dismissed. No changes made to any project.', 'info')
      if (currentResult?.recommendation?.id === recId) {
        setCurrentResult(null)
      }
      loadHistory()
    } catch (err) {
      addToast(`Could not dismiss: ${err.message}`, 'error')
    } finally {
      setIsProcessingAction(false)
    }
  }

  if (!activeProjectId) {
    return (
      <div className="glass-panel" style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <span>No project is currently open.</span>
        <button onClick={() => navigate('/projects')} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
          <ArrowLeft size={14} /> Back to Projects Directory
        </button>
      </div>
    )
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header banner */}
      <div className="glass-panel" style={{ padding: '24px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderLeft: '4px solid var(--accent-violet)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="badge badge-violet">Interactive Sandbox</span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wand2 size={22} color="var(--accent-violet)" />
            Material Swap Sandbox
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', maxWidth: 640 }}>
            {activeProject?.project_name ? `${activeProject.project_name} — ` : ''}
            Describe any swap in plain words. No strict keywords, and typos are fine — every number below is a real recompute, never guessed.
          </p>
        </div>
        <button onClick={() => navigate(`/projects/${activeProjectId}`)} className="btn-secondary" style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
          <ArrowLeft size={14} /> Back to Project Dashboard
        </button>
      </div>

      {recentBetaFork && (
        <div className="glass-panel" style={{ padding: 16, border: '1px solid rgba(var(--c-blue), 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
            Created <strong>{recentBetaFork.newProjectName}</strong> with the swapped figures.
          </span>
          <button onClick={() => navigate(`/projects/${recentBetaFork.newProjectId}`)} className="btn-primary" style={{ fontSize: '0.78rem' }}>
            <span>View Beta Project</span>
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}

      {/* Free-text input */}
      <div className="glass-panel" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: '8px', background: 'rgba(var(--c-violet), 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-violet)' }}>
            <Sparkles size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Describe the swap you want to try</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              e.g. "reduce the current quantity of RCC cement to 80% and keep the 20% to be a M25 with GGBS mixture"
            </span>
          </div>
        </div>
        <form onSubmit={handleEvaluate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Describe the swap you want to try..."
            rows={3}
            className="form-input"
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
          <button type="submit" className="btn-primary" disabled={isEvaluating || !question.trim()} style={{ alignSelf: 'flex-end', padding: '10px 20px' }}>
            {isEvaluating ? 'Evaluating...' : 'Evaluate Swap'}
          </button>
        </form>
      </div>

      {/* Most recent result -- shown prominently, separate from history,
          so the user sees the answer to what they JUST asked without
          scrolling. A needs_clarification response renders as a
          follow-up question, not a result card (nothing was persisted
          for it -- see swap_sandbox.py's own "never guess" discipline). */}
      {currentResult && (
        currentResult.evaluation.needs_clarification ? (
          <div className="glass-panel" style={{ padding: 20, border: '1px solid rgba(var(--c-amber), 0.3)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Info size={18} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                I need a bit more detail
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>
                {currentResult.evaluation.needs_clarification}
              </p>
            </div>
          </div>
        ) : (
          <SwapResultCard
            evaluation={currentResult.evaluation}
            recommendation={currentResult.recommendation}
            isExpanded={expandedAdvisoryId === 'current'}
            onToggleExpand={() => setExpandedAdvisoryId(expandedAdvisoryId === 'current' ? null : 'current')}
            isProcessingAction={isProcessingAction}
            onConfirmAsBeta={handleConfirmAsBeta}
            onReject={handleReject}
            isJustEvaluated
          />
        )
      )}

      {/* History */}
      <div className="glass-panel" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Past Sandbox Swaps ({history.length})
          </h3>
        </div>
        {isLoadingHistory ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading history...</p>
        ) : history.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            No sandbox swaps evaluated yet for this project. Describe one above to see its real recomputed numbers.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {history
              .filter((rec) => !currentResult || rec.id !== currentResult.recommendation?.id)
              .map((rec) => (
                <SwapResultCard
                  key={rec.id}
                  recommendation={rec}
                  isExpanded={expandedAdvisoryId === rec.id}
                  onToggleExpand={() => setExpandedAdvisoryId(expandedAdvisoryId === rec.id ? null : rec.id)}
                  isProcessingAction={isProcessingAction}
                  onConfirmAsBeta={handleConfirmAsBeta}
                  onReject={handleReject}
                  onViewBetaProject={(projectId) => navigate(`/projects/${projectId}`)}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Renders ONE swap, from either shape this page has for it:
 *  - `evaluation` + `recommendation` -- the full response straight from
 *    POST /swap-sandbox/.../evaluate (used for the just-evaluated result,
 *    which additionally has disclosures/advisory in their original
 *    richness).
 *  - `recommendation` alone -- a past Recommendation loaded from
 *    GET /phase4/.../recommendations. Its disclosures/advisory were
 *    persisted onto the Recommendation itself (see phase4.py's
 *    evaluate_and_propose_custom_swap), so history keeps full fidelity
 *    after a reload, not just the numbers.
 * Either way, every number rendered here is read directly off the
 * recommendation/computed result -- never recomputed or restated by
 * this component.
 */
function SwapResultCard({
  evaluation, recommendation, isExpanded, onToggleExpand,
  isProcessingAction, onConfirmAsBeta, onReject, onViewBetaProject, isJustEvaluated,
}) {
  const computed = evaluation?.computed
  const label = recommendation?.label || evaluation?.entry?.substitute_label || 'Swap'
  // Present only when this swap used the continuous GGBS%/fly-ash%
  // interpolation lever (see ice_factors.get_blended_cement_factor_per_kg) --
  // the exact confidence tier (interpolated vs. extrapolated) is already
  // spelled out in the disclosures below, so this badge is just a quick
  // visual flag that the number is an estimate, not a third sourced figure.
  const blendPct = evaluation?.entry?.substitute_blend_pct || recommendation?.custom_entry?.substitute_blend_pct
  const interpretation = evaluation?.interpretation_summary || recommendation?.description
  const reasoning = recommendation?.reasoning || evaluation?.entry?.reasoning
  const structuralCaveat = evaluation?.entry?.structural_caveat || recommendation?.custom_entry?.structural_caveat
  const disclosures = recommendation?.disclosures || evaluation?.disclosures || []
  const advisory = recommendation?.advisory || evaluation?.advisory
  const affected = computed?.affected_line_item_count ?? recommendation?.affected_line_item_count ?? 0
  const before = computed?.original_gwp_kg_co2e ?? recommendation?.carbon_kg_before ?? 0
  const after = computed?.new_gwp_kg_co2e ?? recommendation?.carbon_kg_after ?? 0
  const deltaKg = computed?.savings_kg_co2e ?? recommendation?.delta_kg ?? 0
  const requiresReview = computed?.requires_engineering_review ?? recommendation?.requires_engineering_review ?? false
  const isIncrease = deltaKg < 0 // a negative "savings" means this swap actually ADDS carbon -- shown honestly, not hidden
  const status = recommendation?.status // undefined for a just-evaluated, not-yet-loaded-into-history result -- treated as pending below
  const createdAt = recommendation?.created_at

  return (
    <div className="glass-panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, border: isJustEvaluated ? '1px solid rgba(var(--c-violet), 0.3)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
          {blendPct && (
            <span className="badge badge-amber" style={{ fontSize: '0.62rem', marginLeft: 8 }}>
              Estimated — interpolated % blend
            </span>
          )}
          {createdAt && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
              Asked {new Date(createdAt).toLocaleString()}
            </span>
          )}
        </div>
        <span className={isIncrease ? 'tabular-nums badge badge-amber' : 'tabular-nums badge badge-mint'} style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
          {isIncrease ? '+' : '-'}{(Math.abs(deltaKg) / 1000).toFixed(2)} tCO₂e
        </span>
      </div>

      {interpretation && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.45, margin: 0 }}>{interpretation}</p>
      )}

      {/* Real before/after numbers -- never a fabricated figure. 0
          affected lines (the honest "not present in this BOQ" case) is
          shown as-is, not hidden. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, background: 'rgba(var(--c-surf-2), 0.6)', borderRadius: 'var(--radius-md)', padding: 12 }}>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Before</div>
          <div className="tabular-nums" style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>{(before / 1000).toFixed(2)} t</div>
        </div>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>After</div>
          <div className="tabular-nums" style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>{(after / 1000).toFixed(2)} t</div>
        </div>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Affected Lines</div>
          <div className="tabular-nums" style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>{affected}</div>
        </div>
      </div>

      {affected === 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This project's current BOQ has no computed line items matching this swap's material — the numbers above are honestly unchanged, not a guess.</span>
        </div>
      )}

      {/* Disclosures -- snap-to-nearest-real-option notes, etc. Shown
          prominently (not buried in a tooltip), per the approved plan. */}
      {disclosures.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {disclosures.map((d, i) => (
            <div key={i} style={{ fontSize: '0.76rem', color: 'var(--accent-amber-light)', display: 'flex', alignItems: 'flex-start', gap: 6, background: 'rgba(var(--c-amber), 0.08)', border: '1px solid rgba(var(--c-amber), 0.25)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', lineHeight: 1.4 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{d}</span>
            </div>
          ))}
        </div>
      )}

      {requiresReview && (
        <div style={{ fontSize: '0.72rem', color: 'var(--accent-amber-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={12} />
          <span>Structural engineering sign-off required prior to field specification</span>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onToggleExpand}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600, color: 'var(--accent-mint)' }}
        >
          <Lightbulb size={13} />
          <span>Why this swap — advantages, disadvantages & guidance</span>
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {isExpanded && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reasoning && <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>{reasoning}</p>}
            {structuralCaveat && (
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>{structuralCaveat}</p>
            )}

            {advisory && (
              <div style={{ background: 'rgba(var(--c-blue), 0.06)', border: '1px solid rgba(var(--c-blue), 0.15)', borderRadius: 'var(--radius-md)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>AI-Generated Guidance</span>
                  <span className="badge badge-mint" style={{ fontSize: '0.62rem' }}>
                    {advisory.source === 'ai_generated' ? 'AI-generated' : advisory.source === 'catalog_grounded' ? 'Catalog-grounded' : 'Unavailable'}
                  </span>
                </div>

                {advisory.advantages?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-lime)', marginBottom: 4 }}>Advantages</div>
                    {advisory.advantages.map((a, i) => (
                      <p key={i} style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', lineHeight: 1.45, margin: '0 0 4px' }}>• {a}</p>
                    ))}
                  </div>
                )}

                {advisory.disadvantages?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-amber-light)', marginBottom: 4 }}>Disadvantages</div>
                    {advisory.disadvantages.map((d, i) => (
                      <p key={i} style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', lineHeight: 1.45, margin: '0 0 4px' }}>• {d}</p>
                    ))}
                  </div>
                )}

                {advisory.better_approach && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-mint)', marginBottom: 4 }}>A Better Approach</div>
                    <p style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', lineHeight: 1.45, margin: 0 }}>{advisory.better_approach}</p>
                  </div>
                )}

                {advisory.source === 'unavailable' && !advisory.advantages?.length && !advisory.disadvantages?.length && (
                  <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
                    No AI or catalog-sourced guidance is available for this exact combination.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer -- status-dependent, same two actions (Confirm as Beta /
          Dismiss) Section 5's catalog cards already use, since this IS
          the same Recommendation store. */}
      {recommendation && (
        status === 'confirmed_as_beta' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid rgba(var(--c-overlay), 0.05)' }}>
            <button
              type="button"
              onClick={() => onViewBetaProject?.(recommendation.beta_project_id)}
              className="btn-primary"
              style={{ fontSize: '0.78rem' }}
            >
              <ArrowUpRight size={13} />
              <span>View Beta Project</span>
            </button>
          </div>
        ) : status === 'rejected' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid rgba(var(--c-overlay), 0.05)' }}>
            <span className="badge badge-muted" style={{ fontSize: '0.7rem' }}>Dismissed</span>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px solid rgba(var(--c-overlay), 0.05)' }}>
            <button type="button" onClick={() => onReject(recommendation.id)} disabled={isProcessingAction} className="btn-danger">
              <XCircle size={14} />
              <span>Dismiss</span>
            </button>
            <button type="button" onClick={() => onConfirmAsBeta(recommendation.id)} disabled={isProcessingAction} className="btn-primary" style={{ padding: '6px 14px', fontSize: '0.8125rem' }}>
              <CheckCircle2 size={14} />
              <span>Confirm as Beta Project</span>
            </button>
          </div>
        )
      )}
    </div>
  )
}
