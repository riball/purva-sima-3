import React from 'react'
import { ArrowRight, Zap } from 'lucide-react'
import { usePhase1Form, MAX_GFA_SQM, SQM_TO_SQFT } from '../Phase1FormContext'

/**
 * UX refinement (Phase B), step 1 of 5: ONLY the fields the backend's
 * `mandatory` block actually requires (GFA, location) plus a project
 * name -- nothing else on screen. This is the direct fix for
 * "confusing... what goes where": before, mandatory/optional/review/
 * results were all on one page; now this step can't be confused with
 * anything optional because nothing optional is visible here at all.
 *
 * Structural System was removed from this step per supervisor feedback:
 * confirmed it never changed the calculated carbon total, only which
 * reference BOQ got borrowed to fill quantity gaps (see
 * Phase1FormContext.jsx's own note).
 */
export default function MandatoryStep() {
  const { formData, handleChange, isMandatoryValid, goNext } = usePhase1Form()

  return (
    <div className="glass-panel" style={{ padding: 28, maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>Step 1 of 5 &middot; Required</span>
      </div>
      <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
        Tell us the basics
      </h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 22, lineHeight: 1.5 }}>
        Just four things to start -- the system fills in everything else from your company's own project history.
        You can refine the estimate with more detail on the next steps, or skip straight to a result.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="form-group">
          <label className="form-label">Project Name <span className="form-label-optional">(optional, but recommended -- lets you find this project again by name)</span></label>
          <input
            type="text"
            placeholder="e.g. Ecopolitan Tower B, Horizon Residency"
            value={formData.project_name}
            onChange={(e) => handleChange('project_name', e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Gross Floor Area (GFA) *</label>
          <div className="input-wrapper" style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              required
              min="1"
              max={formData.gfa_unit === 'sqft' ? Math.round(MAX_GFA_SQM * SQM_TO_SQFT) : MAX_GFA_SQM}
              step="any"
              placeholder={formData.gfa_unit === 'sqft' ? 'e.g. 269000' : 'e.g. 25000'}
              value={formData.gfa_value}
              onChange={(e) => handleChange('gfa_value', e.target.value)}
              className="form-input"
              style={{ flex: 1 }}
            />
            {/* sqm/sqft toggle -- switches the displayed unit only. The
                typed number is interpreted in whichever unit is currently
                selected; Phase1FormContext converts it to the canonical
                sqm figure at submit time. */}
            <select
              value={formData.gfa_unit}
              onChange={(e) => handleChange('gfa_unit', e.target.value)}
              className="form-select"
              style={{ width: 90, flexShrink: 0 }}
              aria-label="Gross Floor Area unit"
            >
              <option value="sqm">m&sup2;</option>
              <option value="sqft">ft&sup2;</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Location *</label>
          <input
            type="text"
            required
            placeholder="e.g. Bengaluru, Karnataka"
            value={formData.location}
            onChange={(e) => handleChange('location', e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Number of Floors <span className="form-label-optional">(optional here -- also asked on the next step)</span></label>
          <input
            type="number"
            min="1"
            placeholder="e.g. 14"
            value={formData.num_floors}
            onChange={(e) => handleChange('num_floors', e.target.value)}
            className="form-input"
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 26 }}>
        <button
          onClick={goNext}
          disabled={!isMandatoryValid()}
          className="btn-primary"
          style={{ padding: '10px 22px' }}
        >
          <span>Continue</span>
          <ArrowRight size={15} />
        </button>
      </div>
      {!isMandatoryValid() && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 6 }}>
          <Zap size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
          {(() => {
            const typed = Number(formData.gfa_value)
            const sqmEquivalent = formData.gfa_unit === 'sqft' ? typed / SQM_TO_SQFT : typed
            if (formData.gfa_value && sqmEquivalent > MAX_GFA_SQM) {
              return `GFA looks too large to be real (max ${formData.gfa_unit === 'sqft' ? Math.round(MAX_GFA_SQM * SQM_TO_SQFT).toLocaleString() : MAX_GFA_SQM.toLocaleString()} ${formData.gfa_unit}) -- double-check for an extra digit`
            }
            return 'Enter a GFA and location to continue'
          })()}
        </p>
      )}
    </div>
  )
}
