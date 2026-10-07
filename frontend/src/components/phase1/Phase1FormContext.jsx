import React, { createContext, useContext, useState, useEffect } from 'react'
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

export function Phase1FormProvider({ children }) {
  const { activeCompanyId, activeProjectId, selectProject, loadProjects, addToast } = useProject()

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

  const isMandatoryValid = () => formData.gfa_value && Number(formData.gfa_value) > 0 && formData.location.trim()

  // Converts formData.gfa_value (in whatever unit formData.gfa_unit
  // currently is) to the canonical sqm figure the backend expects.
  const gfaValueToSqm = () => {
    const typed = Number(formData.gfa_value)
    return formData.gfa_unit === 'sqft' ? typed / SQM_TO_SQFT : typed
  }

  // Submits the tiered form (Tier 1/2/3 -- whatever's filled so far) and
  // runs the auto-fill + calculation pipeline, exactly as the old
  // Phase1View.jsx's handleSubmitForm did. Called either from Tier3Step's
  // final "Generate Estimate" button, or from the "Generate Estimate Now"
  // escape hatch on Tier2Step/Tier3Step.
  const handleSubmitForm = async () => {
    if (!isMandatoryValid()) {
      addToast('Please enter a valid Gross Floor Area (GFA) and location', 'error')
      setStep('mandatory')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        company_id: activeCompanyId,
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

      const resultSchema = await api.submitForm(payload)
      setSavedProject(resultSchema)
      selectProject(resultSchema.project_id)
      await loadProjects(activeCompanyId)
      addToast('Project created & gaps auto-estimated', 'success')
      setStep('review')
      await runCalculation(resultSchema.project_id)
    } catch (err) {
      addToast(`Error estimating project: ${err.message}`, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const runCalculation = async (projectId) => {
    setIsCalculating(true)
    try {
      const results = await api.calculateProject(projectId, activeCompanyId)
      setCalculationResult(results)
      addToast('Calculated carbon, cost, and benchmark', 'success')
    } catch (err) {
      addToast(`Calculation failed: ${err.message}`, 'error')
    } finally {
      setIsCalculating(false)
    }
  }

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