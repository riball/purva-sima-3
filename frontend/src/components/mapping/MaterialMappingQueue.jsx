import React, { useState, useEffect, useMemo } from 'react'
import { Tags, Upload, FileSpreadsheet, CheckCircle2, XCircle, Sparkles, Search, PlusCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import StatCard from '../common/StatCard'

/**
 * Phase 5 -- Material Mapping Queue. Brand new screen (no mockup
 * equivalent beyond the name/concept) wired to app/api/onboarding.py's
 * real item-code classification pipeline, via the four wrapper functions
 * added to api/client.js in Phase 0 (uploadOnboardingJob, getOnboardingJob,
 * confirmOnboardingJob, getCanonicalCategories).
 *
 * Flow, matching the real backend exactly (see pipeline.py's own
 * docstring): upload a raw item-code workbook -> the backend runs a
 * cheap regex pass, then an LLM draft + a free local similarity opinion
 * for whatever's left -> returns one job with a review_queue sorted by
 * real impact (Rupee value when a priced document's amounts are
 * supplied, otherwise honest frequency -- see impact_basis). A reviewer
 * then either accepts an existing canonical-category template verbatim,
 * marks a row "not contributing" (service/labour/non-material), or
 * registers a genuinely new category -- never an invented emission
 * factor typed in free-form; a custom category still has to state its
 * own real source and factor, same discipline the backend's own
 * canonical_categories.py templates use.
 *
 * Deliberately dropped from the mockup's version of this screen (per the
 * reviewed spreadsheet): confidence-score coloring on auto-classified
 * rows and the 4-way status vocabulary -- the real vocabulary is just
 * "contributes": yes / no / need_review, so that's what's shown.
 */

const CONTRIBUTES_LABEL = { yes: 'Contributes', no: 'Not Contributing', need_review: 'Needs Review' }

export default function MaterialMappingQueue() {
  const { activeCompanyId, addToast } = useProject()

  const [file, setFile] = useState(null)
  const [useLlmDraft, setUseLlmDraft] = useState(true)
  const [isUploading, setIsUploading] = useState(false)

  const [job, setJob] = useState(null)
  const [canonicalCategories, setCanonicalCategories] = useState({})
  const [decisions, setDecisions] = useState({}) // code -> { fields, registerAsNewCategory, label }
  const [expandedCode, setExpandedCode] = useState(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.getCanonicalCategories().then(setCanonicalCategories).catch((err) => {
      console.warn('Could not load canonical categories:', err.message)
    })
  }, [])

  // A new company selection invalidates whatever job/decisions were in
  // progress -- the job is company-scoped on the backend, re-loading it
  // under a different active company would be meaningless.
  useEffect(() => {
    setJob(null)
    setDecisions({})
  }, [activeCompanyId])

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!file) {
      addToast('Select a raw item-code workbook (.xlsx, .xlsm, or .xls)', 'error')
      return
    }
    setIsUploading(true)
    try {
      const result = await api.uploadOnboardingJob(activeCompanyId, file, { useLlmDraft })
      setJob(result)
      setDecisions({})
      addToast(
        `${result.summary.n_auto_classified} auto-classified, ${result.summary.n_needs_review} need review`,
        'success',
        6000
      )
    } catch (err) {
      addToast(`Upload failed: ${err.message}`, 'error')
    } finally {
      setIsUploading(false)
    }
  }

  const setDecisionFromCategory = (code, categoryKey) => {
    if (!categoryKey) {
      setDecisions((prev) => {
        const next = { ...prev }
        delete next[code]
        return next
      })
      return
    }
    if (categoryKey === '__not_contributing__') {
      setDecisions((prev) => ({ ...prev, [code]: { fields: { contributes: 'no' }, label: 'Not Contributing' } }))
      return
    }
    const template = canonicalCategories[categoryKey]
    if (!template) return
    setDecisions((prev) => ({ ...prev, [code]: { fields: { ...template }, label: template.material_category } }))
  }

  const setCustomDecision = (code, custom) => {
    setDecisions((prev) => ({
      ...prev,
      [code]: {
        fields: {
          contributes: 'yes',
          material_category: custom.material_category,
          ef_kgco2e_per_kg: custom.ef_kgco2e_per_kg ? Number(custom.ef_kgco2e_per_kg) : undefined,
          ef_source: custom.ef_source,
          evidence_tier: custom.evidence_tier || 'user_provided',
          cea_adjusted: custom.cea_adjusted || 'no',
          unit_note: custom.unit_note,
        },
        registerAsNewCategory: custom.registerAsNew ? custom.material_category : undefined,
        label: custom.material_category || 'Custom category',
      },
    }))
  }

  const decidedCount = Object.keys(decisions).length
  const pendingQueue = useMemo(() => {
    if (!job) return []
    const q = job.review_queue || []
    if (!search.trim()) return q
    const s = search.trim().toLowerCase()
    return q.filter((r) => (r.desc || '').toLowerCase().includes(s) || (r.code || '').toLowerCase().includes(s))
  }, [job, search])

  const handleConfirm = async () => {
    if (!job || decidedCount === 0) return
    setIsConfirming(true)
    try {
      const decisionsPayload = Object.entries(decisions).map(([code, d]) => ({
        code,
        fields: d.fields,
        register_as_new_category: d.registerAsNewCategory,
      }))
      const result = await api.confirmOnboardingJob(activeCompanyId, job.job_id, decisionsPayload)
      addToast(
        `${result.decisions_applied} categorization${result.decisions_applied === 1 ? '' : 's'} applied to ${result.codes_written} item code${result.codes_written === 1 ? '' : 's'}` +
          (result.new_categories_registered.length ? ` -- registered ${result.new_categories_registered.join(', ')} as new canonical categories` : ''),
        'success',
        8000
      )
      // Re-fetch the job so confirmed rows drop out of the pending queue
      // (their contributes field is no longer "need_review") and the
      // canonical list picks up anything newly registered.
      const refreshed = await api.getOnboardingJob(activeCompanyId, job.job_id)
      setJob(refreshed)
      setDecisions({})
      if (result.new_categories_registered.length > 0) {
        api.getCanonicalCategories().then(setCanonicalCategories).catch(() => {})
      }
    } catch (err) {
      addToast(`Confirm failed: ${err.message}`, 'error')
    } finally {
      setIsConfirming(false)
    }
  }

  const stillPending = job ? job.review_queue.filter((r) => !decisions[r.code]) : []

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="glass-panel" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: '10px', background: 'rgba(var(--c-blue), 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-lime)' }}>
          <Tags size={18} />
        </div>
        <div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>Material Mapping Queue</h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
            Upload a raw item-code workbook to classify it into material categories -- auto-matched where possible, queued for your review otherwise.
          </p>
        </div>
      </div>

      {/* Upload */}
      <form onSubmit={handleUpload} className="glass-panel" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            style={{
              flex: 1,
              minWidth: 260,
              border: `2px dashed ${file ? 'rgba(var(--c-blue), 0.5)' : 'rgba(var(--c-blue), 0.25)'}`,
              borderRadius: 'var(--radius-lg)',
              padding: '18px 16px',
              textAlign: 'center',
              background: file ? 'rgba(var(--c-blue), 0.06)' : 'rgba(var(--c-surf-2), 0.65)',
              cursor: 'pointer',
            }}
            onClick={() => document.getElementById('mapping-file-input').click()}
          >
            <input
              type="file"
              id="mapping-file-input"
              accept=".xlsx,.xlsm,.xls"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files[0] || null)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <Upload size={20} color="var(--accent-lime)" />
              <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                {file ? file.name : 'Select a raw item-code workbook (.xlsx, .xlsm, .xls)'}
              </span>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={useLlmDraft} onChange={(e) => setUseLlmDraft(e.target.checked)} />
            Use LLM draft for ambiguous rows
          </label>

          <button type="submit" className="btn-primary" disabled={isUploading || !file} style={{ padding: '10px 22px' }}>
            {isUploading ? 'Classifying...' : 'Upload & Classify'}
          </button>
        </div>
      </form>

      {job && (
        <>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <StatCard title="Raw Codes" value={job.n_raw_codes} subtitle={`${job.n_unique_descriptions} unique descriptions`} accent="cyan" icon={FileSpreadsheet} />
            <StatCard title="Auto-Classified" value={job.summary.n_auto_classified} subtitle="Matched on the regex pass" accent="lime" badge="Done" badgeType="lime" icon={CheckCircle2} />
            <StatCard title="Needs Review" value={stillPending.length} subtitle={`${job.summary.n_llm_drafted} have an LLM draft suggestion`} accent="amber" badge="Pending" badgeType="amber" icon={Sparkles} />
            <StatCard title="Reviewed, Not Yet Confirmed" value={decidedCount} subtitle="Click Confirm below to write them" accent="mint" />
          </div>

          {/* Search + Confirm bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 420 }}>
              <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Filter by code or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: 30, fontSize: '0.8125rem' }}
              />
            </div>
            <button onClick={handleConfirm} disabled={isConfirming || decidedCount === 0} className="btn-primary" style={{ padding: '9px 20px' }}>
              {isConfirming ? 'Writing...' : `Confirm ${decidedCount} Reviewed Item${decidedCount === 1 ? '' : 's'}`}
            </button>
          </div>

          {/* Review queue */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Review Queue</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              Sorted by real impact -- {job.review_queue[0]?.impact_basis === 'amount' ? 'Rupee value from the paired priced document' : 'how many original item codes collapsed into each description (no priced document was supplied)'}.
            </p>

            {pendingQueue.length === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                {job.review_queue.length === 0 ? 'Nothing needs review -- every row was auto-classified.' : 'No rows match that filter.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingQueue.map((row) => (
                  <ReviewRow
                    key={row.code}
                    row={row}
                    decision={decisions[row.code]}
                    canonicalCategories={canonicalCategories}
                    isExpanded={expandedCode === row.code}
                    onToggleExpand={() => setExpandedCode((c) => (c === row.code ? null : row.code))}
                    onSelectCategory={(categoryKey) => setDecisionFromCategory(row.code, categoryKey)}
                    onCustomDecision={(custom) => setCustomDecision(row.code, custom)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ReviewRow({ row, decision, canonicalCategories, isExpanded, onToggleExpand, onSelectCategory, onCustomDecision }) {
  const [showCustom, setShowCustom] = useState(false)
  const [custom, setCustom] = useState({ material_category: '', ef_kgco2e_per_kg: '', ef_source: '', cea_adjusted: 'no', unit_note: '', registerAsNew: false })

  const selectValue = decision
    ? decision.registerAsNewCategory !== undefined || showCustom
      ? '__custom__'
      : decision.fields.contributes === 'no'
        ? '__not_contributing__'
        : Object.keys(canonicalCategories).find((k) => canonicalCategories[k].material_category === decision.fields.material_category) || ''
    : ''

  return (
    <div
      style={{
        background: decision ? 'rgba(var(--c-blue), 0.06)' : 'rgba(var(--c-surf-2), 0.6)',
        border: `1px solid ${decision ? 'rgba(var(--c-blue), 0.3)' : 'rgba(var(--c-blue), 0.1)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{row.desc || row.code}</span>
            {decision && <CheckCircle2 size={14} color="var(--accent-lime)" />}
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {row.code} · {row.unit || 'no unit'} · {row.group_size} code{row.group_size === 1 ? '' : 's'} merged ·{' '}
            {row.impact_basis === 'amount' ? `₹${row.impact.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `impact score ${row.impact}`}
          </span>

          {(row.llm_draft || row.similarity_suggestion) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {row.llm_draft && row.llm_draft.suggested_category !== 'none' && (
                <button
                  type="button"
                  onClick={() => onToggleExpand()}
                  className="badge badge-cyan"
                  style={{ fontSize: '0.65rem', cursor: 'pointer', border: 'none' }}
                  title="Click to see the LLM's reasoning"
                >
                  <Sparkles size={10} /> LLM suggests: {row.llm_draft.suggested_category}
                </button>
              )}
              {row.similarity_suggestion?.suggested_category && (
                <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
                  Similar rows: {row.similarity_suggestion.suggested_category}
                </span>
              )}
            </div>
          )}

          {isExpanded && row.llm_draft && (
            <div style={{ marginTop: 8, padding: 10, background: 'rgba(var(--c-overlay),0.03)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Rationale:</strong> {row.llm_draft.rationale || 'none given'}
              {row.llm_draft.cited_words?.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Cited from description:</strong>{' '}
                  {row.llm_draft.cited_words.map((w) => (
                    <span key={w} className="badge badge-muted" style={{ fontSize: '0.62rem', marginRight: 4 }}>{w}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ minWidth: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value
              if (v === '__custom__') {
                setShowCustom(true)
                return
              }
              setShowCustom(false)
              onSelectCategory(v)
            }}
            className="form-select"
            style={{ fontSize: '0.78rem' }}
          >
            <option value="">-- Choose how to classify --</option>
            {row.llm_draft?.suggested_category && row.llm_draft.suggested_category !== 'none' && canonicalCategories[row.llm_draft.suggested_category] && (
              <option value={row.llm_draft.suggested_category}>★ {row.llm_draft.suggested_category} (LLM suggestion)</option>
            )}
            {Object.keys(canonicalCategories)
              .filter((k) => k !== row.llm_draft?.suggested_category)
              .map((k) => (
                <option key={k} value={k}>{canonicalCategories[k].material_category}</option>
              ))}
            <option value="__not_contributing__">Not Contributing (service / labour / non-material)</option>
            <option value="__custom__">Custom / Register New Category...</option>
          </select>
        </div>
      </div>

      {showCustom && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(var(--c-overlay),0.06)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input placeholder="Category key, e.g. aluminium_cladding" className="form-input" style={{ fontSize: '0.78rem' }}
            value={custom.material_category} onChange={(e) => setCustom((c) => ({ ...c, material_category: e.target.value }))} />
          <input placeholder="Emission factor (kgCO2e/kg)" type="number" step="any" className="form-input" style={{ fontSize: '0.78rem' }}
            value={custom.ef_kgco2e_per_kg} onChange={(e) => setCustom((c) => ({ ...c, ef_kgco2e_per_kg: e.target.value }))} />
          <input placeholder="Source citation (required -- never invent a factor)" className="form-input" style={{ fontSize: '0.78rem', gridColumn: '1 / -1' }}
            value={custom.ef_source} onChange={(e) => setCustom((c) => ({ ...c, ef_source: e.target.value }))} />
          <input placeholder="Unit conversion note, if any" className="form-input" style={{ fontSize: '0.78rem', gridColumn: '1 / -1' }}
            value={custom.unit_note} onChange={(e) => setCustom((c) => ({ ...c, unit_note: e.target.value }))} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={custom.registerAsNew} onChange={(e) => setCustom((c) => ({ ...c, registerAsNew: e.target.checked }))} />
            Register as a new canonical category (future uploads, any company, auto-recognize this)
          </label>
          <button
            type="button"
            className="btn-primary"
            style={{ fontSize: '0.75rem', padding: '6px 14px' }}
            disabled={!custom.material_category || !custom.ef_kgco2e_per_kg || !custom.ef_source}
            onClick={() => { onCustomDecision(custom); setShowCustom(false) }}
          >
            <PlusCircle size={13} /> Apply
          </button>
        </div>
      )}
    </div>
  )
}
