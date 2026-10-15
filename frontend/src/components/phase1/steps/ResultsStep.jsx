import React from 'react'
import { Calculator, RefreshCw, Upload, FileSpreadsheet, ArrowLeft, Tag } from 'lucide-react'
import { usePhase1Form } from '../Phase1FormContext'
import SaveProjectNameModal from '../../shared/SaveProjectNameModal'

/**
 * UX refinement (Phase B), step 5 of 5: the calculated results --
 * unchanged content and unchanged backend call (POST /calculate/{id}),
 * now on its own dedicated step instead of sharing a page with the input
 * form. Also where the "save with a name tag" (Phase A) and "refine with
 * a real BOQ" (existing Phase1->Phase2 handoff, unchanged) actions live.
 */
export default function ResultsStep() {
  const {
    savedProject,
    calculationResult,
    isCalculating,
    runCalculation,
    goBack,
    showRefineModal,
    setShowRefineModal,
    refineFile,
    setRefineFile,
    isRefining,
    handleRefineSubmit,
    showSaveNameModal,
    setShowSaveNameModal,
  } = usePhase1Form()

  if (!savedProject) {
    return (
      <div className="glass-panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)', maxWidth: 640, margin: '0 auto' }}>
        Nothing to show yet -- go back and generate an estimate first.
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span className="badge badge-lime" style={{ fontSize: '0.65rem', marginBottom: 6, display: 'inline-block' }}>Step 5 of 5</span>
          <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {savedProject.project_name || 'Conceptual estimate'}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setShowSaveNameModal(true)} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
            <Tag size={15} />
            <span>{savedProject.project_name ? 'Rename' : 'Save with a Name'}</span>
          </button>
          <button onClick={() => setShowRefineModal(true)} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
            <FileSpreadsheet size={15} />
            <span>Refine with Own BOQ</span>
          </button>
          <button onClick={() => runCalculation(savedProject.project_id)} disabled={isCalculating} className="btn-primary" style={{ fontSize: '0.8125rem' }}>
            <RefreshCw size={14} className={isCalculating ? 'spin' : ''} />
            <span>{isCalculating ? 'Recalculating...' : 'Recalculate'}</span>
          </button>
        </div>
      </div>

      {calculationResult ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            className="glass-panel-elevated"
            style={{
              padding: '28px 30px',
              background: 'radial-gradient(circle at top right, rgba(var(--c-blue), 0.12) 0%, rgba(var(--c-surf-3), 0.95) 70%)',
              border: '1px solid rgba(var(--c-blue), 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="badge badge-lime">Calculated Carbon Baseline</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>IFC India Database (CEA Grid Adjusted)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <span className="tabular-nums" style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                {calculationResult.carbon.total_carbon_tonnes.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
              <span style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--accent-lime)' }}>Tonnes CO&sub2;e</span>
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(var(--c-overlay), 0.08)' }}>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Carbon Intensity / m&sup2;</span>
                <div className="tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {calculationResult.carbon.carbon_per_sqm.toFixed(1)} <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)', fontWeight: 500 }}>kgCO&sub2;e/m&sup2;</span>
                </div>
              </div>
              <div style={{ width: 1, background: 'rgba(var(--c-overlay), 0.08)' }} />
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Carbon Intensity / sqft</span>
                <div className="tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {calculationResult.carbon.carbon_per_sqft.toFixed(1)} <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)', fontWeight: 500 }}>kgCO&sub2;e/sqft</span>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: 22 }}>
            <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Material GWP Breakdown</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {calculationResult.carbon.breakdown.map((item, idx) => {
                const pct = ((item.carbon_kg / calculationResult.carbon.total_carbon_kg) * 100).toFixed(1)
                return (
                  <div key={idx} style={{ background: 'rgba(var(--c-surf-2), 0.6)', padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid rgba(var(--c-blue), 0.1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.material}</span>
                      <span className="tabular-nums badge badge-mint">{pct}% of Total</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                      <span>Quantity: <strong style={{ color: 'var(--text-primary)' }}>{item.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} {item.quantity_unit}</strong></span>
                      <span>Emission Factor: <strong style={{ color: 'var(--accent-lime)' }}>{item.factor_used.toFixed(3)} {item.factor_unit}</strong></span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(var(--c-overlay), 0.05)', fontSize: '0.8125rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Total Carbon:</span>
                      <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{(item.carbon_kg / 1000).toFixed(1)} Tonnes CO&sub2;e</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: 18 }}>
            <span className="badge badge-cyan" style={{ fontSize: '0.65rem', marginBottom: 8, display: 'inline-block' }}>Typical Building Benchmark</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {Math.abs(calculationResult.benchmark.pct_difference_from_baseline).toFixed(1)}%{' '}
              <span style={{ fontSize: '0.8125rem', color: calculationResult.benchmark.pct_difference_from_baseline <= 0 ? 'var(--accent-lime)' : 'var(--accent-rose)' }}>
                {calculationResult.benchmark.pct_difference_from_baseline <= 0 ? 'better than typical' : 'above typical'}
              </span>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
              Typical {calculationResult.benchmark.floor_band_used}: {calculationResult.benchmark.baseline_carbon_per_sqm.toFixed(1)} kg/m&sup2;
            </span>
          </div>

          <div className="glass-panel" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>Structural Cost Estimate</span>
              <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>Batched Inflation Adjusted</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="tabular-nums" style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                &#8377;{(calculationResult.cost.total_cost_inr / 10000000).toFixed(2)}
              </span>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--accent-amber-light)' }}>Crores INR</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
              &#8377;{calculationResult.cost.cost_per_sqm_inr.toFixed(0)} / m&sup2; (Concrete & Steel scope only)
            </span>
          </div>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '60px 30px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: 'var(--text-tertiary)' }}>
          <Calculator size={36} color="var(--accent-lime)" />
          <h4 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)' }}>{isCalculating ? 'Calculating...' : 'Awaiting Estimate Parameters'}</h4>
        </div>
      )}

      <div>
        <button onClick={goBack} className="btn-secondary" style={{ padding: '10px 18px' }}>
          <ArrowLeft size={15} />
          <span>Back to Review</span>
        </button>
      </div>

      {showRefineModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(var(--c-black), 0.75)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Refine Project with Real BOQ</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 18 }}>
              Upload this project's actual `.xlsx` Bill of Quantities. It extracts real quantities and updates fields with{' '}
              <strong style={{ color: 'var(--accent-lime)' }}>own-boq-extracted (90% confidence)</strong>, outranking earlier reference-matched estimates.
            </p>
            <div style={{ border: '2px dashed rgba(var(--c-blue), 0.25)', borderRadius: 'var(--radius-md)', padding: 24, textAlign: 'center', background: 'rgba(var(--c-surf-1), 0.6)' }}>
              <input
                type="file"
                id="refine-file-input"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => setRefineFile(e.target.files[0] || null)}
              />
              <label htmlFor="refine-file-input" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Upload size={24} color="var(--accent-lime)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {refineFile ? refineFile.name : 'Click to select Excel BOQ (.xlsx)'}
                </span>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button
                onClick={() => { setShowRefineModal(false); setRefineFile(null) }}
                className="btn-secondary"
                disabled={isRefining}
              >
                Cancel
              </button>
              <button onClick={handleRefineSubmit} className="btn-primary" disabled={isRefining || !refineFile}>
                {isRefining ? 'Extracting...' : 'Refine Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* projectId is always savedProject.project_id here (never null) --
          this project already exists via POST /form, so naming/renaming
          it is a PATCH /projects/{id}/name, not a POST /projects create.
          The create (projectId=null) path is only for a name attached
          BEFORE any project record exists at all (e.g. Phase 2's
          job-completion "save as project" flow, Phase C). */}
      <SaveProjectNameModal
        isOpen={showSaveNameModal}
        onClose={() => setShowSaveNameModal(false)}
        projectId={savedProject.project_id}
        initialName={savedProject.project_name || ''}
      />
    </div>
  )
}
