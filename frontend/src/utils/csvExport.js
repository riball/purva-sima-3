/**
 * Shared CSV export helper -- extracted from ReportsView.jsx so
 * ProjectDashboard.jsx's "Export Report" quick-menu action (Project
 * Dashboard rebuild, item 3) can produce the exact same CSV shape/
 * encoding without duplicating this logic. Behavior is byte-for-byte
 * unchanged from the original ReportsView.jsx implementation.
 */

function toCsvValue(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(toCsvValue).join(',')]
  for (const row of rows) {
    lines.push(row.map(toCsvValue).join(','))
  }
  // BOM so Excel (the realistic consumer for a construction-industry CSV)
  // opens UTF-8 correctly instead of mangling the ₹/₂/₄ symbols already
  // used elsewhere in this app's real data.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
