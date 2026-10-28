import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'

/**
 * UX refinement (Phase B): local (not global) context carrying Phase 1's
 * form/review/results state across the new wizard's steps, so
 * MandatoryStep/Tier2Step/Tier3Step/ReviewStep/ResultsStep don't need
 * prop-drilling through Phase1Wizard.jsx. This is the SAME state and the
 * SAME API calls the old single-page Phase1View.jsx made (POST /form,
 * PATCH /form/{id}, POST /calculate/{id}, POST /refine/{id}) -- nothing
 * about the backend contract changed, only how the UI sequences the
 * user through it. See the plan's Phase B section: "no backend contract
 * changes beyond Phase A's registration hook."
 *
 * Conceptual Estimate single-page rebuild: this same context now also
 * backs ConceptualEstimatePage.jsx, where every field is visible and
 * editable at once instead of gated behind per-step "Continue"/"Generate"
 * buttons. scheduleSync() below is what makes that feel "live" against a
 * REAL backend call (unlike the mockup's free client-side useMemo) --
 * see its own docstring for why POST /form can only ever be called once
 * per project.
 */
const Phase1FormContext = createContext(null)

const STEPS = ['mandatory', 'tier2', 'tier3', 'review', 'results']

// Pulled out to a standalone constant (rather than inline in useState)
// so startNewProject() below can reset to the exact same blank slate the
// provider mounts with -- one definition of "blank", not two that could
// silently drift apart.
// GFA sqm<->sqft toggle: same conversion constant as the backend's own
// SQM_TO_SQFT (calculation_engine.py), duplicated here rather than
// fetched, since it's a fixed unit-conversion factor, not app data.
export const SQM_TO_SQFT = 10.7639

// Sanity ceiling on GFA input -- there was no upper bound anywhere
// (client or server), so a fat-fingered extra digit or two (e.g.
// 999999999999) sailed straight through the whole wizard and produced a
// "successful" results screen with nonsense numbers like "252,275,725,456.3
// Tonnes CO2e" and no warning at all. 10,000,000 sqm (~107M sqft) is
// deliberately generous -- well above even the largest real megaprojects --
// so it only catches genuine fat-finger/garbage input, never a real project.
export const MAX_GFA_SQM = 10_000_000

const BLANK_FORM_DATA = {
  project_name: '',
  // gfa_value is whatever's typed, in whichever unit gfa_unit currently
  // is -- converted to the canonical sqm figure (gfa_sqm, "always stored
  // in sqm internally" per the schema's own convention) only at submit
  // time, in handleSubmitForm below. Kept separate from a converted
  // "display value" so toggling units mid-edit never fights with what's
  // still being typed.
  gfa_value: '',
  gfa_unit: 'sqm', // 'sqm' | 'sqft'
  location: 'Bengaluru, Karnataka',
  // structural_system_type removed from Phase 1 per supervisor feedback --
  // it never affected the calculated carbon total (see
  // calculation_engine.py), only which reference BOQ got borrowed to fill
  // gaps, which now runs unfiltered by structural system instead.
  typology: 'residential',
  num_floors: '14',
  has_basement: true,
  basement_count: '1',
  foundation_type: 'raft',
  finish_spec_level: 'standard',
  parking_type: 'basement',
  parking_area_sqm: '',
  cement_type: 'PPC',
  concrete_grade_mix: 'M30',
  steel_reinforcement_ratio_kg_per_sqm: '',
  facade_type: 'AAC block + texture paint',
  glazing_pct: '25',
  mep_complexity: 'standard',
  green_cert_target: 'none',
  site_condition: 'normal_soil',
}

// Extracted from the inline object handleSubmitForm used to build inline --
// scheduleSync() below needs the exact same shape for its PATCH calls, so
// this is the one definition both paths share (POST /form and
// PATCH /form/{id} both accept this same FormSubmission shape). A field
// left blank in formData becomes `undefined` here, which JSON.stringify
// drops from the request body entirely -- that's what lets PATCH's
// exclude_unset semantics leave an untouched field's own
// boq-matched/llm-estimated provenance alone instead of overwriting it.
function buildFormPayload(formData, companyId, gfaValueToSqm) {
  return {
    company_id: companyId,
    project_name: formData.project_name.trim() || undefined,
    gfa_sqm: gfaValueToSqm(),
    location: formData.location.trim() || undefined,
    typology: formData.typology || undefined,
    num_floors: formData.num_floors ? Number(formData.num_floors) : undefined,
    has_basement: formData.has_basement,
    basement_count: formData.basement_count ? Number(formData.basement_count) : undefined,
    foundation_type: formData.foundation_type || undefined,
    finish_spec_level: formData.finish_spec_level || undefined,
    parking_type: formData.parking_type || undefined,
    parking_area_sqm: formData.parking_area_sqm ? Number(formData.parking_area_sqm) : undefined,
    cement_type: formData.cement_type || undefined,
    concrete_grade_mix: formData.concrete_grade_mix || undefined,
    steel_reinforcement_ratio_kg_per_sqm: formData.steel_reinforcement_ratio_kg_per_sqm
      ? Number(formData.steel_reinforcement_ratio_kg_per_sqm)
      : undefined,
    facade_type: formData.facade_type || undefined,
    glazing_pct: formData.glazing_pct ? Number(formData.glazing_pct) : undefined,
    mep_complexity: formData.mep_complexity || undefined,
    green_cert_target: formData.green_cert_target || undefined,
    site_condition: formData.site_condition || undefined,
  }
}

export function Phase1FormProvider({ children }) {
  const { activeCompanyId, activeProjectId, selectProject, loadProjects, addToast, navigate, projects } = useProject()

  const [step, setStep] = useState('mandatory')

  const [formData, setFormData] = useState(BLANK_FORM_DATA)

  const [savedProject, setSavedProject] = useState(null)
  const [reviewFields, setReviewFields] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPatching, setIsPatching] = useState(false)
  const [isCalculating, setIsCalculating] = useState(false)
  const [calculationResult, setCalculationResult] = useState(null)

  const [showRefineModal, setShowRefineModal] = useState(false)
  const [refineFile, setRefineFile] = useState(null)
  const [isRefining, setIsRefining] = useState(false)

  const [showSaveNameModal, setShowSaveNameModal] = useState(false)

  // Conceptual Estimate single-page rebuild: live-sync machinery.
  // syncRequestIdRef guards against a stale PATCH/calculate response
  // landing after a newer edit has already started its own sync cycle
  // (the classic debounced-network-call race) -- each sync cycle stamps
  // its own id, and a response is applied only if it's still the latest.
  const syncTimerRef = useRef(null)
  const syncRequestIdRef = useRef(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isLockingBaseline, setIsLockingBaseline] = useState(false)

  // formDataRef always mirrors the LATEST formData, kept in sync via the
  // effect below. This exists purely so scheduleSync()'s setTimeout
  // callback (which fires up to 700ms after the keystroke that scheduled
  // it, by which point several more renders -- and keystrokes -- may
  // have happened) reads the truly-current form state instead of the
  // stale `formData` closure captured at schedule time, which would
  // otherwise always be missing whatever was typed most recently.
  const formDataRef = useRef(formData)
  useEffect(() => {
    formDataRef.current = formData
  }, [formData])

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [])

  // Load an existing project when one is already selected (e.g. opened
  // from the Projects menu) -- same effect the old Phase1View.jsx had,
  // just also jumps straight to the results step instead of showing the
  // mandatory-fields step for a project that's already been calculated.
  useEffect(() => {
    if (!activeProjectId) return

    const fetchExistingProject = async () => {
      try {
        const schema = await api.getForm(activeProjectId, activeCompanyId)
        if (schema) {
          setSavedProject(schema)
          populateFormFromSchema(schema)
          if (schema.mandatory?.gfa_sqm?.value) {
            setStep('results')
            runCalculation(schema.project_id)
          }
        }
      } catch (err) {
        console.log('No Phase 1 form record for project:', err.message)
      }
    }

    fetchExistingProject()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, activeCompanyId])

  const populateFormFromSchema = (schema) => {
    setFormData((prev) => ({
      ...prev,
      project_name: schema.project_name || '',
      // Backend always returns gfa_sqm in sqm -- always populate the
      // display field back in sqm too (unit resets to 'sqm' on load),
      // simplest and most predictable when reopening a saved project.
      gfa_value: schema.mandatory?.gfa_sqm?.value || '',
      gfa_unit: 'sqm',
      location: schema.mandatory?.location?.value || '',
      typology: schema.tier2?.typology?.value || 'residential',
      num_floors: schema.tier2?.num_floors?.value || '',
      has_basement: schema.tier2?.has_basement?.value ?? true,
      basement_count: schema.tier2?.basement_count?.value || '',
      foundation_type: schema.tier2?.foundation_type?.value || 'raft',
      finish_spec_level: schema.tier2?.finish_spec_level?.value || 'standard',
      parking_type: schema.tier2?.parking_type?.value || 'basement',
      parking_area_sqm: schema.tier2?.parking_area_sqm?.value || '',
      cement_type: schema.tier3?.cement_type?.value || 'PPC',
      concrete_grade_mix: schema.tier3?.concrete_grade_mix?.value || 'M30',
      steel_reinforcement_ratio_kg_per_sqm: schema.tier3?.steel_reinforcement_ratio_kg_per_sqm?.value || '',
      facade_type: schema.tier3?.facade_type?.value || '',
      glazing_pct: schema.tier3?.glazing_pct?.value || '',
      mep_complexity: schema.tier3?.mep_complexity?.value || 'standard',
      green_cert_target: schema.tier3?.green_cert_target?.value || '',
      site_condition: schema.tier3?.site_condition?.value || 'normal_soil',
    }))
  }

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  // Converts data.gfa_value (in whatever unit data.gfa_unit currently is)
  // to the canonical sqm figure the backend expects. Takes `data` rather
  // than reading the `formData` closure directly so callers that need the
  // truly-current value (scheduleSync's debounced callback, via
  // formDataRef) aren't stuck with whatever formData looked like when
  // they were defined -- see formDataRef's own comment above.
  const gfaValueToSqmFor = (data) => {
    const typed = Number(data.gfa_value)
    return data.gfa_unit === 'sqft' ? typed / SQM_TO_SQFT : typed
  }
  const gfaValueToSqm = () => gfaValueToSqmFor(formData)

  const isMandatoryValidFor = (data) => {
    if (!data.gfa_value || !data.location.trim()) return false
    const sqm = gfaValueToSqmFor(data)
    return Number.isFinite(sqm) && sqm > 0 && sqm <= MAX_GFA_SQM
  }
  const isMandatoryValid = () => isMandatoryValidFor(formData)

  // Submits the tiered form (Tier 1/2/3 -- whatever's filled so far) and
  // runs the auto-fill + calculation pipeline, exactly as the old
  // Phase1View.jsx's handleSubmitForm did. Called either from Tier3Step's
  // final "Generate Estimate" button, or from the "Generate Estimate Now"
  // escape hatch on Tier2Step/Tier3Step.
  const handleSubmitForm = async (opts = {}) => {
    const { silent = false, data = formData } = opts
    if (!isMandatoryValidFor(data)) {
      if (!silent) addToast('Please enter a valid Gross Floor Area (GFA) and location', 'error')
      setStep('mandatory')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = buildFormPayload(data, activeCompanyId, () => gfaValueToSqmFor(data))

      const resultSchema = await api.submitForm(payload)
      setSavedProject(resultSchema)
      selectProject(resultSchema.project_id)
      await loadProjects(activeCompanyId)
      if (!silent) addToast('Project created & gaps auto-estimated', 'success')
      setStep('review')
      await runCalculation(resultSchema.project_id, { silent })
    } catch (err) {
      addToast(`Error estimating project: ${err.message}`, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const runCalculation = async (projectId, opts = {}) => {
    const { requestId, silent = false } = opts
    setIsCalculating(true)
    try {
      const results = await api.calculateProject(projectId, activeCompanyId)
      if (requestId !== undefined && requestId !== syncRequestIdRef.current) return // stale -- a newer edit has since started its own sync
      setCalculationResult(results)
      if (!silent) addToast('Calculated carbon, cost, and benchmark', 'success')
    } catch (err) {
      addToast(`Calculation failed: ${err.message}`, 'error')
    } finally {
      setIsCalculating(false)
    }
  }

  // Conceptual Estimate single-page rebuild: called from every field's
  // onChange (after handleChange) instead of waiting for a step's
  // explicit "Continue"/"Generate Estimate" button. Debounces ~700ms so
  // a real backend round-trip doesn't fire on every keystroke, then:
  //   - no project yet -> create it (POST /form, via the existing
  //     handleSubmitForm -- this is the ONLY time POST /form may be
  //     called for this project; see buildFormPayload's own comment on
  //     why a second call would mint a brand-new project_id instead of
  //     updating this one).
  //   - project already exists -> PATCH /form/{id} with the current
  //     full form snapshot (same payload shape, same semantics
  //     ReviewStep.jsx's handleApplyPatch already relies on: every field
  //     included is unconditionally marked user-entered/100% confidence,
  //     fields left blank in formData are omitted and so left untouched),
  //     then recalculate.
  const scheduleSync = () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      const myRequestId = ++syncRequestIdRef.current
      runSync(myRequestId)
    }, 700)
  }

  const runSync = async (myRequestId) => {
    const data = formDataRef.current // the truly-current snapshot, not the stale closure -- see formDataRef's comment

    if (!savedProject) {
      if (!isMandatoryValidFor(data)) return
      await handleSubmitForm({ silent: true, data })
      return
    }

    if (!isMandatoryValidFor(data)) return // a mandatory field was cleared mid-edit -- nothing to sync yet

    setIsSyncing(true)
    try {
      const payload = buildFormPayload(data, activeCompanyId, () => gfaValueToSqmFor(data))
      const updated = await api.patchForm(savedProject.project_id, payload, activeCompanyId)
      if (myRequestId !== syncRequestIdRef.current) return // a newer edit has since started its own sync
      setSavedProject(updated)
      await runCalculation(updated.project_id, { requestId: myRequestId, silent: true })
    } catch (err) {
      if (myRequestId !== syncRequestIdRef.current) return
      addToast(`Couldn't sync your changes: ${err.message}`, 'error')
    } finally {
      if (myRequestId === syncRequestIdRef.current) setIsSyncing(false)
    }
  }

  // Locks this project's Phase 1 estimate as its Phase 3 baseline --
  // reuses the ALREADY-WORKING backend path confirmed during this
  // feature's research: POST /phase3/projects/{id}/baseline with
  // source_type='phase1_estimate' takes no file, reads this project's
  // existing Phase 1 record, and reuses calculate_embodied_carbon()/
  // estimate_cost() to build the baseline (phase3.py's
  // baseline_from_phase1_estimate). overwrite=true is only ever passed
  // for the "Update & re-lock" affordance on a project whose own
  // baseline is already phase1_estimate-sourced -- never for a real
  // boq/wo baseline, which this page must never silently replace.
  const handleLockBaseline = async (overwrite = false) => {
    if (!savedProject) return
    setIsLockingBaseline(true)
    try {
      await api.recordBaseline(savedProject.project_id, {
        sourceType: 'phase1_estimate',
        companyId: activeCompanyId,
        overwrite,
      })
      await loadProjects(activeCompanyId)
      selectProject(savedProject.project_id)
      addToast('Baseline locked -- project is now tracked', 'success')
      navigate('project-dashboard')
    } catch (err) {
      addToast(`Failed to lock baseline: ${err.message}`, 'error')
    } finally {
      setIsLockingBaseline(false)
    }
  }

  // This project's own entry in the global project list, if it's been
  // created yet -- used by ConceptualEstimatePage.jsx to decide whether
  // "Lock Baseline" should still be the primary action (no baseline yet,
  // or an existing phase1_estimate one that can be re-locked) or has
  // been superseded by a real boq/wo baseline recorded elsewhere.
  const projectSummary = savedProject ? projects.find((p) => p.project_id === savedProject.project_id) : null

  const handleApplyPatch = async () => {
    if (!savedProject || Object.keys(reviewFields).length === 0) return

    setIsPatching(true)
    try {
      const updated = await api.patchForm(savedProject.project_id, reviewFields, activeCompanyId)
      setSavedProject(updated)
      setReviewFields({})
      addToast('User corrections applied unconditionally (Confidence: 100%)', 'success')
      await runCalculation(savedProject.project_id)
    } catch (err) {
      addToast(`Failed to apply corrections: ${err.message}`, 'error')
    } finally {
      setIsPatching(false)
    }
  }

  const handleRefineSubmit = async () => {
    if (!refineFile || !savedProject) return

    setIsRefining(true)
    try {
      const res = await api.refineProject(savedProject.project_id, refineFile, activeCompanyId)
      setSavedProject(res.project)
      setShowRefineModal(false)
      setRefineFile(null)
      addToast(res.message || 'Project refined with own BOQ!', 'success')
      await runCalculation(savedProject.project_id)
    } catch (err) {
      addToast(`Refinement failed: ${err.message}`, 'error')
    } finally {
      setIsRefining(false)
    }
  }

  // UX refinement: "I want to be able to add new project from the
  // conceptual estimate tab." Without this, opening Phase 1 always shows
  // whichever project happens to be selected in the global context (and
  // the effect above auto-loads it) -- there was no way to start a
  // second, blank estimate without first going to the Projects tab and
  // clearing the selection some other way. This clears BOTH halves of
  // that state at once: the global activeProjectId (selectProject(null),
  // so nothing re-loads behind this reset) and every piece of local
  // wizard state, back to the exact blank slate the provider itself
  // mounts with.
  const startNewProject = () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncRequestIdRef.current += 1 // invalidates any in-flight sync for the project being left behind
    selectProject(null)
    setSavedProject(null)
    setFormData(BLANK_FORM_DATA)
    setReviewFields({})
    setCalculationResult(null)
    setStep('mandatory')
    addToast('Starting a new conceptual estimate', 'success', 2500)
  }

  const goToStep = (target) => setStep(target)
  const goNext = () => {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }
  const goBack = () => {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  return (
    <Phase1FormContext.Provider
      value={{
        STEPS,
        step,
        goToStep,
        goNext,
        goBack,
        formData,
        handleChange,
        isMandatoryValid,
        savedProject,
        reviewFields,
        setReviewFields,
        isSubmitting,
        isPatching,
        isCalculating,
        calculationResult,
        handleSubmitForm,
        runCalculation,
        handleApplyPatch,
        showRefineModal,
        setShowRefineModal,
        refineFile,
        setRefineFile,
        isRefining,
        handleRefineSubmit,
        showSaveNameModal,
        setShowSaveNameModal,
        startNewProject,
        scheduleSync,
        isSyncing,
        handleLockBaseline,
        isLockingBaseline,
        projectSummary,
      }}
    >
      {children}
    </Phase1FormContext.Provider>
  )
}

export function usePhase1Form() {
  const context = useContext(Phase1FormContext)
  if (!context) {
    throw new Error('usePhase1Form must be used within a Phase1FormProvider')
  }
  return context
}
