import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Clock, Plus, AlertTriangle, Upload, FileText, BarChart3, TrendingUp, Trash2,
  SlidersHorizontal, CheckCircle2, XCircle, Lock, ArrowLeft, Download, Sparkles,
  ChevronUp, ChevronDown, X, FlaskConical, ArrowUpRight, Pencil, ArrowRight, Info,
  Maximize2, Minimize2, RotateCcw, LayoutGrid, Wand2,
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { api } from '../../api/client'
import { useProject } from '../../context/ProjectContext'
import { downloadCsv } from '../../utils/csvExport'
import { originLabel } from '../../utils/projectOrigin'
import StatCard from '../common/StatCard'
import MaterialBreakdownChart, { aggregateCategories, CATEGORY_COLORS, CATEGORY_LABELS, FALLBACK_COLOR } from '../common/charts/MaterialBreakdownChart'
import CarbonDataExplorer from '../charts/CarbonDataExplorer'
import ChatBar from '../hub/ChatBar'
import SaveProjectNameModal from '../shared/SaveProjectNameModal'

/**
 * Project Dashboard -- rebuilt against the user's own line-by-line
 * "Projects & Embodied Carbon Directory" spec (see the approved plan at
 * staged-wobbling-salamander.md). Reached only from a card in
 * ProjectDirectory.jsx (the 'project' view) or the 'tracking' shortcut --
 * this file itself is the 'project-dashboard' view.
 *
 * Changes from the prior reskin of TrackingChatHub/Phase4View, section by
 * section (numbers match the user's own spec):
 *  - Item 3: header drops the ProjectSwitcher dropdown and any Client/
 *    Engineer fields (never had them) for a plain project name + a quick
 *    menu (Upload Bill / Add Chart / Export Report / Ask Copilot) plus a
 *    "All Projects" back-link to the Directory and "Last updated".
 *  - Item 4: a "Latest Bill Dated" StatCard using the now-reliable
 *    extracted billed_date (see cop_bill_parser.py), not the upload date.
 *  - Item 5: Carbon Trends becomes a small chart sandbox (add/remove/
 *    reorder cards, each with its own dataset), and the baseline/
 *    projected lines are progressive per-bill figures (computed here,
 *    frontend-only -- see progressiveSeries below, mirroring
 *    phase3.compute_dashboard()'s own latest-only formula applied to
 *    every point) instead of flat reference lines.
 *  - Item 6: a real Materials table (Emission Factor / Database Source
 *    columns, backed by the new representative_emission_factor /
 *    dominant_factor_source fields) under the existing breakdown chart.
 *  - Item 7: no structural change needed here -- the Bills table already
 *    renders `billed_date` straight from the backend, which now derives
 *    it from the COP PDF itself rather than the uploader's typed date.
 *  - Item 8: "Confirm" in Alternatives (renamed "(Beta)") now calls the
 *    confirm-as-beta endpoint, which forks a new sibling project instead
 *    of mutating this one -- a banner links to the new Beta project
 *    instead of updating this page's own figures.
 *  - Item 9: the old "Data Quality & Audit" section is removed entirely
 *    (the backend audit-log endpoints are untouched, just unused here --
 *    Reports & Audits still exposes the same data for a BOQ-sourced
 *    project).
 */

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function guessDateFromPeriod(text) {
  if (!text) return null
  const t = text.trim().toLowerCase()

  const isoMatch = t.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    if (month >= 1 && month <= 12) {
      const day = isoMatch[3] ? Number(isoMatch[3]) : new Date(year, month, 0).getDate()
      return `${isoMatch[1]}-${isoMatch[2]}-${String(day).padStart(2, '0')}`
    }
  }

  const quarterMatch = t.match(/q([1-4])[^0-9]*(\d{4})/) || t.match(/(\d{4})[^0-9]*q([1-4])/)
  if (quarterMatch) {
    const [, a, b] = quarterMatch
    const year = a.length === 4 ? Number(a) : Number(b)
    const quarter = a.length === 4 ? Number(b) : Number(a)
    const endMonth = quarter * 3
    const day = new Date(year, endMonth, 0).getDate()
    return `${year}-${String(endMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const mLabelMatch = t.match(/\bm(\d{1,2})[^0-9]*(\d{4})\b/)
  if (mLabelMatch) {
    const month = Number(mLabelMatch[1])
    const year = Number(mLabelMatch[2])
    if (month >= 1 && month <= 12) {
      const day = new Date(year, month, 0).getDate()
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const monthIdx = MONTH_NAMES.findIndex((name) => t.includes(name) || t.includes(name.slice(0, 3)))
  if (monthIdx !== -1) {
    const yearMatch = t.match(/(\d{4})/) || t.match(/\b(\d{2})\b/)
    const currentYear = new Date().getFullYear()
    let year = currentYear
    if (yearMatch) {
      year = yearMatch[1].length === 4 ? Number(yearMatch[1]) : 2000 + Number(yearMatch[1])
    }
    const month = monthIdx + 1
    const day = new Date(year, month, 0).getDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return null
}

// "Name every section like how the mockup has named it" (Phase F) -- the
// mockup only actually demonstrates the "Section N: ..." convention on
// two sections (its own Section 2 and Section 5 screenshots), which fixes
// the numbering for all five since they're the same five sections in the
// same order; 1/3/4 keep their existing short names rather than inventing
// mockup wording that was never shown. Nav pills stay short ("Section N:"
// + the compact label); each section's own <h3> below carries the fuller
// mockup title where the mockup gave one (2 and 5), or the existing
// heading text prefixed the same way (1, 3, 4).
const SECTIONS = [
  { id: 'summary', label: 'Section 1: Summary' },
  { id: 'trends', label: 'Section 2: Carbon Trends' },
  { id: 'materials', label: 'Section 3: Materials' },
  { id: 'bills', label: 'Section 4: Bills & Progress' },
  { id: 'alternatives', label: 'Section 5: Alternatives (Beta)' },
]

// Item 4 ("name every section like how the mockup has named it") applied
// to the chart grid's own titles, not just page section headers --
// `subtitle` is the muted line ChartCardBlock now shows under each title.
// `chartType` is the single chart form this codebase actually renders for
// that dataset today (see ChartBuilderModal's own comment on why the
// Custom Configurator's type picker is a disabled single-option select
// rather than a real multi-type switch -- an honest reflection of scope,
// not a placeholder bug).
const CHART_DATASETS = [
  { id: 'carbon-over-time', label: 'Trajectory', subtitle: 'Baseline vs cumulative billed carbon over time', chartType: 'Combo (line + bar)' },
  { id: 'material-breakdown', label: 'Share by Material', subtitle: 'Proportion of total carbon by material category', chartType: 'Donut' },
  { id: 'material-ranking', label: 'Hotspot Ranking', subtitle: 'Highest-impact material categories, ranked', chartType: 'Horizontal Bar' },
  { id: 'substitution-impact', label: 'Substitution Impact', subtitle: 'Current spec vs. verified lower-carbon alternative, per catalog entry', chartType: 'Grouped Bar' },
  { id: 'progress-vs-intensity', label: 'Carbon Intensity Over Time', subtitle: 'kgCO₂e per m² across logged bills', chartType: 'Line' },
]

// Phase E's "4 mockup cards instead of 1" default layout, also what
// "Reset Layout" restores. Always rebuilt with fresh ids (never the same
// array reference reused across projects/resets) so React never confuses
// one project's expand/collapse state for another's.
const defaultChartCards = () => [
  { id: `c-${Date.now()}-traj`, dataset: 'carbon-over-time' },
  { id: `c-${Date.now()}-hot`, dataset: 'material-ranking' },
  { id: `c-${Date.now()}-share`, dataset: 'material-breakdown' },
  { id: `c-${Date.now()}-sub`, dataset: 'substitution-impact' },
]

// The Interactive Chart Builder's 4 named Guided Presets (mockup-named),
// each just a fixed { dataset } card -- same cards the Custom Configurator
// tab can build piece by piece, pre-assembled for one-click add.
const CHART_PRESETS = [
  { id: 'preset-trajectory', name: 'Executive Trajectory Summary', description: 'The 3-series baseline/cumulative/period trend used for stakeholder updates.', dataset: 'carbon-over-time' },
  { id: 'preset-hotspot', name: 'Top Carbon Driving Packages', description: 'Ranks material categories by embodied carbon, highest first.', dataset: 'material-ranking' },
  { id: 'preset-scenario', name: 'Decarbonization Scenario Sandbox', description: 'Every catalog swap’s current-spec vs. alternative carbon, side by side.', dataset: 'substitution-impact' },
  { id: 'preset-donut', name: 'Embodied Carbon Share Donut', description: 'Each material category’s share of total embodied carbon.', dataset: 'material-breakdown' },
]

function EmptyNote({ text }) {
  return <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>{text}</div>
}

function ChartTooltipBox({ children }) {
  return (
    <div
      style={{
        background: 'rgba(var(--c-surf-6),0.95)',
        border: '1px solid rgba(var(--c-blue),0.35)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 11,
        color: 'var(--text-primary)',
        boxShadow: '0 6px 18px rgba(var(--c-black),0.4)',
      }}
    >
      {children}
    </div>
  )
}

// Item 5's "material ranking" dataset -- same aggregateCategories() output
// Section 3's breakdown chart and the Materials table both use, just
// rendered as a sorted horizontal bar ranking with a real hover tooltip
// (dataviz: hover is default, not optional).
function MaterialRankingChart({ bills, height = 320 }) {
  const { rows } = useMemo(() => aggregateCategories(bills), [bills])
  if (rows.length === 0) return <EmptyNote text="No category data yet -- add a bill to see material ranking." />

  const data = rows.map((r) => ({
    name: CATEGORY_LABELS[r.category] || (r.category ? r.category.replace(/_/g, ' ') : 'Uncategorized'),
    category: r.category,
    tonnes: r.total / 1000,
  }))

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="rgba(var(--c-overlay),0.06)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <ChartTooltipBox>
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  <div>{p.tonnes.toFixed(1)} tCO₂e</div>
                </ChartTooltipBox>
              )
            }}
          />
          <Bar dataKey="tonnes" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.category || i} fill={CATEGORY_COLORS[d.category] || FALLBACK_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Phase E's "Substitution Impact" dataset -- the mockup's "Decarbonization
// Scenario Sandbox" card: every APPLICABLE catalog entry's current-spec
// vs. alternative carbon, grouped side by side (never a single merged bar
// -- "two measures -> two bars", the same two-bar-comparison principle
// CompareBars uses elsewhere in the app). Explicitly KEPT here even after
// Section 5's own "Baseline vs Current Carbon" chart was removed per
// request -- this one lives in Section 2's analytical grid, not
// Alternatives, and is the real "baseline vs. after-swap" comparison the
// user asked to keep.
// Sourced straight from catalogPreview (Phase D's read-only, real-recompute
// catalog-preview endpoint) -- never a second, approximate calculation.
// Entries with applicable: false are excluded here (there's nothing to
// compare for them), matching how they're already shown separately, muted,
// in the Alternatives grid rather than silently as a zero-height bar pair.
function SubstitutionImpactChart({ catalogPreview, height = 320 }) {
  const data = (catalogPreview || [])
    .filter((e) => e.applicable)
    .map((e) => ({
      name: e.label,
      original: e.original_gwp_kg_co2e / 1000,
      alternative: e.new_gwp_kg_co2e / 1000,
    }))

  if (data.length === 0) return <EmptyNote text="No applicable material swaps for this baseline yet -- see the Alternatives section below." />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--chart-ord-light)' }} />
          Current Spec
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--accent-lime)' }} />
          Verified Alternative
        </span>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }} barGap={3}>
            <CartesianGrid stroke="rgba(var(--c-overlay),0.06)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload
                return (
                  <ChartTooltipBox>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
                    <div style={{ color: 'var(--chart-ord-light)' }}>Current: {p.original.toFixed(1)} tCO₂e</div>
                    <div style={{ color: 'var(--accent-lime)' }}>Alternative: {p.alternative.toFixed(1)} tCO₂e</div>
                  </ChartTooltipBox>
                )
              }}
            />
            <Bar dataKey="original" name="Current Spec" fill="var(--chart-ord-light)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="alternative" name="Verified Alternative" fill="var(--accent-lime)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Item 5's "progress vs intensity" dataset -- a single-axis line (never a
// dual-axis chart, per dataviz's #1 anti-pattern) of carbon intensity
// (kgCO2e/m²) over time, with % complete surfaced in the hover tooltip
// rather than a second scale.
function IntensityOverTimeChart({ dashboardPoints, baseline, height = 320 }) {
  const data = useMemo(() => {
    if (!baseline?.floor_area_sqm) return []
    return dashboardPoints
      .filter((p) => p.quantity_basis !== 'present')
      .map((p) => ({
        period: p.period,
        dateLabel: new Date(p.billed_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }),
        intensity: p.total_gwp_kg_co2e_to_date / baseline.floor_area_sqm,
        percentComplete: p.stated_percent_complete,
      }))
  }, [dashboardPoints, baseline])

  if (!baseline?.floor_area_sqm) return <EmptyNote text="This project has no floor area recorded -- carbon intensity can't be computed." />
  if (data.length === 0) return <EmptyNote text="Add a cumulative bill to see carbon intensity over time." />

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="rgba(var(--c-overlay),0.06)" vertical={false} />
          <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'rgba(var(--c-overlay),0.1)' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => v.toFixed(0)} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <ChartTooltipBox>
                  <div style={{ fontWeight: 700 }}>{p.period}</div>
                  <div style={{ color: 'var(--accent-mint)', fontWeight: 600 }}>{p.intensity.toFixed(1)} kgCO₂e/m²</div>
                  {p.percentComplete != null && <div style={{ color: 'var(--text-tertiary)' }}>{p.percentComplete.toFixed(1)}% complete</div>}
                </ChartTooltipBox>
              )
            }}
          />
          <Line type="monotone" dataKey="intensity" stroke="var(--accent-mint)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// UX refinement: the small, consistent "this is an estimate, not a
// measured bill" disclosure shown above any chart rendered from
// estimateBill or the baseline's own estimated total -- never silent
// about the distinction, per the user's own "mentioning it as an
// 'estimate'" wording.
export function EstimateBadge({ text = 'Estimated from the locked Conceptual Estimate baseline -- no bills logged yet, so this is not a measured breakdown.' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
      <span className="badge badge-amber" style={{ fontSize: '0.68rem' }}>Estimate</span>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{text}</span>
    </div>
  )
}

// The "material breakdown chart could show the same thing as what is seen
// in the conceptual page" -- same donut (MaterialBreakdownDonut in
// ConceptualEstimatePage.jsx: Recharts PieChart, innerRadius/outerRadius
// ring, per-category Cell colors, a 2-col legend with %) reused here for
// the ESTIMATE-only view, so a project tracked from a Conceptual Estimate
// shows the identical visual it already showed before baselining. Takes
// the baseline's material_breakdown snapshot ({category, gwp_kg_co2e}
// rows), not calculationResult.carbon.breakdown ({material, carbon_kg})
// -- same data, different field names (one's a live CalculationResult,
// the other a locked Phase3Baseline snapshot), reconciled here rather
// than changing either backend shape. Section 3 (Materials) still
// switches to MaterialBreakdownChart's two-segment stacked bar once a
// real bill exists -- the donut stays ESTIMATE-only THERE, per the
// user's own "after bills uploaded, retreat to the bar ranking style".
//
// Phase E generalizes this same donut for Section 2's "Share by Material"
// grid card, which the mockup shows as a normal default card, not an
// estimate-only fallback -- so this now ALSO accepts `bills` (real,
// already-logged BillPeriods), aggregated the exact same way
// MaterialBreakdownChart does (aggregateCategories, basis-aware
// cumulative/present handling and all) rather than re-deriving category
// totals a second way. A caller passes either `bills` (real data,
// preferred when non-empty) or `materialBreakdown` (the estimate
// snapshot) -- never both meaningfully at once.
export function EstimatedMaterialBreakdownDonut({ materialBreakdown, bills, totalCarbonKg, height = 220 }) {
  const aggregated = useMemo(() => (bills && bills.length > 0 ? aggregateCategories(bills) : null), [bills])
  const data = aggregated
    ? aggregated.rows.map((r) => ({ category: r.category, gwp_kg_co2e: r.total }))
    : (materialBreakdown || []).filter((item) => (item.gwp_kg_co2e || 0) > 0)
  const effectiveTotal = totalCarbonKg || data.reduce((sum, d) => sum + (d.gwp_kg_co2e || 0), 0)

  if (data.length === 0) return <EmptyNote text="No material breakdown available yet." />

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={62} outerRadius={94} paddingAngle={3} dataKey="gwp_kg_co2e">
              {data.map((entry, idx) => (
                <Cell key={entry.category || idx} fill={CATEGORY_COLORS[entry.category] || FALLBACK_COLOR} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
              formatter={(val, _name, item) => [
                `${(val / 1000).toFixed(1)} tCO₂e`,
                CATEGORY_LABELS[item.payload.category] || item.payload.category,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, maxWidth: 420 }}>
        {data.map((item, idx) => (
          <div key={item.category || idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: CATEGORY_COLORS[item.category] || FALLBACK_COLOR, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {CATEGORY_LABELS[item.category] || (item.category ? item.category.replace(/_/g, ' ') : 'Uncategorized')}
              </span>
            </span>
            <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>
              {item.pct_of_total != null ? Math.round(item.pct_of_total) : effectiveTotal ? Math.round(((item.gwp_kg_co2e || 0) / effectiveTotal) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// The "carbon-over-time" dataset's fallback for a project with no bills
// yet but an estimated (phase1_estimate) baseline. CarbonDataExplorer
// fundamentally plots a real time series (cumulativePoints/
// presentOnlyPoints) -- forcing a single estimated point into it would
// risk it being read as a real "Cumulative (Billed)" series. Instead this
// is a separate, honestly-labeled visual: the estimated total as a
// headline figure, plus (when available) its own material breakdown as a
// ranked bar -- the same shape MaterialRankingChart already renders for
// real bills, reused here via estimateBill.
function EstimatedBaselineCard({ baseline }) {
  if (!baseline?.total_gwp_kg_co2e) {
    return <EmptyNote text="No bills logged yet, and no Conceptual Estimate baseline is available for this project." />
  }
  const tonnes = baseline.total_gwp_kg_co2e / 1000
  const rows = [...(baseline.material_breakdown || [])]
    .sort((a, b) => (b.gwp_kg_co2e || 0) - (a.gwp_kg_co2e || 0))
    .map((r) => ({
      name: CATEGORY_LABELS[r.category] || (r.category ? r.category.replace(/_/g, ' ') : 'Uncategorized'),
      category: r.category,
      tonnes: (r.gwp_kg_co2e || 0) / 1000,
    }))

  return (
    <div>
      <EstimateBadge text="From the locked Conceptual Estimate -- no bills logged yet, so there's no real trend over time to plot. This is the estimated baseline total, by material." />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
        <span className="tabular-nums" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)' }}>{tonnes.toFixed(1)}</span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--accent-amber)' }}>tCO₂e estimated baseline</span>
      </div>
      {rows.length > 0 && (
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="rgba(var(--c-overlay),0.06)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <ChartTooltipBox>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div>{p.tonnes.toFixed(1)} tCO₂e (estimated)</div>
                    </ChartTooltipBox>
                  )
                }}
              />
              <Bar dataKey="tonnes" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {rows.map((d, i) => (
                  <Cell key={d.category || i} fill={CATEGORY_COLORS[d.category] || FALLBACK_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// One card in the Section 2 "Carbon Performance & Analytical Grid"
// sandbox -- the add/rearrange/delete setup the user chose over a fixed
// grid of charts, now restyled to the mockup's card chrome (Phase E):
// plain white `glass-panel` surface, a title+muted-subtitle header (from
// CHART_DATASETS, or a Custom Configurator override on the card itself)
// instead of an inline re-pick-the-dataset dropdown, and an expand toggle
// alongside the existing reorder/delete icons. A card's dataset is now set
// once, at add time, via the Interactive Chart Builder (ChartBuilderModal)
// -- "add a specific chart" rather than "reconfigure this slot's data
// source in place" matches how the mockup's own grid behaves.
// `carbon-over-time` is the only dataset wired to the real propose/
// delete-bill interactions (CarbonDataExplorer's own onPointClick), since
// the rest are read-only summaries of the same underlying data.
//
// Extracted out of ChartCardBlock so ChartBuilderModal's live preview
// renders the EXACT same component tree a real card would -- never a
// second, simplified approximation of what "Add to Dashboard" will
// actually produce.
function renderChartBody(dataset, chartData, { chartHeight = 320, explorerHeight = 420 } = {}) {
  if (dataset === 'carbon-over-time') {
    return chartData.bills.length === 0 && chartData.baseline?.is_estimated ? (
      <EstimatedBaselineCard baseline={chartData.baseline} />
    ) : (
      <CarbonDataExplorer
        cumulativePoints={chartData.cumulativePoints}
        presentOnlyPoints={chartData.presentOnlyPoints}
        baselineTonnes={chartData.baselineTonnes}
        projectedTonnes={chartData.projectedTonnes}
        baselineSeries={chartData.baselineSeries}
        projectedSeries={chartData.projectedSeries}
        isExceedingBaseline={chartData.isExceedingBaseline}
        proposedTonnes={chartData.proposedTonnes}
        billStatus={chartData.billStatus}
        onPointClick={chartData.onPointClick}
        height={explorerHeight}
        defaultSeriesKeys={['baseline', 'cumulative', 'present']}
      />
    )
  }
  if (dataset === 'material-breakdown') {
    if (chartData.bills.length > 0) return <EstimatedMaterialBreakdownDonut bills={chartData.bills} height={chartHeight - 100} />
    if (chartData.estimateBill) {
      return (
        <>
          <EstimateBadge />
          <EstimatedMaterialBreakdownDonut
            materialBreakdown={chartData.estimateBill.category_breakdown}
            totalCarbonKg={chartData.baseline?.total_gwp_kg_co2e}
            height={chartHeight - 100}
          />
        </>
      )
    }
    return <EmptyNote text="Add a bill to see its material breakdown here." />
  }
  if (dataset === 'material-ranking') {
    if (chartData.bills.length > 0) return <MaterialRankingChart bills={chartData.bills} height={chartHeight} />
    if (chartData.estimateBill) {
      return (
        <>
          <EstimateBadge />
          <MaterialRankingChart bills={[chartData.estimateBill]} height={chartHeight} />
        </>
      )
    }
    return <MaterialRankingChart bills={chartData.bills} height={chartHeight} />
  }
  if (dataset === 'substitution-impact') return <SubstitutionImpactChart catalogPreview={chartData.catalogPreview} height={chartHeight} />
  if (dataset === 'progress-vs-intensity') {
    return <IntensityOverTimeChart dashboardPoints={chartData.dashboardPoints} baseline={chartData.baseline} height={chartHeight} />
  }
  return null
}

function ChartCardBlock({ card, idx, total, onRemove, onMoveUp, onMoveDown, onToggleExpand, chartData }) {
  const meta = CHART_DATASETS.find((d) => d.id === card.dataset)
  const title = card.title || meta?.label || card.dataset
  const subtitle = card.subtitle || meta?.subtitle
  const isExpanded = !!card.expanded
  const chartHeight = isExpanded ? 560 : 320
  const explorerHeight = isExpanded ? 560 : 420

  return (
    <div className="glass-panel" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{title}</h4>
          {subtitle && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={onMoveUp} disabled={idx === 0} title="Move up" className="btn-secondary" style={{ padding: '5px 8px' }}>
            <ChevronUp size={13} />
          </button>
          <button type="button" onClick={onMoveDown} disabled={idx === total - 1} title="Move down" className="btn-secondary" style={{ padding: '5px 8px' }}>
            <ChevronDown size={13} />
          </button>
          <button type="button" onClick={onToggleExpand} title={isExpanded ? 'Collapse' : 'Expand'} className="btn-secondary" style={{ padding: '5px 8px' }}>
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button type="button" onClick={onRemove} title="Remove this chart" className="btn-danger" style={{ padding: '5px 8px' }}>
            <X size={13} />
          </button>
        </div>
      </div>

      {renderChartBody(card.dataset, chartData, { chartHeight, explorerHeight })}
    </div>
  )
}

// The Interactive Chart Builder (Phase E) -- opened by "Add Custom Chart".
// Guided Presets: the mockup's 4 named presets, one click each. Custom
// Dataset & Configurator: title/subtitle, a dataset dropdown, a
// compatible-chart-type picker, and a live preview built from
// renderChartBody -- the SAME render path a real card uses, so the
// preview never lies about what gets added.
//
// The chart-type picker is deliberately a single, disabled option rather
// than a real multi-type switch: this codebase renders exactly one fixed
// chart form per dataset today (see CHART_DATASETS' own `chartType`
// field) -- there's no donut-vs-bar toggle wired up underneath for any of
// them yet. Showing it as "only enabling types the chosen dataset can
// actually render" (one, here) is the honest version of that contract
// rather than presenting a choice this build can't actually honor.
function ChartBuilderModal({ isOpen, onClose, tab, onTabChange, onAddPreset, onAddCustom, chartData }) {
  const [customDataset, setCustomDataset] = useState('carbon-over-time')
  const [customTitle, setCustomTitle] = useState('')
  const [customSubtitle, setCustomSubtitle] = useState('')

  if (!isOpen) return null
  const customMeta = CHART_DATASETS.find((d) => d.id === customDataset)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(var(--c-black), 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 720, maxHeight: '85vh', overflowY: 'auto', padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wand2 size={18} color="var(--accent-lime)" />
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>Interactive Chart Builder</h3>
          </div>
          <button type="button" onClick={onClose} title="Close" className="btn-secondary" style={{ padding: '5px 8px' }}>
            <X size={15} />
          </button>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 20 }}>
          Add a ready-made chart from the presets below, or build a custom one from any dataset this project has.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid rgba(var(--c-overlay), 0.08)' }}>
          <button
            type="button"
            onClick={() => onTabChange('presets')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px', marginBottom: -1,
              fontSize: '0.8125rem', fontWeight: 700,
              color: tab === 'presets' ? 'var(--accent-lime)' : 'var(--text-muted)',
              borderBottom: tab === 'presets' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            }}
          >
            Guided Presets
          </button>
          <button
            type="button"
            onClick={() => onTabChange('custom')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px', marginBottom: -1, marginLeft: 16,
              fontSize: '0.8125rem', fontWeight: 700,
              color: tab === 'custom' ? 'var(--accent-lime)' : 'var(--text-muted)',
              borderBottom: tab === 'custom' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            }}
          >
            Custom Dataset & Configurator
          </button>
        </div>

        {tab === 'presets' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {CHART_PRESETS.map((preset) => (
              <div key={preset.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid rgba(var(--c-blue), 0.12)', background: 'rgba(var(--c-surf-2), 0.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(var(--c-blue), 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-lime)', flexShrink: 0 }}>
                    <LayoutGrid size={17} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>{preset.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{preset.description}</div>
                  </div>
                </div>
                <button type="button" onClick={() => onAddPreset(preset)} className="btn-primary" style={{ fontSize: '0.78rem', padding: '6px 14px', flexShrink: 0 }}>
                  Add to Dashboard
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Chart Title</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={customMeta?.label || ''}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Subtitle</label>
                <input
                  type="text"
                  value={customSubtitle}
                  onChange={(e) => setCustomSubtitle(e.target.value)}
                  placeholder={customMeta?.subtitle || ''}
                  className="form-input"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Primary Dataset</label>
                <select value={customDataset} onChange={(e) => setCustomDataset(e.target.value)} className="form-select">
                  {CHART_DATASETS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Chart Type</label>
                <select value={customMeta?.chartType || ''} disabled className="form-select" style={{ opacity: 0.7 }}>
                  <option value={customMeta?.chartType || ''}>{customMeta?.chartType}</option>
                </select>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Only the type this dataset supports is offered.</span>
              </div>
            </div>

            <div>
              <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Live Preview</label>
              <div style={{ background: 'rgba(var(--c-surf-2), 0.5)', border: '1px solid rgba(var(--c-blue), 0.12)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{customTitle || customMeta?.label}</h4>
                {(customSubtitle || customMeta?.subtitle) && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>{customSubtitle || customMeta?.subtitle}</p>
                )}
                {renderChartBody(customDataset, chartData, { chartHeight: 240, explorerHeight: 280 })}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => onAddCustom(customDataset, { title: customTitle, subtitle: customSubtitle })}
                className="btn-primary"
                style={{ fontSize: '0.8125rem', padding: '8px 16px' }}
              >
                <Plus size={14} />
                <span>Add Chart Card to Dashboard</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProjectDashboard() {
  const { activeCompanyId, activeProjectId, activeProject, loadProjects, addToast, navigate, selectProject } = useProject()

  const [activeSection, setActiveSection] = useState('summary')

  // --- Phase 3: dashboard / bills / baseline state ---
  const [dashboard, setDashboard] = useState(null)
  const [bills, setBills] = useState([])
  const [chatTools, setChatTools] = useState({})

  // "I should be able to modify the name of the project even after
  // creating the Project" -- reuses the same SaveProjectNameModal every
  // other rename affordance in the app already uses (ProjectDirectory,
  // PortfolioOverview), just newly wired up here on the Dashboard header.
  const [showRenameModal, setShowRenameModal] = useState(false)

  const [showBaselineModal, setShowBaselineModal] = useState(false)
  const [baselineSourceType] = useState('wo')
  const [baselineFile, setBaselineFile] = useState(null)
  const [baselineFloorArea, setBaselineFloorArea] = useState('25000')
  const [baselineFloorAreaBasis, setBaselineFloorAreaBasis] = useState('built_up_total')
  const [isRecordingBaseline, setIsRecordingBaseline] = useState(false)

  const [showBillModal, setShowBillModal] = useState(false)
  const [billPeriod, setBillPeriod] = useState('')
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [billDateTouched, setBillDateTouched] = useState(false)
  const [billStatedPct, setBillStatedPct] = useState('')
  const [billFile, setBillFile] = useState(null)
  const [billQuantityBasis, setBillQuantityBasis] = useState('cummulative')
  const [isLoggingBill, setIsLoggingBill] = useState(false)

  const [pendingRecommendation, setPendingRecommendation] = useState(null)
  const [deleteBillTarget, setDeleteBillTarget] = useState(null)
  const [isDeletingBill, setIsDeletingBill] = useState(false)

  // --- Phase 4: current state / recommendations / catalog ---
  const [currentState, setCurrentState] = useState(null)
  const [currentStateError, setCurrentStateError] = useState(null) // string | null -- the raw backend detail, for the restriction banner
  const [recommendations, setRecommendations] = useState([])
  const [catalog, setCatalog] = useState([])
  const [selectedSubId, setSelectedSubId] = useState('steel_ifc_to_ars_eaf_recycled')
  const [sliderPct, setSliderPct] = useState(50)
  const [isProposing, setIsProposing] = useState(false)
  const [isProcessingAction, setIsProcessingAction] = useState(false)

  // "I want to be able to see all the possible suggested material swaps
  // just like the mock up" -- every catalog entry's real, recomputed
  // numbers at once (GET .../catalog-preview), replacing the old
  // one-at-a-time dropdown+slider. catalogPreview is read-only (nothing
  // persisted by loading it); dismissedPreviewIds is purely a local,
  // per-page-load "hide this card" set -- there's no backend entity to
  // reject yet at preview stage, unlike a real pending Recommendation.
  // adjustingPreviewId tracks which single card currently has its
  // fine-tune slider expanded -- reuses selectedSubId/sliderPct (the same
  // state the old form used) rather than introducing a parallel pair, so
  // "Adjust %" opening a card sets selectedSubId to that card's id and
  // seeds sliderPct from its own evaluated_pct.
  const [catalogPreview, setCatalogPreview] = useState([])
  const [isLoadingCatalogPreview, setIsLoadingCatalogPreview] = useState(false)
  const [catalogPreviewError, setCatalogPreviewError] = useState(null)
  const [dismissedPreviewIds, setDismissedPreviewIds] = useState(() => new Set())
  const [adjustingPreviewId, setAdjustingPreviewId] = useState(null)
  const [confirmingPreviewId, setConfirmingPreviewId] = useState(null)
  // Card redesign to match the mockup's compact layout: the full
  // engineering `reasoning` paragraph (and the evidence-tier/source
  // metadata) is real, useful content this app has never hidden, but the
  // mockup's card shows only a one-line caveat by default -- so it moves
  // behind a per-card "Why this swap?" disclosure instead of disappearing.
  const [expandedReasoningId, setExpandedReasoningId] = useState(null)

  // Item 8: the most recent successful "Confirm as Beta Scenario" result
  // for this project -- shown as a banner linking to the new twin project
  // instead of this page's own figures changing. Cleared on project
  // switch, same as pendingRecommendation below.
  const [recentBetaFork, setRecentBetaFork] = useState(null) // { newProjectId, newProjectName }

  // Item 5: the Section 2 chart sandbox -- add/remove/reorder, each card
  // an independent dataset selection. Reset to a single default card on
  // project switch, same as every other per-project UI state here.
  const [chartCards, setChartCards] = useState(defaultChartCards)
  const [showChartBuilderModal, setShowChartBuilderModal] = useState(false)
  const [builderTab, setBuilderTab] = useState('presets')

  // Stale-response guard -- same pattern both source files already used
  // independently; kept as one ref here since both load on the same
  // project-switch effect.
  const activeProjectIdRef = useRef(activeProjectId)
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  useEffect(() => {
    if (!activeProjectId) {
      setDashboard(null)
      setBills([])
      setCurrentState(null)
      setCurrentStateError(null)
      setRecommendations([])
      return
    }
    loadData()
    loadChatTools()
    loadPhase4Data()
    loadCatalog()
    loadCatalogPreview()
    setActiveSection('summary')
    setRecentBetaFork(null)
    setChartCards(defaultChartCards())
    setDismissedPreviewIds(new Set())
    setAdjustingPreviewId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, activeCompanyId])

  const loadData = async () => {
    const requestedProjectId = activeProjectId
    try {
      const dash = await api.getDashboard(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setDashboard(dash)
      const bList = await api.getBills(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setBills(bList)
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      console.log('No dashboard yet for project:', err.message)
      setDashboard(null)
      setBills([])
    }
  }

  const loadChatTools = async () => {
    try {
      const tools = await api.getChatTools()
      setChatTools(tools)
    } catch (err) {
      console.warn('Could not load chat tools:', err.message)
    }
  }

  const loadPhase4Data = async () => {
    const requestedProjectId = activeProjectId
    try {
      const state = await api.getCurrentState(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setCurrentState(state)
      setCurrentStateError(null)
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      setCurrentState(null)
      setCurrentStateError(err.message || null)
    }

    try {
      const recs = await api.getRecommendations(activeProjectId, null, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setRecommendations(recs)
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      console.log('Phase 4 data not ready:', err.message)
      setRecommendations([])
    }
  }

  const loadCatalog = async () => {
    try {
      const cat = await api.getBoqCatalog()
      setCatalog(cat)
    } catch (err) {
      console.warn('Could not load catalog:', err.message)
    }
  }

  const loadCatalogPreview = async () => {
    const requestedProjectId = activeProjectId
    setIsLoadingCatalogPreview(true)
    try {
      const preview = await api.getCatalogPreview(activeProjectId, activeCompanyId)
      if (activeProjectIdRef.current !== requestedProjectId) return
      setCatalogPreview(preview)
      setCatalogPreviewError(null)
    } catch (err) {
      if (activeProjectIdRef.current !== requestedProjectId) return
      // Expected for a non-BOQ/WO baseline (phase1_estimate) -- the
      // boqOnlyRestriction banner already covers that case, so this error
      // is only surfaced if the grid is somehow rendered anyway.
      setCatalogPreview([])
      setCatalogPreviewError(err.message || null)
    } finally {
      if (activeProjectIdRef.current === requestedProjectId) setIsLoadingCatalogPreview(false)
    }
  }

  const handleRecordBaselineSubmit = async (e) => {
    e.preventDefault()
    if (!baselineFile) {
      addToast('Please select a Work Order file', 'error')
      return
    }
    setIsRecordingBaseline(true)
    try {
      await api.recordBaseline(activeProjectId, {
        companyId: activeCompanyId,
        sourceType: baselineSourceType,
        file: baselineFile,
        floorAreaSqm: baselineFloorArea ? Number(baselineFloorArea) : undefined,
        floorAreaBasis: baselineFloorAreaBasis,
        overwrite: true,
      })
      addToast('Baseline recorded successfully', 'success')
      setShowBaselineModal(false)
      setBaselineFile(null)
      loadData()
      loadPhase4Data()
    } catch (err) {
      addToast(`Failed to record baseline: ${err.message}`, 'error')
    } finally {
      setIsRecordingBaseline(false)
    }
  }

  const isBillFilePdf = !!billFile && billFile.name.toLowerCase().endsWith('.pdf')
  const duplicateDateBill = billDate ? bills.find((b) => b.billed_date === billDate && b.period !== billPeriod.trim()) : null

  const handleLogBillSubmit = async (e) => {
    e.preventDefault()
    if (!billFile) {
      addToast('Please select a bill document (.xlsx or .pdf)', 'error')
      return
    }
    setIsLoggingBill(true)
    try {
      // Item 7: for a Certificate of Payment PDF, period/billedDate are
      // left for the backend to derive from the document itself (see
      // api/client.js's logBill -- only appended when truthy); an Excel
      // BOQ bill has no such field in the file, so it still needs the
      // user-entered period/date sent explicitly.
      await api.logBill(activeProjectId, {
        companyId: activeCompanyId,
        period: isBillFilePdf ? (billPeriod.trim() || undefined) : (billPeriod.trim() || billDate),
        billedDate: isBillFilePdf ? undefined : billDate,
        file: billFile,
        statedPercentComplete: billStatedPct ? Number(billStatedPct) : undefined,
        quantityBasis: isBillFilePdf ? billQuantityBasis : undefined,
      })
      addToast(
        isBillFilePdf
          ? 'Bill logged — its billed date was read directly off the document, not today\'s upload date'
          : `Bill logged for ${billPeriod || billDate} — the project now shows in Projects with this update`,
        'success',
        6000
      )
      setShowBillModal(false)
      setBillFile(null)
      setBillPeriod('')
      setBillDate(new Date().toISOString().split('T')[0])
      setBillDateTouched(false)
      setBillStatedPct('')
      setBillQuantityBasis('cummulative')
      loadData()
      loadProjects(activeCompanyId)
    } catch (err) {
      addToast(`Failed to log bill: ${err.message}`, 'error')
    } finally {
      setIsLoggingBill(false)
    }
  }

  const handleConfirmDeleteBill = async () => {
    if (!deleteBillTarget) return
    setIsDeletingBill(true)
    try {
      await api.deleteBill(activeProjectId, deleteBillTarget.period, activeCompanyId)
      addToast(`Removed bill for period "${deleteBillTarget.period}"`, 'success')
      setDeleteBillTarget(null)
      loadData()
      loadProjects(activeCompanyId)
    } catch (err) {
      addToast(`Failed to remove bill: ${err.message}`, 'error')
    } finally {
      setIsDeletingBill(false)
    }
  }

  const handlePropose = async (e) => {
    e.preventDefault()
    if (!selectedSubId || sliderPct <= 0) return
    setIsProposing(true)
    try {
      await api.proposeRecommendation(activeProjectId, selectedSubId, Number(sliderPct), activeCompanyId)
      addToast('Proposed lower-carbon swap with real recomputed delta', 'success')
      loadPhase4Data()
    } catch (err) {
      addToast(`Proposal failed: ${err.message}`, 'error')
    } finally {
      setIsProposing(false)
    }
  }

  // Item 8: forks a new sibling "Material Change Projects (Beta)" project
  // with the substituted totals instead of mutating this project's own
  // numbers -- see app/services/phase4.py's confirm_recommendation_as_beta_twin.
  const handleConfirmAsBeta = async (recId) => {
    setIsProcessingAction(true)
    try {
      const result = await api.confirmRecommendationAsBeta(activeProjectId, recId, activeCompanyId)
      setRecentBetaFork({ newProjectId: result.new_project_id, newProjectName: result.new_project_name })
      addToast(
        `Created "${result.new_project_name}" with the substituted figures — this project's own numbers are unchanged.`,
        'success',
        8000,
        { label: 'View Beta Project', onClick: () => { selectProject(result.new_project_id); navigate('project-dashboard') } }
      )
      loadPhase4Data()
      loadProjects(activeCompanyId) // so the Directory's Beta section picks up the new twin immediately
    } catch (err) {
      addToast(`Could not create Beta scenario: ${err.message}`, 'error')
    } finally {
      setIsProcessingAction(false)
    }
  }

  const handleReject = async (recId) => {
    setIsProcessingAction(true)
    try {
      await api.rejectRecommendation(activeProjectId, recId, activeCompanyId)
      addToast('Recommendation rejected. No changes made to project numbers.', 'info')
      loadPhase4Data()
    } catch (err) {
      addToast(`Reject failed: ${err.message}`, 'error')
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Card-grid "Confirm" (Phase D): drives the SAME two-step API contract
  // the old dropdown+slider form used (propose, then confirm-as-beta) --
  // just as one click instead of a human doing both steps separately. Uses
  // the card's own pre-computed evaluated_pct by default, or whatever the
  // user set via that card's "Adjust %" slider (adjustingPreviewId ===
  // entry.substitution_id -- reuses sliderPct, the same state the old form
  // used). A propose failure never calls confirm; a confirm failure after
  // a successful propose leaves a real pending Recommendation behind,
  // surfaced in "Pending Recommendations" below exactly as it already was.
  const handleConfirmCard = async (entry) => {
    const pct = adjustingPreviewId === entry.substitution_id ? Number(sliderPct) : entry.evaluated_pct
    if (!pct || pct <= 0) return
    setConfirmingPreviewId(entry.substitution_id)
    try {
      const rec = await api.proposeRecommendation(activeProjectId, entry.substitution_id, pct, activeCompanyId)
      const result = await api.confirmRecommendationAsBeta(activeProjectId, rec.id, activeCompanyId)
      setRecentBetaFork({ newProjectId: result.new_project_id, newProjectName: result.new_project_name })
      addToast(
        `Created "${result.new_project_name}" with the substituted figures — this project's own numbers are unchanged.`,
        'success',
        8000,
        { label: 'View Beta Project', onClick: () => { selectProject(result.new_project_id); navigate('project-dashboard') } }
      )
      setAdjustingPreviewId(null)
      loadPhase4Data()
      loadProjects(activeCompanyId)
    } catch (err) {
      addToast(`Could not confirm this swap: ${err.message}`, 'error')
    } finally {
      setConfirmingPreviewId(null)
    }
  }

  const activeSub = catalog.find((c) => c.id === selectedSubId)

  const BASE_CATEGORY_LABELS = {
    rcc: 'RCC / Cement',
    reinforcement_steel: 'Reinforcement Steel',
    brickwork: 'Brickwork',
  }
  const visibleCatalogPreview = catalogPreview.filter((e) => !dismissedPreviewIds.has(e.substitution_id))

  const baselineTonnes = dashboard?.baseline ? dashboard.baseline.total_gwp_kg_co2e / 1000 : null
  const projectedTonnes = dashboard?.projected_total_gwp_kg_co2e ? dashboard.projected_total_gwp_kg_co2e / 1000 : null
  const isExceedingBaseline = dashboard?.projected_vs_baseline_pct != null && dashboard.projected_vs_baseline_pct > 0
  const billStatus = dashboard
    ? {
        percentComplete: dashboard.percent_complete,
        percentCompleteSource: dashboard.percent_complete_source,
        latestPeriod: dashboard.latest_period,
        projectedVsBaselinePct: dashboard.projected_vs_baseline_pct,
      }
    : null

  const dashboardPoints = dashboard?.points || []
  const cumulativePoints = dashboardPoints.filter((p) => p.quantity_basis !== 'present')
  const presentOnlyPoints = dashboardPoints.filter((p) => p.quantity_basis === 'present')

  // Item 5: progressive, per-point baseline/projected figures -- the same
  // formula phase3.compute_dashboard() applies ONLY to the latest bill
  // (percent_complete -> baseline*pct for a progressive baseline,
  // gwp/(pct/100) for the projected total), applied here to every
  // cumulative-basis point instead of just the last one. "If no bills
  // were uploaded" there are no cumulativePoints to loop over, so both
  // arrays come back empty and CarbonDataExplorer's own fallback (see
  // that component) draws the flat baselineTonnes/projectedTonnes line
  // instead -- "a straight line is accepted."
  const progressiveSeries = useMemo(() => {
    const baselineSeries = []
    const projectedSeries = []
    const baseline = dashboard?.baseline
    for (const p of cumulativePoints) {
      let percentComplete = p.stated_percent_complete
      if (percentComplete == null && baseline?.total_value) {
        percentComplete = Math.min((p.total_value_to_date / baseline.total_value) * 100, 999)
      }
      if (percentComplete != null && baseline?.total_gwp_kg_co2e) {
        baselineSeries.push({ period: p.period, value: (baseline.total_gwp_kg_co2e * (percentComplete / 100)) / 1000 })
      }
      if (percentComplete && percentComplete > 0) {
        projectedSeries.push({ period: p.period, value: (p.total_gwp_kg_co2e_to_date / (percentComplete / 100)) / 1000 })
      }
    }
    return { baselineSeries, projectedSeries }
  }, [cumulativePoints, dashboard])

  // Item 4: the most recently billed period regardless of basis -- bills
  // is already sorted oldest-first by billed_date (see phase3.py's
  // list_bill_periods), so the last entry IS the latest bill, matching
  // dashboard.latest_bill_period.
  const latestBill = bills.length > 0 ? bills[bills.length - 1] : null

  // Item 6: the current material composition -- the most recent bill's
  // own category_breakdown (not summed across bills, since
  // representative_emission_factor is only meaningful for the set of
  // line items that actually fed one bill's own aggregation).
  const latestCategoryBreakdown = useMemo(() => {
    const rows = latestBill?.category_breakdown || []
    return [...rows].sort((a, b) => (b.gwp_kg_co2e || 0) - (a.gwp_kg_co2e || 0))
  }, [latestBill])

  // UX refinement: "even in the project dashboard, there is no chart shown
  // at all for the conceptual estimated projects, i want it to give
  // estimated graphs mentioning it as an 'estimate'." A project tracked
  // from a Conceptual Estimate baseline (dashboard.baseline.is_estimated)
  // has no real bills yet, so there's nothing for MaterialBreakdownChart/
  // MaterialRankingChart to aggregate -- until the first bill is logged,
  // they'd otherwise just show "Add a bill...". This builds a synthetic,
  // client-side-only "bill" shaped exactly like a real BillPeriod
  // (quantity_basis + category_breakdown), wrapping the baseline's own
  // material_breakdown snapshot (see phase3.py's Phase3Baseline docstring)
  // so the existing charts can render it unchanged. It is NEVER sent to
  // the backend and never mistaken for a real bill -- every place it's
  // used pairs it with a visible "Estimate" badge, and `bills.length`
  // (the real array) is always what gates whether real-bill UI shows.
  const estimateBill = useMemo(() => {
    const baseline = dashboard?.baseline
    if (!baseline?.is_estimated || !baseline.material_breakdown || baseline.material_breakdown.length === 0) return null
    return {
      quantity_basis: 'cummulative',
      category_breakdown: baseline.material_breakdown,
      period: 'Conceptual Estimate',
      billed_date: baseline.recorded_at,
    }
  }, [dashboard])

  // Reliable, proactive signal -- not dependent on any error string.
  // get_current_state_summary itself doesn't enforce this restriction
  // (see the docstring above), so currentStateError is kept only for a
  // genuine "no Phase 3 baseline at all" failure, which can't actually
  // arise in this branch (dashboard.baseline already being truthy
  // implies one exists).
  const boqOnlyRestriction = !!dashboard?.baseline && dashboard.baseline.source_type !== 'boq' && dashboard.baseline.source_type !== 'wo'

  // Hoisted out of the chartCards.map() JSX so both the real card grid
  // and ChartBuilderModal's live preview (Phase E) build from the exact
  // same chartData object -- every field here uses safe navigation since
  // this is computed on every render, including before `dashboard` loads.
  const chartData = {
    cumulativePoints,
    presentOnlyPoints,
    baselineTonnes,
    projectedTonnes,
    baselineSeries: progressiveSeries.baselineSeries,
    projectedSeries: progressiveSeries.projectedSeries,
    isExceedingBaseline,
    proposedTonnes: pendingRecommendation ? pendingRecommendation.carbon_kg_after / 1000 : null,
    billStatus,
    onPointClick: (point) => setDeleteBillTarget(point),
    bills,
    estimateBill,
    dashboardPoints,
    baseline: dashboard?.baseline,
    catalogPreview,
  }

  function scrollToSection(id) {
    setActiveSection(id)
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Item 3's quick menu --------------------------------------------------

  const handleOpenAddBill = () => {
    setBillDate(new Date().toISOString().split('T')[0])
    setBillDateTouched(false)
    setShowBillModal(true)
  }

  // "for the project dashboard... adding a chart is much better in the
  // mockup and i want the exact same layout for the charts as well" --
  // "Add Chart" no longer appends a fixed default card directly; it opens
  // the Interactive Chart Builder (ChartBuilderModal), same as the
  // mockup's own "Add Custom Chart" affordance. The modal's own
  // "Add to Dashboard" actions call addChartCard below.
  const handleAddChart = () => {
    setBuilderTab('presets')
    setShowChartBuilderModal(true)
    scrollToSection('trends')
  }

  const handleResetLayout = () => {
    setChartCards(defaultChartCards())
  }

  const addChartCard = (dataset, { title, subtitle } = {}) => {
    setChartCards((prev) => [
      ...prev,
      { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, dataset, title: title || undefined, subtitle: subtitle || undefined },
    ])
    setShowChartBuilderModal(false)
    scrollToSection('trends')
  }

  const removeChartCard = (id) => setChartCards((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev))
  const toggleChartCardExpand = (id) => setChartCards((prev) => prev.map((c) => (c.id === id ? { ...c, expanded: !c.expanded } : c)))
  const moveChartCard = (id, dir) =>
    setChartCards((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const copy = [...prev]
      const [item] = copy.splice(idx, 1)
      copy.splice(newIdx, 0, item)
      return copy
    })

  const handleExportReport = () => {
    if (bills.length === 0) {
      addToast('No bills logged yet for this project -- nothing to export.', 'info')
      return
    }
    const projectName = activeProject?.project_name || activeProjectId || 'project'
    const safeFileStem = String(projectName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project'
    downloadCsv(
      `${safeFileStem}-bills-${new Date().toISOString().split('T')[0]}.csv`,
      ['Period', 'Billed Date', 'Source', 'Quantity Basis', 'GWP to Date (tCO2e)', 'Billed Value (INR)', 'Stated % Complete', 'Lines Computed', 'Lines Total'],
      bills.map((b) => [
        b.period,
        b.billed_date,
        b.bill_source === 'pdf_cop' ? 'Certificate of Payment (PDF)' : 'Excel BOQ',
        b.quantity_basis === 'present' ? 'This period only' : 'Cumulative to date',
        (b.total_gwp_kg_co2e_to_date / 1000).toFixed(2),
        b.total_value_to_date,
        b.stated_percent_complete ?? '',
        b.n_lines_computed,
        b.n_lines_total,
      ])
    )
  }

  const scrollToChat = () => {
    document.getElementById('chat-bar-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const lastUpdatedLabel = latestBill
    ? new Date(latestBill.billed_date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    : dashboard?.baseline
    ? new Date(dashboard.baseline.recorded_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: 'calc(100vh - 180px)' }}>
      {/* Header: back-to-directory + project name + quick menu. */}
      <div className="glass-panel" style={{ position: 'relative', zIndex: 30, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('project')} className="btn-secondary" style={{ fontSize: '0.78rem' }} title="Back to the Projects & Embodied Carbon Directory">
            <ArrowLeft size={14} />
            <span>All Projects</span>
          </button>
          <div>
            {originLabel(activeProject?.baseline_source_type) && (
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent-mint)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>
                {originLabel(activeProject?.baseline_source_type)}
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                {activeProject?.project_name || activeProjectId || 'Project'}
              </h2>
              <button
                onClick={() => setShowRenameModal(true)}
                title="Rename project"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--text-muted)' }}
              >
                <Pencil size={14} />
              </button>
              <span className="badge badge-lime">Project Dashboard</span>
              {activeProject?.is_beta_twin && (
                <span className="badge badge-violet" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <FlaskConical size={11} /> Beta Scenario
                </span>
              )}
            </div>
            {/* "a crucial miss out is that, after i open project dashboard, i
                cannot see the build up area mentioned anywhere, mention it
                below the title of the project" -- dashboard.baseline.
                floor_area_sqm is already populated for every baseline type
                (boq/wo set it from the uploaded document's own floor area;
                phase1_estimate sets it from the Conceptual Estimate's GFA
                field, see baseline_from_phase1_estimate in phase3.py) --
                this just surfaces it, no backend change needed. Omitted
                entirely (not "—") for the rare case of a baseline recorded
                before floor_area_sqm existed. */}
            {dashboard?.baseline?.floor_area_sqm != null && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '2px 0 0', fontWeight: 600 }}>
                Built-up Area:{' '}
                <span className="tabular-nums" style={{ color: 'var(--accent-lime)' }}>
                  {dashboard.baseline.floor_area_sqm.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²
                </span>
              </p>
            )}
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
              {lastUpdatedLabel ? `Last updated ${lastUpdatedLabel}` : 'No bills logged yet'}
            </p>
          </div>
        </div>

        {activeProjectId && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setShowBaselineModal(true)} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
              <Clock size={15} />
              <span>{dashboard?.baseline ? 'Update Baseline' : 'Set Baseline'}</span>
            </button>
            {dashboard?.baseline && (
              <>
                <button onClick={handleOpenAddBill} className="btn-primary" style={{ fontSize: '0.8125rem' }}>
                  <Upload size={15} />
                  <span>Upload Bill</span>
                </button>
                <button onClick={handleAddChart} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
                  <BarChart3 size={15} />
                  <span>Add Chart</span>
                </button>
                <button onClick={handleExportReport} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
                  <Download size={15} />
                  <span>Export Report</span>
                </button>
                <button onClick={scrollToChat} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
                  <Sparkles size={15} />
                  <span>Ask Copilot</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {!activeProjectId ? (
        <div className="glass-panel" style={{ padding: 36, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={28} color="var(--accent-amber)" />
          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>No project selected</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', maxWidth: 420 }}>
            Go back to the Projects & Embodied Carbon Directory to pick a project.
          </p>
        </div>
      ) : !dashboard?.baseline ? (
        <div className="glass-panel" style={{ padding: 30, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <AlertTriangle size={32} color="var(--accent-amber)" />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>No Fixed Baseline Recorded Yet</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', maxWidth: 440 }}>
            Before you can log bills and track running carbon, record this project's initial full-scope baseline.
          </p>
          <button onClick={() => setShowBaselineModal(true)} className="btn-primary" style={{ marginTop: 6 }}>
            Set Project Baseline
          </button>
        </div>
      ) : (
        <>
          {/* Sticky in-page section nav */}
          <nav
            className="glass-panel"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 20,
              display: 'flex',
              gap: 4,
              padding: 6,
              flexWrap: 'wrap',
            }}
          >
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollToSection(s.id)}
                className={`sidebar-nav-item ${activeSection === s.id ? 'active' : ''}`}
                style={{ width: 'auto', flex: '1 1 auto', minWidth: 120, justifyContent: 'center' }}
              >
                <div className="sidebar-nav-item-content" style={{ justifyContent: 'center' }}>
                  <span>{s.label}</span>
                </div>
              </button>
            ))}
          </nav>

          {/* --- Section: Summary --- */}
          <div id="section-summary" style={{ display: 'flex', flexDirection: 'column', gap: 14, scrollMarginTop: 70 }}>
            <div style={{ background: 'rgba(var(--c-surf-5), 0.75)', border: '1px solid rgba(var(--c-blue), 0.16)', borderRadius: 'var(--radius-md)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className={`badge ${dashboard.baseline.is_estimated ? 'badge-amber' : 'badge-mint'}`}>
                  {dashboard.baseline.is_estimated ? 'Estimated Baseline' : `Priced Baseline (${dashboard.baseline.source_type.toUpperCase()})`}
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>Recorded {new Date(dashboard.baseline.recorded_at).toLocaleDateString()} from {dashboard.baseline.source_file}</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)' }}>{bills.length} {bills.length === 1 ? 'Bill' : 'Bills'} Logged</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              {/* Baseline used to be shown only as small inline text in the
                  status strip above (~0.8125rem) -- noticeably smaller than
                  every other headline number on this page. It's the number
                  everything else here is measured against, so it gets the
                  same StatCard treatment (same 1.75rem value size) as
                  "Billed to Date" right next to it. */}
              <StatCard
                title="Baseline Target"
                value={(dashboard.baseline.total_gwp_kg_co2e / 1000).toFixed(1)}
                unit="tCO₂e"
                subtitle={dashboard.baseline.is_estimated ? 'Estimated, from Phase 1' : `Priced (${dashboard.baseline.source_type.toUpperCase()})`}
                accent="mint"
                badge={dashboard.baseline.is_estimated ? 'Estimated' : 'Priced'}
                badgeType={dashboard.baseline.is_estimated ? 'amber' : 'mint'}
              />
              <StatCard
                title="Billed to Date"
                value={
                  dashboard.latest_bill_quantity_basis === 'present'
                    ? (dashboard.latest_bill_gwp_kg_co2e ? (dashboard.latest_bill_gwp_kg_co2e / 1000).toFixed(1) : '0.0')
                    : (dashboard.billed_to_date_gwp_kg_co2e ? (dashboard.billed_to_date_gwp_kg_co2e / 1000).toFixed(1) : '0.0')
                }
                unit="tCO₂e"
                subtitle={
                  dashboard.latest_bill_quantity_basis === 'present'
                    ? `Latest period: ${dashboard.latest_bill_period} (this period only, not a running total)`
                    : `Latest period: ${dashboard.latest_period || 'None yet'}`
                }
                accent="amber"
                badge={!dashboard.latest_bill_period ? 'Pending' : dashboard.latest_bill_quantity_basis === 'present' ? 'Present' : 'Cumulative'}
                badgeType="amber"
              />
              {/* Item 4: the real date OFF the bill document, not the day
                  it was uploaded -- surfaces the COP-PDF date-extraction
                  fix directly on the Summary section. */}
              <StatCard
                title="Latest Bill Dated"
                value={latestBill ? new Date(latestBill.billed_date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                subtitle={
                  latestBill
                    ? `Period "${latestBill.period}" — ${latestBill.bill_source === 'pdf_cop' ? 'read off the bill document itself' : 'as entered for this Excel BOQ bill'}`
                    : 'No bills uploaded yet'
                }
                accent="violet"
                badge={latestBill ? (latestBill.bill_source === 'pdf_cop' ? 'COP PDF' : 'Excel BOQ') : undefined}
                badgeType="violet"
              />
              <StatCard
                title="Project Completion"
                value={dashboard.percent_complete ? `${dashboard.percent_complete.toFixed(1)}%` : '0%'}
                subtitle={dashboard.percent_complete_source?.replace(/_/g, ' ') || 'Awaiting bills'}
                accent="mint"
                badge="Progress"
                badgeType="mint"
              />
              <StatCard
                title="Projected at Completion"
                value={dashboard.projected_total_gwp_kg_co2e ? (dashboard.projected_total_gwp_kg_co2e / 1000).toFixed(1) : (dashboard.baseline.total_gwp_kg_co2e / 1000).toFixed(1)}
                unit="tCO₂e"
                subtitle={
                  dashboard.projected_vs_baseline_pct !== null && dashboard.projected_vs_baseline_pct !== undefined
                    ? `${dashboard.projected_vs_baseline_pct > 0 ? '+' : ''}${dashboard.projected_vs_baseline_pct.toFixed(1)}% vs Baseline`
                    : 'At baseline estimate'
                }
                accent={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'amber' : 'lime'}
                badge={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'Exceeding' : 'On Track'}
                badgeType={dashboard.projected_vs_baseline_pct && dashboard.projected_vs_baseline_pct > 0 ? 'amber' : 'lime'}
              />
              {dashboard.cost_per_kg_co2e_to_date && (
                <StatCard
                  title="Cost per kg CO₂e"
                  value={`₹${dashboard.cost_per_kg_co2e_to_date.toFixed(1)}`}
                  subtitle="Billed Rs value / Billed kg CO₂e"
                  accent="mint"
                  badge="Efficiency"
                  badgeType="mint"
                />
              )}
            </div>

            {dashboard.benchmark_available && (
              <div className="glass-panel" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
                    Typical Building Benchmark
                  </span>
                  <span className="badge badge-violet" style={{ fontSize: '0.65rem' }}>{dashboard.benchmark_floor_band_used}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span className="tabular-nums" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {dashboard.projected_carbon_per_sqm?.toFixed(1) || '-'}
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--accent-lime)' }}>kgCO₂e / m²</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Typical is {dashboard.typical_carbon_per_sqm?.toFixed(1)} kg/m²)</span>
                </div>
              </div>
            )}
          </div>

          {/* --- Section: Carbon Trends (chart sandbox) --- */}
          <div id="section-trends" className="glass-panel" style={{ padding: 22, scrollMarginTop: 70 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={16} color="var(--accent-lime)" />
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Section 2: Carbon Performance Over Time & Analytical Grid</h3>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleResetLayout} className="btn-secondary" style={{ fontSize: '0.78rem' }} title="Restore the default 4-chart layout">
                  <RotateCcw size={14} />
                  <span>Reset Layout</span>
                </button>
                <button onClick={handleAddChart} className="btn-secondary" style={{ fontSize: '0.78rem' }}>
                  <Plus size={14} />
                  <span>Add Custom Chart</span>
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 18, alignItems: 'start' }}>
              {chartCards.map((card, idx) => (
                <ChartCardBlock
                  key={card.id}
                  card={card}
                  idx={idx}
                  total={chartCards.length}
                  onRemove={() => removeChartCard(card.id)}
                  onMoveUp={() => moveChartCard(card.id, -1)}
                  onMoveDown={() => moveChartCard(card.id, 1)}
                  onToggleExpand={() => toggleChartCardExpand(card.id)}
                  chartData={chartData}
                />
              ))}
            </div>
          </div>

          {/* --- Section: Materials --- */}
          <div id="section-materials" className="glass-panel" style={{ padding: 22, scrollMarginTop: 70 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <BarChart3 size={16} color="var(--accent-mint)" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Section 3: Material Composition & Hotspot Breakdown</h3>
            </div>
            {bills.length > 0 ? (
              <>
                <MaterialBreakdownChart bills={bills} />
                {latestCategoryBreakdown.length > 0 && (
                  <div style={{ overflowX: 'auto', marginTop: 20 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(var(--c-blue), 0.15)', color: 'var(--accent-lime)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          <th style={{ padding: '8px 12px' }}>Material</th>
                          <th style={{ padding: '8px 12px' }}>GWP (tCO₂e)</th>
                          <th style={{ padding: '8px 12px' }}>% of Total</th>
                          <th style={{ padding: '8px 12px' }}>Emission Factor</th>
                          <th style={{ padding: '8px 12px' }}>Database Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestCategoryBreakdown.map((row, idx) => (
                          <tr key={row.category || idx} style={{ borderBottom: '1px solid rgba(var(--c-overlay), 0.04)', fontSize: '0.8125rem' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 9, height: 9, borderRadius: '50%', background: CATEGORY_COLORS[row.category] || FALLBACK_COLOR, flexShrink: 0 }} />
                                {CATEGORY_LABELS[row.category] || (row.category ? row.category.replace(/_/g, ' ') : 'Uncategorized')}
                              </span>
                            </td>
                            <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--accent-lime)', fontWeight: 600 }}>
                              {((row.gwp_kg_co2e || 0) / 1000).toFixed(1)}
                            </td>
                            <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                              {row.pct_of_total != null ? `${row.pct_of_total.toFixed(1)}%` : '-'}
                            </td>
                            <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                              {row.representative_emission_factor != null ? row.representative_emission_factor.toFixed(2) : '—'}
                            </td>
                            <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: '0.75rem', maxWidth: 320 }}>
                              {row.dominant_factor_source || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>
                      From the most recent bill ({latestBill?.period}). A blank Emission Factor means either this category's line items don't share one native unit (so a single kgCO₂e-per-unit figure wouldn't be meaningful) or this bill was logged before this column existed -- re-upload it to backfill.
                    </p>
                  </div>
                )}
              </>
            ) : estimateBill ? (
              <>
                <EstimateBadge text="From the locked Conceptual Estimate baseline -- no bills logged yet, so this isn't a real measured breakdown." />
                <EstimatedMaterialBreakdownDonut
                  materialBreakdown={estimateBill.category_breakdown}
                  totalCarbonKg={dashboard?.baseline?.total_gwp_kg_co2e}
                />
              </>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                Add a bill to see its material breakdown here.
              </div>
            )}
          </div>

          {/* --- Section: Bills & Progress --- */}
          <div id="section-bills" className="glass-panel" style={{ padding: 22, scrollMarginTop: 70 }}>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Section 4: All Logged Bills</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 14 }}>
              Billed Date is read from the bill document itself for a Certificate of Payment PDF (its "Work done period" end date), not the day it was uploaded.
            </p>
            {bills.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(var(--c-blue), 0.15)', color: 'var(--accent-lime)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '8px 12px' }}>Period</th>
                      <th style={{ padding: '8px 12px' }}>Billed Date</th>
                      <th style={{ padding: '8px 12px' }}>Source</th>
                      <th style={{ padding: '8px 12px' }}>GWP to Date (tCO₂e)</th>
                      <th style={{ padding: '8px 12px' }}>Billed Value</th>
                      <th style={{ padding: '8px 12px' }}>% Complete</th>
                      <th style={{ padding: '8px 12px' }}>Lines Computed</th>
                      <th style={{ padding: '8px 12px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(var(--c-overlay), 0.04)', fontSize: '0.8125rem' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{b.period}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)' }}>{b.billed_date}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            {b.bill_source === 'pdf_cop' ? (
                              <span className="badge badge-mint" style={{ fontSize: '0.65rem' }}>
                                <FileText size={11} /> COP PDF
                              </span>
                            ) : (
                              <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>Excel BOQ</span>
                            )}
                            {b.quantity_basis === 'present' && (
                              <span className="badge badge-amber" style={{ fontSize: '0.6rem' }} title="This bill reflects only its own billing period's quantities, not a running total.">
                                Present period only
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--accent-lime)', fontWeight: 600 }}>
                          {(b.total_gwp_kg_co2e_to_date / 1000).toFixed(1)}
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>₹{(b.total_value_to_date / 100000).toFixed(1)}L</td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--accent-lime)' }}>
                          {b.stated_percent_complete ? `${b.stated_percent_complete.toFixed(1)}%` : '-'}
                        </td>
                        <td className="tabular-nums" style={{ padding: '8px 12px', color: 'var(--text-tertiary)' }}>{b.n_lines_computed}/{b.n_lines_total}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <button
                            type="button"
                            onClick={() => setDeleteBillTarget(b)}
                            title={`Remove bill for period "${b.period}"`}
                            style={{
                              background: 'rgba(var(--c-rose), 0.08)', border: '1px solid rgba(var(--c-rose), 0.2)',
                              borderRadius: 'var(--radius-sm)', color: 'var(--accent-rose-light)', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 5,
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No bills logged yet. Click "Upload Bill" above to record the first period.</p>
            )}
          </div>

          {/* --- Section: Material Alternatives (Beta) --- */}
          <div id="section-alternatives" style={{ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 70 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <FlaskConical size={16} color="var(--accent-violet)" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Section 5: Material Alternatives & Decarbonization Scenarios</h3>
              <span className="badge badge-violet" style={{ fontSize: '0.68rem' }}>Interactive Sandbox</span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: -10 }}>
              Confirming a swap here never changes this project's own numbers — it opens a new twin project with the substituted figures, listed under "Material Change Projects (Beta)" in the Directory.
            </p>

            {recentBetaFork && (
              <div className="glass-panel" style={{ padding: 16, border: '1px solid rgba(var(--c-blue), 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                  Created <strong>{recentBetaFork.newProjectName}</strong> with the substituted figures.
                </span>
                <button
                  onClick={() => { selectProject(recentBetaFork.newProjectId); navigate('project-dashboard') }}
                  className="btn-primary"
                  style={{ fontSize: '0.78rem' }}
                >
                  <span>View Beta Project</span>
                  <ArrowUpRight size={14} />
                </button>
              </div>
            )}

            {boqOnlyRestriction ? (
              <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, borderLeft: '4px solid var(--accent-amber)' }}>
                <Lock size={26} color="var(--accent-amber)" />
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Alternatives require a BOQ or Work Order baseline</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', maxWidth: 480, lineHeight: 1.5 }}>
                  This project's baseline was recorded from a {dashboard.baseline.source_type === 'phase1_estimate' ? 'Conceptual Estimate' : dashboard.baseline.source_type}, not a BOQ or Work Order.
                  Proposing and confirming lower-carbon material swaps is only supported for a BOQ or Work Order baseline. Record one (Update Baseline, above) to unlock this section.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {/* "I want to be able to see all the possible suggested
                    material swaps just like the mock up" -- every catalog
                    entry's real, recomputed numbers at once, not one at a
                    time via a dropdown. */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '8px', background: 'rgba(var(--c-blue), 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-lime)' }}>
                      <SlidersHorizontal size={18} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Suggested Material Swaps</h3>
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)' }}>Verified supplier & IS-code catalog — every entry, real recomputed numbers</span>
                    </div>
                  </div>

                  {isLoadingCatalogPreview ? (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Evaluating every catalog entry against this baseline...</p>
                  ) : catalogPreviewError ? (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--accent-rose)' }}>{catalogPreviewError}</p>
                  ) : visibleCatalogPreview.length === 0 ? (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {catalogPreview.length === 0 ? 'No catalog entries available.' : 'All suggested swaps dismissed for this session.'}
                    </p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                      {visibleCatalogPreview.map((entry) => {
                        const isAdjusting = adjustingPreviewId === entry.substitution_id
                        const isConfirming = confirmingPreviewId === entry.substitution_id
                        const effectivePct = isAdjusting ? Number(sliderPct) : entry.evaluated_pct
                        const originalLabel = BASE_CATEGORY_LABELS[entry.base_category] || entry.base_category.replace(/_/g, ' ')

                        if (!entry.applicable) {
                          return (
                            <div
                              key={entry.substitution_id}
                              className="glass-panel"
                              style={{ padding: 20, opacity: 0.6, display: 'flex', flexDirection: 'column', gap: 10 }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                                <span>{originalLabel}</span>
                                <ArrowRight size={13} color="var(--text-muted)" />
                                <span>{entry.label}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                <span>Not applicable to this baseline — no matching line items found to substitute.</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                                <button
                                  type="button"
                                  onClick={() => setDismissedPreviewIds((prev) => new Set(prev).add(entry.substitution_id))}
                                  className="btn-secondary"
                                  style={{ fontSize: '0.72rem', padding: '5px 10px' }}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          )
                        }

                        const isReasoningOpen = expandedReasoningId === entry.substitution_id

                        return (
                          <div key={entry.substitution_id} className="glass-panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {/* Category eyebrow + status badge -- matches the mockup's
                                card header exactly (category top-left, verdict pill
                                top-right). */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {originalLabel}
                              </span>
                              <span className={entry.status === 'verified_suitable' ? 'badge badge-mint' : 'badge badge-amber'} style={{ fontSize: '0.68rem' }}>
                                {entry.status === 'verified_suitable' ? 'Verified Suitable' : 'Technical Review Required'}
                              </span>
                            </div>

                            {/* Original Specification -- this app only ever knows the
                                CATEGORY being replaced (there's no per-baseline branded
                                product name on file), so the "spec name" here is
                                honestly the same category label, not an invented
                                product string. Emissions is real (original_gwp_kg_co2e). */}
                            <div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>Original Specification:</div>
                              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>{originalLabel}</div>
                              <div className="tabular-nums" style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                                Emissions: {(entry.original_gwp_kg_co2e / 1000).toFixed(1)} tCO₂e
                              </div>
                            </div>

                            {/* Proposed Alternative box */}
                            <div style={{ background: 'var(--color-success-subtle)', border: '1px solid rgba(var(--c-blue), 0.18)', borderRadius: 'var(--radius-md)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>Proposed Alternative:</div>
                                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>{entry.label}</div>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, paddingTop: 8, borderTop: '1px solid rgba(var(--c-overlay), 0.08)' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Reduction:</span>
                                <span className="tabular-nums" style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--accent-lime)', whiteSpace: 'nowrap' }}>
                                  -{(entry.savings_kg_co2e / 1000).toFixed(1)} tCO₂e ({entry.savings_pct_of_total.toFixed(1)}%)
                                </span>
                              </div>
                              {/* The mockup's card shows a "Cost Delta" row with a real-
                                  looking percentage -- this app deliberately never
                                  estimates one (cost_delta_pct is always null; see
                                  evaluate_catalog_preview's own docstring), the same
                                  "never fabricate a number" rule applied everywhere else
                                  here. Showing the row with an honest "Not estimated"
                                  keeps the mockup's layout without inventing a figure. */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Cost Delta:</span>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Not estimated</span>
                              </div>
                            </div>

                            {/* Note -- every real catalog entry carries a structural
                                caveat even for routine, pre-approved swaps (e.g. "extend
                                curing time"), so this is always real, specific guidance,
                                never a placeholder. */}
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>{entry.structural_caveat}</p>

                            <div>
                              <button
                                type="button"
                                onClick={() => setExpandedReasoningId(isReasoningOpen ? null : entry.substitution_id)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600, color: 'var(--accent-mint)' }}
                              >
                                <span>Why this swap?</span>
                                {isReasoningOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                              </button>
                              {isReasoningOpen && (
                                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <p style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{entry.reasoning}</p>
                                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                    Affects {entry.affected_line_item_count} line item{entry.affected_line_item_count === 1 ? '' : 's'} at {entry.evaluated_pct}% substitution · Evidence: {entry.evidence_tier.replace(/_/g, ' ')}
                                  </p>
                                </div>
                              )}
                            </div>

                            {isAdjusting && (
                              <div className="form-group" style={{ marginTop: 2 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <label className="form-label">Substitution Share</label>
                                  <span className="tabular-nums" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-lime)' }}>{sliderPct}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="5"
                                  max={entry.evaluated_pct}
                                  step="5"
                                  value={sliderPct}
                                  onChange={(e) => setSliderPct(e.target.value)}
                                  style={{ width: '100%', accentColor: 'var(--accent-lime)', cursor: 'pointer' }}
                                />
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                  <span>5% min</span>
                                  <span>{entry.evaluated_pct}% recommended max</span>
                                </div>
                              </div>
                            )}

                            {/* Footer -- "Confirm Change" / "Dismiss", matching the
                                mockup's two-button layout and wording exactly. Adjust %
                                is real functionality the mockup doesn't show at all, so
                                it stays as a small de-emphasized text link rather than a
                                third full-sized button competing with the mockup's own
                                pair. */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, paddingTop: 10, borderTop: '1px solid rgba(var(--c-overlay), 0.05)' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isAdjusting) {
                                    setAdjustingPreviewId(null)
                                  } else {
                                    setAdjustingPreviewId(entry.substitution_id)
                                    setSelectedSubId(entry.substitution_id)
                                    setSliderPct(entry.evaluated_pct)
                                  }
                                }}
                                style={{ alignSelf: 'flex-end', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}
                              >
                                {isAdjusting ? 'Cancel Adjust' : 'Adjust %'}
                              </button>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmCard({ ...entry, evaluated_pct: effectivePct })}
                                  disabled={isConfirming}
                                  className="btn-primary"
                                  style={{ flex: 2, fontSize: '0.8125rem', padding: '9px 14px' }}
                                >
                                  <CheckCircle2 size={13} />
                                  <span>{isConfirming ? 'Confirming...' : 'Confirm Change'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDismissedPreviewIds((prev) => new Set(prev).add(entry.substitution_id))}
                                  className="btn-secondary"
                                  style={{ flex: 1, fontSize: '0.8125rem', padding: '9px 14px' }}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Pending decisions -- the "Baseline vs Current Carbon" bar
                    chart that used to sit beside this was removed per
                    explicit instruction (the mockup's own Alternatives
                    section is cards only, no chart); that same baseline-
                    vs-projected comparison is still visible as real
                    StatCards in Section 1 above, so no coverage is lost,
                    just the duplicate chart here. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div className="glass-panel" style={{ padding: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Pending Recommendations ({recommendations.filter((r) => r.status === 'pending').length})
                      </h3>
                      <span className="badge badge-amber">Awaiting Human Decision</span>
                    </div>

                    {recommendations.filter((r) => r.status === 'pending').length === 0 ? (
                      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        No pending recommendations. A swap only lands here if Confirm succeeds in proposing it but the beta-fork step itself then fails — otherwise Confirm (above) creates the beta project directly.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {recommendations.filter((r) => r.status === 'pending').map((rec) => (
                          <div key={rec.id} style={{ background: 'rgba(var(--c-surf-2), 0.8)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid rgba(var(--c-amber), 0.3)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div>
                                <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>{rec.label} ({rec.user_pct}%)</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                                  Affects {rec.affected_line_item_count} line items • Proposed {new Date(rec.created_at).toLocaleDateString()}
                                </span>
                              </div>
                              <span className="tabular-nums badge badge-mint" style={{ fontSize: '0.8125rem' }}>
                                -{rec.delta_pct.toFixed(1)}% ({(Math.abs(rec.delta_kg) / 1000).toFixed(1)} t)
                              </span>
                            </div>
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{rec.reasoning}</p>
                            {rec.requires_engineering_review && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--accent-amber-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <AlertTriangle size={12} />
                                <span>Structural engineering sign-off required prior to field specification</span>
                              </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px solid rgba(var(--c-overlay), 0.05)' }}>
                              <button onClick={() => handleReject(rec.id)} disabled={isProcessingAction} className="btn-danger">
                                <XCircle size={14} />
                                <span>Reject Swap</span>
                              </button>
                              <button onClick={() => handleConfirmAsBeta(rec.id)} disabled={isProcessingAction} className="btn-primary" style={{ padding: '6px 14px', fontSize: '0.8125rem' }}>
                                <CheckCircle2 size={14} />
                                <span>Confirm as Beta Scenario</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Spacer so content never sits directly under the sticky chat bar */}
      <div style={{ flex: 1 }} />

      {/* Chat bar, pinned to the bottom. The wrapping id is "Ask Copilot"'s
          scroll target (see scrollToChat above) -- ChatBar itself is the
          existing, real, working chat (backed by chatbot.py), reused here
          rather than building a second chat surface. */}
      <div id="chat-bar-anchor">
        <ChatBar chatTools={chatTools} onPendingChange={setPendingRecommendation} />
      </div>

      <SaveProjectNameModal
        isOpen={showRenameModal}
        onClose={() => setShowRenameModal(false)}
        projectId={activeProjectId}
        initialName={activeProject?.project_name || ''}
        onSaved={() => loadProjects(activeCompanyId)}
      />

      <ChartBuilderModal
        isOpen={showChartBuilderModal}
        onClose={() => setShowChartBuilderModal(false)}
        tab={builderTab}
        onTabChange={setBuilderTab}
        onAddPreset={(preset) => addChartCard(preset.dataset)}
        onAddCustom={(dataset, opts) => addChartCard(dataset, opts)}
        chartData={chartData}
      />

      {/* Set/Update Baseline Modal */}
      {showBaselineModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(var(--c-black), 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Set Project Baseline</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 18 }}>
              This recorded baseline serves as the permanent benchmark point every subsequent bill is measured against.
            </p>
            <form onSubmit={handleRecordBaselineSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Baseline Source Type</label>
                <div className="form-input" style={{ display: 'flex', alignItems: 'center', color: 'var(--text-primary)', cursor: 'default' }}>
                  Uploaded Work Order (.pdf)
                </div>
              </div>

              <div style={{ border: '2px dashed rgba(var(--c-blue), 0.25)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center', background: 'rgba(var(--c-surf-1), 0.6)' }}>
                <input
                  type="file"
                  id="dash-baseline-file-input"
                  accept=".pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => setBaselineFile(e.target.files[0] || null)}
                />
                <label htmlFor="dash-baseline-file-input" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <Upload size={20} color="var(--accent-lime)" />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {baselineFile ? baselineFile.name : 'Select Work Order (.pdf) file'}
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setShowBaselineModal(false)} className="btn-secondary" disabled={isRecordingBaseline}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isRecordingBaseline}>
                  {isRecordingBaseline ? 'Recording...' : 'Record Baseline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Bill Modal */}
      {showBillModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(var(--c-black), 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Upload a Bill</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 18 }}>
              Upload an Excel BOQ-shaped bill or a Certificate of Payment PDF — either works here, evaluated against the same baseline.
            </p>
            <form onSubmit={handleLogBillSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ border: '2px dashed rgba(var(--c-blue), 0.25)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center', background: 'rgba(var(--c-surf-1), 0.6)' }}>
                <input
                  type="file"
                  id="dash-bill-file-input"
                  accept=".xlsx,.xls,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => setBillFile(e.target.files[0] || null)}
                />
                <label htmlFor="dash-bill-file-input" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <Upload size={20} color="var(--accent-lime)" />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {billFile ? billFile.name : 'Select Bill Document (.xlsx or .pdf)'}
                  </span>
                </label>
              </div>

              {isBillFilePdf ? (
                <p style={{ fontSize: '0.75rem', color: 'var(--accent-lime)', margin: 0, lineHeight: 1.4, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <FileText size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>The period label and billed date will be read directly off this PDF's "Work done period" / "RA Bill No." fields — not today's upload date. You can still override the period label below if you'd like a different label.</span>
                </p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Period Label</label>
                    <input
                      type="text"
                      placeholder="e.g. 2026-Q1, M03-2026, Sept"
                      value={billPeriod}
                      onChange={(e) => {
                        const value = e.target.value
                        setBillPeriod(value)
                        if (!billDateTouched) {
                          const guessed = guessDateFromPeriod(value)
                          if (guessed) setBillDate(guessed)
                        }
                      }}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Billed Date</label>
                    <input
                      type="date"
                      required
                      value={billDate}
                      onChange={(e) => {
                        setBillDate(e.target.value)
                        setBillDateTouched(true)
                      }}
                      className="form-input"
                    />
                  </div>
                </div>
              )}

              {isBillFilePdf && (
                <div className="form-group">
                  <label className="form-label">
                    Period Label Override <span className="form-label-optional">(Optional -- defaults to the RA Bill No. on the document)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Leave blank to use the document's own RA Bill No."
                    value={billPeriod}
                    onChange={(e) => setBillPeriod(e.target.value)}
                    className="form-input"
                  />
                </div>
              )}

              {duplicateDateBill && (
                <p style={{ fontSize: '0.75rem', color: 'var(--accent-amber)', margin: '-8px 0 0', lineHeight: 1.4 }}>
                  ⚠ Period "{duplicateDateBill.period}" is already logged with this same date. Logging another
                  bill on the same date can scramble the chart's left-to-right order -- pick a different date
                  if these are actually two separate periods.
                </p>
              )}

              <div className="form-group">
                <label className="form-label">
                  Stated % Complete <span className="form-label-optional">(Optional)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  placeholder="e.g. 35.0 (derived from value if omitted)"
                  value={billStatedPct}
                  onChange={(e) => setBillStatedPct(e.target.value)}
                  className="form-input"
                />
              </div>

              {isBillFilePdf && (
                <div className="form-group">
                  <label className="form-label">
                    Quantity Basis <span className="form-label-optional">(Certificate of Payment only)</span>
                  </label>
                  <select value={billQuantityBasis} onChange={(e) => setBillQuantityBasis(e.target.value)} className="form-select">
                    <option value="cummulative">Cumulative to date (Cummu. column)</option>
                    <option value="present">This billing period only (Present column)</option>
                  </select>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.4 }}>
                    {billQuantityBasis === 'present'
                      ? "Uses only this RA bill's Present-column quantities -- this bill will represent this period's work alone, not the running total."
                      : "Uses the Cummu. column -- this bill represents total work done on the project as of this date (the default)."}
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setShowBillModal(false)} className="btn-secondary" disabled={isLoggingBill}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isLoggingBill || !billFile}>
                  {isLoggingBill ? 'Parsing & Computing...' : 'Upload Bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete-bill confirmation */}
      {deleteBillTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(var(--c-black), 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="glass-panel-elevated animate-fade-in" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <AlertTriangle size={20} color="var(--accent-rose-light)" />
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Remove this bill?</h3>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 22, lineHeight: 1.5 }}>
              This permanently removes the bill logged for period{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deleteBillTarget.period}"</strong> (billed{' '}
              {deleteBillTarget.billed_date}). The baseline and every other bill are untouched. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setDeleteBillTarget(null)} className="btn-secondary" disabled={isDeletingBill}>Cancel</button>
              <button type="button" onClick={handleConfirmDeleteBill} className="btn-danger" disabled={isDeletingBill}>
                {isDeletingBill ? 'Removing...' : 'Remove Bill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
