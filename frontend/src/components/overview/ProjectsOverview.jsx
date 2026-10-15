import React, { useState } from 'react'
import { Building2, Plus, ArrowRight, FileSpreadsheet, LineChart, SlidersHorizontal, CheckCircle2, AlertTriangle, Clock, Search, Pencil, Trash2, X } from 'lucide-react'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import SaveProjectNameModal from '../shared/SaveProjectNameModal'

export default function ProjectsOverview({ onNavigatePhase }) {
  const {
    projects,
    activeCompanyId,
    companies,
    activeProjectId,
    selectProject,
    loadProjects,
    deleteProject,
    isLoading,
  } = useProject()

  // UX refinement: name search + inline rename. Filters the already-
  // loaded `projects` list client-side (instant, no extra round trip --
  // it already carries the project_registry-corrected name via
  // phase3.list_projects()'s own lookup). GET /projects/search exists for
  // a fuzzier/scored lookup, used later by the chat bar's name
  // resolution; the full list is already local here so a simple
  // substring filter is enough.
  const [searchQuery, setSearchQuery] = useState('')
  const [renameTarget, setRenameTarget] = useState(null) // { project_id, project_name } | null
  const [deleteTarget, setDeleteTarget] = useState(null) // { project_id, project_name } | null
  const [isDeleting, setIsDeleting] = useState(false)

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteProject(deleteTarget.project_id, activeCompanyId)
      setDeleteTarget(null)
    } catch {
      // deleteProject already surfaced a toast -- leave the confirm
      // dialog open so the user can see what happened and retry/cancel.
    } finally {
      setIsDeleting(false)
    }
  }

  const currentCompany = companies.find((c) => c.company_id === activeCompanyId)
  const totalProjects = projects.length
  const baselineCount = projects.filter((p) => p.has_baseline).length
  const billedCount = projects.filter((p) => p.n_bills > 0).length
  const phase1OnlyCount = projects.filter((p) => p.has_phase1_record && !p.has_baseline).length

  const q = searchQuery.trim().toLowerCase()
  const visibleProjects = q
    ? projects.filter((p) => (p.project_name || p.project_id).toLowerCase().includes(q))
    : projects

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Top Banner / Hero inspired by GreenSpan & Verdant */}
      <div
        className="glass-panel"
        style={{
          padding: '32px 36px',
          background: 'rgba(var(--c-surf-5), 0.25)',
          border: '1px solid rgba(var(--c-blue-dim), 0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ maxWidth: 680, position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="badge badge-lime">Company Portfolio</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--accent-lime)', fontWeight: 600 }}>
              {currentCompany?.display_name || activeCompanyId}
            </span>
          </div>

          <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 10 }}>
            Embodied Carbon Analyzer
          </h1>

          <p style={{ fontSize: '0.9375rem', color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: 20 }}>
            Every number is verified against actual quantities and versioned emission factors. Never a guessed delta.
            Track your projects from initial conceptual forms, through real BOQ / Work Order audits, to live site billing.
          </p>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn-primary"
              onClick={() => {
                // Clear whatever project is currently selected BEFORE
                // switching tabs -- Phase1Wizard's own form state always
                // starts blank on mount (App.jsx only renders it while
                // activeTab === 'phase1', so it fully unmounts/remounts
                // on every tab switch), but its auto-load effect
                // immediately re-fetches and displays whatever
                // activeProjectId still points to. Without this, clicking
                // "New Estimate" while a project was previously open
                // doesn't show a blank form at all -- it silently reloads
                // that old project, jumps straight to its Results step,
                // and fires the "Calculated carbon, cost, and benchmark"
                // toast, which reads exactly like "old project saved and
                // benchmarked" instead of a fresh estimate starting.
                selectProject(null)
                onNavigatePhase('phase1')
              }}
            >
              <Plus size={16} />
              <span>New Estimate (Phase 1)</span>
            </button>
            <button
              className="btn-secondary"
              onClick={() => onNavigatePhase('phase2')}
            >
              <FileSpreadsheet size={16} />
              <span>Ingest Real BOQ / WO (Phase 2)</span>
            </button>
          </div>
        </div>

        {/* Decorative Atmospheric Glow */}
        <div
          style={{
            position: 'absolute',
            right: -60,
            top: -60,
            width: 280,
            height: 280,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(var(--c-blue), 0.14) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Portfolio KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <StatCard
          title="Total Projects"
          value={totalProjects}
          subtitle={`Managed under ${currentCompany?.display_name || activeCompanyId}`}
          icon={Building2}
          accent="lime"
          badge="Company Scope"
          badgeType="lime"
        />
        <StatCard
          title="With Fixed Baseline"
          value={baselineCount}
          subtitle="Stable point every future bill is measured against"
          icon={CheckCircle2}
          accent="mint"
          badge={`${totalProjects > 0 ? Math.round((baselineCount / totalProjects) * 100) : 0}%`}
          badgeType="mint"
        />
        <StatCard
          title="Active Construction"
          value={billedCount}
          subtitle="Projects with periodic bills logged to date"
          icon={LineChart}
          accent="amber"
          badge={`${billedCount} Billed`}
          badgeType="amber"
        />
        <StatCard
          title="Conceptual Estimates"
          value={phase1OnlyCount}
          subtitle="Ready for Phase 2 BOQ refinement or baseline setting"
          icon={Clock}
          accent="cyan"
          badge="Pre-Construction"
          badgeType="cyan"
        />
      </div>

      {/* Projects Grid */}
      <div>
        {/* flexWrap added, and the search input's fixed width: 240 changed
            to width: '100%' + maxWidth: 240, so this row wraps onto two
            lines on a narrow viewport instead of overflowing -- a fixed
            240px input alongside the title block in a non-wrapping
            justify-content: space-between row was ~48px wider than a
            390px viewport before this fix. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Projects
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              Select a project to load its context across all phases -- or search by name
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: 240 }}>
              <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Search projects by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input"
                style={{ paddingLeft: 30, paddingRight: searchQuery ? 30 : 12, fontSize: '0.8125rem', width: '100%' }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex',
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <button
              onClick={() => loadProjects()}
              className="btn-secondary"
              style={{ fontSize: '0.75rem', padding: '6px 14px' }}
            >
              Refresh List
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="glass-panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Loading projects...
          </div>
        ) : visibleProjects.length === 0 && q ? (
          <div className="glass-panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No project found matching "{searchQuery}".
          </div>
        ) : projects.length === 0 ? (
          <div
            className="glass-panel"
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(var(--c-blue), 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-lime)',
              }}
            >
              <Building2 size={24} />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              No Projects Found for {currentCompany?.display_name || activeCompanyId}
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', maxWidth: 460 }}>
              Start by submitting a quick conceptual estimate in Phase 1, or upload an actual project BOQ spreadsheet / Work Order PDF in Phase 2.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button className="btn-primary" onClick={() => { selectProject(null); onNavigatePhase('phase1') }}>
                Create Estimate (Phase 1)
              </button>
              <button className="btn-secondary" onClick={() => onNavigatePhase('phase2')}>
                Upload BOQ (Phase 2)
              </button>
            </div>
          </div>
        ) : (
          /* minmax(min(360px, 100%), 1fr) instead of a bare minmax(360px, 1fr):
             on a narrow viewport (e.g. a phone at ~390px, minus page padding)
             a flat 360px minimum doesn't fit and the grid overflows
             horizontally, clipping project cards off-screen -- measured
             ~48px of overflow at 390px wide before this fix. min(360px, 100%)
             lets the single-column case shrink to the actual available width
             instead of forcing a track that's wider than the viewport. */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 16 }}>
            {visibleProjects.map((project) => {
              const isSelected = project.project_id === activeProjectId
              const displayName = project.project_name || `Project ${project.project_id.slice(0, 8)}`

              return (
                <div
                  key={project.project_id}
                  className="glass-panel"
                  style={{
                    padding: 22,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 16,
                    cursor: 'pointer',
                    borderColor: isSelected ? 'var(--accent-lime)' : undefined,
                    boxShadow: isSelected ? '0 0 20px rgba(var(--c-blue), 0.25)' : undefined,
                  }}
                  onClick={() => selectProject(project.project_id)}
                >
                  <div>
                    {/* Header: Project Name & Selected Indicator.
                        flexWrap + minWidth: 0 on the title block + a
                        truncated (not wrapping/forcing-width) ID line --
                        without these, a flex-shrink:0 action-button group
                        alongside a long monospace project-id string
                        overflowed the card (and the whole page) by ~39px
                        at a 390px viewport before this fix. */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                      <div style={{ minWidth: 0, flex: '1 1 160px' }}>
                        <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                          {displayName}
                        </h3>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ID: {project.project_id}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenameTarget({ project_id: project.project_id, project_name: displayName })
                          }}
                          title="Rename project"
                          style={{
                            background: 'rgba(var(--c-blue), 0.08)', border: '1px solid rgba(var(--c-blue), 0.15)',
                            borderRadius: 'var(--radius-sm)', color: 'var(--accent-lime)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 5,
                          }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget({ project_id: project.project_id, project_name: displayName })
                          }}
                          title="Delete project"
                          style={{
                            background: 'rgba(var(--c-rose), 0.08)', border: '1px solid rgba(var(--c-rose), 0.2)',
                            borderRadius: 'var(--radius-sm)', color: 'var(--accent-rose-light)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 5,
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                        {isSelected ? (
                          <span className="badge badge-lime" style={{ fontSize: '0.7rem' }}>
                            Active Focus
                          </span>
                        ) : (
                          <span className="badge badge-muted" style={{ fontSize: '0.7rem' }}>
                            Click to select
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status Tags */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                      {project.has_baseline ? (
                        <span className={`badge ${project.baseline_is_estimated ? 'badge-amber' : 'badge-mint'}`}>
                          {project.baseline_is_estimated ? 'Baseline (Estimated)' : `Baseline (${project.baseline_source_type?.toUpperCase()})`}
                        </span>
                      ) : (
                        <span className="badge badge-muted">
                          No Baseline Yet
                        </span>
                      )}

                      {project.n_bills > 0 ? (
                        <span className="badge badge-lime">
                          {project.n_bills} {project.n_bills === 1 ? 'Bill' : 'Bills'} Logged ({project.latest_bill_period})
                        </span>
                      ) : (
                        <span className="badge badge-muted">
                          0 Bills Logged
                        </span>
                      )}

                      {project.has_phase1_record && (
                        <span className="badge badge-cyan">
                          Phase 1 Model
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions / Jump to Phases */}
                  <div
                    style={{
                      borderTop: '1px solid rgba(var(--c-overlay), 0.06)',
                      paddingTop: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 6 }}>
                      {project.has_phase1_record && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            selectProject(project.project_id)
                            onNavigatePhase('phase1')
                          }}
                          className="btn-secondary"
                          style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                          title="View & Edit Phase 1 Conceptual Estimate"
                        >
                          Phase 1
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          selectProject(project.project_id)
                          onNavigatePhase('phase3')
                        }}
                        className="btn-secondary"
                        style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                        title="View Live Tracking, Bills & Chat"
                      >
                        Tracking & Chat
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          selectProject(project.project_id)
                          onNavigatePhase('phase2')
                        }}
                        className="btn-secondary"
                        style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                        title="Upload a BOQ or Work Order for this project"
                      >
                        Upload
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          selectProject(project.project_id)
                          onNavigatePhase('phase4')
                        }}
                        className="btn-secondary"
                        style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                        title="Review Lower-Carbon Swaps & Audit Log"
                      >
                        Swaps
                      </button>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        selectProject(project.project_id)
                        onNavigatePhase(project.has_baseline ? 'phase3' : 'phase1')
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: isSelected ? 'var(--accent-lime)' : 'var(--accent-lime)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <span>Open</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <SaveProjectNameModal
        isOpen={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        projectId={renameTarget?.project_id}
        initialName={renameTarget?.project_name || ''}
      />

      {/* Delete confirmation -- deliberately its own small modal, not a
          native browser confirm(), to match the app's own dialog style
          and to state plainly that this removes every phase's data for
          the project, not just this card. */}
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
              This permanently deletes <strong style={{ color: 'var(--text-primary)' }}>"{deleteTarget.project_name}"</strong> --
              its conceptual estimate, baseline, every logged bill, and its swap/audit history. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary" disabled={isDeleting}>
                Cancel
              </button>
              <button type="button" onClick={handleConfirmDelete} className="btn-danger" disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
