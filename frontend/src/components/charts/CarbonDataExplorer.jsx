import React, { useMemo, useState } from 'react'
import {
  ComposedChart, Line, Bar, Area, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Brush, ResponsiveContainer,
} from 'recharts'
import { X, Plus } from 'lucide-react'

/**
 * UX refinement (Phase G): replaces the two separate, fixed-shape charts
 * TrackingChatHub.jsx used to render (one Cumulative-vs-Baseline line
 * chart with reference lines, one bare Present-Period bar-less chart) with
 * ONE chart the user builds themselves -- "I should be able to use data
 * visualization techniques to view the data selected."
 *
 * Every number this project can plot against a timeline is exposed as a
 * "metric" the user can add or remove, and each added metric gets its own
 * independently-chosen render type (line / bar / area / points) -- so
 * "cumulative as a line + present period as bars + baseline as a line"
 * all compose onto one ComposedChart, sharing one x-axis and one
 * color-coded legend (the metric chips themselves double as the legend --
 * their color swatch IS the series color, so there's no separate static
 * legend to keep in sync).
 *
 * Why cumulative and present (two genuinely different timelines, with
 * possibly-different period dates -- see phase3.compute_dashboard()'s
 * quantity_basis split) can now share one x-axis when they couldn't share
 * one Y-SCALE before: the old complaint ("how are current and cumulative
 * in the same graph") was about one shared axis silently summing/crushing
 * two incomparable magnitudes together with no way to tell them apart.
 * Here they're still two distinct series (own color, own legend chip,
 * never merged into one number) -- only the x-axis (dates) is shared,
 * which is exactly what "view both over the same timeline" asks for. The
 * y-axis domain is still computed from whatever's actually selected, so
 * turning Present off again shrinks the scale back down.
 *
 * Baseline / Projected / Proposed used to be Recharts <ReferenceLine>s --
 * fixed, line-only, un-selectable. They're now ordinary data series (the
 * same constant value repeated across every visible date) so they can be
 * rendered as any of the four types too, same as a real measured series.
 * Each keeps its default dashed-line look when left on "Line" (so the
 * at-a-glance "dashed = reference, solid = measured" read survives), but
 * nothing stops picking "Bar" for Baseline if that's genuinely more
 * useful for a particular comparison.
 *
 * Props: same inputs TrackingChatHub.jsx already had on hand for the two
 * old charts -- nothing new required of the caller.
 */

const TYPE_OPTIONS = [
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar / Histogram' },
  { value: 'area', label: 'Area' },
  { value: 'points', label: 'Points' },
]

const DEFAULT_TYPE = {
  cumulative: 'line',
  present: 'bar',
  baseline: 'line',
  projected: 'line',
  proposed: 'line',
}

const CONSTANT_METRICS = new Set(['baseline', 'projected', 'proposed'])
const DELETABLE_METRICS = new Set(['cumulative', 'present'])

export default function CarbonDataExplorer({
  cumulativePoints = [],
  presentOnlyPoints = [],
  baselineTonnes = null,
  projectedTonnes = null,
  // Project Dashboard rebuild (item 5): progressive, per-point baseline/
  // projected figures -- "a progressive estimate of the baseline... not a
  // straight line", "projected carbon... also to be not a straight line
  // but a changing figure with respect to the project completion status."
  // Each is an optional array of {period, value} (value already in
  // tonnes, same unit as baselineTonnes/projectedTonnes), one entry per
  // DashboardPoint that could compute one. Looked up per row by `period`
  // below; a row with no matching entry (or when the array itself is
  // empty/omitted -- "if no bills were uploaded then a straight line is
  // accepted") falls back to the flat baselineTonnes/projectedTonnes
  // constant, so nothing regresses for a caller that never passes these.
  baselineSeries = null,
  projectedSeries = null,
  isExceedingBaseline = false,
  proposedTonnes = null,
  billStatus = null,
  onPointClick = null,
  emptyMessage = 'No bills logged yet — this timeline appears after the first one.',
  height = '70vh',
  // Phase E's "Trajectory" default card (the mockup's Section 2 grid) wants
  // Baseline/Cumulative/Period-Incurred on load instead of this
  // component's long-standing cumulative+baseline+projected default --
  // overridable per caller rather than changing what every other screen
  // using this same explorer (TrackingChatHub, CarbonTrackingPage) opens
  // with by default.
  defaultSeriesKeys = ['cumulative', 'baseline', 'projected'],
}) {
  const heightStyle = typeof height === 'number' ? `${height}px` : height
  const projectedColor = isExceedingBaseline ? 'var(--accent-rose)' : 'var(--accent-lime-green)'

  // Baseline -> Period/Present -> Cumulative is the same progression the
  // mockup's Trajectory chart shows (its own sampled hues pass the dataviz
  // skill's `--ordinal` checks, see index.css's --chart-ord-* tokens) --
  // reused here for those 3 roles. `projected`'s color is a genuine STATUS
  // signal (on-track vs over-baseline), not series identity, so it keeps
  // its own red/green logic unchanged. `proposed` is a true "what-if"
  // overlay that can render alongside all three at once, so it gets its
  // own nominal categorical slot rather than crowding the ordinal ramp.
  const metricDefs = useMemo(
    () => ({
      cumulative: { key: 'cumulative', label: 'Cumulative (Billed)', color: 'var(--chart-ord-dark)', available: cumulativePoints.length > 0 },
      present: { key: 'present', label: 'Monthly / Present Period', color: 'var(--chart-ord-mid)', available: presentOnlyPoints.length > 0 },
      baseline: { key: 'baseline', label: 'Baseline', color: 'var(--chart-ord-light)', available: baselineTonnes != null || (baselineSeries && baselineSeries.length > 0) },
      projected: { key: 'projected', label: 'Projected at Completion', color: projectedColor, available: projectedTonnes != null || (projectedSeries && projectedSeries.length > 0) },
      proposed: { key: 'proposed', label: 'Proposed (unconfirmed)', color: 'var(--chart-cat-4)', available: proposedTonnes != null },
    }),
    [cumulativePoints.length, presentOnlyPoints.length, baselineTonnes, projectedTonnes, proposedTonnes, projectedColor, baselineSeries, projectedSeries]
  )

  // Default view: whatever the single old "Cumulative vs Baseline" chart
  // used to show by default (cumulative + baseline + projected), so
  // nothing regresses for someone who never touches the controls --
  // "baseline being default and seen already."
  const [series, setSeries] = useState(() =>
    defaultSeriesKeys
      .filter((k) => metricDefs[k]?.available)
      .map((k) => ({ key: k, type: DEFAULT_TYPE[k] }))
  )

  const addMetric = (key) => {
    if (!key || series.some((s) => s.key === key)) return
    setSeries((prev) => [...prev, { key, type: DEFAULT_TYPE[key] || 'line' }])
  }
  const removeMetric = (key) => setSeries((prev) => prev.filter((s) => s.key !== key))
  const setMetricType = (key, type) => setSeries((prev) => prev.map((s) => (s.key === key ? { ...s, type } : s)))

  const addableKeys = Object.values(metricDefs).filter((m) => m.available && !series.some((s) => s.key === m.key))

  // Merge both point arrays into one date-sorted timeline. Each row only
  // carries the fields a bill actually exists for on that date -- the
  // other series simply has a gap there (Recharts skips nulls rather than
  // drawing a false zero).
  //
  // Keyed by `period`, not `billed_date`: ZoomableCarbonChart (what this
  // replaces) never merged rows at all -- one x-axis entry per bill,
  // always -- and two distinct periods can legitimately share the same
  // billed_date (e.g. several bills entered/backdated the same day).
  // Keying by billed_date silently collapsed those into one row and
  // dropped the others. `period` is the field compute_dashboard() already
  // treats as each bill's unique identity (it's also the delete-bill key),
  // so it's the safe merge key; a present-basis point only merges onto a
  // cumulative row that happens to share the exact same period label,
  // which is the one case where that's actually desired (both metrics for
  // "this period" plotted at the same x position).
  const data = useMemo(() => {
    const rowsByPeriod = new Map()
    const addPoints = (points, field) => {
      points.forEach((p) => {
        const rowKey = p.period || p.billed_date
        if (!rowsByPeriod.has(rowKey)) {
          rowsByPeriod.set(rowKey, {
            billedDate: p.billed_date,
            dateLabel: new Date(p.billed_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }),
            period: p.period,
            _raw: {},
          })
        }
        const row = rowsByPeriod.get(rowKey)
        row[field] = p.total_gwp_kg_co2e_to_date / 1000
        row._raw[field] = p
      })
    }
    addPoints(cumulativePoints, 'cumulative')
    addPoints(presentOnlyPoints, 'present')

    const rows = Array.from(rowsByPeriod.values()).sort((a, b) => new Date(a.billedDate) - new Date(b.billedDate))

    const baselineByPeriod = new Map((baselineSeries || []).map((p) => [p.period, p.value]))
    const projectedByPeriod = new Map((projectedSeries || []).map((p) => [p.period, p.value]))

    // Baseline/Projected: a progressive, per-point value when one was
    // computed for that exact period (see baselineSeries/projectedSeries
    // above), else the flat constant stamped across every visible date --
    // the same "fixed horizontal line" behavior this always had, kept as
    // the fallback so a caller with no progressive data (or a project
    // with no bills, which never gets here at all) still renders a
    // straight reference line.
    rows.forEach((row) => {
      const progressiveBaseline = baselineByPeriod.get(row.period)
      row.baseline = progressiveBaseline != null ? progressiveBaseline : baselineTonnes != null ? baselineTonnes : undefined
      const progressiveProjected = projectedByPeriod.get(row.period)
      row.projected = progressiveProjected != null ? progressiveProjected : projectedTonnes != null ? projectedTonnes : undefined
      if (proposedTonnes != null) row.proposed = proposedTonnes
    })

    return rows
  }, [cumulativePoints, presentOnlyPoints, baselineTonnes, projectedTonnes, proposedTonnes, baselineSeries, projectedSeries])

  if (data.length === 0) {
    return (
      <div style={{ height: heightStyle, minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem', textAlign: 'center', padding: 20 }}>
        {emptyMessage}
      </div>
    )
  }

  const showBrush = data.length > 3

  const allVisibleValues = data.flatMap((row) => series.map((s) => row[s.key]).filter((v) => v != null))
  const maxVisibleValue = Math.max(0, ...allVisibleValues)
  const yDomain = [0, maxVisibleValue > 0 ? Math.ceil((maxVisibleValue * 1.08) / 10) * 10 : 10]

  const handleSeriesClick = (metricKey, payload) => {
    if (!onPointClick || !DELETABLE_METRICS.has(metricKey)) return
    const raw = payload?._raw?.[metricKey]
    if (raw) onPointClick(raw)
  }

  return (
    <div>
      {billStatus && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginBottom: 14, padding: '8px 12px', borderRadius: 'var(--radius-md, 8px)',
            background: 'rgba(var(--c-blue), 0.06)', border: '1px solid rgba(var(--c-blue), 0.14)',
            fontSize: '0.78rem',
          }}
        >
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {billStatus.percentComplete != null ? `${billStatus.percentComplete.toFixed(1)}% complete` : 'No bills logged yet'}
          </span>
          {billStatus.percentCompleteSource && (
            <span style={{ color: 'var(--text-muted)' }}>({billStatus.percentCompleteSource.replace(/_/g, ' ')})</span>
          )}
          {billStatus.latestPeriod && (
            <>
              <span style={{ color: 'var(--border-slate)' }}>•</span>
              <span style={{ color: 'var(--text-tertiary)' }}>Latest bill: {billStatus.latestPeriod}</span>
            </>
          )}
          {billStatus.projectedVsBaselinePct != null && (
            <>
              <span style={{ color: 'var(--border-slate)' }}>•</span>
              <span style={{ color: projectedColor, fontWeight: 600 }}>
                {billStatus.projectedVsBaselinePct > 0 ? '+' : ''}
                {billStatus.projectedVsBaselinePct.toFixed(1)}% vs baseline at this pace
              </span>
            </>
          )}
        </div>
      )}

      {/* Metric + chart-type controls -- doubles as the legend: each
          chip's color swatch is the exact color that metric is drawn in. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {series.map((s) => {
          const def = metricDefs[s.key]
          if (!def) return null
          return (
            <div
              key={s.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius-full)', padding: '4px 6px 4px 10px',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: def.color, flexShrink: 0 }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{def.label}</span>
              <select
                value={s.type}
                onChange={(e) => setMetricType(s.key, e.target.value)}
                className="form-select"
                style={{ fontSize: '0.7rem', padding: '3px 20px 3px 8px', height: 'auto', minWidth: 0, width: 'auto' }}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeMetric(s.key)}
                title={`Remove ${def.label}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: '50%', border: 'none',
                  background: 'rgba(var(--c-overlay), 0.08)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <X size={11} />
              </button>
            </div>
          )
        })}

        {addableKeys.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} color="var(--text-muted)" />
            <select
              value=""
              onChange={(e) => addMetric(e.target.value)}
              className="form-select"
              style={{ fontSize: '0.75rem', padding: '5px 24px 5px 8px', height: 'auto', width: 'auto' }}
            >
              <option value="" disabled>Add metric...</option>
              {addableKeys.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div style={{ height: heightStyle, minHeight: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="rgba(var(--c-overlay),0.06)" vertical={false} />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'rgba(var(--c-overlay),0.1)' }} tickLine={false} />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={(v) => v.toFixed(0)}
            />
            <Tooltip content={<ExplorerTooltip series={series} metricDefs={metricDefs} />} />

            {series.map((s) => {
              const def = metricDefs[s.key]
              if (!def) return null
              const dashed = CONSTANT_METRICS.has(s.key) ? '5 4' : undefined
              const clickable = DELETABLE_METRICS.has(s.key) && !!onPointClick

              if (s.type === 'bar') {
                return (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={def.label}
                    fill={def.color}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                    cursor={clickable ? 'pointer' : undefined}
                    onClick={clickable ? (payload) => handleSeriesClick(s.key, payload) : undefined}
                  />
                )
              }
              if (s.type === 'area') {
                return (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={def.label}
                    stroke={def.color}
                    fill={def.color}
                    fillOpacity={0.16}
                    strokeWidth={2}
                    strokeDasharray={dashed}
                    connectNulls={false}
                    isAnimationActive={false}
                    dot={clickable ? { r: 3, cursor: 'pointer', onClick: (e, p) => handleSeriesClick(s.key, p?.payload) } : false}
                  />
                )
              }
              if (s.type === 'points') {
                return (
                  <Scatter
                    key={s.key}
                    dataKey={s.key}
                    name={def.label}
                    fill={def.color}
                    isAnimationActive={false}
                    cursor={clickable ? 'pointer' : undefined}
                    onClick={clickable ? (payload) => handleSeriesClick(s.key, payload) : undefined}
                  />
                )
              }
              // default: line
              return (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={def.label}
                  stroke={def.color}
                  strokeWidth={2}
                  strokeDasharray={dashed}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={(dotProps) => (
                    <ClickableDot
                      {...dotProps}
                      key={`dot-${s.key}-${dotProps.payload?.period}`}
                      fillColor="var(--bg-primary)"
                      strokeColor={def.color}
                      radius={4}
                      onPointClick={clickable ? () => handleSeriesClick(s.key, dotProps.payload) : null}
                    />
                  )}
                  activeDot={{ r: 6 }}
                />
              )
            })}

            {showBrush && (
              <Brush
                dataKey="dateLabel"
                height={22}
                stroke="var(--chart-ord-dark)"
                fill="rgba(var(--c-blue), 0.06)"
                travellerWidth={8}
                tickFormatter={() => ''}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.72rem', color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
        {onPointClick && series.some((s) => DELETABLE_METRICS.has(s.key)) && (
          <span style={{ color: 'var(--text-muted)' }}>Click a cumulative or present-period mark to remove that bill</span>
        )}
        {showBrush && <span style={{ color: 'var(--text-muted)' }}>Drag the handles below the chart to zoom into a date range</span>}
      </div>
    </div>
  )
}

// A plain circle standing in for Recharts' default dot, so a click
// handler (and a pointer cursor) can be attached per-point -- Recharts'
// built-in `dot={{...}}` object form doesn't support onClick, only a
// custom render function (this) does.
function ClickableDot({ cx, cy, fillColor, strokeColor, radius, onPointClick }) {
  if (cx == null || cy == null) return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={fillColor}
      stroke={strokeColor}
      strokeWidth={2}
      style={{ cursor: onPointClick ? 'pointer' : 'default' }}
      onClick={(e) => {
        if (!onPointClick) return
        e.stopPropagation()
        onPointClick()
      }}
    />
  )
}

function ExplorerTooltip({ active, payload, series, metricDefs }) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
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
      <div style={{ fontWeight: 700 }}>{row.period}</div>
      <div style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>{row.billedDate}</div>
      {series.map((s) => {
        const def = metricDefs[s.key]
        const v = row[s.key]
        if (v == null || !def) return null
        return (
          <div key={s.key} style={{ color: def.color, fontWeight: 600 }}>
            {def.label}: {v.toFixed(1)} tCO₂e
          </div>
        )
      })}
    </div>
  )
}
