import React from 'react'
import { Check } from 'lucide-react'
import { usePhase1Form } from './Phase1FormContext'

const LABELS = {
  mandatory: 'Basics',
  tier2: 'Typology',
  tier3: 'Materials',
  review: 'Review',
  results: 'Results',
}

/**
 * UX refinement (Phase B): a small stepper header, the fix for the user's
 * core complaint -- "confusing and misleading as to what goes where."
 * Every step is visible at once, in order, so it's always clear what's
 * mandatory (step 1) versus optional refinement (steps 2-3) versus
 * output (steps 4-5). A step can be revisited by clicking it once it's
 * been reached; a not-yet-reached step is inert (not clickable) rather
 * than letting the user jump ahead of data that doesn't exist yet.
 */
export default function WizardProgress() {
  const { STEPS, step, goToStep, savedProject } = usePhase1Form()
  const currentIdx = STEPS.indexOf(step)

  return (
    // wizard-progress-steps class (index.css) makes this row horizontally
    // scrollable under 640px instead of clipping -- five whiteSpace:nowrap
    // labels in a non-wrapping flex row overflowed by ~163px at a 390px
    // viewport, with "Results" clipped off-screen entirely before this fix.
    <div className="wizard-progress-steps" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24 }}>
      {STEPS.map((s, idx) => {
        const isDone = idx < currentIdx
        const isActive = idx === currentIdx
        // review/results steps only become reachable once a project has
        // actually been submitted -- clicking ahead to them before that
        // would show an empty/broken step.
        const isReachable = idx <= currentIdx || (savedProject && idx <= STEPS.indexOf('results'))

        return (
          <React.Fragment key={s}>
            <button
              onClick={() => isReachable && goToStep(s)}
              disabled={!isReachable}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'transparent',
                border: 'none',
                cursor: isReachable ? 'pointer' : 'default',
                padding: '6px 4px',
                opacity: isReachable ? 1 : 0.4,
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  flexShrink: 0,
                  background: isActive ? 'var(--accent-lime)' : isDone ? 'rgba(var(--c-blue), 0.25)' : 'rgba(var(--c-overlay),0.06)',
                  color: isActive ? 'var(--bg-primary)' : isDone ? 'var(--accent-lime)' : 'var(--text-muted)',
                  border: isActive ? 'none' : '1px solid rgba(var(--c-overlay),0.08)',
                }}
              >
                {isDone ? <Check size={13} /> : idx + 1}
              </div>
              <span
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--text-primary)' : isDone ? 'var(--text-secondary)' : 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {LABELS[s]}
              </span>
            </button>
            {idx < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1, background: idx < currentIdx ? 'rgba(var(--c-blue), 0.4)' : 'rgba(var(--c-overlay),0.08)', minWidth: 16 }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
