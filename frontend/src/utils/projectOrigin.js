/**
 * Conceptual Estimate rebuild: shared mapping from a project's
 * ProjectSummary.baseline_source_type ('boq' | 'wo' | 'phase1_estimate',
 * already computed by backend/app/services/phase3.py's list_projects())
 * to the human-readable origin label the Directory card and Dashboard
 * header both show above a project's title -- "where this project
 * originated from" per the user's own spec. A project with no baseline
 * recorded yet (baseline_source_type is null/undefined) has no origin
 * to show; originLabel() returns null and callers render nothing.
 */
export const ORIGIN_LABELS = {
  phase1_estimate: 'Conceptual Estimate',
  boq: 'BOQ Upload',
  wo: 'Work Order Upload',
}

export function originLabel(baselineSourceType) {
  return ORIGIN_LABELS[baselineSourceType] || null
}
