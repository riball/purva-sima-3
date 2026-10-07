import React from 'react'

/**
 * RadialGauge Component
 * Inspired by Reference #3: glowing circular metric ring
 */
export default function RadialGauge({
  percentage = 0,
  size = 140,
  strokeWidth = 10,
  label = '',
  sublabel = '',
  valueText = null,
  color = '#3182CE',
  trackColor = 'rgba(49, 130, 206, 0.1)',
}) {
  const clamped = Math.min(100, Math.max(0, percentage))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (clamped / 100) * circumference

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress Arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: 'stroke-dashoffset 0.8s ease',
            filter: `drop-shadow(0 0 6px ${color}88)`,
          }}
        />
      </svg>
      {/* Center Text */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <span className="tabular-nums" style={{ fontSize: size * 0.22, fontWeight: 700, color: '#f8fafc', lineHeight: 1 }}>
          {valueText !== null ? valueText : `${clamped.toFixed(0)}%`}
        </span>
        {sublabel && (
          <span style={{ fontSize: size * 0.09, color: '#3182CE', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4, fontWeight: 600 }}>
            {sublabel}
          </span>
        )}
      </div>
      {label && (
        <span style={{ marginTop: 8, fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
          {label}
        </span>
      )}
    </div>
  )
}
