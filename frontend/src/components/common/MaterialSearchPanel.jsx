import React, { useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronUp } from 'lucide-react'
import { materialLabel } from './materialCategoryLabels'

/**
 * "Search any material with a stored emission factor, not just this
 * BOQ's top 5" -- the user's own ask, verbatim: calculate every material
 * category boq_carbon's engine CAN compute (backend/app/services/
 * boq_carbon/engine.py's ALL_MATERIAL_CATEGORIES -- 17 categories: rcc,
 * pcc, reinforcement_steel, structural_steel, brickwork, blockwork_aac,
 * blockwork_dense, masonry, plaster_cement, plaster_gypsum, tile_ceramic,
 * natural_stone, paint, aluminium, upvc_window_door_frame, glass,
 * timber), cross-joined with THIS upload's own line items, so a
 * category that never appeared here still has a real, honest zero-value
 * entry instead of nothing to search.
 *
 * materials: result.all_materials -- [{ category, gwp_kg_co2e,
 * line_item_count, pct_of_total, representative_emission_factor,
 * dominant_factor_source }], one entry per canonical category.
 *
 * lineItems: result.line_items -- the raw per-row results, each with its
 * own enriched_description/category/gwp_kg_co2e. Needed because a real
 * BOQ line's own wording and the engine's classification label can
 * legitimately differ -- e.g. a line whose description literally says
 * "...Solid Cement Concrete Block MASONRY Work..." is deliberately
 * classified as "blockwork_dense" / "Dense Blockwork", not the generic
 * "masonry" category (classifier.py's block-work regex is checked, and
 * wins, before the generic masonry fallback -- see _ORDERED_RULES and
 * its own comments; that's a more specific, better-sourced factor, not
 * a misclassification). Searching "masonry" against category labels
 * alone would wrongly report "not present" for a BOQ that plainly has a
 * masonry line in it, just filed under a more specific category name --
 * so this also scans every line's own description for the search term
 * and surfaces which category it actually landed in, with the matching
 * line(s) shown so the connection is visible, not just asserted.
 *
 * This is deliberately a separate card from CategoryBarChart's "Top
 * Materials -- This BOQ" / "Material-Wise Carbon Contribution" uses --
 * those stay focused on ranking/visualizing what's actually significant;
 * this one is a lookup tool over the full, fixed catalog plus this BOQ's
 * own line text.
 */
export default function MaterialSearchPanel({ materials = [], lineItems = [] }) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState({})

  const { results, unclassifiedMatchCount } = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return { results: materials.map((m) => ({ ...m, labelMatch: true, matchedLines: [] })), unclassifiedMatchCount: 0 }

    // Every line item whose OWN description mentions the search term,
    // grouped by whichever category it actually got classified into --
    // not by what the user typed. A line with no category at all
    // (unclassified -- never fed into any material total) is counted
    // separately rather than silently dropped, see the footer note below.
    const linesByCategory = {}
    let unclassifiedMatches = 0
    for (const li of lineItems) {
      const desc = (li.enriched_description || '').toLowerCase()
      if (!desc.includes(q)) continue
      if (!li.category) {
        unclassifiedMatches += 1
        continue
      }
      if (!linesByCategory[li.category]) linesByCategory[li.category] = []
      linesByCategory[li.category].push(li)
    }

    const matched = materials
      .map((m) => {
        const label = materialLabel(m.category).toLowerCase()
        const labelMatch = label.includes(q) || (m.category || '').toLowerCase().includes(q)
        const matchedLines = linesByCategory[m.category] || []
        if (!labelMatch && matchedLines.length === 0) return null
        return { ...m, labelMatch, matchedLines }
      })
      .filter(Boolean)

    return { results: matched, unclassifiedMatchCount: unclassifiedMatches }
  }, [materials, lineItems, query])

  if (!materials || materials.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
        No material catalog data available for this result yet.
      </div>
    )
  }

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a material -- e.g. timber, brickwork, masonry..."
          className="form-input"
          style={{ width: '100%', paddingLeft: 36 }}
        />
      </div>

      {results.length === 0 ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
          No material matching "{query}" is in the emission-factor catalog, and no line in this BOQ mentions it either.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
          {results.map((m) => {
            const present = m.line_item_count > 0
            const hasTextMatches = m.matchedLines && m.matchedLines.length > 0
            const isExpanded = !!expanded[m.category]
            return (
              <div
                key={m.category}
                style={{
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: present ? 'rgba(var(--c-overlay),0.03)' : 'transparent',
                  border: present ? 'none' : '1px dashed rgba(var(--c-overlay),0.08)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                      {materialLabel(m.category)}
                    </div>
                    {present ? (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {m.line_item_count} line{m.line_item_count === 1 ? '' : 's'} in this BOQ
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        Has a stored emission factor, but not present in this BOQ
                      </div>
                    )}
                    {!m.labelMatch && hasTextMatches && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', marginTop: 3 }}>
                        Not its own category name -- matched because {m.matchedLines.length} line{m.matchedLines.length === 1 ? '' : 's'} here mention "{query}"
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div className="tabular-nums" style={{ fontSize: '0.8125rem', fontWeight: 700, color: present ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {(m.gwp_kg_co2e / 1000).toFixed(m.gwp_kg_co2e > 0 ? 2 : 0)} t CO2e
                      </div>
                      {present && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.pct_of_total.toFixed(1)}% of total</div>
                      )}
                    </div>
                    {hasTextMatches && (
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [m.category]: !prev[m.category] }))}
                        className="btn-secondary"
                        style={{ padding: '4px 6px', fontSize: '0.7rem' }}
                        title="Show the matching line(s) from this BOQ"
                      >
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                    )}
                  </div>
                </div>
                {isExpanded && hasTextMatches && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(var(--c-overlay),0.06)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {m.matchedLines.map((li, idx) => (
                      <div key={idx} style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Row {li.row}:</span>{' '}
                        {li.enriched_description.length > 160 ? `${li.enriched_description.slice(0, 160)}...` : li.enriched_description}
                        {li.gwp_kg_co2e != null && (
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}> -- {(li.gwp_kg_co2e / 1000).toFixed(2)} t CO2e</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {query.trim() && unclassifiedMatchCount > 0 && (
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.45 }}>
          Also found in {unclassifiedMatchCount} line{unclassifiedMatchCount === 1 ? '' : 's'} this BOQ couldn't classify into any material
          category at all, so they're not counted above -- see "What Wasn't Computed, and Why" below.
        </p>
      )}
    </div>
  )
}
