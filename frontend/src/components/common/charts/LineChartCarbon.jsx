import React, { useState } from 'react'

const WIDTH = 640
const PAD = { top: 16, right: 20, bottom: 30, left: 56 }

/**
 * Cumulative embodied-carbon-over-time line chart, with an optional
 * dashed baseline reference line. Plain SVG (no charting library in this
 * project's dependencies) -- single accent hue for the one real series,
 * a dashed neutral-amber reference line for the baseline (never the same
 * hue as the series, since it's a different kind of thing: a fixed
 * target, not a measured point), >=8px hit targets on hover, direct
 * value+period tooltip instead of a wall of always-on labels.
 *
 * points: [{ period, billed_date, total_gwp_kg_co2e_to_date }], oldest
 * first (matches phase3.DashboardResult.points' own ordering).
 */
export default function LineChartCarbon({ points = [], baselineTonnes = null, height = 220 }) {
  const [hoverIdx, setHoverIdx] = useState(null)
  const innerW = WIDTH - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom

  if (!points || points.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.8125rem', textAlign: 'center', padding: 20 }}>
        No bills logged yet — this timeline appears after the first one.
      </div>
    )
  }

  const values = points.map((p) => p.total_gwp_kg_co2e_to_date / 1000)
  const maxVal = Math.max(...values, baselineTonnes || 0) * 1.12 || 1
  const dates = points.map((p) => new Date(p.billed_date).getTime())
  const minDate = Math.min(...dates)
  const maxDate = Math.max(...dates)
  const dateSpan = maxDate - minDate || 1

  const xFor = (i) => (points.length === 1 ? innerW / 2 : ((dates[i] - minDate) / dateSpan) * innerW)
  const yFor = (v) => innerH - (v / maxVal) * innerH

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`).join(' ')

  const yTicks = 4
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (maxVal / yTicks) * i)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} role="img" aria-label="Cumulative embodied carbon over time, versus baseline">
        <g transform={`translate(${PAD.left}, ${PAD.top})`}>
          {tickVals.map((t, i) => (
            <g key={i}>
              <line x1={0} x2={innerW} y1={yFor(t)} y2={yFor(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={-10} y={yFor(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#64748b">
                {t.toFixed(0)}
              </text>
            </g>
          ))}

          {baselineTonnes != null && (
            <>
              <line x1={0} x2={innerW} y1={yFor(baselineTonnes)} y2={yFor(baselineTonnes)} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4" />
              <text x={innerW} y={Math.max(yFor(baselineTonnes) - 6, 10)} textAnchor="end" fontSize={10} fill="#f59e0b" fontWeight={600}>
                Baseline · {baselineTonnes.toFixed(0)} t
              </text>
            </>
          )}

          <path d={linePath} fill="none" stroke="#3182CE" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

          {values.map((v, i) => (
            <circle
              key={`pt-${i}`}
              cx={xFor(i)} cy={yFor(v)} r={hoverIdx === i ? 6 : 4}
              fill="#0B2B26" stroke="#3182CE" strokeWidth={2}
            />
          ))}

          {values.map((v, i) => (
            <rect
              key={`hit-${i}`}
              x={xFor(i) - 12} y={0} width={24} height={innerH} fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            />
          ))}

          <text x={0} y={innerH + 20} fontSize={10} fill="#64748b" textAnchor="start">
            {new Date(points[0].billed_date).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
          </text>
          {points.length > 1 && (
            <text x={innerW} y={innerH + 20} fontSize={10} fill="#64748b" textAnchor="end">
              {new Date(points[points.length - 1].billed_date).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
            </text>
          )}
        </g>
      </svg>

      {hoverIdx != null && (
        <div
          style={{
            position: 'absolute',
            left: `${((PAD.left + xFor(hoverIdx)) / WIDTH) * 100}%`,
            top: 4,
            transform: 'translateX(-50%)',
            background: 'rgba(8,15,10,0.95)',
            border: '1px solid rgba(49,130,206,0.35)',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 11,
            color: '#f8fafc',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
            zIndex: 5,
          }}
        >
          <div style={{ fontWeight: 700 }}>{points[hoverIdx].period}</div>
          <div style={{ color: '#94a3b8' }}>{points[hoverIdx].billed_date}</div>
          <div style={{ color: '#3182CE', fontWeight: 600 }}>{values[hoverIdx].toFixed(1)} tCO₂e</div>
        </div>
      )}
    </div>
  )
}
