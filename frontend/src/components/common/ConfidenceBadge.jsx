import React from 'react'

export default function ConfidenceBadge({ source = 'unset', confidence = 0.0 }) {
  const configs = {
    'user-entered': {
      label: 'User Entered',
      badgeClass: 'badge-lime',
      confText: '100%',
    },
    'own-boq-extracted': {
      label: 'Own BOQ',
      badgeClass: 'badge-mint',
      confText: `${(confidence * 100).toFixed(0)}%`,
    },
    'boq-matched': {
      label: 'Reference Scaled',
      badgeClass: 'badge-cyan',
      confText: `${(confidence * 100).toFixed(0)}%`,
    },
    'llm-estimated': {
      label: 'Estimated Gap',
      badgeClass: 'badge-amber',
      confText: `${(confidence * 100).toFixed(0)}%`,
    },
    'fallback-default': {
      label: 'Standard Default',
      badgeClass: 'badge-muted',
      confText: `${(confidence * 100).toFixed(0)}%`,
    },
    'unset': {
      label: 'Unset',
      badgeClass: 'badge-muted',
      confText: '0%',
    },
  }

  const config = configs[source] || configs['unset']

  return (
    <span
      className={`badge ${config.badgeClass}`}
      title={`Source: ${source} (Confidence: ${config.confText})`}
      style={{ cursor: 'help' }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />
      {config.label}
      <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>{config.confText}</span>
    </span>
  )
}
