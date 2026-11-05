// Single, shared label map for every material category boq_carbon's
// engine can compute a GWP for -- see backend/app/services/boq_carbon/
// engine.py's ALL_MATERIAL_CATEGORIES tuple, which this list must stay in
// sync with (same 17 categories, same raw strings). Pulled out of
// CategoryBarChart.jsx into its own module so the new searchable
// "every material with a stored emission factor" list (MaterialSearchPanel.jsx)
// and every bar-chart use of these categories show the exact same label
// for the exact same category, rather than two components growing their
// own slightly-different copies.
export const MATERIAL_CATEGORY_LABELS = {
  rcc: 'RCC (Reinforced Cement Concrete)',
  pcc: 'PCC (Plain Cement Concrete)',
  reinforcement_steel: 'Reinforcement Steel',
  structural_steel: 'Structural Steel',
  brickwork: 'Brickwork',
  blockwork_aac: 'AAC Blockwork',
  blockwork_dense: 'Dense Blockwork',
  // Generic fallback classification -- a BOQ line that said "masonry"
  // with no brick/block/AAC/dense keyword specific enough to resolve to
  // one of the categories above (see classifier.py's _MASONRY_RE, last
  // priority in _ORDERED_RULES so it never steals a more specific match).
  masonry: 'Masonry (Generic)',
  plaster_cement: 'Cement Plaster',
  plaster_gypsum: 'Gypsum Plaster',
  tile_ceramic: 'Ceramic Tile',
  natural_stone: 'Natural Stone',
  paint: 'Paint',
  aluminium: 'Aluminium',
  upvc_window_door_frame: 'uPVC Window/Door Frame',
  glass: 'Glass',
  timber: 'Timber',
}

/** Human-readable label for a category string, falling back to a
 * title-cased version of the raw category for anything not in the map
 * above (keeps this safe for a category added backend-side before this
 * map is updated, rather than throwing or showing nothing). */
export function materialLabel(category) {
  if (!category) return 'Uncategorized'
  return MATERIAL_CATEGORY_LABELS[category] || category.replace(/_/g, ' ')
}
