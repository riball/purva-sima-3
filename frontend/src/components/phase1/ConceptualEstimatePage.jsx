import React from 'react'
import {
  Plus, Tag, FileSpreadsheet, Upload, RefreshCw, BookmarkPlus, LayoutDashboard, Sparkles,
} from 'lucide-react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { Phase1FormProvider, usePhase1Form, MAX_GFA_SQM, SQM_TO_SQFT } from './Phase1FormContext'
import { useProject } from '../../context/ProjectContext'
import SaveProjectNameModal from '../shared/SaveProjectNameModal'
import { CATEGORY_COLORS, CATEGORY_LABELS, FALLBACK_COLOR } from '../common/charts/MaterialBreakdownChart'

/**
 * Conceptual Estimate rebuild -- mockup-fidelity pass (see the approved
 * "Conceptual Estimate page rebuild" plan). Replaces Phase1Wizard's
 * 5-step flow (Basics -> Typology -> Materials -> Review -> Results,
 * one screen at a time) with a SINGLE page: all 3 numbered input
 * sections visible at once on the left, a persistent live results panel
 * on the right -- matching the mockup's `ConceptualEstimatePage.tsx`
 * layout/chrome, but populated with THIS app's real tiered fields and
 * REAL backend-computed numbers (never the mockup's fabricated
 * SCM%/rebar-recycled sliders or its masonry/finishes carbon, neither of
 * which exist in this backend's calculation_engine.py -- see the plan's
 * "no backend changes needed" section for exactly what's real here).
 *
 * "Live" against a real backend call (not the mockup's free client-side
 * useMemo) is provided by Phase1FormContext's scheduleSync() -- every
 * field's onChange calls handleChange() then scheduleSync(), which
 * debounces ~700ms and then creates (first time) or PATCHes (every time
 * after) the project and recalculates. See that context file's own
 * comments for the full mechanics.
 *
 * The old wizard/step files (Phase1Wizard.jsx, MandatoryStep.jsx,
 * Tier2Step.jsx, Tier3Step.jsx, ReviewStep.jsx, ResultsStep.jsx) are left
 * in place, untouched, simply no longer referenced by App.jsx's
 * 'conceptual-estimate' view -- same "don't touch working code nobody
 * depends on removing" precedent as the prior Dashboard rebuild's audit
 * log section.
 */

const REFERENCE_PROVENANCE_RE = /^boq-sourced \((.+)\)$/

// The backend now sends an explicit material_category on every breakdown
// row (see calculation_engine.py's MaterialBreakdown) -- added precisely
// because a quantity_unit-only guess breaks the moment two categories
// share a unit (glass and aluminium are both area-based, same as each
// other but different from concrete's m3/steel's kg). The unit-based
// fallback below only matters for a baseline locked before that field
// existed (a stale CalculationResult cached somewhere); every live
// /calculate response already carries material_category directly.
function categoryForBreakdownItem(item) {
  if (item.material_category) return item.material_category
  if (item.quantity_unit === 'm3') return 'concrete'
  if (item.quantity_unit === 'kg') return 'reinforcement_steel'
  return null
}

function SectionHeader({ number, title, caption }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid rgba(var(--c-blue), 0.1)', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-lime)', color: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>
          {number}
        </span>
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      </div>
      {caption && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{caption}</span>}
    </div>
  )
}

// UX refinement: "there is estimated gap (40%) being shown for every
// title, same for materials, make it avg out and mention it below the
// section name itself". Before this, every single auto-filled field in
// Typology/Materials carried its OWN ConfidenceBadge -- harmless with one
// or two auto-filled fields, but once nothing in a section was user-set
// (the common case for a fresh estimate), that was 7-8 near-identical
// "Estimated Gap 40%" pills in a row. This collapses a whole section's
// worth of per-field badges into ONE summary line under the section
// title: average confidence across every auto-filled field, grouped by
// source so a section that's genuinely a mix (e.g. some fields BOQ-
// matched, others LLM-estimated) still says so honestly rather than
// averaging across semantically different sources into one misleading
// number.
const PROVENANCE_LABELS = {
  'own-boq-extracted': { label: 'Own BOQ', badgeClass: 'badge-mint' },
  'boq-matched': { label: 'Reference Scaled', badgeClass: 'badge-cyan' },
  'llm-estimated': { label: 'Estimated Gap', badgeClass: 'badge-amber' },
  'fallback-default': { label: 'Standard Default', badgeClass: 'badge-muted' },
}

function SectionProvenanceSummary({ fieldObjs }) {
  const autoFilled = (fieldObjs || []).filter((f) => f && f.source !== 'unset' && f.source !== 'user-entered')
  if (autoFilled.length === 0) return null

  const bySource = new Map()
  autoFilled.forEach((f) => {
    if (!bySource.has(f.source)) bySource.set(f.source, [])
    bySource.get(f.source).push(f.confidence ?? 0)
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: -6, marginBottom: 14 }}>
      {Array.from(bySource.entries()).map(([source, confidences]) => {
        const config = PROVENANCE_LABELS[source] || { label: source, badgeClass: 'badge-muted' }
        const avgPct = Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100)
        return (
          <span
            key={source}
            className={`badge ${config.badgeClass}`}
            title={`${confidences.length} of ${autoFilled.length} auto-filled fields in this section, averaging ${avgPct}% confidence`}
            style={{ cursor: 'help' }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />
            {config.label} <span style={{ opacity: 0.7 }}>({confidences.length})</span>
            <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>avg {avgPct}%</span>
          </span>
        )
      })}
    </div>
  )
}

function BasicsSection() {
  const { formData, handleChange, scheduleSync, isMandatoryValid, savedProject } = usePhase1Form()

  const edit = (field, value) => {
    handleChange(field, value)
    scheduleSync()
  }

  return (
    <div className="glass-panel" style={{ padding: 20 }}>
      <SectionHeader number={1} title="Basics" caption="Required" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Project Name <span className="form-label-optional">(optional, but recommended)</span></label>
          <input
            type="text"
            placeholder="e.g. Ecopolitan Tower B, Horizon Residency"
            value={formData.project_name}
            onChange={(e) => edit('project_name', e.target.value)}
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
              onChange={(e) => edit('gfa_value', e.target.value)}
              className="form-input"
              style={{ flex: 1 }}
            />
            <select
              value={formData.gfa_unit}
              onChange={(e) => edit('gfa_unit', e.target.value)}
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
            onChange={(e) => edit('location', e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Number of Floors</label>
          <input
            type="number"
            min="1"
            placeholder="e.g. 14"
            value={formData.num_floors}
            onChange={(e) => edit('num_floors', e.target.value)}
            className="form-input"
          />
        </div>
      </div>

      {!isMandatoryValid() && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 10 }}>
          Enter a GFA and location -- Typology and Materials unlock automatically, and your estimate updates live as you type.
        </p>
      )}
      {savedProject && (
        <p style={{ fontSize: '0.72rem', color: 'var(--accent-lime)', marginTop: 10 }}>
          Saved as project <strong>{savedProject.project_name || savedProject.project_id}</strong>
        </p>
      )}
    </div>
  )
}

function TypologySection({ disabled }) {
  const { formData, handleChange, scheduleSync, savedProject } = usePhase1Form()
  const edit = (field, value) => {
    handleChange(field, value)
    scheduleSync()
  }
  const tier2 = savedProject?.tier2

  return (
    <div className="glass-panel" style={{ padding: 20, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
      <SectionHeader number={2} title="Typology" caption="Improves match accuracy -- estimated if left blank" />
      <SectionProvenanceSummary
        fieldObjs={[tier2?.typology, tier2?.foundation_type, tier2?.basement_count, tier2?.finish_spec_level, tier2?.parking_type, tier2?.parking_area_sqm]}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="form-group">
          <label className="form-label">Typology</label>
          <select value={formData.typology} onChange={(e) => edit('typology', e.target.value)} className="form-select">
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
            <option value="institutional">Institutional</option>
            <option value="mixed_use">Mixed Use</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Foundation Type</label>
          <select value={formData.foundation_type} onChange={(e) => edit('foundation_type', e.target.value)} className="form-select">
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
            onChange={(e) => {
              const value = e.target.value
              handleChange('basement_count', value)
              handleChange('has_basement', Number(value) > 0)
              scheduleSync()
            }}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Finish Spec Level</label>
          <select value={formData.finish_spec_level} onChange={(e) => edit('finish_spec_level', e.target.value)} className="form-select">
            <option value="economical">Economical</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Parking Type</label>
          <select value={formData.parking_type} onChange={(e) => edit('parking_type', e.target.value)} className="form-select">
            <option value="surface">Surface</option>
            <option value="basement">Basement</option>
            <option value="multi-level">Multi-level</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Parking Area <span className="form-label-optional">(m&sup2;)</span></label>
          <input
            type="number"
            min="0"
            placeholder="auto-estimated if left blank"
            value={formData.parking_area_sqm}
            onChange={(e) => edit('parking_area_sqm', e.target.value)}
            className="form-input"
          />
        </div>
      </div>
    </div>
  )
}

function MaterialsSection({ disabled }) {
  const { formData, handleChange, scheduleSync, savedProject } = usePhase1Form()
  const edit = (field, value) => {
    handleChange(field, value)
    scheduleSync()
  }
  const tier3 = savedProject?.tier3

  return (
    <div className="glass-panel" style={{ padding: 20, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
      <SectionHeader number={3} title="Materials" caption="IFC India anchor keys -- estimated if left blank" />
      <SectionProvenanceSummary
        fieldObjs={[tier3?.cement_type, tier3?.concrete_grade_mix, tier3?.steel_reinforcement_ratio_kg_per_sqm, tier3?.mep_complexity, tier3?.facade_type, tier3?.glazing_pct, tier3?.site_condition]}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="form-group">
          <label className="form-label">Cement Blend Type</label>
          <select value={formData.cement_type} onChange={(e) => edit('cement_type', e.target.value)} className="form-select">
            <option value="PPC">PPC (30% Fly Ash Blend - Standard India)</option>
            <option value="PSC">PSC (25% Slag/GGBS Blend - Low Carbon)</option>
            <option value="OPC">OPC (Ordinary Portland - High Carbon)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Concrete Grade</label>
          <select value={formData.concrete_grade_mix} onChange={(e) => edit('concrete_grade_mix', e.target.value)} className="form-select">
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
              onChange={(e) => edit('steel_reinforcement_ratio_kg_per_sqm', e.target.value)}
              className="form-input input-with-suffix"
            />
            <span className="input-suffix">kg/m&sup2;</span>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">MEP Complexity</label>
          <select value={formData.mep_complexity} onChange={(e) => edit('mep_complexity', e.target.value)} className="form-select">
            <option value="basic">Basic</option>
            <option value="standard">Standard</option>
            <option value="complex">Complex</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Facade Type</label>
          <input
            type="text"
            placeholder="e.g. AAC block + texture paint"
            value={formData.facade_type}
            onChange={(e) => edit('facade_type', e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Glazing <span className="form-label-optional">(%)</span></label>
          <input
            type="number"
            min="0"
            max="100"
            placeholder="e.g. 25"
            value={formData.glazing_pct}
            onChange={(e) => edit('glazing_pct', e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Site Condition</label>
          <select value={formData.site_condition} onChange={(e) => edit('site_condition', e.target.value)} className="form-select">
            <option value="normal_soil">Normal Soil</option>
            <option value="rocky">Rocky</option>
            <option value="waterlogged">Waterlogged</option>
            <option value="reclaimed_land">Reclaimed Land</option>
          </select>
        </div>

      </div>
    </div>
  )
}

function MaterialBreakdownDonut({ breakdown, totalCarbonKg }) {
  const data = breakdown
    .map((item) => ({ ...item, category: categoryForBreakdownItem(item) }))
    .filter((item) => item.carbon_kg > 0)

  return (
    <div style={{ paddingTop: 14, borderTop: '1px solid rgba(var(--c-overlay), 0.08)' }}>
      <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
        Estimated Material Breakdown
      </div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={45} outerRadius={68} paddingAngle={3} dataKey="carbon_kg">
              {data.map((entry, idx) => (
                <Cell key={idx} fill={CATEGORY_COLORS[entry.category] || FALLBACK_COLOR} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
              formatter={(val, _name, item) => [`${(val / 1000).toFixed(1)} tCO₂e`, item.payload.material]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {data.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_COLORS[item.category] || FALLBACK_COLOR, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {CATEGORY_LABELS[item.category] || item.material}
              </span>
            </span>
            <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>
              {totalCarbonKg ? Math.round((item.carbon_kg / totalCarbonKg) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReferenceInfluenceNote({ costBreakdown }) {
  const influenced = (costBreakdown || [])
    .map((item) => ({ item, match: item.rate_provenance?.match(REFERENCE_PROVENANCE_RE) }))
    .filter((x) => x.match)

  if (influenced.length === 0) return null

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(var(--c-blue), 0.08)', border: '1px solid rgba(var(--c-blue), 0.15)' }}>
      {influenced.map(({ item, match }, idx) => (
        <p key={idx} style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>
          <strong style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{item.material}</strong> rate was influenced by reference project{' '}
          <strong style={{ color: 'var(--accent-cyan)' }}>{match[1]}</strong>.
        </p>
      ))}
    </div>
  )
}

function ResultsPanel() {
  const {
    savedProject, calculationResult, isCalculating, isSyncing,
    handleLockBaseline, isLockingBaseline, projectSummary,
    showSaveNameModal, setShowSaveNameModal,
  } = usePhase1Form()
  const { selectProject, navigate } = useProject()

  const viewDashboard = () => {
    selectProject(savedProject.project_id)
    navigate('project-dashboard')
  }

  if (!savedProject) {
    return (
      <div className="glass-panel-elevated" style={{ padding: '50px 24px', textAlign: 'center', color: 'var(--text-tertiary)', position: 'sticky', top: 20 }}>
        <Sparkles size={30} color="var(--accent-lime)" style={{ marginBottom: 10 }} />
        <p style={{ fontSize: '0.875rem' }}>Fill in the Basics to see your live carbon &amp; cost estimate here.</p>
      </div>
    )
  }

  const hasBaseline = !!projectSummary?.has_baseline
  const baselineIsPhase1 = projectSummary?.baseline_source_type === 'phase1_estimate'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 20 }}>
      <div
        className="glass-panel-elevated"
        style={{
          padding: '24px 26px',
          background: 'radial-gradient(circle at top right, rgba(var(--c-blue), 0.12) 0%, rgba(var(--c-surf-3), 0.95) 70%)',
          border: '1px solid rgba(var(--c-blue), 0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>
            {isSyncing || isCalculating ? 'Updating...' : 'Deterministic Baseline Result'}
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>IFC India (CEA Grid Adjusted)</span>
        </div>

        {!calculationResult ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '20px 0' }}>
            {isCalculating || isSyncing ? 'Calculating...' : 'Awaiting estimate parameters.'}
          </p>
        ) : (
          <>
            {calculationResult.carbon.scope_note && (
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(var(--c-overlay), 0.08)' }}>
                {calculationResult.carbon.scope_note}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span className="tabular-nums" style={{ fontSize: '2.25rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                {calculationResult.carbon.total_carbon_tonnes.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
              <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--accent-lime)' }}>Tonnes CO₂e</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 10, borderRadius: 'var(--radius-md)', background: 'rgba(var(--c-surf-2), 0.6)', fontSize: '0.75rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.65rem' }}>Intensity / m&sup2;</span>
                <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{calculationResult.carbon.carbon_per_sqm.toFixed(1)}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.65rem' }}>Intensity / sqft</span>
                <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{calculationResult.carbon.carbon_per_sqft.toFixed(1)}</span>
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>vs. typical {calculationResult.benchmark.floor_band_used.replace('_', '-')} building:</span>
                <span className="tabular-nums" style={{ fontWeight: 700, color: calculationResult.benchmark.pct_difference_from_baseline <= 0 ? 'var(--accent-lime)' : 'var(--accent-rose)' }}>
                  {calculationResult.benchmark.pct_difference_from_baseline > 0 ? '+' : ''}{calculationResult.benchmark.pct_difference_from_baseline.toFixed(1)}%
                </span>
              </div>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                Typical: {calculationResult.benchmark.baseline_carbon_per_sqm.toFixed(1)} kg/m&sup2; (self-computed, not a published benchmark)
              </span>
            </div>

            <MaterialBreakdownDonut breakdown={calculationResult.carbon.breakdown} totalCarbonKg={calculationResult.carbon.total_carbon_kg} />

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(var(--c-overlay), 0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>Structural Cost Estimate</span>
                <span className="badge badge-amber" style={{ fontSize: '0.6rem' }}>Inflation Adjusted</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                <span className="tabular-nums" style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  &#8377;{(calculationResult.cost.total_cost_inr / 10000000).toFixed(2)}
                </span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--accent-amber-light)' }}>Cr</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>(&#8377;{calculationResult.cost.cost_per_sqm_inr.toFixed(0)}/m&sup2;)</span>
              </div>
              <ReferenceInfluenceNote costBreakdown={calculationResult.cost.breakdown} />
            </div>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(var(--c-overlay), 0.08)' }}>
              {hasBaseline && !baselineIsPhase1 ? (
                <>
                  <button onClick={viewDashboard} className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                    <LayoutDashboard size={15} />
                    <span>View Project Dashboard</span>
                  </button>
                  <p style={{ fontSize: '0.68rem', textAlign: 'center', color: 'var(--text-muted)', marginTop: 6 }}>
                    This project is already tracked via a real BOQ/Work Order baseline -- this estimate can't replace it.
                  </p>
                </>
              ) : hasBaseline ? (
                <>
                  <button onClick={viewDashboard} className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                    <LayoutDashboard size={15} />
                    <span>View Project Dashboard</span>
                  </button>
                  <button
                    onClick={() => handleLockBaseline(true)}
                    disabled={isLockingBaseline}
                    className="btn-secondary"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8, fontSize: '0.75rem' }}
                  >
                    <RefreshCw size={13} className={isLockingBaseline ? 'spin' : ''} />
                    <span>{isLockingBaseline ? 'Updating...' : 'Update & Re-lock with Latest Estimate'}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleLockBaseline(false)}
                    disabled={isLockingBaseline}
                    className="btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    <BookmarkPlus size={16} />
                    <span>{isLockingBaseline ? 'Locking...' : 'Lock Baseline & Start Tracking Project'}</span>
                  </button>
                  <p style={{ fontSize: '0.68rem', textAlign: 'center', color: 'var(--text-muted)', marginTop: 6 }}>
                    Records this estimate as the project's Phase 3 baseline and opens its live dashboard.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <SaveProjectNameModal
        isOpen={showSaveNameModal}
        onClose={() => setShowSaveNameModal(false)}
        projectId={savedProject.project_id}
        initialName={savedProject.project_name || ''}
      />
    </div>
  )
}

function HeaderToolbar() {
  const {
    savedProject, startNewProject, setShowSaveNameModal,
    showRefineModal, setShowRefineModal, refineFile, setRefineFile, isRefining, handleRefineSubmit,
  } = usePhase1Form()

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-lime)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          <span>Phase 1 Conceptual Estimator</span>
          <span>&middot;</span>
          <span>Early Design Stage (Pre-BOQ)</span>
        </div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Conceptual Carbon Estimation</h2>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {savedProject && (
          <>
            <button onClick={() => setShowSaveNameModal(true)} className="btn-secondary" style={{ fontSize: '0.78rem' }}>
              <Tag size={14} />
              <span>{savedProject.project_name ? 'Rename' : 'Save with a Name'}</span>
            </button>
            <button onClick={() => setShowRefineModal(true)} className="btn-secondary" style={{ fontSize: '0.78rem' }}>
              <FileSpreadsheet size={14} />
              <span>Refine with Own BOQ</span>
            </button>
          </>
        )}
        <button onClick={startNewProject} className="btn-secondary" style={{ fontSize: '0.78rem' }}>
          <Plus size={14} />
          <span>New Estimate</span>
        </button>
      </div>

      {showRefineModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(var(--c-black), 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Refine Project with Real BOQ</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 18 }}>
              Upload this project's actual `.xlsx` Bill of Quantities. It extracts real quantities and updates fields with{' '}
              <strong style={{ color: 'var(--accent-lime)' }}>own-boq-extracted (90% confidence)</strong>, outranking earlier reference-matched estimates.
            </p>
            <div style={{ border: '2px dashed rgba(var(--c-blue), 0.25)', borderRadius: 'var(--radius-md)', padding: 24, textAlign: 'center', background: 'rgba(var(--c-surf-1), 0.6)' }}>
              <input
                type="file"
                id="refine-file-input-conceptual"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => setRefineFile(e.target.files[0] || null)}
              />
              <label htmlFor="refine-file-input-conceptual" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Upload size={24} color="var(--accent-lime)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {refineFile ? refineFile.name : 'Click to select Excel BOQ (.xlsx)'}
                </span>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button onClick={() => { setShowRefineModal(false); setRefineFile(null) }} className="btn-secondary" disabled={isRefining}>
                Cancel
              </button>
              <button onClick={handleRefineSubmit} className="btn-primary" disabled={isRefining || !refineFile}>
                {isRefining ? 'Extracting...' : 'Refine Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PageBody() {
  const { isMandatoryValid } = usePhase1Form()
  const sectionsEnabled = isMandatoryValid()

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <HeaderToolbar />
      <div className="grid-conceptual-estimate" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(320px, 5fr)', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <BasicsSection />
          <TypologySection disabled={!sectionsEnabled} />
          <MaterialsSection disabled={!sectionsEnabled} />
        </div>
        <ResultsPanel />
      </div>
    </div>
  )
}

export default function ConceptualEstimatePage() {
  return (
    <Phase1FormProvider>
      <PageBody />
    </Phase1FormProvider>
  )
}
