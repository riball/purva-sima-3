import React from 'react'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { usePhase1Form } from '../Phase1FormContext'

/**
 * UX refinement (Phase B), step 3 of 5: the last, most-advanced tier
 * (material specs) -- same "clearly optional" treatment as Tier2Step,
 * except its Continue button IS the final "Generate Conceptual Estimate"
 * submit (there's no step 4 of manual entry; step 4 is Review, which only
 * exists once a project has been submitted).
 */
export default function Tier3Step() {
  const { formData, handleChange, goBack, handleSubmitForm, isSubmitting } = usePhase1Form()

  return (
    <div className="glass-panel" style={{ padding: 28, maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>Step 3 of 5 &middot; Optional</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>IFC India anchor keys -- estimated if left blank</span>
      </div>
      <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
        Material specifications
      </h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 22, lineHeight: 1.5 }}>
        The most advanced tier -- also optional. When you're ready, generate the estimate below.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="form-group">
          <label className="form-label">Cement Blend Type</label>
          <select value={formData.cement_type} onChange={(e) => handleChange('cement_type', e.target.value)} className="form-select">
            <option value="PPC">PPC (30% Fly Ash Blend - Standard India)</option>
            <option value="PSC">PSC (25% Slag/GGBS Blend - Low Carbon)</option>
            <option value="OPC">OPC (Ordinary Portland - High Carbon)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Concrete Grade</label>
          <select value={formData.concrete_grade_mix} onChange={(e) => handleChange('concrete_grade_mix', e.target.value)} className="form-select">
            <option value="M20">M20</option>
            <option value="M25">M25</option>
            <option value="M30">M30 (Standard Frame)</option>
            <option value="M35">M35</option>
            <option value="M40">M40 (High Rise)</option>
            <option value="M45">M45</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Steel Ratio <span className="form-label-optional">(auto-matched from BOQ)</span></label>
          <div className="input-wrapper">
            <input
              type="number"
              step="any"
              placeholder="Auto-matched from BOQ"
              value={formData.steel_reinforcement_ratio_kg_per_sqm}
              onChange={(e) => handleChange('steel_reinforcement_ratio_kg_per_sqm', e.target.value)}
              className="form-input input-with-suffix"
            />
            <span className="input-suffix">kg/m&sup2;</span>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Green Certification</label>
          <input
            type="text"
            placeholder="e.g. IGBC Gold, none"
            value={formData.green_cert_target}
            onChange={(e) => handleChange('green_cert_target', e.target.value)}
            className="form-input"
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 26 }}>
        <button onClick={goBack} className="btn-secondary" style={{ padding: '10px 18px' }}>
          <ArrowLeft size={15} />
          <span>Back</span>
        </button>

        <button
          onClick={() => handleSubmitForm()}
          disabled={isSubmitting}
          className="btn-primary"
          style={{ padding: '10px 24px' }}
        >
          <Sparkles size={16} />
          <span>{isSubmitting ? 'Estimating & Matching History...' : 'Generate Conceptual Estimate'}</span>
        </button>
      </div>
    </div>
  )
}
