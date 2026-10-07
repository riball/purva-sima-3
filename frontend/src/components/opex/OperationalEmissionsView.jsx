import React, { useState, useEffect, useCallback } from 'react'
import { Zap, Flame, Calculator, Trash2, Building2, Clock } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'

const EMPTY_FORM = {
  entity_name: '',
  company: 'PL',
  entity_type: 'Corporate Office',
  period: '',
  diesel_dg_litres: '',
  diesel_vehicles_litres: '',
  lpg_kg: '',
  grid_kwh: '',
  built_up_area_sqft: '',
  revenue_inr_lakhs: '',
}

// Fixed per-source colors for the Scope 1/2 breakdown bars -- never
// cycled/recomputed per render, same "assign categorical hues in fixed
// order" rule this app's other charts already follow (see
// common/charts/CategoryBarChart.jsx).
const SOURCE_COLORS = {
  diesel_dg: '#f59e0b',
  diesel_vehicles: '#fb923c',
  lpg: '#a78bfa',
  grid_electricity: '#3182CE',
}
const SOURCE_LABELS = {
  diesel_dg: 'Diesel (DG Set)',
  diesel_vehicles: 'Diesel (Vehicles)',
  lpg: 'LPG',
  grid_electricity: 'Grid Electricity',
}

function SourceBars({ breakdown }) {
  const anyValue = breakdown.some((b) => b.kg_co2e > 0)
  if (!anyValue) {
    return <div style={{ fontSize: '0.78rem', color: '#64748b', padding: '8px 0' }}>No quantity entered for this scope.</div>
  }
  const maxVal = Math.max(...breakdown.map((b) => b.kg_co2e)) || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {breakdown.map((b) => {
        const color = SOURCE_COLORS[b.source] || '#94a3b8'
        const pct = (b.kg_co2e / maxVal) * 100
        return (
          <div key={b.source}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4 }}>
              <span style={{ color: '#cbd5e1', fontWeight: 500 }}>{SOURCE_LABELS[b.source] || b.source}</span>
              <span className="tabular-nums" style={{ color, fontWeight: 700 }}>
                {(b.kg_co2e / 1000).toFixed(2)} t{' '}
                <span style={{ color: '#64748b', fontWeight: 400 }}>
                  ({b.quantity.toLocaleString()} {b.unit})
                </span>
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(pct, 2)}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: color,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ScopeSplitBar({ scope1Pct, scope2Pct }) {
  return (
    <div>
      <div style={{ display: 'flex', height: 22, borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ width: `${scope1Pct}%`, background: '#f59e0b', transition: 'width 0.4s ease' }} title={`Scope 1: ${scope1Pct.toFixed(1)}%`} />
        <div style={{ width: `${scope2Pct}%`, background: '#3182CE', transition: 'width 0.4s ease' }} title={`Scope 2: ${scope2Pct.toFixed(1)}%`} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: '0.72rem' }}>
        <span style={{ color: '#f59e0b' }}>● Scope 1 — {scope1Pct.toFixed(1)}%</span>
        <span style={{ color: '#3182CE' }}>Scope 2 — {scope2Pct.toFixed(1)}% ●</span>
      </div>
    </div>
  )
}

/**
 * UX: new standalone "Operational Emissions" tab -- Scope 1 (diesel DG +
 * diesel vehicles + LPG) & Scope 2 (grid electricity) calculator. The user
 * enters quantities only; emission factors are fixed constants sourced
 * from app/services/operational_emissions.py (matched exactly against the
 * PL/PHL FY2024-25 sustainability report's own Emissions_consl sheet), not
 * something entered per calculation. Deliberately separate from the
 * embodied-carbon project model (Phase 1/2/3/4) -- a different GHG
 * Protocol category, a different entity concept (HQ/Project under PL/PHL,
 * not a BOQ-backed project_id), so it uses its own backend service/router
 * and storage namespace rather than reusing ProjectContext's project_id.
 */
export default function OperationalEmissionsView() {
  const { activeCompanyId, addToast } = useProject()
  const [form, setForm] = useState(EMPTY_FORM)
  const [isCalculating, setIsCalculating] = useState(false)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true)
    try {
      const entries = await api.listOperationalEmissions(activeCompanyId)
      setHistory(entries)
    } catch (err) {
      console.warn('Could not load operational emissions history:', err.message)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [activeCompanyId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsCalculating(true)
    try {
      const payload = {
        company_id: activeCompanyId,
        entity_name: form.entity_name || null,
        company: form.company || null,
        entity_type: form.entity_type || null,
        period: form.period || null,
        diesel_dg_litres: Number(form.diesel_dg_litres) || 0,
        diesel_vehicles_litres: Number(form.diesel_vehicles_litres) || 0,
        lpg_kg: Number(form.lpg_kg) || 0,
        grid_kwh: Number(form.grid_kwh) || 0,
        built_up_area_sqft: form.built_up_area_sqft ? Number(form.built_up_area_sqft) : null,
        revenue_inr_lakhs: form.revenue_inr_lakhs ? Number(form.revenue_inr_lakhs) : null,
      }
      const calculated = await api.calculateOperationalEmissions(payload)
      setResult(calculated)
      addToast('Operational emissions calculated', 'success')
      await loadHistory()
    } catch (err) {
      addToast(`Calculation failed: ${err.message}`, 'error')
    } finally {
      setIsCalculating(false)
    }
  }

  const handleDelete = async (entryId) => {
    try {
      await api.deleteOperationalEmissions(entryId, activeCompanyId)
      addToast('Entry deleted', 'success')
      if (result?.entry_id === entryId) setResult(null)
      await loadHistory()
    } catch (err) {
      addToast(`Failed to delete: ${err.message}`, 'error')
    }
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div className="glass-panel" style={{ padding: '24px 28px', borderLeft: '4px solid var(--accent-mint)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span className="badge badge-mint">Scope 1 & 2</span>
          <span style={{ fontSize: '0.8125rem', color: '#3182CE', fontWeight: 600 }}>Operational Emissions</span>
        </div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc' }}>Site Fuel & Electricity Emissions</h2>
        <p style={{ fontSize: '0.875rem', color: '#94a3b8', maxWidth: 640 }}>
          Enter fuel and electricity consumption for an HQ or a Project. Emission factors (diesel, LPG, grid
          electricity) are fixed and sourced from CEA/DEFRA — you only enter quantities.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Entity Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Provident Ecopolitan"
              value={form.entity_name}
              onChange={(e) => updateField('entity_name', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Company</label>
            {/* Display labels only -- the underlying stored value stays
                "PL"/"PHL" (matches the PL/PHL FY2024-25 sustainability
                report's own Emissions_consl sheet codes referenced
                elsewhere in this file), so nothing downstream that reads
                this field needs to change. */}
            <select className="form-select" value={form.company} onChange={(e) => updateField('company', e.target.value)}>
              <option value="PL">Puravankara Ltd</option>
              <option value="PHL">Provident Housing Ltd</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Entity Type</label>
            <select className="form-select" value={form.entity_type} onChange={(e) => updateField('entity_type', e.target.value)}>
              <option value="Corporate Office">Corporate Office</option>
              <option value="Provident">Provident</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Period</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. FY2024-25"
              value={form.period}
              onChange={(e) => updateField('period', e.target.value)}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Flame size={15} color="#f59e0b" />
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f8fafc' }}>Scope 1 — Fuel Burned On-Site</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Diesel — DG Set (litres)</label>
              <input type="number" step="any" min="0" className="form-input" value={form.diesel_dg_litres} onChange={(e) => updateField('diesel_dg_litres', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Diesel — Vehicles (litres)</label>
              <input type="number" step="any" min="0" className="form-input" value={form.diesel_vehicles_litres} onChange={(e) => updateField('diesel_vehicles_litres', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">LPG (kg)</label>
              <input type="number" step="any" min="0" className="form-input" value={form.lpg_kg} onChange={(e) => updateField('lpg_kg', e.target.value)} />
            </div>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Zap size={15} color="#3182CE" />
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f8fafc' }}>Scope 2 — Purchased Electricity</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Grid Electricity (kWh)</label>
              <input type="number" step="any" min="0" className="form-input" value={form.grid_kwh} onChange={(e) => updateField('grid_kwh', e.target.value)} />
            </div>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Building2 size={15} color="#64748b" />
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f8fafc' }}>Optional — Intensity Metrics</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Built-Up Area (sq.ft)</label>
              <input type="number" step="any" min="0" className="form-input" value={form.built_up_area_sqft} onChange={(e) => updateField('built_up_area_sqft', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Revenue (INR Lakhs)</label>
              <input type="number" step="any" min="0" className="form-input" value={form.revenue_inr_lakhs} onChange={(e) => updateField('revenue_inr_lakhs', e.target.value)} />
            </div>
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={isCalculating} style={{ padding: '12px 20px', fontSize: '0.9375rem' }}>
          <Calculator size={15} />
          <span>{isCalculating ? 'Calculating...' : 'Calculate Emissions'}</span>
        </button>
      </form>

      {result && (
        <div className="glass-panel" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>
            Results {result.entity_name ? `— ${result.entity_name}` : ''}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <StatCard
              title="Scope 1 Total"
              value={result.scope1_total_tonnes_co2e.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              unit="t CO2e"
              accent="amber"
            />
            <StatCard
              title="Scope 2 Total"
              value={result.scope2_total_tonnes_co2e.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              unit="t CO2e"
              accent="cyan"
            />
            <StatCard
              title="Combined Total"
              value={result.combined_total_tonnes_co2e.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              unit="t CO2e"
              accent="mint"
            />
            {result.intensity_kg_co2e_per_sqft != null && (
              <StatCard
                title="Intensity"
                value={result.intensity_kg_co2e_per_sqft.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                unit="kg CO2e/sq.ft"
                accent="lime"
              />
            )}
          </div>

          <div>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 10 }}>
              Scope 1 vs Scope 2 Split
            </span>
            <ScopeSplitBar scope1Pct={result.scope1_pct_of_combined} scope2Pct={result.scope2_pct_of_combined} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            <div>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 10 }}>
                Scope 1 by Source
              </span>
              <SourceBars breakdown={result.scope1_breakdown} />
            </div>
            <div>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 10 }}>
                Scope 2 by Source
              </span>
              <SourceBars breakdown={result.scope2_breakdown} />
            </div>
          </div>

          {result.intensity_kg_co2e_per_lakh_revenue != null && (
            <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              Revenue intensity:{' '}
              <strong style={{ color: '#f8fafc' }}>
                {result.intensity_kg_co2e_per_lakh_revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg CO2e / INR lakh
              </strong>
            </div>
          )}
        </div>
      )}

      <div className="glass-panel" style={{ padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Clock size={15} color="#64748b" />
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>Past Calculations</h3>
        </div>
        {isLoadingHistory ? (
          <p style={{ fontSize: '0.8125rem', color: '#64748b' }}>Loading...</p>
        ) : history.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#64748b' }}>No calculations yet — fill out the form above and click Calculate.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((entry) => (
              <div
                key={entry.entry_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
                onClick={() => setResult(entry)}
              >
                <div>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f8fafc' }}>
                    {entry.entity_name || 'Untitled entity'}{' '}
                    {entry.company ? `(${entry.company}${entry.entity_type ? ` ${entry.entity_type}` : ''})` : ''}
                  </span>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    {entry.combined_total_tonnes_co2e.toLocaleString(undefined, { maximumFractionDigits: 2 })} t CO2e combined ·{' '}
                    {new Date(entry.created_at).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(entry.entry_id)
                  }}
                  style={{
                    background: 'rgba(244, 63, 94, 0.1)',
                    border: '1px solid rgba(244, 63, 94, 0.25)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 8px',
                    color: '#fb7185',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}