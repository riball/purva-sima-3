import React from 'react'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Brush, ResponsiveContainer } from 'recharts'

/**
 * UX refinement (Phase D): the zoomable "read bills like a stock chart"
 * ask. Replaces the fixed-viewport hand-rolled SVG (LineChartCarbon) with
 * a Recharts <ComposedChart> + <Brush> -- the brush handle underneath the
 * chart lets the user drag to zoom into any date range and drag back out,
 * exactly like a stock ticker's range selector. Kept to the existing dark
 * palette: --accent-mint (var(--accent-lime)) for the one real measured series,
 * --accent-amber for the fixed baseline reference line, thin 2px strokes,
 * a dark tooltip that matches the app chrome.
 *
 * Post-delivery correction: this used to ALSO plot present-basis bills
 * (a single billing period's own quantity, not a running total -- see
 * compute_dashboard()'s cumulative/present split) as a second overlaid
 * series on this SAME chart/axis. Reported live as genuinely confusing --
 * "how are current and cumulative in the same graph, they're supposed to
 * be complete separate things" -- and looking at it with real data makes
 * the complaint obvious: a single month's quantity is naturally a much
 * smaller number than a running cumulative total/baseline/projection, so
 * sharing one y-axis crushes the present-only points down near zero,
 * nearly invisible against a baseline/projected scale many times larger.
 * This component now only ever draws ONE series plus reference lines --
 * it no longer knows about "present" at all. The split happens one level
 * up (TrackingChatHub.jsx), which renders TWO separate instances of this
 * same component: one fed only cumulative-basis points (with the
 * baseline/projected/proposed reference lines), one fed only
 * present-basis points (no reference lines -- there's no "baseline" for
 * a single period), each getting its own correctly-scaled y-axis instead
 * of fighting over one.
 *
 * points: [{ period, billed_date, total_gwp_kg_co2e_to_date }], oldest
 * first -- same shape phase3.DashboardResult.points already returns, so
 * this is a drop-in replacement everywhere LineChartCarbon was used.
 *
 * projectedTonnes: a second fixed reference line -- "if billing continues
 * at its current pace, this is where the project's total is headed",
 * i.e. phase3.DashboardResult.projected_total_gwp_kg_co2e, extrapolated
 * from the latest bill's percent-complete. Colored rose when it sits
 * above baselineTonnes (tracking to exceed the original full-scope
 * estimate) and lime otherwise (isExceedingBaseline, computed by the
 * caller from the same projected_vs_baseline_pct the KPI cards already
 * use) -- never confused with the permanent amber baseline line.
 *
 * billStatus: { percentComplete, percentCompleteSource, latestPeriod,
 * projectedVsBaselinePct } -- phase3.DashboardResult's own bill-progress
 * fields, rendered as a compact readout under the chart so "where does
 * this bill stand" reads right off the graph, not just off a separate
 * KPI card.
 *
 * proposedTonnes (Phase E): a third dashed reference line -- "if the
 * currently-pending chat-proposed substitution were confirmed, the
 * project's total would sit here" -- shown only while that proposal is
 * pending, purely a client-side preview never persisted until Confirm is
 * actually clicked. Drawn in purple, so the three fixed reference lines
 * (permanent baseline, current projection, temporary "what it could
 * become") are never confused with each other or with the one real
 * measured series.
 *
 * onPointClick(point) -- UX refinement: "theres no delete option for
 * graphs". When given, every plotted point becomes clickable (and shows
 * a pointer cursor); the caller is handed back the raw point object (the
 * same shape passed in via `points`) and decides what to do with it --
 * TrackingChatHub.jsx wires this to open the exact same delete-bill
 * confirmation modal the bills table's trash icon already uses, so
 * removing a bill no longer requires scrolling down to the table at all.
 *
 * height: number (px) or any CSS height string (e.g. "75vh") -- sets the
 * outer wrapper's height, which ResponsiveContainer then fills at 100%.
 */
export default function ZoomableCarbonChart({
  points = [],
  baselineTonnes = null,
  projectedTonnes = null,
  isExceedingBaseline = false,
  proposedTonnes = null,
  ghostPoints = null,
  billStatus = null,
  onPointClick = null,
  emptyMessage = 'No bills logged yet — this timeline appears after the first one.',
  height = 300,
}) {
  const heightStyle = typeof height === 'number' ? `${height}px` : height

  if (!points || points.length === 0) {
    return (
      <div style={{ height: heightStyle, minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem', textAlign: 'center', padding: 20 }}>
        {emptyMessage}
      </div>
    )
  }

  const ghostByPeriod = {}
  if (ghostPoints) {
    ghostPoints.forEach((g) => {
      ghostByPeriod[g.period] = g.total_gwp_kg_co2e_to_date / 1000
    })
  }

  const data = points.map((p) => ({
    period: p.period,
    billedDate: p.billed_date,
    dateLabel: new Date(p.billed_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }),
    tonnes: p.total_gwp_kg_co2e_to_date / 1000,
    ghostTonnes: ghostByPeriod[p.period],
    _raw: p,
  }))

  // Only show the brush (zoom control) once there's actually a range
  // worth narrowing -- with <=3 points the whole chart already fits.
  const showBrush = data.length > 3
  const projectedColor = isExceedingBaseline ? 'var(--accent-rose)' : 'var(--accent-lime-green)'

  // Explicit Y-axis domain, rather than relying on Recharts'
  // ifOverflow="extendDomain" to auto-stretch the axis for us -- that
  // prop's behavior isn't consistent across every Recharts version, and
  // a baseline/projected total can sit far outside the billed-to-date
  // range (e.g. a project still early in billing vs. its full-scope
  // baseline). Computing the domain ourselves from every value that
  // needs to be visible guarantees the reference lines are always
  // actually on-screen, regardless of Recharts version quirks.
  const allVisibleValues = [
    ...data.map((d) => d.tonnes).filter((v) => v != null),
    ...(baselineTonnes != null ? [baselineTonnes] : []),
    ...(projectedTonnes != null ? [projectedTonnes] : []),
    ...(proposedTonnes != null ? [proposedTonnes] : []),
  ]
  const maxVisibleValue = Math.max(0, ...allVisibleValues)
  const yDomain = [0, maxVisibleValue > 0 ? Math.ceil((maxVisibleValue * 1.08) / 10) * 10 : 10]

  return (
    <div>
      {billStatus && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginBottom: 12, padding: '8px 12px', borderRadius: 'var(--radius-md, 8px)',
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

      <div style={{ height: heightStyle, minHeight: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* Bug fix: this chart's tick values are raw tonnes (no K/M
              abbreviation), so a real project's cumulative/baseline
              numbers routinely run 5-6 digits (e.g. "54000", "100000").
              The old margin.left: -12 + YAxis width: 44 combo was sized
              for 4-digit numbers -- the negative left margin shifted the
              whole axis block 12px further left than its already-tight
              44px label column, pushing the leading 1-2 digits of any
              5+-digit tick off the left edge of the chart's SVG canvas.
              That's what the "this chart is so messed up" / "duplicate
              10000 labels" report was: e.g. "15000"/"30000"/"54000" each
              losing their leading digit and all collapsing to
              visually-similar "...000"-ish clipped text. The DOM text
              content was always correct (confirmed via a live DOM
              dump) -- only the painted glyphs were being clipped.
              Fixed by widening the label column and giving it a small
              positive left margin instead of a negative one, so a
              6-digit tick still fits with room to spare. */}
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
            <Tooltip content={<ChartTooltip />} />

            {baselineTonnes != null && (
              <ReferenceLine
                y={baselineTonnes}
                ifOverflow="extendDomain"
                stroke="var(--accent-amber)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                label={{ value: `Baseline · ${baselineTonnes.toFixed(0)} t`, position: 'insideTopRight', fill: 'var(--accent-amber)', fontSize: 10, fontWeight: 600 }}
              />
            )}

            {projectedTonnes != null && (
              <ReferenceLine
                y={projectedTonnes}
                ifOverflow="extendDomain"
                stroke={projectedColor}
                strokeWidth={1.5}
                strokeDasharray="2 2"
                label={{ value: `Projected · ${projectedTonnes.toFixed(0)} t`, position: 'insideTopLeft', fill: projectedColor, fontSize: 10, fontWeight: 600 }}
              />
            )}

            <Line
              type="monotone"
              dataKey="tonnes"
              name="Billed cumulative"
              stroke="var(--accent-lime)"
              strokeWidth={2}
              dot={(dotProps) => (
                <ClickableDot {...dotProps} key={`dot-${dotProps.payload?.period}`} fillColor="var(--bg-primary)" strokeColor="var(--accent-lime)" radius={4} onPointClick={onPointClick} />
              )}
              activeDot={{ r: 6 }}
              connectNulls={false}
              isAnimationActive={false}
            />

            {proposedTonnes != null && (
              <ReferenceLine
                y={proposedTonnes}
                ifOverflow="extendDomain"
                stroke="var(--accent-violet)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                label={{ value: `Proposed · ${proposedTonnes.toFixed(0)} t`, position: 'insideBottomRight', fill: 'var(--accent-violet)', fontSize: 10, fontWeight: 600 }}
              />
            )}

            {ghostPoints && (
              <Line
                type="monotone"
                dataKey="ghostTonnes"
                name="Proposed (not yet confirmed)"
                stroke="var(--accent-violet)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}

            {showBrush && (
              <Brush
                dataKey="dateLabel"
                height={22}
                stroke="var(--accent-lime)"
                fill="rgba(var(--c-blue), 0.06)"
                travellerWidth={8}
                tickFormatter={() => ''}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.72rem', color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 2, background: 'var(--accent-lime)', display: 'inline-block', borderRadius: 2 }} />
          Billed cumulative
        </span>
        {baselineTonnes != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--accent-amber)', display: 'inline-block' }} />
            Baseline (set previously)
          </span>
        )}
        {projectedTonnes != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: `2px dashed ${projectedColor}`, display: 'inline-block' }} />
            Projected (from bills to date)
          </span>
        )}
        {(proposedTonnes != null || ghostPoints) && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--accent-violet)', display: 'inline-block' }} />
            Proposed (unconfirmed)
          </span>
        )}
        {onPointClick && <span style={{ color: 'var(--text-muted)' }}>Click a point to remove that bill</span>}
        {showBrush && <span style={{ color: 'var(--text-muted)' }}>Drag the handles below the chart to zoom into a date range</span>}
      </div>
    </div>
  )
}

// A plain circle standing in for Recharts' default dot, so a click
// handler (and a pointer cursor) can be attached per-point -- Recharts'
// built-in `dot={{...}}` object form doesn't support onClick, only a
// custom render function (this) does.
function ClickableDot({ cx, cy, payload, fillColor, strokeColor, radius, onPointClick }) {
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
        onPointClick(payload._raw)
      }}
    />
  )
}

function ChartTooltip({ active, payload }) {
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
      <div style={{ color: 'var(--text-tertiary)' }}>{row.billedDate}</div>
      <div style={{ color: 'var(--accent-lime)', fontWeight: 600 }}>
        {row.tonnes != null ? row.tonnes.toFixed(1) : '-'} tCO₂e
      </div>
      {row.ghostTonnes != null && (
        <div style={{ color: 'var(--accent-violet)', fontWeight: 600 }}>{row.ghostTonnes.toFixed(1)} tCO₂e (proposed)</div>
      )}
    </div>
  )
}
