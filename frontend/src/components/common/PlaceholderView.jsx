import React from 'react'

// Temporary stand-in for a screen not yet built in the phased rebuild --
// lets the shell (nav, theme, company switching) be verified end-to-end
// against the real backend before each real screen lands. Every usage
// site is replaced as its own phase completes (see the approved plan).
export default function PlaceholderView({ title, phase, description }) {
  return (
    <div className="glass-panel" style={{ padding: '48px 32px', textAlign: 'center' }}>
      <div
        style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--brand-light)',
          marginBottom: 10,
        }}
      >
        {phase}
      </div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{title}</h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', maxWidth: 480, margin: '0 auto' }}>{description}</p>
    </div>
  )
}
