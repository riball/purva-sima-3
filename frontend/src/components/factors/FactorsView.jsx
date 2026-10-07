import React, { useState, useEffect } from 'react'
import { Database, Search, History, ShieldCheck, Zap, BookOpen, ExternalLink } from 'lucide-react'
import { api } from '../../api/client'
import StatCard from '../common/StatCard'

export default function FactorsView() {
  const [factorsSnapshot, setFactorsSnapshot] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('structural_steel')
  const [categoryHistory, setCategoryHistory] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    loadFactors()
  }, [])

  useEffect(() => {
    if (selectedCategory) {
      loadHistory(selectedCategory)
    }
  }, [selectedCategory])

  const loadFactors = async () => {
    setIsLoading(true)
    try {
      const data = await api.getCurrentFactors()
      setFactorsSnapshot(data)
      const categories = Object.keys(data).filter((k) => !k.startsWith('_'))
      if (categories.length > 0 && !categories.includes(selectedCategory)) {
        setSelectedCategory(categories[0])
      }
    } catch (err) {
      console.warn('Could not load factors:', err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const loadHistory = async (cat) => {
    try {
      const hist = await api.getCategoryHistory(cat)
      setCategoryHistory(hist)
    } catch (err) {
      console.log('No history for category:', cat, err.message)
      setCategoryHistory([])
    }
  }

  const rawEntries = factorsSnapshot ? Object.entries(factorsSnapshot).filter(([k]) => !k.startsWith('_')) : []
  const filteredEntries = rawEntries.filter(([k, v]) => {
    const term = searchQuery.toLowerCase()
    return k.toLowerCase().includes(term) || (v.ef_source || '').toLowerCase().includes(term)
  })

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
          borderLeft: '4px solid var(--accent-cyan)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="badge badge-cyan">Governance & Data</span>
            <span style={{ fontSize: '0.8125rem', color: '#38bdf8', fontWeight: 600 }}>
              Versioned Emission Factors
            </span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc' }}>
            Single Canonical Emission-Factor Database
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
            IFC India (2017) primary source, adjusted to India’s Central Electricity Authority (CEA) grid cleanliness.
            Both BOQ and Work Order pipelines read from this same single source of truth.
          </p>
        </div>

        <span className="badge badge-mint" style={{ fontSize: '0.8125rem', padding: '6px 14px' }}>
          <ShieldCheck size={14} />
          <span>EPD & IFC Verified</span>
        </span>
      </div>

      {/* Grid: Factor Catalog on Left & Inspector / History on Right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(460px, 1.2fr) minmax(420px, 1fr)', gap: 24, alignItems: 'start' }}>
        
        {/* Left Column: Factor Explorer */}
        <div className="glass-panel" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#f8fafc' }}>
              Canonical Material Factors
            </h3>

            <div style={{ position: 'relative' }}>
              <Search size={14} color="#64748b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Search category or source..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input"
                style={{ paddingLeft: 30, fontSize: '0.78rem', width: 210 }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 600, overflowY: 'auto', paddingRight: 6 }}>
            {filteredEntries.map(([catKey, data]) => {
              const isSelected = selectedCategory === catKey
              const isCea = data.cea_adjusted === 'yes'
              const tier = data.evidence_tier || 'placeholder_source'

              return (
                <div
                  key={catKey}
                  onClick={() => setSelectedCategory(catKey)}
                  style={{
                    background: isSelected ? 'rgba(49, 130, 206, 0.12)' : 'rgba(10, 18, 12, 0.65)',
                    border: `1px solid ${isSelected ? 'var(--accent-lime)' : 'rgba(49, 130, 206, 0.12)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f8fafc', textTransform: 'capitalize' }}>
                      {catKey.replace(/_/g, ' ')}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {isCea && (
                        <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                          CEA Grid Adjusted
                        </span>
                      )}
                      <span className={`badge ${tier === 'ifc_primary_source' ? 'badge-lime' : 'badge-muted'}`} style={{ fontSize: '0.65rem' }}>
                        {tier.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
                    <span className="tabular-nums" style={{ fontSize: '1.125rem', fontWeight: 700, color: '#3182CE' }}>
                      {data.ef_kgco2e_per_kg?.toFixed(4)}{' '}
                      <span style={{ fontSize: '0.72rem', color: '#3182CE' }}>kgCO₂e / kg</span>
                    </span>

                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {data.ef_source}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column: Selected Factor Details & Revision History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Active Category Deep Dive */}
          {selectedCategory && factorsSnapshot?.[selectedCategory] && (
            <div className="glass-panel" style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="badge badge-lime">Material Detail</span>
                <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
                  KEY: {selectedCategory}
                </span>
              </div>

              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: 14, textTransform: 'capitalize' }}>
                {selectedCategory.replace(/_/g, ' ')}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: 'rgba(9, 16, 11, 0.7)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '0.72rem', color: '#3182CE', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Emission Factor & Unit Note
                  </span>
                  <div className="tabular-nums" style={{ fontSize: '1.375rem', fontWeight: 700, color: '#3182CE', marginTop: 2 }}>
                    {factorsSnapshot[selectedCategory].ef_kgco2e_per_kg} kgCO₂e/kg
                  </div>
                  {factorsSnapshot[selectedCategory].unit_note && (
                    <p style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: 6, lineHeight: 1.4 }}>
                      {factorsSnapshot[selectedCategory].unit_note}
                    </p>
                  )}
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Primary Source & Methodology
                  </span>
                  <p style={{ fontSize: '0.8125rem', color: '#f8fafc', marginTop: 4, lineHeight: 1.45 }}>
                    {factorsSnapshot[selectedCategory].ef_source}
                  </p>
                </div>

                {factorsSnapshot[selectedCategory]._reconciliation && (
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.2)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 10,
                      fontSize: '0.75rem',
                      color: '#7dd3fc',
                      lineHeight: 1.4,
                    }}
                  >
                    <strong>Workstream 01 Reconciliation:</strong> {factorsSnapshot[selectedCategory]._reconciliation}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Historical Revisions Log */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <History size={16} color="#38bdf8" />
              <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f8fafc' }}>
                Revision History for {selectedCategory}
              </h4>
            </div>

            {categoryHistory.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: '#64748b' }}>
                No prior revisions recorded. Currently active factor is the initial anchored baseline.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {categoryHistory.map((hist, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(9, 16, 11, 0.65)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: 4 }}>
                      <span>Valid: {hist.valid_from} {hist.valid_to ? `to ${hist.valid_to}` : '(Current)'}</span>
                      <span className="tabular-nums" style={{ fontWeight: 600, color: '#3182CE' }}>
                        {hist.value.ef_kgco2e_per_kg} kgCO₂e/kg
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: 1.3 }}>
                      {hist.changelog_note}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
