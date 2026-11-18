import React, { useState, useEffect, useCallback } from 'react'
import { FileSpreadsheet, FileText, Upload, X, HelpCircle, Sliders, Clock, Plus, AlertTriangle } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import JobResultsCompare from './JobResultsCompare'

/**
 * UX refinement (Phase C): replaces the old single-file, blocking upload
 * flow with a dual dropzone (BOQ + Work Order) that queues up to two
 * INDEPENDENT background jobs (POST /uploads/combined) and returns
 * immediately -- "upload should happen in a way where i can browse other
 * parts of the project while the calculation can take place in the
 * background". Nothing here ever merges a BOQ and WO result; the user
 * picks which (if either) becomes a project's baseline from
 * JobResultsCompare, once a job succeeds.
 *
 * The What-If Substitution Sandbox is preserved unchanged from the old
 * synchronous flow -- it still runs instantly against whatever .xlsx BOQ
 * file is currently sitting in the BOQ dropzone (POST /boq-carbon/substitute),
 * independent of the background job queue.
 */
export default function Phase2View() {
  const { activeCompanyId, addToast, activeJobs } = useProject()

  // Dual dropzone state -- either or both may be filled before submitting
  // One or more BOQ workbooks, calculated together as ONE combined BOQ.
  // boqInspect/sheetPick are aligned with boqFiles: what sheets each file
  // has (from POST /uploads/boq/inspect) and which of them are ticked.
  // sheetPick[i] is null until that file has been inspected.
  const [boqFiles, setBoqFiles] = useState([])
  const [boqInspect, setBoqInspect] = useState([])
  const [sheetPick, setSheetPick] = useState([])
  const [boqWarnings, setBoqWarnings] = useState([])
  const [isInspecting, setIsInspecting] = useState(false)
  const boqFile = boqFiles.length === 1 ? boqFiles[0] : null // What-If Sandbox works on a single workbook
  const [woFile, setWoFile] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [floorAreaSqm, setFloorAreaSqm] = useState('25000')
  const [floorAreaBasis, setFloorAreaBasis] = useState('built_up_total')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fix: "Use as Baseline" used to silently reuse whatever project happened
  // to be selected elsewhere in the app ("mapping to a random already
  // existing project and not creating a new one"). The real fix is to name
  // the project right here, at upload time, so "Use as Baseline" always has
  // a name to create a NEW project under. jobNameMap keys a job_id to the
  // name that was typed when that upload was submitted -- one submission's
  // BOQ and WO jobs share the same typed name, since they're the same
  // upload. Persisted in state (not just local var) so it survives the
  // re-render when refreshJobs() pulls the new job in.
  const [jobNameMap, setJobNameMap] = useState({})

  // Recent jobs (all statuses) for this company -- JobResultsCompare renders
  // these as cards. activeJobs (from ProjectContext, already polling every
  // ~5s) tells us when to re-pull the full list so a job that just finished
  // shows up here with its result, not just as a toast.
  const [allJobs, setAllJobs] = useState([])
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)

  const refreshJobs = useCallback(async () => {
    if (!activeCompanyId) return
    setIsLoadingJobs(true)
    try {
      const jobs = await api.listJobs(activeCompanyId, false)
      setAllJobs(jobs)
    } catch (err) {
      console.warn('Could not load recent uploads:', err.message)
    } finally {
      setIsLoadingJobs(false)
    }
  }, [activeCompanyId])

  useEffect(() => {
    refreshJobs()
  }, [refreshJobs])

  // Re-pull whenever the number of currently-active jobs changes (a job
  // either just got queued elsewhere, or -- more importantly -- just
  // dropped out of "active" because it finished).
  const activeJobCount = activeJobs.length
  useEffect(() => {
    refreshJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobCount])

  const addBoqFiles = (fileList) => {
    const incoming = Array.from(fileList || [])
    if (incoming.length === 0) return
    const fresh = incoming.filter((f) => !boqFiles.some((p) => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified))
    if (fresh.length < incoming.length) addToast('A file that is already in the list was skipped', 'info')
    if (fresh.length === 0) return
    setBoqFiles((prev) => [...prev, ...fresh])
    setSheetPick((prev) => [...prev, ...fresh.map(() => null)])
    setBoqInspect((prev) => [...prev, ...fresh.map(() => null)])
  }

  const removeBoqFile = (idx) => {
    setBoqFiles((prev) => prev.filter((_, i) => i !== idx))
    setSheetPick((prev) => prev.filter((_, i) => i !== idx))
    setBoqInspect((prev) => prev.filter((_, i) => i !== idx))
  }

  const toggleSheet = (fileIdx, sheetName) => {
    setSheetPick((prev) =>
      prev.map((pick, i) => {
        if (i !== fileIdx || pick === null) return pick
        return pick.includes(sheetName) ? pick.filter((n) => n !== sheetName) : [...pick, sheetName]
      })
    )
  }

  // Whenever the file list or the ticked sheets change, re-read each file's
  // sheet list and the overlap warnings for exactly the ticked sheets.
  // First time a file is seen (pick === null) its default sheets get ticked.
  const pickKey = JSON.stringify(sheetPick)
  useEffect(() => {
    if (boqFiles.length === 0) {
      setBoqWarnings([])
      return undefined
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setIsInspecting(true)
      try {
        const res = await api.inspectBoqFiles(boqFiles, sheetPick)
        if (cancelled) return
        setBoqInspect(res.files)
        setBoqWarnings(res.warnings || [])
        setSheetPick((prev) => {
          if (!prev.some((p) => p === null)) return prev
          return prev.map((p, i) => (p === null ? (res.files[i]?.sheets || []).filter((sh) => sh.selected_by_default).map((sh) => sh.name) : p))
        })
      } catch (err) {
        if (!cancelled) addToast(`Could not read the BOQ file(s): ${err.message}`, 'error')
      } finally {
        if (!cancelled) setIsInspecting(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boqFiles, pickKey])

  // Substitution Simulation (unchanged, keyed off the retained boqFile)
  const [showSubSim, setShowSubSim] = useState(false)
  const [subCatalog, setSubCatalog] = useState([])
  const [selectedSubs, setSelectedSubs] = useState({})
  const [subSimResult, setSubSimResult] = useState(null)
  const [isSimulating, setIsSimulating] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (boqFiles.length === 0 && !woFile) {
      addToast('Select at least one file — a BOQ, a Work Order, or both', 'error')
      return
    }
    if (boqFiles.length > 0) {
      if (isInspecting || sheetPick.some((p) => p === null)) {
        addToast('Still reading the BOQ sheets — try again in a moment', 'info')
        return
      }
      const emptyIdx = sheetPick.findIndex((p, i) => (p || []).length === 0 && !boqInspect[i]?.error)
      if (emptyIdx !== -1) {
        addToast(`Tick at least one sheet for ${boqFiles[emptyIdx].name} (or remove that file)`, 'error')
        return
      }
      if (boqInspect.some((f) => f?.error)) {
        addToast('One of the BOQ files could not be read — remove it and try again', 'error')
        return
      }
    }
    if (!floorAreaSqm) {
      addToast('Total Built-Up Area (TBUA) is required — it is used to calculate embodied carbon per m² and as the project baseline\'s floor area', 'error')
      return
    }
    if (!projectName.trim()) {
      addToast('Project Name is required — it will be used to create the new project when you lock this in as a baseline', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await api.uploadCombined(
        { boqFiles, boqSheets: sheetPick, woFile },
        { floorAreaSqm: floorAreaSqm ? Number(floorAreaSqm) : undefined, floorAreaBasis, companyId: activeCompanyId }
      )
      const kinds = [res.boq_job_id && 'BOQ', res.wo_job_id && 'Work Order'].filter(Boolean).join(' + ')
      // Record the typed name against both returned job ids -- same upload, same name.
      const trimmedName = projectName.trim()
      setJobNameMap((prev) => {
        const next = { ...prev }
        if (res.boq_job_id) next[res.boq_job_id] = trimmedName
        if (res.wo_job_id) next[res.wo_job_id] = trimmedName
        return next
      })
      addToast(`${kinds} calculation started — it's running in the background. Explore the rest of the app; you'll get a notification the moment it's done.`, 'success', 7000)
      await refreshJobs()
      // Reset the name + files so the next upload starts clean -- each
      // submission names its own project, nothing carries over by accident.
      setProjectName('')
      setBoqFiles([])
      setSheetPick([])
      setBoqInspect([])
      setBoqWarnings([])
      setWoFile(null)
    } catch (err) {
      addToast(`Could not start calculation: ${err.message}`, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenSubstitutionSim = async () => {
    setShowSubSim(true)
    try {
      const cat = await api.getBoqCatalog()
      setSubCatalog(cat)
      const initial = {}
      cat.forEach((c) => {
        initial[c.id] = 0
      })
      setSelectedSubs(initial)
    } catch (err) {
      console.warn('Could not load substitution catalog:', err.message)
    }
  }

  const handleRunSimulation = async () => {
    if (!boqFile) return
    const requested = Object.entries(selectedSubs)
      .filter(([_, pct]) => pct > 0)
      .map(([id, pct]) => ({ substitution_id: id, user_pct: Number(pct) }))

    if (requested.length === 0) {
      addToast('Please adjust at least one substitution slider above 0%', 'error')
      return
    }

    setIsSimulating(true)
    try {
      const sim = await api.substituteBoq(boqFile, requested, {
        sheetName: sheetPick[0]?.length === 1 ? sheetPick[0][0] : undefined,
        floorAreaSqm: floorAreaSqm ? Number(floorAreaSqm) : undefined,
        floorAreaBasis: floorAreaBasis || undefined,
      })
      setSubSimResult(sim)
      addToast('Substitutions recomputed deterministically', 'success')
    } catch (err) {
      addToast(`Simulation failed: ${err.message}`, 'error')
    } finally {
      setIsSimulating(false)
    }
  }

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
          gap: 20,
          flexWrap: 'wrap',
          borderLeft: '4px solid var(--accent-mint)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="badge badge-mint">Phase 2</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--accent-lime)', fontWeight: 600 }}>
              Calculate For Real
            </span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Real BOQ & Work Order Ingestion
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', maxWidth: 640 }}>
            Upload a BOQ, a Work Order, or both at once — each is classified and computed independently in the background,
            so you're free to keep working elsewhere while it runs.
          </p>
        </div>

        {boqFile && (
          <button onClick={handleOpenSubstitutionSim} className="btn-primary" style={{ fontSize: '0.8125rem' }}>
            <Sliders size={15} />
            <span>What-If Substitution Sandbox</span>
          </button>
        )}
      </div>

      {/* Dual Dropzone Upload Form */}
      <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: 26 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, marginBottom: 20 }}>
          <BoqMultiDropzone
            files={boqFiles}
            inspect={boqInspect}
            picks={sheetPick}
            warnings={boqWarnings}
            isInspecting={isInspecting}
            onAdd={addBoqFiles}
            onRemove={removeBoqFile}
            onToggleSheet={toggleSheet}
          />
          <Dropzone
            icon={FileText}
            label="Work Order (PDF)"
            hint="Matches Activity Numbers against this company's master item-code catalog"
            accept=".pdf"
            file={woFile}
            onSelect={setWoFile}
            onClear={() => setWoFile(null)}
          />
        </div>

        {/* Area Basis Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginBottom: 20 }}>
          <div className="form-group">
            <label className="form-label">Project Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Purva Ecopolitan"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="form-input"
              style={!projectName.trim() ? { borderColor: 'rgba(var(--c-rose), 0.5)' } : undefined}
            />
            {!projectName.trim() && (
              <span style={{ fontSize: '0.7rem', color: 'var(--accent-rose)', marginTop: 4, display: 'block' }}>
                Required — used to create a new project when you lock this in as a baseline below.
              </span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Total Built-Up Area (TBUA) *</label>
            <div className="input-wrapper">
              <input
                type="number"
                step="any"
                required
                placeholder="e.g. 25000"
                value={floorAreaSqm}
                onChange={(e) => setFloorAreaSqm(e.target.value)}
                className="form-input input-with-suffix"
                style={!floorAreaSqm ? { borderColor: 'rgba(var(--c-rose), 0.5)' } : undefined}
              />
              <span className="input-suffix">m²</span>
            </div>
            {!floorAreaSqm && (
              <span style={{ fontSize: '0.7rem', color: 'var(--accent-rose)', marginTop: 4, display: 'block' }}>
                Required — used to calculate embodied carbon per m² and recorded on the project baseline.
              </span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Floor Area Basis</label>
            <select value={floorAreaBasis} onChange={(e) => setFloorAreaBasis(e.target.value)} className="form-select">
              <option value="built_up_total">Total Built-Up Area (BUA - Recommended)</option>
              <option value="net_internal_gia">Net Internal / Gross Internal Area (GIA)</option>
              <option value="carpet_saleable">Carpet / Saleable Area</option>
              <option value="other">Other Basis</option>
            </select>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(var(--c-amber), 0.08)',
            border: '1px solid rgba(var(--c-amber), 0.25)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            fontSize: '0.78rem',
            color: 'var(--accent-amber-light)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 20,
          }}
        >
          <HelpCircle size={16} style={{ flexShrink: 0 }} />
          <span>
            <strong>Floor Area Discipline:</strong> A common audit trap is dividing whole-building carbon by net apartment GIA
            (which excludes basements & parking priced in the BOQ), inflating carbon/m² up to 8.5x. Total Built-Up Area is recommended.
          </span>
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={isSubmitting || isInspecting || (boqFiles.length === 0 && !woFile) || !floorAreaSqm || !projectName.trim()}
          style={{ width: '100%', padding: '12px 20px', fontSize: '0.9375rem' }}
        >
          {isSubmitting ? 'Queuing...' : 'Start Background Calculation'}
        </button>
      </form>

      {/* Recent Uploads / Job Results */}
      {allJobs.length > 0 ? (
        <JobResultsCompare jobs={allJobs} jobNameMap={jobNameMap} onJobDeleted={refreshJobs} />
      ) : (
        !isLoadingJobs && (
          <div className="glass-panel" style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <Clock size={22} />
            <span>No uploads yet — start one above and it'll show up here the moment it's queued.</span>
          </div>
        )
      )}

      {/* Standalone What-If Substitution Sandbox Modal (unchanged) */}
      {showSubSim && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(var(--c-black), 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  What-If Material Substitution Sandbox
                </h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
                  Simulate verified lower-carbon alternatives against the uploaded BOQ file. Recomputed line-by-line for real.
                </p>
              </div>
              <button onClick={() => setShowSubSim(false)} className="btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                Close
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
              {subCatalog.map((sub) => {
                const currentPct = selectedSubs[sub.id] || 0
                return (
                  <div
                    key={sub.id}
                    style={{
                      background: 'rgba(var(--c-surf-2), 0.7)',
                      padding: 16,
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid rgba(var(--c-blue), 0.15)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{sub.substitute_label}</span>
                        <span className="badge badge-lime" style={{ fontSize: '0.65rem', marginLeft: 8 }}>
                          Max {sub.max_recommended_pct}%
                        </span>
                      </div>
                      <span className="tabular-nums" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                        {currentPct}%
                      </span>
                    </div>

                    <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.4, marginBottom: 10 }}>{sub.reasoning}</p>

                    <input
                      type="range"
                      min="0"
                      max={sub.max_recommended_pct}
                      step="5"
                      value={currentPct}
                      onChange={(e) => {
                        const val = e.target.value
                        setSelectedSubs((prev) => ({ ...prev, [sub.id]: val }))
                      }}
                      style={{ width: '100%', accentColor: 'var(--accent-lime)', cursor: 'pointer' }}
                    />
                  </div>
                )
              })}
            </div>

            <button onClick={handleRunSimulation} disabled={isSimulating} className="btn-primary" style={{ width: '100%', padding: '12px 20px', marginBottom: 20 }}>
              {isSimulating ? 'Recomputing BOQ...' : 'Recompute With Selected Substitutions'}
            </button>

            {subSimResult && (
              <div
                style={{
                  background: 'rgba(var(--c-surf-5), 0.9)',
                  padding: 20,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(var(--c-blue), 0.3)',
                }}
              >
                <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--accent-lime)', marginBottom: 12 }}>
                  Combined Substitution Impact
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Original Carbon:</span>
                    <div className="tabular-nums" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {(subSimResult.base_total_gwp_kg_co2e / 1000).toFixed(1)} t
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Substituted Carbon:</span>
                    <div className="tabular-nums" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--accent-lime-hover)' }}>
                      {(subSimResult.combined_total_gwp_kg_co2e / 1000).toFixed(1)} t
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Reduction Achieved:</span>
                    <div className="tabular-nums" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                      -{subSimResult.combined_savings_pct.toFixed(1)}% ({(subSimResult.combined_savings_kg_co2e / 1000).toFixed(1)} t)
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Dropzone({ icon: Icon, label, hint, accept, file, onSelect, onClear }) {
  const inputId = `dropzone-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div
      style={{
        border: `2px dashed ${file ? 'rgba(var(--c-blue), 0.5)' : 'rgba(var(--c-blue), 0.25)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '26px 18px',
        textAlign: 'center',
        background: file ? 'rgba(var(--c-blue), 0.06)' : 'rgba(var(--c-surf-2), 0.65)',
        cursor: 'pointer',
        transition: 'border-color var(--transition-fast), background var(--transition-fast)',
        position: 'relative',
      }}
      onClick={() => document.getElementById(inputId).click()}
    >
      <input
        type="file"
        id={inputId}
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => onSelect(e.target.files[0] || null)}
      />

      {file && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'rgba(var(--c-black),0.4)',
            border: 'none',
            borderRadius: '50%',
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          <X size={12} />
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(var(--c-blue), 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-lime)',
          }}
        >
          {file ? <Icon size={22} /> : <Upload size={22} />}
        </div>
        <div>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {file ? file.name : label}
          </span>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>{file ? 'Selected — ready to queue' : hint}</p>
        </div>
      </div>
    </div>
  )
}


function formatInr(n) {
  if (!n) return '—'
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  return `₹${Math.round(n).toLocaleString()}`
}

/**
 * Several BOQ workbooks can be added one after the other; every ticked sheet
 * of every file is calculated together as ONE BOQ. Each workbook lists all
 * its sheets with a checkbox: real BOQ tables are ticked by default, rate
 * lists / summary sheets are listed but unticked with the reason, and the
 * user can still tick any of them. Overlap warnings (e.g. a "Combined" sheet
 * that is the other sheets merged) are shown but never block the upload.
 */
function BoqMultiDropzone({ files, inspect, picks, warnings, isInspecting, onAdd, onRemove, onToggleSheet }) {
  const inputId = 'dropzone-boq-multi'
  const hasFiles = files.length > 0
  return (
    <div
      style={{
        border: `2px dashed ${hasFiles ? 'rgba(var(--c-blue), 0.5)' : 'rgba(var(--c-blue), 0.25)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '18px',
        background: hasFiles ? 'rgba(var(--c-blue), 0.06)' : 'rgba(var(--c-surf-2), 0.65)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <input
        type="file"
        id={inputId}
        accept=".xlsx,.xls"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          onAdd(e.target.files)
          e.target.value = '' // allow picking the same file again after removing it
        }}
      />

      <div
        style={{ textAlign: 'center', cursor: 'pointer' }}
        onClick={() => document.getElementById(inputId).click()}
      >
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(var(--c-blue), 0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-lime)' }}>
          {hasFiles ? <Plus size={22} /> : <Upload size={22} />}
        </div>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 6 }}>
          {hasFiles ? 'Add another BOQ' : 'Bill of Quantities'}
        </div>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
          {hasFiles
            ? 'All ticked sheets of all files are calculated together as one BOQ'
            : 'Add one or more BOQ workbooks — every BOQ sheet inside each is included'}
        </p>
      </div>

      {files.map((file, fi) => {
        const info = inspect[fi]
        const pick = picks[fi] || []
        return (
          <div key={`${file.name}-${fi}`} style={{ background: 'rgba(var(--c-black),0.12)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileSpreadsheet size={16} style={{ color: 'var(--accent-lime)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1, wordBreak: 'break-all' }}>{file.name}</span>
              <button
                type="button"
                onClick={() => onRemove(fi)}
                title="Remove this file"
                style={{ background: 'rgba(var(--c-black),0.4)', border: 'none', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', cursor: 'pointer', flexShrink: 0 }}
              >
                <X size={11} />
              </button>
            </div>

            {!info && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>Reading sheets…</p>}
            {info?.error && <p style={{ fontSize: '0.72rem', color: 'var(--accent-rose)', marginTop: 6 }}>{info.error}</p>}

            {info && !info.error && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                {info.sheets.map((sh) => {
                  const checked = pick.includes(sh.name)
                  return (
                    <label key={sh.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.75rem', cursor: 'pointer', color: checked ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      <input type="checkbox" checked={checked} onChange={() => onToggleSheet(fi, sh.name)} style={{ marginTop: 2 }} />
                      <span style={{ flex: 1 }}>
                        <strong style={{ fontWeight: 600 }}>{sh.name}</strong>
                        {sh.n_lines > 0 && (
                          <span style={{ color: 'var(--text-muted)' }}> — {sh.n_lines} lines{sh.total_amount ? ` · ${formatInr(sh.total_amount)}` : ''}</span>
                        )}
                        {sh.skip_reason && (
                          <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)' }}>Not included automatically: {sh.skip_reason}</span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {isInspecting && hasFiles && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Checking sheets for overlaps…</p>}

      {warnings.length > 0 && (
        <div style={{ border: '1px solid rgba(var(--c-amber), 0.45)', background: 'rgba(var(--c-amber), 0.08)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            <AlertTriangle size={14} style={{ color: 'var(--accent-amber)' }} /> Possible double counting
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 6 }}>You can still upload as is, or untick the repeated sheet above.</p>
        </div>
      )}
    </div>
  )
}
