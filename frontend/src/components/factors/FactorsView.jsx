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
  // Bug fix (Phase 6): the live /factors/current snapshot carries
  // cea_adjusted as a real JSON boolean (confirmed against
  // app/data/ice_db/factor_history.json -- every recorded entry's value
  // is `true`/`false`, never the string "yes"). The original component
  // compared against the string 'yes', which is the convention used by a
  // DIFFERENT schema (the onboarding/master_item_codes.json canonical
  // category template, a separate subsystem) -- so every "CEA Grid
  // Adjusted" badge and this count were silently always false here.
  const ceaAdjustedCount = rawEntries.filter(([, v]) => v.cea_adjusted === true).length
  const ifcPrimaryCount = rawEntries.filter(([, v]) => v.evidence_tier === 'ifc_primary_source').length
  // reinforcement_steel (and potentially other future entries) is a
  // "discoverability stub" -- present in the snapshot with only a _note
  // and superseded_by, no ef_kgco2e_per_kg/ef_source/evidence_tier, because
  // both calculation engines actually read its real factor from
  // ice_factors.get_steel_rebar_factor_per_kg() instead of this file. Any
  // entry missing ef_kgco2e_per_kg is treated as one of these stubs rather
  // than rendered as if it just has a blank/missing value.
  const isStubEntry = (v) => v && v.ef_kgco2e_per_kg === undefined

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Stat row -- real counts straight from the live snapshot, not a
          fabricated "last updated" timestamp (generate_snapshot() has no
          such field: it's regenerated from factor_history.json on every
          request, so there's no meaningful "last updated" to show here). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <StatCard
          title="Tracked Categories"
          value={rawEntries.length}
          subtitle="Concrete uses a separate per-grade schema, not shown here; reinforcement steel is listed but sourced elsewhere"
          icon={Database}
          accent="lime"
        />
        <StatCard
          title="CEA Grid-Adjusted"
          value={ceaAdjustedCount}
          unit={`/ ${rawEntries.length}`}
          subtitle="Factors adjusted to India's Central Electricity Authority grid cleanliness"
          icon={Zap}
          accent="cyan"
        />
        <StatCard
          title="IFC Primary Source"
          value={ifcPrimaryCount}
          unit={`/ ${rawEntries.length}`}
          subtitle="Backed directly by IFC India (2017), the dataset's anchor source"
          icon={BookOpen}
          accent="mint"
        />
      </div>

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
            <span style={{ fontSize: '0.8125rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
              Versioned Emission Factors
            </span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Single Canonical Emission-Factor Database
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
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
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Canonical Material Factors
            </h3>

            <div style={{ position: 'relative' }}>
              <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
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
              const isCea = data.cea_adjusted === true
              const tier = data.evidence_tier || 'placeholder_source'
              const isStub = isStubEntry(data)

              return (
                <div
                  key={catKey}
                  onClick={() => setSelectedCategory(catKey)}
                  style={{
                    background: isSelected ? 'rgba(var(--c-blue), 0.12)' : 'rgba(var(--c-surf-2), 0.65)',
                    border: `1px solid ${isSelected ? 'var(--accent-lime)' : 'rgba(var(--c-blue), 0.12)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                      {catKey.replace(/_/g, ' ')}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {isStub ? (
                        <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
                          sourced elsewhere
                        </span>
                      ) : (
                        <>
                          {isCea && (
                            <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                              CEA Grid Adjusted
                            </span>
                          )}
                          <span className={`badge ${tier === 'ifc_primary_source' ? 'badge-lime' : 'badge-muted'}`} style={{ fontSize: '0.65rem' }}>
                            {tier.replace(/_/g, ' ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {isStub ? (
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.4 }}>
                      {data._note || 'Not sourced from this endpoint -- see the detail panel.'}
                    </p>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
                      <span className="tabular-nums" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                        {data.ef_kgco2e_per_kg?.toFixed(4)}{' '}
                        <span style={{ fontSize: '0.72rem', color: 'var(--accent-lime)' }}>kgCO₂e / kg</span>
                      </span>

                      <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {data.ef_source}
                      </span>
                    </div>
                  )}
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
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  KEY: {selectedCategory}
                </span>
              </div>

              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 14, textTransform: 'capitalize' }}>
                {selectedCategory.replace(/_/g, ' ')}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {isStubEntry(factorsSnapshot[selectedCategory]) ? (
                  <div
                    style={{
                      background: 'rgba(var(--c-surf-1), 0.7)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(var(--c-overlay), 0.1)',
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Sourced Elsewhere, Not From This Endpoint
                    </span>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', marginTop: 6, lineHeight: 1.45 }}>
                      {factorsSnapshot[selectedCategory]._note}
                    </p>
                  </div>
                ) : (
                  <>
                    <div style={{ background: 'rgba(var(--c-surf-1), 0.7)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--accent-lime)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Emission Factor & Unit Note
                      </span>
                      <div className="tabular-nums" style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--accent-lime)', marginTop: 2 }}>
                        {factorsSnapshot[selectedCategory].ef_kgco2e_per_kg} kgCO₂e/kg
                      </div>
                      {factorsSnapshot[selectedCategory].unit_note && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
                          {factorsSnapshot[selectedCategory].unit_note}
                        </p>
                      )}
                    </div>

                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Primary Source & Methodology
                      </span>
                      <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', marginTop: 4, lineHeight: 1.45 }}>
                        {factorsSnapshot[selectedCategory].ef_source}
                      </p>
                    </div>
                  </>
                )}

                {factorsSnapshot[selectedCategory]._reconciliation && (
                  <div
                    style={{
                      background: 'rgba(var(--c-cyan), 0.08)',
                      border: '1px solid rgba(var(--c-cyan), 0.2)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 10,
                      fontSize: '0.75rem',
                      color: 'var(--accent-skyblue)',
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
              <History size={16} color="var(--accent-cyan)" />
              <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Revision History for {selectedCategory}
              </h4>
            </div>

            {categoryHistory.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                No prior revisions recorded. Currently active factor is the initial anchored baseline.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {categoryHistory.map((hist, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(var(--c-surf-1), 0.65)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(var(--c-overlay), 0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>
                      <span>Valid: {hist.valid_from} {hist.valid_to ? `to ${hist.valid_to}` : '(Current)'}</span>
                      {hist.value.ef_kgco2e_per_kg !== undefined && (
                        <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--accent-lime)' }}>
                          {hist.value.ef_kgco2e_per_kg} kgCO₂e/kg
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
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
