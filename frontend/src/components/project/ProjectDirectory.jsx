import React, { useState, useEffect, useMemo } from 'react'
import { Building2, MapPin, Search, ArrowRight, Layers, FlaskConical, Trash2, AlertTriangle } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import { aggregateCategories, CATEGORY_LABELS } from '../common/charts/MaterialBreakdownChart'
import { originLabel } from '../../utils/projectOrigin'

/**
 * "Projects & Embodied Carbon Directory" -- the quick-look card grid the
 * user's mockup opens with, reached from the 'project' nav item ("Projects
 * & Detail"). Pattern-matched to the mockup's own ProjectsDirectory.tsx
 * structure, with the user's own explicit cuts applied (see the approved
 * "Projects & Embodied Carbon Directory + Project Dashboard rebuild"
 * plan, item 1/2):
 *   1. A search bar only -- no archetype/status filter dropdowns.
 *   2. The card's metrics summary matches the mockup minus Contractor,
 *      and "Largest Driver" is relabeled "Most Contributing Material"
 *      (same computed value, reusing MaterialBreakdownChart's own
 *      aggregateCategories() -- the same per-project fan-out pattern
 *      PortfolioOverview.jsx already established for this exact
 *      "no single endpoint aggregates this" situation).
 *
 * Projects are split into two groups: real tracked projects in the main
 * grid, then (only if any exist) Beta twins -- forked by
 * app/services/phase4.py's confirm_recommendation_as_beta_twin() and
 * flagged via ProjectSummary.is_beta_twin -- in their own "Material
 * Change Projects (Beta)" section at the bottom, never mixed into the
 * main grid.
 */
export default function ProjectDirectory() {
  const { projects, activeCompanyId, selectProject, navigate, deleteProject, isLoading: projectsLoading } = useProject()

  const [dashboards, setDashboards] = useState({}) // project_id -> dashboard | 'error'
  const [billsByProject, setBillsByProject] = useState({}) // project_id -> bills[] | 'error'
  const [searchQuery, setSearchQuery] = useState('')
  // Permanent delete, backed by DELETE /projects/{id} (already wired on
  // deleteProject in ProjectContext -- removes the name registry entry,
  // Phase 1 record, and the whole Phase 3/4 directory in one call). Its
  // own small confirmation modal, matching the delete-bill dialog style
  // already established in TrackingChatHub.jsx, not a native confirm().
  const [deleteTarget, setDeleteTarget] = useState(null) // project row | null
  const [isDeleting, setIsDeleting] = useState(false)

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteProject(deleteTarget.project_id, activeCompanyId)
      setDeleteTarget(null)
    } catch {
      // deleteProject already surfaced a toast -- leave the confirm
      // dialog open so the user can retry or cancel.
    } finally {
      setIsDeleting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const baselined = projects.filter((p) => p.has_baseline)
    if (baselined.length === 0) {
      setDashboards({})
      setBillsByProject({})
      return
    }
    Promise.allSettled(baselined.map((p) => api.getDashboard(p.project_id, activeCompanyId))).then((results) => {
      if (cancelled) return
      const next = {}
      results.forEach((res, i) => {
        next[baselined[i].project_id] = res.status === 'fulfilled' ? res.value : 'error'
      })
      setDashboards(next)
    })
    Promise.allSettled(baselined.map((p) => api.getBills(p.project_id, activeCompanyId))).then((results) => {
      if (cancelled) return
      const next = {}
      results.forEach((res, i) => {
        next[baselined[i].project_id] = res.status === 'fulfilled' ? res.value : 'error'
      })
      setBillsByProject(next)
    })
    return () => {
      cancelled = true
    }
  }, [projects, activeCompanyId])

  const rows = useMemo(() => {
    return projects.map((p) => {
      const dash = dashboards[p.project_id]
      const hasDash = dash && dash !== 'error' && dash.baseline
      const bills = billsByProject[p.project_id]
      const categoryTotals = Array.isArray(bills) ? aggregateCategories(bills).rows : []
      const mostContributing = categoryTotals.length > 0 ? categoryTotals[0] : null

      const baselineT = hasDash ? dash.baseline.total_gwp_kg_co2e / 1000 : null
      const billedT = hasDash && dash.billed_to_date_gwp_kg_co2e != null ? dash.billed_to_date_gwp_kg_co2e / 1000 : null
      const projectedT = hasDash && dash.projected_total_gwp_kg_co2e ? dash.projected_total_gwp_kg_co2e / 1000 : baselineT
      const floorAreaSqm = hasDash ? dash.baseline.floor_area_sqm : null
      const deviationPct = hasDash ? dash.projected_vs_baseline_pct : null
      const completionPct = hasDash ? dash.percent_complete : null
      const budgetUsedPct = baselineT && billedT != null ? Math.min(100, (billedT / baselineT) * 100) : null
      const intensityKgPerM2 = floorAreaSqm && projectedT != null ? (projectedT * 1000) / floorAreaSqm : null
      const currentIntensityKgPerM2 = floorAreaSqm && billedT != null ? (billedT * 1000) / floorAreaSqm : null

      return {
        project: p,
        hasDash,
        mostContributing,
        baselineT,
        billedT,
        projectedT,
        floorAreaSqm,
        deviationPct,
        completionPct,
        budgetUsedPct,
        intensityKgPerM2,
        currentIntensityKgPerM2,
      }
    })
  }, [projects, dashboards, billsByProject])

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const p = r.project
      return (p.project_name || '').toLowerCase().includes(q) || (p.location || '').toLowerCase().includes(q)
    })
  }, [rows, searchQuery])

  const normalRows = filteredRows.filter((r) => !r.project.is_beta_twin)
  const betaRows = filteredRows.filter((r) => r.project.is_beta_twin)

  const tracked = rows.filter((r) => !r.project.is_beta_twin && r.hasDash)
  const totalBaselineT = tracked.reduce((sum, r) => sum + (r.baselineT || 0), 0)
  const totalBilledT = tracked.reduce((sum, r) => sum + (r.billedT || 0), 0)
  const totalFloorArea = tracked.reduce((sum, r) => sum + (r.floorAreaSqm || 0), 0)
  const avgIntensity = totalFloorArea > 0 ? (totalBilledT * 1000) / totalFloorArea : null

  function openProject(projectId) {
    selectProject(projectId)
    navigate('project-dashboard')
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || (category ? category.replace(/_/g, ' ') : 'Uncategorized')
  }

  function statusBadge(r) {
    if (r.deviationPct === null) return null
    return r.deviationPct > 0 ? { label: 'Above Baseline', type: 'badge-amber' } : { label: 'On Track', type: 'badge-lime' }
  }

  function ProjectCard({ r }) {
    const p = r.project
    const status = statusBadge(r)
    return (
      <div
        className="glass-panel"
        onClick={() => openProject(p.project_id)}
        style={{ padding: 22, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {p.archetype && <span className="badge badge-mint" style={{ fontSize: '0.68rem' }}>{p.archetype}</span>}
              {p.construction_stage && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {p.construction_stage}
                  {r.completionPct !== null && ` (${r.completionPct.toFixed(0)}%)`}
                </span>
              )}
            </div>
            {status && <span className={`badge ${status.type}`} style={{ fontSize: '0.68rem', flexShrink: 0 }}>{status.label}</span>}
          </div>

          <div style={{ marginBottom: 14 }}>
            {originLabel(p.baseline_source_type) && (
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 2 }}>
                {originLabel(p.baseline_source_type)}
              </span>
            )}
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>{p.project_name || p.project_id}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {p.location && (
                <>
                  <MapPin size={12} />
                  <span>{p.location}</span>
                  <span>·</span>
                </>
              )}
              <span>GFA: <strong style={{ color: 'var(--text-secondary)' }}>{r.floorAreaSqm ? Math.round(r.floorAreaSqm).toLocaleString() : '--'} m²</strong></span>
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 'var(--radius-md)', background: 'rgba(var(--c-surf-2), 0.6)', border: '1px solid rgba(var(--c-blue), 0.12)', marginBottom: 14 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Embodied Carbon Metrics Summary
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Baseline Target</div>
                <div className="tabular-nums" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {r.baselineT !== null ? r.baselineT.toFixed(1) : '--'} <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-muted)' }}>t</span>
                </div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Immutable design</div>
              </div>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Cumulative Incurred</div>
                <div className="tabular-nums" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                  {r.billedT !== null ? r.billedT.toFixed(1) : '--'} <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-muted)' }}>t</span>
                </div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{r.budgetUsedPct !== null ? `${r.budgetUsedPct.toFixed(0)}% budget used` : '--'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Projected Final</div>
                <div className="tabular-nums" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {r.projectedT !== null ? r.projectedT.toFixed(1) : '--'} <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-muted)' }}>t</span>
                </div>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: r.deviationPct !== null && r.deviationPct > 0 ? 'var(--accent-amber-light)' : 'var(--accent-lime)' }}>
                  {r.deviationPct !== null ? `${r.deviationPct > 0 ? '+' : ''}${r.deviationPct.toFixed(1)}% vs baseline` : '--'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Carbon Intensity</div>
                <div className="tabular-nums" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {r.intensityKgPerM2 !== null ? Math.round(r.intensityKgPerM2) : '--'} <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-muted)' }}>kg/m²</span>
                </div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                  {r.currentIntensityKgPerM2 !== null ? `Current: ${Math.round(r.currentIntensityKgPerM2)} kg/m²` : '--'}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(var(--c-blue), 0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: 5 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Physical Progress: <strong>{r.completionPct !== null ? `${r.completionPct.toFixed(0)}%` : '--'}</strong></span>
                <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>Carbon Released: <strong>{r.budgetUsedPct !== null ? `${r.budgetUsedPct.toFixed(0)}%` : '--'}</strong></span>
              </div>
              <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(var(--c-overlay),0.1)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, r.completionPct || 0)}%`,
                    background: r.deviationPct !== null && r.deviationPct > 0 ? 'var(--accent-amber)' : 'var(--accent-lime)',
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            Most Contributing Material: <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>
              {r.mostContributing ? categoryLabel(r.mostContributing.category) : '--'}
            </strong>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, marginTop: 14, borderTop: '1px solid rgba(var(--c-blue), 0.1)' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Last updated: {p.latest_billed_date || 'never'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(p) }}
              className="btn-secondary"
              title="Delete project"
              aria-label="Delete project"
              style={{ fontSize: '0.75rem', padding: '7px 9px', color: 'var(--accent-rose-light)' }}
            >
              <Trash2 size={13} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openProject(p.project_id) }}
              className="btn-primary"
              style={{ fontSize: '0.75rem', padding: '7px 12px' }}
            >
              <span>Open Project Dashboard</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="glass-panel" style={{ padding: '20px 24px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-lime)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            <Layers size={13} />
            <span>Portfolio Project Selection</span>
            <span>·</span>
            <span>{projects.length} Monitored Assets</span>
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Projects &amp; Embodied Carbon Directory</h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginTop: 2, maxWidth: 560 }}>
            Select any project to inspect its carbon trajectory, billing verification, material breakdown, and substitution scenarios.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', background: 'rgba(var(--c-surf-2), 0.6)', border: '1px solid rgba(var(--c-blue), 0.12)', borderRadius: 'var(--radius-md)' }}>
          <div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Portfolio Baseline</div>
            <div className="tabular-nums" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>{totalBaselineT.toFixed(1)} <span style={{ fontSize: '0.62rem', fontWeight: 400, color: 'var(--text-muted)' }}>t</span></div>
          </div>
          <div style={{ width: 1, height: 28, background: 'rgba(var(--c-blue), 0.15)' }} />
          <div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Incurred Actuals</div>
            <div className="tabular-nums" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--accent-lime)' }}>{totalBilledT.toFixed(1)} <span style={{ fontSize: '0.62rem', fontWeight: 400, color: 'var(--text-muted)' }}>t</span></div>
          </div>
          <div style={{ width: 1, height: 28, background: 'rgba(var(--c-blue), 0.15)' }} />
          <div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Avg Intensity</div>
            <div className="tabular-nums" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>{avgIntensity !== null ? Math.round(avgIntensity) : '--'} <span style={{ fontSize: '0.62rem', fontWeight: 400, color: 'var(--text-muted)' }}>kg/m²</span></div>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', maxWidth: 420 }}>
        <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          type="text"
          placeholder="Search by project name or location..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="form-input"
          style={{ paddingLeft: 34, width: '100%' }}
        />
      </div>

      {projectsLoading ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading projects…</p>
      ) : normalRows.length === 0 ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No projects match this search.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 18 }}>
          {normalRows.map((r) => <ProjectCard key={r.project.project_id} r={r} />)}
        </div>
      )}

      {betaRows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 10, borderTop: '1px solid rgba(var(--c-blue), 0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FlaskConical size={15} color="var(--accent-cyan)" />
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>Material Change Projects (Beta)</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              -- confirmed substitution scenarios, each forked from a real project without changing its own figures
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 18 }}>
            {betaRows.map((r) => <ProjectCard key={r.project.project_id} r={r} />)}
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(var(--c-black), 0.75)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <AlertTriangle size={20} color="var(--accent-rose-light)" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Delete this project?</h3>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 22, lineHeight: 1.5 }}>
              This permanently removes{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deleteTarget.project_name || deleteTarget.project_id}"</strong>{' '}
              — its Phase 1 record, baseline, and every bill logged against it. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary" disabled={isDeleting}>
                Cancel
              </button>
              <button type="button" onClick={handleConfirmDelete} className="btn-danger" disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
