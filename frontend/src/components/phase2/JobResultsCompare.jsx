import React, { useState } from 'react'
import { FileSpreadsheet, FileText, Loader2, CheckCircle2, XCircle, LayoutDashboard, Layers } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import SaveProjectNameModal from '../shared/SaveProjectNameModal'
import JobCalculationDashboard from './JobCalculationDashboard'

const STATUS_META = {
  queued: { label: 'Queued', color: '#64748b', icon: Loader2, spin: false },
  running: { label: 'Calculating...', color: '#f59e0b', icon: Loader2, spin: true },
  succeeded: { label: 'Done', color: '#3182CE', icon: CheckCircle2, spin: false },
  failed: { label: 'Failed', color: '#f43f5e', icon: XCircle, spin: false },
}

/**
 * UX refinement (Phase C): shows recent BOQ/WO background jobs
 * side-by-side, each with its own status and (once succeeded) a compact
 * KPI summary straight from job_store.JobRecord.result_summary -- no
 * extra API call needed just to compare jobs. "View Dashboard" lazily
 * fetches the complete result (GET /uploads/jobs/{id}/result, line items
 * included) only for the one job the user actually opens, and renders it
 * in JobCalculationDashboard.jsx's full detail view.
 *
 * "Use as Baseline" is the locked "independent, you choose" decision in
 * practice: nothing here ever merges a BOQ and WO job's numbers -- the
 * user explicitly picks ONE job's result to become a project's Phase 3
 * baseline (POST /uploads/jobs/{id}/use-as-baseline, which reuses
 * phase3.baseline_from_boq_result/baseline_from_wo_result unchanged).
 */
export default function JobResultsCompare({ jobs }) {
  const { activeCompanyId, activeProjectId, addToast, loadProjects, selectProject, navigate } = useProject()
  // UX refinement: "after the upload i want to view the details of the
  // calculation in a dashboard format" -- dashboardJobId is which job's
  // full-detail modal (JobCalculationDashboard) is currently open, if
  // any. detailsByJob caches each job's full result (GET
  // /uploads/jobs/{id}/result) once fetched, so re-opening the same
  // job's dashboard doesn't re-fetch it.
  const [dashboardJobId, setDashboardJobId] = useState(null)
  const [detailsByJob, setDetailsByJob] = useState({})
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [baselineTargetJob, setBaselineTargetJob] = useState(null) // job needing a project name before it can be baselined
  const [applyingJobId, setApplyingJobId] = useState(null)

  if (!jobs || jobs.length === 0) return null

  const openDashboard = async (job) => {
    setDashboardJobId(job.job_id)
    if (!detailsByJob[job.job_id] && job.status === 'succeeded') {
      setIsLoadingDetails(true)
      try {
        const result = await api.getJobResult(job.job_id, activeCompanyId)
        setDetailsByJob((prev) => ({ ...prev, [job.job_id]: result }))
      } catch (err) {
        addToast(`Could not load details: ${err.message}`, 'error')
        setDashboardJobId(null)
      } finally {
        setIsLoadingDetails(false)
      }
    }
  }

  const dashboardJob = jobs.find((j) => j.job_id === dashboardJobId) || null
  const dashboardResult = dashboardJobId ? detailsByJob[dashboardJobId] : null

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
      addToast(`"${job.source_filename}" recorded as the project's baseline`, 'success', 8000, {
        label: 'View Dashboard',
        onClick: () => {
          selectProject(projectId)
          navigate('phase3')
        },
      })
      selectProject(projectId)
      await loadProjects(activeCompanyId)
    } catch (err) {
      addToast(`Failed to record baseline: ${err.message}`, 'error')
    } finally {
      setApplyingJobId(null)
    }
  }

  const handleUseAsBaseline = (job) => {
    if (activeProjectId) {
      applyAsBaseline(job, activeProjectId)
    } else {
      // No project selected yet -- this job's result needs a home. Ask
      // for a name, which mints a fresh project_id (Phase A's POST
      // /projects), then immediately attach this job's result to it.
      setBaselineTargetJob(job)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>Recent Uploads</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        {jobs.map((job) => {
          const meta = STATUS_META[job.status]
          const StatusIcon = meta.icon
          const summary = job.result_summary
          const isLoadingThisDashboard = isLoadingDetails && dashboardJobId === job.job_id

          return (
            <div key={job.job_id} className="glass-panel" style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {job.kind === 'boq' ? <FileSpreadsheet size={16} color="#3182CE" /> : <FileText size={16} color="#3182CE" />}
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f8fafc' }}>{job.source_filename}</span>
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600, color: meta.color }}>
                  <StatusIcon size={13} className={meta.spin ? 'spin' : ''} />
                  {meta.label}
                </span>
              </div>

              {job.status === 'failed' && (
                <p style={{ fontSize: '0.78rem', color: '#f43f5e', lineHeight: 1.4 }}>{job.error}</p>
              )}

              {summary && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                    <div>
                      <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' }}>Total Carbon</span>
                      <div className="tabular-nums" style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>
                        {summary.total_gwp_tonnes_co2e?.toLocaleString(undefined, { maximumFractionDigits: 1 })}{' '}
                        <span style={{ fontSize: '0.7rem', color: '#3182CE' }}>t CO&sub2;e</span>
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' }}>Coverage</span>
                      <div className="tabular-nums" style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>
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
                    {/* Product decision: "Use as Baseline" only for Work
                        Order uploads, never for a BOQ upload -- a Work
                        Order is a finalized/contracted document, a BOQ is
                        not, so only a WO should be able to become the
                        fixed benchmark a project is measured against. */}
                    {job.kind === 'wo' && (
                      <button
                        onClick={() => handleUseAsBaseline(job)}
                        disabled={applyingJobId === job.job_id}
                        className="btn-primary"
                        style={{ fontSize: '0.72rem', padding: '6px 12px', flex: 1 }}
                      >
                        <Layers size={13} />
                        <span>{applyingJobId === job.job_id ? 'Saving...' : 'Use as Baseline'}</span>
                      </button>
                    )}
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

      {dashboardJob && dashboardResult && (
        <JobCalculationDashboard
          job={dashboardJob}
          result={dashboardResult}
          onClose={() => setDashboardJobId(null)}
        />
      )}
    </div>
  )
}