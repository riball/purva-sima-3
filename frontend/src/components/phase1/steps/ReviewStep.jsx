import React from 'react'
import { ArrowRight, ArrowLeft } from 'lucide-react'
import { usePhase1Form } from '../Phase1FormContext'
import ConfidenceBadge from '../../common/ConfidenceBadge'

/**
 * UX refinement (Phase B), step 4 of 5: the provenance-review table,
 * unchanged in behavior (PATCH /form/{id}, same as before) but now on
 * its own step -- decluttered from the input steps and no longer sharing
 * a page with the results, which is exactly the "what goes where"
 * confusion the user called out about the old single-page layout.
 */
export default function ReviewStep() {
  const { savedProject, reviewFields, setReviewFields, isPatching, handleApplyPatch, goNext, goBack } = usePhase1Form()

  const renderFieldReviewRow = (label, path, fieldObj) => {
    if (!fieldObj) return null
    const currentValue = reviewFields[path] !== undefined ? reviewFields[path] : fieldObj.value ?? ''

    return (
      <tr key={path} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <td style={{ padding: '10px 14px', fontSize: '0.8125rem', color: '#f8fafc', fontWeight: 500 }}>{label}</td>
        <td style={{ padding: '10px 14px' }}>
          <ConfidenceBadge source={fieldObj.source} confidence={fieldObj.confidence} />
        </td>
        <td style={{ padding: '10px 14px' }}>
          <input
            type="text"
            value={currentValue}
            onChange={(e) => {
              const val = e.target.value
              setReviewFields((prev) => ({ ...prev, [path]: val }))
            }}
            className="form-input"
            style={{
              padding: '6px 10px',
              fontSize: '0.8125rem',
              borderColor: reviewFields[path] !== undefined ? 'var(--accent-lime)' : 'rgba(49, 130, 206, 0.2)',
            }}
          />
        </td>
      </tr>
    )
  }

  if (!savedProject) {
    return (
      <div className="glass-panel" style={{ padding: 40, textAlign: 'center', color: '#94a3b8', maxWidth: 640, margin: '0 auto' }}>
        Nothing to review yet -- go back and generate an estimate first.
      </div>
    )
  }

  return (
    <div className="glass-panel" style={{ padding: 28, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <span className="badge badge-cyan" style={{ fontSize: '0.65rem', marginBottom: 6, display: 'inline-block' }}>Step 4 of 5</span>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>
            Review estimated fields
          </h2>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 2 }}>
            Every field's origin is tracked. Overwriting a value marks it as user-entered (100% confidence).
          </p>
        </div>

        {Object.keys(reviewFields).length > 0 && (
          <button onClick={handleApplyPatch} disabled={isPatching} className="btn-primary" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
            {isPatching ? 'Applying...' : `Save ${Object.keys(reviewFields).length} Corrections`}
          </button>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(49, 130, 206, 0.15)', color: '#3182CE', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ padding: '8px 14px' }}>Field</th>
              <th style={{ padding: '8px 14px' }}>Source & Confidence</th>
              <th style={{ padding: '8px 14px' }}>Value (Editable)</th>
            </tr>
          </thead>
          <tbody>
            {renderFieldReviewRow('GFA (m²)', 'gfa_sqm', savedProject.mandatory?.gfa_sqm)}
            {renderFieldReviewRow('Location', 'location', savedProject.mandatory?.location)}
            {renderFieldReviewRow('Typology', 'typology', savedProject.tier2?.typology)}
            {renderFieldReviewRow('Floor Count', 'num_floors', savedProject.tier2?.num_floors)}
            {renderFieldReviewRow('Foundation', 'foundation_type', savedProject.tier2?.foundation_type)}
            {renderFieldReviewRow('Cement Type', 'cement_type', savedProject.tier3?.cement_type)}
            {renderFieldReviewRow('Concrete Grade', 'concrete_grade_mix', savedProject.tier3?.concrete_grade_mix)}
            {renderFieldReviewRow('Steel Ratio (kg/m²)', 'steel_reinforcement_ratio_kg_per_sqm', savedProject.tier3?.steel_reinforcement_ratio_kg_per_sqm)}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 }}>
        <button onClick={goBack} className="btn-secondary" style={{ padding: '10px 18px' }}>
          <ArrowLeft size={15} />
          <span>Back</span>
        </button>
        <button onClick={goNext} className="btn-primary" style={{ padding: '10px 22px' }}>
          <span>View Results</span>
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  )
}