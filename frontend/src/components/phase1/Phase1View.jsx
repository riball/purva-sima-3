import React, { useState, useEffect } from 'react'
import { Building2, Sparkles, Calculator, CheckCircle, RefreshCw, Upload, ArrowRight, ShieldCheck, HelpCircle, Layers, FileSpreadsheet } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'
import ConfidenceBadge from '../common/ConfidenceBadge'

export default function Phase1View() {
  const { activeCompanyId, activeProjectId, selectProject, loadProjects, addToast } = useProject()

  // Form State
  const [formData, setFormData] = useState({
    project_name: '',
    gfa_sqm: '',
    location: 'Bengaluru, Karnataka',
    structural_system_type: 'rcc_frame',
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
    green_cert_target: 'GRIHA 3-star',
    site_condition: 'normal_soil',
  })

  // Loaded Project Schema & Review State
  const [savedProject, setSavedProject] = useState(null)
  const [reviewFields, setReviewFields] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPatching, setIsPatching] = useState(false)
  const [isCalculating, setIsCalculating] = useState(false)
  const [calculationResult, setCalculationResult] = useState(null)

  // Refine Modal
  const [showRefineModal, setShowRefineModal] = useState(false)
  const [refineFile, setRefineFile] = useState(null)
  const [isRefining, setIsRefining] = useState(false)

  // Load existing project if active
  useEffect(() => {
    if (!activeProjectId) return

    const fetchExistingProject = async () => {
      try {
        const schema = await api.getForm(activeProjectId, activeCompanyId)
        if (schema) {
          setSavedProject(schema)
          populateFormFromSchema(schema)
          // Run calculation automatically if GFA exists
          if (schema.mandatory?.gfa_sqm?.value) {
            runCalculation(schema.project_id)
          }
        }
      } catch (err) {
        // Project might not have a Phase 1 form record yet (e.g. only a Phase 3 baseline)
        console.log('No Phase 1 form record for project:', err.message)
      }
    }

    fetchExistingProject()
  }, [activeProjectId, activeCompanyId])

  const populateFormFromSchema = (schema) => {
    setFormData((prev) => ({
      ...prev,
      project_name: schema.project_name || '',
      gfa_sqm: schema.mandatory?.gfa_sqm?.value || '',
      location: schema.mandatory?.location?.value || '',
      structural_system_type: schema.mandatory?.structural_system_type?.value || 'rcc_frame',
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

  // Handle Form Change
  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  // Submit Form (Auto-fill pipeline: BOQ match + LLM fallback)
  const handleSubmitForm = async (e) => {
    e.preventDefault()
    if (!formData.gfa_sqm || Number(formData.gfa_sqm) <= 0) {
      addToast('Please enter a valid Gross Floor Area (GFA)', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        company_id: activeCompanyId,
        project_name: formData.project_name.trim() || undefined,
        gfa_sqm: Number(formData.gfa_sqm),
        location: formData.location.trim() || undefined,
        structural_system_type: formData.structural_system_type || undefined,
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
      runCalculation(resultSchema.project_id)
    } catch (err) {
      addToast(`Error estimating project: ${err.message}`, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Run Calculation
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

  // Apply Review Corrections (PATCH)
  const handleApplyPatch = async () => {
    if (!savedProject || Object.keys(reviewFields).length === 0) return

    setIsPatching(true)
    try {
      const updated = await api.patchForm(savedProject.project_id, reviewFields, activeCompanyId)
      setSavedProject(updated)
      setReviewFields({})
      addToast('User corrections applied unconditionally (Confidence: 100%)', 'success')
      runCalculation(savedProject.project_id)
    } catch (err) {
      addToast(`Failed to apply corrections: ${err.message}`, 'error')
    } finally {
      setIsPatching(false)
    }
  }

  // Refine with Own BOQ
  const handleRefineSubmit = async (e) => {
    e.preventDefault()
    if (!refineFile || !savedProject) return

    setIsRefining(true)
    try {
      const res = await api.refineProject(savedProject.project_id, refineFile, activeCompanyId)
      setSavedProject(res.project)
      setShowRefineModal(false)
      setRefineFile(null)
      addToast(res.message || 'Project refined with own BOQ!', 'success')
      runCalculation(savedProject.project_id)
    } catch (err) {
      addToast(`Refinement failed: ${err.message}`, 'error')
    } finally {
      setIsRefining(false)
    }
  }

  // Render Provenance Row in Review Table
  const renderFieldReviewRow = (label, path, fieldObj) => {
    if (!fieldObj) return null
    const currentValue = reviewFields[path] !== undefined ? reviewFields[path] : fieldObj.value ?? ''

    return (
      <tr key={path} style={{ borderBottom: '1px solid rgba(var(--c-overlay), 0.05)' }}>
        <td style={{ padding: '10px 14px', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>
          {label}
        </td>
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
              borderColor: reviewFields[path] !== undefined ? 'var(--accent-lime)' : 'rgba(var(--c-blue), 0.2)',
            }}
          />
        </td>
      </tr>
    )
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Header Banner */}
      <div
        className="glass-panel"
        style={{
          padding: '24px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderLeft: '4px solid var(--accent-lime)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="badge badge-lime">Phase 1</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--accent-lime)', fontWeight: 600 }}>
              Estimate Early
            </span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Tiered Conceptual Carbon Estimator
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
            Fill in what you know; the system fills the gaps from company project history, then an LLM engineering estimate.
            Every estimated field is tagged honestly so you can review and override it.
          </p>
        </div>

        {savedProject && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn-secondary"
              onClick={() => setShowRefineModal(true)}
              style={{ fontSize: '0.8125rem' }}
            >
              <FileSpreadsheet size={15} />
              <span>Refine with Own BOQ</span>
            </button>
            <button
              className="btn-primary"
              onClick={() => runCalculation(savedProject.project_id)}
              disabled={isCalculating}
              style={{ fontSize: '0.8125rem' }}
            >
              <RefreshCw size={14} className={isCalculating ? 'spin' : ''} />
              <span>{isCalculating ? 'Recalculating...' : 'Recalculate'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Grid: Left side (Form & Review) / Right side (Calculated Results) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(480px, 1fr) minmax(420px, 1fr)', gap: 24, alignItems: 'start' }}>
        
        {/* Left Column: Intake Form & Review Accordion */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Intake Form */}
          <form onSubmit={handleSubmitForm} className="glass-panel" style={{ padding: 24 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
              Project Specification
            </h3>

            {/* Project Name */}
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Project Name</label>
              <input
                type="text"
                placeholder="e.g. Ecopolitan Tower B, Horizon Residency"
                value={formData.project_name}
                onChange={(e) => handleChange('project_name', e.target.value)}
                className="form-input"
              />
            </div>

            {/* Tier 1: Mandatory Basics */}
            <div style={{ background: 'rgba(var(--c-surf-2), 0.6)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid rgba(var(--c-blue), 0.14)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>Tier 1 · Mandatory</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Core geometric anchors</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Gross Floor Area (GFA)</label>
                  <div className="input-wrapper">
                    <input
                      type="number"
                      required
                      min="1"
                      step="any"
                      placeholder="e.g. 25000"
                      value={formData.gfa_sqm}
                      onChange={(e) => handleChange('gfa_sqm', e.target.value)}
                      className="form-input input-with-suffix"
                    />
                    <span className="input-suffix">m²</span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Location</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Bengaluru, Karnataka"
                    value={formData.location}
                    onChange={(e) => handleChange('location', e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Structural System</label>
                  <select
                    value={formData.structural_system_type}
                    onChange={(e) => handleChange('structural_system_type', e.target.value)}
                    className="form-select"
                  >
                    <option value="rcc_frame">RCC Frame (Reinforced Cement Concrete)</option>
                    <option value="steel_frame">Structural Steel Frame</option>
                    <option value="load_bearing_masonry">Load-Bearing Masonry</option>
                    <option value="composite">Composite Steel-Concrete</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Tier 2: Building Typology & Substructure */}
            <div style={{ background: 'rgba(var(--c-surf-2), 0.6)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid rgba(var(--c-blue), 0.14)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <span className="badge badge-mint" style={{ fontSize: '0.65rem' }}>Tier 2 · Typology & Substructure</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Estimated if left blank</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Typology</label>
                  <select
                    value={formData.typology}
                    onChange={(e) => handleChange('typology', e.target.value)}
                    className="form-select"
                  >
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
                  <select
                    value={formData.foundation_type}
                    onChange={(e) => handleChange('foundation_type', e.target.value)}
                    className="form-select"
                  >
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
            </div>

            {/* Tier 3: Material Specifications */}
            <div style={{ background: 'rgba(var(--c-surf-2), 0.6)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid rgba(var(--c-blue), 0.14)', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>Tier 3 · Materials</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>IFC India anchor keys</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Cement Blend Type</label>
                  <select
                    value={formData.cement_type}
                    onChange={(e) => handleChange('cement_type', e.target.value)}
                    className="form-select"
                  >
                    <option value="PPC">PPC (30% Fly Ash Blend - Standard India)</option>
                    <option value="PSC">PSC (25% Slag/GGBS Blend - Low Carbon)</option>
                    <option value="OPC">OPC (Ordinary Portland - High Carbon)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Concrete Grade</label>
                  <select
                    value={formData.concrete_grade_mix}
                    onChange={(e) => handleChange('concrete_grade_mix', e.target.value)}
                    className="form-select"
                  >
                    <option value="M20">M20</option>
                    <option value="M25">M25</option>
                    <option value="M30">M30 (Standard Frame)</option>
                    <option value="M35">M35</option>
                    <option value="M40">M40 (High Rise)</option>
                    <option value="M45">M45</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Steel Ratio <span className="form-label-optional">(Optional)</span>
                  </label>
                  <div className="input-wrapper">
                    <input
                      type="number"
                      step="any"
                      placeholder="Auto-matched from BOQ"
                      value={formData.steel_reinforcement_ratio_kg_per_sqm}
                      onChange={(e) => handleChange('steel_reinforcement_ratio_kg_per_sqm', e.target.value)}
                      className="form-input input-with-suffix"
                    />
                    <span className="input-suffix">kg/m²</span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Green Certification</label>
                  <input
                    type="text"
                    placeholder="e.g. GRIHA 3-star, none"
                    value={formData.green_cert_target}
                    onChange={(e) => handleChange('green_cert_target', e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
              style={{ width: '100%', padding: '12px 20px', fontSize: '0.9375rem' }}
            >
              <Sparkles size={16} />
              <span>{isSubmitting ? 'Estimating & Matching History...' : 'Generate Conceptual Estimate'}</span>
            </button>
          </form>

          {/* Field Provenance Review Table */}
          {savedProject && (
            <div className="glass-panel" style={{ padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Review Estimated Fields & Provenance
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                    Every field's origin is tracked. Overwriting unconditionally marks it as user-entered (100% confidence).
                  </p>
                </div>

                {Object.keys(reviewFields).length > 0 && (
                  <button
                    onClick={handleApplyPatch}
                    disabled={isPatching}
                    className="btn-primary"
                    style={{ fontSize: '0.75rem', padding: '6px 14px' }}
                  >
                    {isPatching ? 'Applying...' : `Save ${Object.keys(reviewFields).length} Corrections`}
                  </button>
                )}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(var(--c-blue), 0.15)', color: 'var(--accent-lime)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <th style={{ padding: '8px 14px' }}>Field</th>
                      <th style={{ padding: '8px 14px' }}>Source & Confidence</th>
                      <th style={{ padding: '8px 14px' }}>Value (Editable)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderFieldReviewRow('GFA (m²)', 'gfa_sqm', savedProject.mandatory?.gfa_sqm)}
                    {renderFieldReviewRow('Location', 'location', savedProject.mandatory?.location)}
                    {renderFieldReviewRow('Structural System', 'structural_system_type', savedProject.mandatory?.structural_system_type)}
                    {renderFieldReviewRow('Typology', 'typology', savedProject.tier2?.typology)}
                    {renderFieldReviewRow('Floor Count', 'num_floors', savedProject.tier2?.num_floors)}
                    {renderFieldReviewRow('Foundation', 'foundation_type', savedProject.tier2?.foundation_type)}
                    {renderFieldReviewRow('Cement Type', 'cement_type', savedProject.tier3?.cement_type)}
                    {renderFieldReviewRow('Concrete Grade', 'concrete_grade_mix', savedProject.tier3?.concrete_grade_mix)}
                    {renderFieldReviewRow('Steel Ratio (kg/m²)', 'steel_reinforcement_ratio_kg_per_sqm', savedProject.tier3?.steel_reinforcement_ratio_kg_per_sqm)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Calculated Results (Carbon, Cost, Benchmark, GRIHA) */}
        <div>
          {calculationResult ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Primary Carbon Headline Card */}
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
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                    IFC India Database (CEA Grid Adjusted)
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                  <span className="tabular-nums" style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                    {calculationResult.carbon.total_carbon_tonnes.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </span>
                  <span style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--accent-lime)' }}>
                    Tonnes CO₂e
                  </span>
                </div>

                {/* Per Area Metric Pill Row */}
                <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(var(--c-overlay), 0.08)' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Carbon Intensity / m²
                    </span>
                    <div className="tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {calculationResult.carbon.carbon_per_sqm.toFixed(1)}{' '}
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)', fontWeight: 500 }}>kgCO₂e/m²</span>
                    </div>
                  </div>

                  <div style={{ width: 1, background: 'rgba(var(--c-overlay), 0.08)' }} />

                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Carbon Intensity / sqft
                    </span>
                    <div className="tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {calculationResult.carbon.carbon_per_sqft.toFixed(1)}{' '}
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)', fontWeight: 500 }}>kgCO₂e/sqft</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Material Breakdown */}
              <div className="glass-panel" style={{ padding: 22 }}>
                <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>
                  Material GWP Breakdown
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {calculationResult.carbon.breakdown.map((item, idx) => {
                    const pct = ((item.carbon_kg / calculationResult.carbon.total_carbon_kg) * 100).toFixed(1)
                    return (
                      <div
                        key={idx}
                        style={{
                          background: 'rgba(var(--c-surf-2), 0.6)',
                          padding: 14,
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid rgba(var(--c-blue), 0.1)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {item.material}
                          </span>
                          <span className="tabular-nums badge badge-mint">
                            {pct}% of Total
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                          <span>
                            Quantity:{' '}
                            <strong style={{ color: 'var(--text-primary)' }}>
                              {item.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} {item.quantity_unit}
                            </strong>
                          </span>
                          <span>
                            Emission Factor:{' '}
                            <strong style={{ color: 'var(--accent-lime)' }}>
                              {item.factor_used.toFixed(3)} {item.factor_unit}
                            </strong>
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(var(--c-overlay), 0.05)', fontSize: '0.8125rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Total Carbon:</span>
                          <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {(item.carbon_kg / 1000).toFixed(1)} Tonnes CO₂e
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* GRIHA Benchmark & Criterion 21 LCA Points */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Benchmark */}
                <div className="glass-panel" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>GRIHA-Style Benchmark</span>
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {Math.abs(calculationResult.benchmark.pct_difference_from_baseline).toFixed(1)}%{' '}
                    <span style={{ fontSize: '0.8125rem', color: calculationResult.benchmark.pct_difference_from_baseline <= 0 ? 'var(--accent-lime)' : 'var(--accent-rose)' }}>
                      {calculationResult.benchmark.pct_difference_from_baseline <= 0 ? 'better than typical' : 'above typical'}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                    Typical {calculationResult.benchmark.floor_band_used}: {calculationResult.benchmark.baseline_carbon_per_sqm.toFixed(1)} kg/m²
                  </span>
                </div>

                {/* GRIHA Points */}
                <div className="glass-panel" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>GRIHA V6.0 Criterion 21</span>
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                    {calculationResult.griha_criterion_21.points_estimated} / {calculationResult.griha_criterion_21.max_points} Points
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                    {calculationResult.griha_criterion_21.pct_reduction.toFixed(1)}% GWP reduction vs OPC baseline
                  </span>
                </div>
              </div>

              {/* Cost Estimate with Inflation Note */}
              <div className="glass-panel" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
                    Structural Cost Estimate
                  </span>
                  <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>
                    Batched Inflation Adjusted
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="tabular-nums" style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    ₹{(calculationResult.cost.total_cost_inr / 10000000).toFixed(2)}
                  </span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--accent-amber-light)' }}>
                    Crores INR
                  </span>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                  ₹{calculationResult.cost.cost_per_sqm_inr.toFixed(0)} / m² (Concrete & Steel scope only)
                </span>
              </div>
            </div>
          ) : (
            <div
              className="glass-panel"
              style={{
                padding: '60px 30px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
                color: 'var(--text-tertiary)',
              }}
            >
              <Calculator size={36} color="var(--accent-lime)" />
              <h4 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Awaiting Estimate Parameters
              </h4>
              <p style={{ fontSize: '0.875rem', maxWidth: 360, lineHeight: 1.5 }}>
                Submit the project specification on the left to run the IFC India calculation engine and see real carbon, cost, and GRIHA benchmark results.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Refine With Own BOQ Modal */}
      {showRefineModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(var(--c-black), 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              Refine Project with Real BOQ
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 18 }}>
              Upload this project's actual `.xlsx` Bill of Quantities. It extracts real quantities and updates fields with{' '}
              <strong style={{ color: 'var(--accent-lime)' }}>own-boq-extracted (90% confidence)</strong>, outranking earlier reference-matched estimates.
            </p>

            <form onSubmit={handleRefineSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  border: '2px dashed rgba(var(--c-blue), 0.25)',
                  borderRadius: 'var(--radius-md)',
                  padding: 24,
                  textAlign: 'center',
                  background: 'rgba(var(--c-surf-1), 0.6)',
                }}
              >
                <input
                  type="file"
                  id="refine-file-input"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={(e) => setRefineFile(e.target.files[0] || null)}
                />
                <label
                  htmlFor="refine-file-input"
                  style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
                >
                  <Upload size={24} color="var(--accent-lime)" />
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {refineFile ? refineFile.name : 'Click to select Excel BOQ (.xlsx)'}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Only non-supplementary primary sheets are processed
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowRefineModal(false)
                    setRefineFile(null)
                  }}
                  className="btn-secondary"
                  disabled={isRefining}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isRefining || !refineFile}>
                  {isRefining ? 'Extracting...' : 'Refine Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
