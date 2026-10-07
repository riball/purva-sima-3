import React from 'react'
import { ArrowRight, ArrowLeft, Sparkles } from 'lucide-react'
import { usePhase1Form } from '../Phase1FormContext'

/**
 * UX refinement (Phase B), step 2 of 5: clearly optional -- a visible
 * "Optional" badge, a Skip button, AND a "Generate Estimate Now" escape
 * hatch that submits immediately (letting the backend's own
 * match_boq_defaults/fill_missing_fields auto-fill pipeline handle
 * whatever's left blank, exactly as before). This is what keeps the fast
 * one-shot-submit path just as fast as the old single-page form, while
 * still making it visually obvious that nothing here is required.
 */
export default function Tier2Step() {
  const { formData, handleChange, goNext, goBack, handleSubmitForm, isSubmitting } = usePhase1Form()

  return (
    <div className="glass-panel" style={{ padding: 28, maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="badge badge-mint" style={{ fontSize: '0.65rem' }}>Step 2 of 5 &middot; Optional</span>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Improves match accuracy -- estimated if left blank</span>
      </div>
      <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f8fafc', marginBottom: 6 }}>
        Typology & substructure
      </h2>
      <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginBottom: 22, lineHeight: 1.5 }}>
        None of this is required -- skip it and the system estimates it from the most similar project on file.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="form-group">
          <label className="form-label">Typology</label>
          <select value={formData.typology} onChange={(e) => handleChange('typology', e.target.value)} className="form-select">
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
            <option value="institutional">Institutional</option>
            <option value="mixed_use">Mixed Use</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Number of Floors</label>
          <input
            type="number"
            min="1"
            placeholder="e.g. 14"
            value={formData.num_floors}
            onChange={(e) => handleChange('num_floors', e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Foundation Type</label>
          <select value={formData.foundation_type} onChange={(e) => handleChange('foundation_type', e.target.value)} className="form-select">
            <option value="raft">Raft Foundation</option>
            <option value="isolated_footing">Isolated Footing</option>
            <option value="pile">Pile Foundation</option>
            <option value="combined_footing">Combined Footing</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Basement Floors</label>
          <input
            type="number"
            min="0"
            placeholder="e.g. 1 or 2"
            value={formData.basement_count}
            onChange={(e) => handleChange('basement_count', e.target.value)}
            className="form-input"
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 26 }}>
        <button onClick={goBack} className="btn-secondary" style={{ padding: '10px 18px' }}>
          <ArrowLeft size={15} />
          <span>Back</span>
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => handleSubmitForm()}
            disabled={isSubmitting}
            className="btn-secondary"
            style={{ padding: '10px 18px' }}
            title="Skip the rest and generate an estimate from what you've entered so far"
          >
            <Sparkles size={15} />
            <span>{isSubmitting ? 'Generating...' : 'Generate Estimate Now'}</span>
          </button>
          <button onClick={goNext} className="btn-primary" style={{ padding: '10px 22px' }}>
            <span>Continue</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
