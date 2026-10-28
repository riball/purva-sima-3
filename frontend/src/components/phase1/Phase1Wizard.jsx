import React from 'react'
import { Plus } from 'lucide-react'
import { Phase1FormProvider, usePhase1Form } from './Phase1FormContext'
import WizardProgress from './WizardProgress'
import MandatoryStep from './steps/MandatoryStep'
import Tier2Step from './steps/Tier2Step'
import Tier3Step from './steps/Tier3Step'
import ReviewStep from './steps/ReviewStep'
import ResultsStep from './steps/ResultsStep'

/**
 * UX refinement (Phase B): replaces the old single-page Phase1View.jsx
 * (mandatory + tier2 + tier3 + review table + results all crammed onto
 * one screen) with a 5-step wizard -- Basics (required) -> Typology
 * (optional) -> Materials (optional) -> Review -> Results. Same backend
 * calls throughout (POST /form, PATCH /form/{id}, POST /calculate/{id},
 * POST /refine/{id}), same auto-fill pipeline
 * (match_boq_defaults/fill_missing_fields) -- this is a UI restructure
 * only, per the plan's Phase B ("no backend contract changes").
 *
 * See Phase1FormContext.jsx for the shared state/handlers every step
 * reads from, and WizardProgress.jsx for the stepper header that keeps
 * "what goes where" visible at all times.
 */
function WizardBody() {
  const { step, savedProject, startNewProject } = usePhase1Form()

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <WizardProgress />
        {/* UX refinement: start a second, blank estimate without leaving
            this tab -- only shown once there's an actual project loaded
            (a project already in progress, or a saved one opened from
            elsewhere), since the wizard already IS a blank estimate on
            first load otherwise. */}
        {savedProject && (
          <button
            onClick={startNewProject}
            className="btn-secondary"
            style={{ fontSize: '0.78rem', padding: '7px 14px', flexShrink: 0, marginTop: -2 }}
            title="Start a new conceptual estimate"
          >
            <Plus size={14} />
            <span>New Estimate</span>
          </button>
        )}
      </div>
      {step === 'mandatory' && <MandatoryStep />}
      {step === 'tier2' && <Tier2Step />}
      {step === 'tier3' && <Tier3Step />}
      {step === 'review' && <ReviewStep />}
      {step === 'results' && <ResultsStep />}
    </div>
  )
}

export default function Phase1Wizard() {
  return (
    <Phase1FormProvider>
      <WizardBody />
    </Phase1FormProvider>
  )
}
