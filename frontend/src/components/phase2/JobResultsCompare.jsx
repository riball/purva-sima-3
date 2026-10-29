import React, { useState } from 'react'
import { FileSpreadsheet, FileText, Loader2, CheckCircle2, XCircle, LayoutDashboard, Layers, Trash2, AlertTriangle } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import SaveProjectNameModal from '../shared/SaveProjectNameModal'

const STATUS_META = {
  queued: { label: 'Queued', color: 'var(--text-muted)', icon: Loader2, spin: false },
  running: { label: 'Calculating...', color: 'var(--accent-amber)', icon: Loader2, spin: true },
  succeeded: { label: 'Done', color: 'var(--accent-lime)', icon: CheckCircle2, spin: false },
  failed: { label: 'Failed', color: 'var(--accent-rose)', icon: XCircle, spin: false },
}

/**
 * UX refinement (Phase C): shows recent BOQ/WO background jobs
 * side-by-side, each with its own status and (once succeeded) a compact
 * KPI summary straight from job_store.JobRecord.result_summary -- no
 * extra API call needed just to compare jobs. "View Dashboard" lazily
 * fetches the complete result (GET /uploads/jobs/{id}/result, line items
 * included) only for the one job the user actually opens, and renders it
 * via JobDashboardPage.jsx's full-screen detail view (see that component's
 * own docstring below for why it's a page, not a modal).
 *
 * "Use as Baseline" is the locked "independent, you choose" decision in
 * practice: nothing here ever merges a BOQ and WO job's numbers -- the
 * user explicitly picks ONE job's result to become a project's Phase 3
 * baseline (POST /uploads/jobs/{id}/use-as-baseline, which reuses
 * phase3.baseline_from_boq_result/baseline_from_wo_result unchanged).
 * Available for both BOQ and Work Order uploads -- the backend path is
 * symmetric for either kind.
 *
 * "View Dashboard" opens a dedicated full-screen page (JobDashboardPage,
 * via App.jsx's 'job-dashboard' view) rather than a modal popup -- the
 * job+result it needs are handed to ProjectContext (openJobDashboard),
 * since the full-page view is rendered with no props, same as every
 * other screen in this app's router-less navigation.
 *
 * Fix: "Use as Baseline" used to fall back to `activeProjectId` -- whatever
 * project happened to be selected elsewhere in the app -- which silently
 * overwrote that project's baseline instead of creating a new one ("mapping
 * to a random already existing project"). Now it always resolves a name
 * FIRST and always creates a fresh project from it: `jobNameMap` (passed
 * down from Phase2View, keyed by job_id to the name typed on the upload
 * form) supplies the name for a job from this page load; an older job card
 * with no name on record falls back to the SaveProjectNameModal prompt.
 * Either way, a NEW project is created via createNamedProject -- this
 * component never reuses an existing project_id for "Use as Baseline".
 *
 * "In analyze a boq page, i want to be able to delete some recent uploads"
 * -- a trash-icon button per card, confirmed via the same fixed-overlay
 * confirm-modal pattern ProjectDashboard.jsx already uses for bill/project
 * deletes (deleteBillTarget there, deleteTarget here). Permanent delete
 * (DELETE /uploads/jobs/{id}, job_store.delete_job -- removes both the
 * job record and its persisted result file, nothing soft-deleted). This
 * component owns no data-fetching of its own, so after a successful
 * delete it calls the onJobDeleted callback Phase2View.jsx passes down
 * (its own refreshJobs) rather than trying to mutate the jobs prop itself.
 */
export default function JobResultsCompare({ jobs, jobNameMap = {}, onJobDeleted }) {
  const { activeCompanyId, addToast, loadProjects, selectProject, navigate, openJobDashboard, createNamedProject } = useProject()
  // UX refinement: "after the upload i want to view the details of the
  // calculation in a dashboard format" -- detailsByJob caches each job's
  // full result (GET /uploads/jobs/{id}/result) once fetched, so
  // re-opening the same job's dashboard doesn't re-fetch it.
  // loadingJobId tracks which card's "View Dashboard" button is
  // currently fetching, purely for that button's own loading label.
  const [detailsByJob, setDetailsByJob] = useState({})
  const [loadingJobId, setLoadingJobId] = useState(null)
  const [baselineTargetJob, setBaselineTargetJob] = useState(null) // job needing a project name before it can be baselined
  const [applyingJobId, setApplyingJobId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null) // job awaiting delete confirmation
  const [isDeletingJob, setIsDeletingJob] = useState(false)

  if (!jobs || jobs.length === 0) return null

  const openDashboard = async (job) => {
    let result = detailsByJob[job.job_id]
    if (!result && job.status === 'succeeded') {
      setLoadingJobId(job.job_id)
      try {
        result = await api.getJobResult(job.job_id, activeCompanyId)
        setDetailsByJob((prev) => ({ ...prev, [job.job_id]: result }))
      } catch (err) {
        addToast(`Could not load details: ${err.message}`, 'error')
        setLoadingJobId(null)
        return
      }
      setLoadingJobId(null)
    }
    openJobDashboard(job, result)
    navigate('job-dashboard')
  }

  const applyAsBaseline = async (job, projectId) => {
    setApplyingJobId(job.job_id)
    try {
      // overwrite: true -- clicking this button IS the explicit "pick this
      // job's result as the baseline" action (see this component's own
      // docstring above), so it should replace any existing baseline the
      // same way TrackingChatHub.jsx's "Set Project Baseline" modal already
      // does (that form also always sends overwrite: true). Without this,
      // client.js's useJobAsBaseline defaults data.overwrite to undefined
      // -> false, and the backend (upload_jobs.use_job_as_baseline) rejects
      // with "already has a Phase 3 baseline recorded. Pass overwrite=True
      // to replace it." on every project that already has one -- which is
      // the bug reported: "Use as Baseline" appeared broken from this grid.
      await api.useJobAsBaseline(job.job_id, { projectId, companyId: activeCompanyId, overwrite: true })
      addToast(`"${job.source_filename}" recorded as the project's baseline`, 'success', 5000)
      selectProject(projectId)
      await loadProjects(activeCompanyId)
      // Land directly on the same Project Dashboard every other project
      // uses -- no separate "job dashboard" stop after a baseline is
      // committed. JobDashboardPage (via "View Dashboard" above) stays the
      // pre-commit review screen only.
      navigate('project-dashboard')
    } catch (err) {
      addToast(`Failed to record baseline: ${err.message}`, 'error')
    } finally {
      setApplyingJobId(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeletingJob(true)
    try {
      await api.deleteJob(deleteTarget.job_id, activeCompanyId)
      addToast(`Removed upload "${deleteTarget.source_filename}"`, 'success')
      setDeleteTarget(null)
      if (onJobDeleted) await onJobDeleted()
    } catch (err) {
      addToast(`Could not delete upload: ${err.message}`, 'error')
    } finally {
      setIsDeletingJob(false)
    }
  }

  const handleUseAsBaseline = async (job) => {
    const typedName = jobNameMap[job.job_id]
    if (typedName) {
      // Name was already typed on the upload form -- create the new
      // project right now and attach this job's result to it. Never
      // touches whatever project happens to be selected elsewhere.
      setApplyingJobId(job.job_id)
      try {
        const created = await createNamedProject(typedName, activeCompanyId)
        await applyAsBaseline(job, created.project_id)
      } catch (err) {
        // createNamedProject already toasts its own failure
        setApplyingJobId(null)
      }
    } else {
      // Older job card from a previous page load, with no name on record
      // -- fall back to the name-entry prompt, which also always creates a
      // new project (SaveProjectNameModal's projectId=null path).
      setBaselineTargetJob(job)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Recent Uploads</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        {jobs.map((job) => {
          const meta = STATUS_META[job.status]
          const StatusIcon = meta.icon
          const summary = job.result_summary
          const isLoadingThisDashboard = loadingJobId === job.job_id

          return (
            <div key={job.job_id} className="glass-panel" style={{ padding: 20 }}>
              {/* Bug found while testing against a real filename
                  ("Provident_Ecopolitan_WO_KPIL.pdf" -- one long
                  underscore-joined run with no space for the browser to
                  wrap on): with no minWidth:0/overflow constraint on the
                  filename, a long unbroken name pushed this whole row
                  past the card's width, shoving the status badge AND the
                  delete button out of view entirely -- not just visually
                  crowded, genuinely unclickable. The filename now
                  truncates with an ellipsis (full name still available
                  via the title attribute) and the status+delete group
                  gets flexShrink:0 so it's never the thing that gives. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }} title={job.source_filename}>
                  {job.kind === 'boq' ? <FileSpreadsheet size={16} color="var(--accent-lime)" style={{ flexShrink: 0 }} /> : <FileText size={16} color="var(--accent-lime)" style={{ flexShrink: 0 }} />}
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{job.source_filename}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600, color: meta.color, whiteSpace: 'nowrap' }}>
                    <StatusIcon size={13} className={meta.spin ? 'spin' : ''} />
                    {meta.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(job)}
                    title="Delete this upload"
                    aria-label="Delete this upload"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-rose)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-rose) 12%, transparent)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {job.status === 'failed' && (
                <p style={{ fontSize: '0.78rem', color: 'var(--accent-rose)', lineHeight: 1.4 }}>{job.error}</p>
              )}

              {summary && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                    <div>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Carbon</span>
                      <div className="tabular-nums" style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {summary.total_gwp_tonnes_co2e?.toLocaleString(undefined, { maximumFractionDigits: 1 })}{' '}
                        <span style={{ fontSize: '0.7rem', color: 'var(--accent-lime)' }}>t CO₂e</span>
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Coverage</span>
                      <div className="tabular-nums" style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {summary.coverage_pct?.toFixed(1) ?? '-'}%
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button
                      onClick={() => openDashboard(job)}
                      disabled={isLoadingThisDashboard}
                      className="btn-secondary"
                      style={{ fontSize: '0.72rem', padding: '6px 10px', flex: 1 }}
                    >
                      <LayoutDashboard size={13} />
                      <span>{isLoadingThisDashboard ? 'Loading...' : 'View Dashboard'}</span>
                    </button>
                    <button
                      onClick={() => handleUseAsBaseline(job)}
                      disabled={applyingJobId === job.job_id}
                      className="btn-primary"
                      style={{ fontSize: '0.72rem', padding: '6px 12px', flex: 1 }}
                    >
                      <Layers size={13} />
                      <span>{applyingJobId === job.job_id ? 'Saving...' : 'Use as Baseline'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      <SaveProjectNameModal
        isOpen={!!baselineTargetJob}
        onClose={() => setBaselineTargetJob(null)}
        projectId={null}
        onSaved={(entry) => applyAsBaseline(baselineTargetJob, entry.project_id)}
      />

      {/* Delete-upload confirmation -- same fixed-overlay pattern as
          ProjectDashboard.jsx's deleteBillTarget modal. */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(var(--c-black), 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <AlertTriangle size={20} color="var(--accent-rose-light)" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Delete this upload?</h3>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 22, lineHeight: 1.5 }}>
              This permanently removes{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deleteTarget.source_filename}"</strong> and its calculated
              result. Any project this upload was already saved as a baseline for is untouched. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary" disabled={isDeletingJob}>Cancel</button>
              <button type="button" onClick={handleConfirmDelete} className="btn-danger" disabled={isDeletingJob}>
                {isDeletingJob ? 'Deleting...' : 'Delete Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
