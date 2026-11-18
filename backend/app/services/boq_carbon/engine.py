"""Phase 2 calculation engine: raw BOQ file -> embodied carbon (GWP100,
kg CO2e), using the format-agnostic parser (parser.py), the keyword
classifier (classifier.py), and the single canonical factor source
(Workstream 01) -- app.services.ice_factors/cea_adjustment for concrete +
reinforcement steel (cement-type/grade-dependent, the same real
CEA-adjusted IFC data Phase 1 uses), and app.services.emission_factors
for every other category. Both boq_carbon and wo_carbon read from this
same pair of modules now; neither engine keeps its own copy of a number.
See emission_factors.py's module docstring for what changed in this
workstream and why (extra_factors.py / boq_carbon_extra_factors.json are
now deprecated, unread by this engine, kept only as a historical record).

Floor area handling -- read this before trusting a kgCO2e/m2 figure:

Comparing this pipeline's real BOQ-derived totals against real EDGE
certification report numbers (two actual projects) showed the single
largest source of a "wrong-looking" per-sqm figure was DIVIDING BY THE
WRONG AREA, not a factor-accuracy problem. One project's declared
"Gross Internal Area" turned out to be just its apartments' net area
(272 units summed), excluding a large basement/podium/parking structure
that the BOQ (correctly) prices concrete and steel for -- an 8.5x gap
between that declared area and the project's true built-up area.
Because of this, calculate_from_boq() takes floor_area_basis as a
REQUIRED, explicit field alongside floor_area_sqm (not just a bare
number) and stamps it onto the result, so nobody downstream can read a
"kg CO2e/m2" figure without also seeing what it was divided by.

Scope, stated plainly: only line items the classifier recognizes AND
whose unit is one this engine knows how to convert contribute to the
total. Everything else is tracked in unclassified_line_items /
unconverted_line_items rather than silently dropped -- so the coverage
gap is always visible on the result, never hidden inside a single
"total" number.

compute_line_gwp() (previously a module-private _compute_line_gwp) is
now also imported directly by substitution_engine.py, which needs to
recompute a line's GWP under an ALTERNATE cement_type/category to
produce a real substitution delta rather than an estimated one -- see
that module's docstring.
"""

from __future__ import annotations

import re
from typing import Literal, Optional, Union

from pydantic import BaseModel

from app.services import coverage as coverage_service
from app.services.boq_carbon.classifier import (
    CATEGORY_ALUMINIUM,
    CATEGORY_BLOCKWORK_AAC,
    CATEGORY_BLOCKWORK_DENSE,
    CATEGORY_BRICK,
    CATEGORY_GLASS,
    CATEGORY_MASONRY,
    CATEGORY_NATURAL_STONE,
    CATEGORY_PAINT,
    CATEGORY_PCC,
    CATEGORY_PLASTER_CEMENT,
    CATEGORY_PLASTER_GYPSUM,
    CATEGORY_RCC,
    CATEGORY_STEEL_REBAR,
    CATEGORY_STEEL_SECTION,
    CATEGORY_TILE_CERAMIC,
    CATEGORY_TIMBER,
    CATEGORY_UPVC,
    classify_material,
)

# The complete, canonical set of material categories THIS ENGINE can
# compute a GWP for -- one tuple listing exactly the same 17 categories
# compute_line_gwp()'s own `if category in (...)` / `if category ==`
# branches below handle, in the same order they appear there. Added for
# the "search any material with a stored emission factor, not just this
# BOQ's top 5" feature (see calculate_from_boq's all_materials field) --
# that feature needs to know the full universe of computable categories,
# including ones that happen not to appear in a given BOQ at all, which
# by_category alone can't answer (it only ever lists categories that had
# at least one computed line). Kept as one tuple, in this one module,
# right next to the branches it mirrors, specifically so the two can
# never silently drift apart -- adding a new category to compute_line_gwp
# means adding it here too, in the same file, a few lines away.
ALL_MATERIAL_CATEGORIES: tuple[str, ...] = (
    CATEGORY_RCC,
    CATEGORY_PCC,
    CATEGORY_STEEL_REBAR,
    CATEGORY_STEEL_SECTION,
    CATEGORY_BRICK,
    CATEGORY_BLOCKWORK_AAC,
    CATEGORY_BLOCKWORK_DENSE,
    CATEGORY_MASONRY,
    CATEGORY_PLASTER_CEMENT,
    CATEGORY_PLASTER_GYPSUM,
    CATEGORY_TILE_CERAMIC,
    CATEGORY_NATURAL_STONE,
    CATEGORY_PAINT,
    CATEGORY_ALUMINIUM,
    CATEGORY_UPVC,
    CATEGORY_GLASS,
    CATEGORY_TIMBER,
)
from app.services.boq_carbon.parser import extract_billable_items
from app.services.boq_carbon.sheets import default_sheets, detect_overlaps
from app.services.emission_factors import get_factor
from app.services.ice_factors import get_concrete_factor_per_m3, get_steel_rebar_factor_per_kg

SQM_TO_SQFT = 10.7639

_VOL_UNITS = re.compile(r"^(cum|cu\.?m|m3|m\^3)$", re.I)
_AREA_UNITS = re.compile(r"^(sqm|sq\.?m|m2|m\^2)$", re.I)
_MASS_KG_UNITS = re.compile(r"^(kg|kgs)$", re.I)
_MASS_MT_UNITS = re.compile(r"^(mt|ton|tonne|tonnes|t)$", re.I)
# Linear/running-length units -- added for tile skirting/coping items
# (e.g. "CLAY TILE... skirting... 100mm height", priced in Rmt, not Sqm).
# Confirmed real via diagnose_coverage_gaps.py: these lines were correctly
# classified as 'tile' but silently dropped because the engine only knew
# how to convert Sqm for that category.
_LINEAR_UNITS = re.compile(r"^(rmt|rm|rft|r\.?m\.?t?)$", re.I)
# Count/piece units -- added for timber joinery items. Confirmed real via
# a direct scan of both reference BOQs before adding this category at
# all: every one of Ecopolitan's 75 genuine timber lines (door/window
# frame joinery) is priced in "Nos", none in kg/m3/m2 -- so a count-unit
# conversion path is required for timber to contribute anything, not
# optional the way it was for the mass/area/volume categories.
_COUNT_UNITS = re.compile(r"^(nos\.?|no\.?|each|ea)$", re.I)

# Assumed skirting/coping height for tile items priced per running metre
# rather than per sqm. 100mm is stated explicitly in the one real example
# checked ("100mm height" note on a clay-tile skirting item) -- standard
# Indian skirting height is commonly 100-150mm, so this is a reasonable,
# evidenced default, not an arbitrary guess, but it IS an assumption
# rather than a per-line-verified figure -- basis_note always says so.
ASSUMED_TILE_SKIRTING_HEIGHT_M = 0.1

FloorAreaBasis = Literal["net_internal_gia", "built_up_total", "carpet_saleable", "other"]

FLOOR_AREA_BASIS_NOTES = {
    "net_internal_gia": (
        "Net internal / Gross Internal Area -- typically the sum of individual "
        "unit areas only (e.g. apartment carpet+wall areas), EXCLUDING common "
        "areas, corridors, basement, podium parking, and terrace/service floors. "
        "Confirmed on a real project to be as little as 1/8.5 of that same "
        "project's true built-up area -- dividing a whole-building carbon total "
        "by this figure will read as a large overestimate versus a report that "
        "uses a narrower area definition, even when the underlying quantities "
        "are correct."
    ),
    "built_up_total": (
        "Total constructed floor area across every level the BOQ actually prices "
        "-- basement, podium/parking, tower floors, terrace, common areas, "
        "everything. This is the area that should be roughly proportional to "
        "the BOQ's own concrete/steel/finishes quantities."
    ),
    "carpet_saleable": (
        "Saleable/carpet area -- usually smaller than net_internal_gia (excludes "
        "wall thickness, balconies counted at reduced weightage, etc.). Rarely "
        "the right denominator for a whole-building carbon total."
    ),
    "other": "Basis not one of the standard categories above -- describe it in a note when reporting this result.",
}


class LineItemResult(BaseModel):
    row: int
    enriched_description: str
    uom: Optional[str]
    qty: Optional[float]
    category: Optional[str]
    cement_type: Optional[str] = None
    grade: Optional[str] = None
    gwp_kg_co2e: Optional[float]
    basis_note: str  # e.g. "12.3 m3 x 227.1 kgCO2e/m3 (PPC, M25)", or the reason it wasn't computed
    # UX refinement (Phase C, Part A): which of coverage.py's fixed six-
    # reason taxonomy buckets this line fell into, when it wasn't
    # computed -- set from _classify_boq_exclusion_reason(), the SAME
    # function calculate_from_boq()'s own coverage_rows builder already
    # called (computed once now, read twice, not computed twice). None
    # for a line that WAS computed. Lets the frontend's "What Wasn't
    # Computed, and Why" panel filter line_items by reason directly,
    # instead of only ever seeing coverage.excluded_by_reason's aggregate
    # count with no way to see which lines it's counting.
    exclusion_reason: Optional[str] = None
    # Workstream 07: the BOQ's own Rate/Amount columns for this row, when
    # the sheet has them (parser.py's extract_billable_items already
    # parses both -- this just surfaces them on the result). Purely
    # additive; None for any BOQ/row with no priced Rate/Amount column.
    # Feed the new `coverage` field's value-weighted coverage check below
    # -- rate is kept alongside amount (not just amount alone) because a
    # real reference BOQ was found, while building this, whose Amount
    # column is present but zero-filled for every row despite Rate being
    # real throughout (confirmed: wherever both amount and rate*qty are
    # present elsewhere in the same file, amount == rate*qty exactly) --
    # coverage falls back to rate*qty for exactly that case, see
    # calculate_from_boq's coverage-row builder.
    rate: Optional[float] = None
    amount: Optional[float] = None
    # Which workbook / sheet this line came from. `row` alone repeats across
    # sheets, so identify a line by (source_file, source_sheet, row) -- see
    # line_key() below. None only on results saved before multi-sheet support.
    source_file: Optional[str] = None
    source_sheet: Optional[str] = None


def line_key(li) -> tuple:
    """A line's identity inside a (possibly multi-sheet, multi-file) result."""
    return (getattr(li, "source_file", None), getattr(li, "source_sheet", None), li.row)


class SourceSummary(BaseModel):
    """One row of the per-sheet breakdown shown when a result combines several
    sheets and/or files: what each contributed to the combined total."""
    source_file: str
    sheet_name: str
    n_lines_total: int
    n_lines_computed: int
    total_gwp_kg_co2e: float
    total_value: float


class CategoryTotal(BaseModel):
    category: str
    gwp_kg_co2e: float
    line_item_count: int
    pct_of_total: float
    # Added for the Project Dashboard's Materials table (Emission Factor /
    # EPD-Database-Source columns) -- both derived purely from data this
    # engine already computes per line, no new factor-resolution path.
    # representative_emission_factor: this category's gwp_kg_co2e divided
    # by the summed qty of only the line items that actually fed that
    # total -- meaningful because every line within one category shares
    # one native unit (m3 for concrete, kg for steel, etc. -- see
    # compute_line_gwp's per-category unit checks above), so this is a
    # real kgCO2e-per-native-unit figure, not a cross-unit average. None
    # when qty_covered is 0 (shouldn't happen if gwp_kg_co2e > 0, but
    # guards divide-by-zero regardless).
    representative_emission_factor: Optional[float] = None
    # dominant_factor_source: rather than text-mining every line's
    # basis_note (format varies per category, and concrete's own source
    # can genuinely vary line-to-line by cement_type/grade blend), this
    # is simply the basis_note of the single highest-GWP line item in
    # this category -- "representative" in the literal sense: a real
    # line that really did compute this way, not an invented aggregate.
    dominant_factor_source: Optional[str] = None


class BoqCarbonResult(BaseModel):
    source_file: str
    sheet_name: str
    # One entry per (file, sheet) that fed this result -- a single entry for
    # an ordinary one-sheet BOQ, several for a multi-sheet / multi-file one.
    sources: list[SourceSummary] = []
    # Plain-language cautions (e.g. two selected sheets look like the same
    # scope). Never blocks the calculation; shown next to the result.
    warnings: list[str] = []
    n_lines_total: int
    n_lines_classified: int
    n_lines_computed: int  # classified AND successfully converted to a GWP value
    total_gwp_kg_co2e: float
    total_gwp_tonnes_co2e: float
    by_category: list[CategoryTotal]
    # Every category in ALL_MATERIAL_CATEGORIES (the full set this engine
    # knows how to compute), not just the ones that actually appeared in
    # this BOQ -- a category with no lines here, or no computable lines,
    # gets a real zero-valued entry (gwp_kg_co2e=0.0, line_item_count=0)
    # rather than being left out, so a search over "every material with a
    # stored emission factor" can answer "0 -- not present in this BOQ"
    # for a material instead of silently having nothing to say about it.
    # by_category stays exactly as it was (only categories with >=1
    # computed line) -- it still drives the Top-5-this-BOQ card and the
    # full breakdown chart unchanged; this field is purely additive, for
    # the new searchable-materials list only.
    all_materials: list[CategoryTotal] = []
    floor_area_sqm: Optional[float] = None
    floor_area_basis: Optional[FloorAreaBasis] = None
    floor_area_basis_note: Optional[str] = None
    gwp_per_sqm: Optional[float] = None
    gwp_per_sqft: Optional[float] = None
    line_items: list[LineItemResult] = []
    # Workstream 06: set by app/api/boq_carbon.py, not by this engine
    # itself (calculate_from_boq has no company_id/reference-registration
    # concept -- it's a pure file-in, numbers-out function). Left None
    # for any caller that doesn't go through the auto-registration path,
    # so this is purely additive to every existing response shape.
    registered_as_reference: Optional[bool] = None
    reference_slug: Optional[str] = None
    registration_note: Optional[str] = None
    # Workstream 07: value-weighted coverage summary (computed vs. total
    # Amount, broken down by a fixed six-reason taxonomy) plus the same
    # figures restricted to the ~5 highest-impact material categories --
    # see app.services.coverage's module docstring. Optional only for
    # symmetry with the other Optional result fields; always set by
    # calculate_from_boq() itself (unlike registered_as_reference, this
    # isn't conditional on the caller opting into anything).
    coverage: Optional[coverage_service.Coverage] = None
    scope_note: str = (
        "Covers rcc, pcc, reinforcement_steel, structural_steel, brickwork, "
        "blockwork_aac/blockwork_dense, plaster_cement/plaster_gypsum, "
        "tile_ceramic/natural_stone, paint, timber, and "
        "aluminium/upvc_window_door_frame/glass line items that the "
        "classifier recognized AND whose unit this engine knows how to "
        "convert. MEP, sanitary fittings, waterproofing membranes, and any "
        "unrecognized line item are NOT included -- see the `coverage` field "
        "for exactly how much value that leaves out and why."
    )
    factor_disclaimer: str = (
        "As of Workstream 01 (one emission-factor source), every category "
        "this engine computes reads from exactly one place -- the same place "
        "the Work Order pipeline (wo_carbon) reads from. Concrete (rcc/pcc) "
        "and reinforcement steel use the real, India-specific, CEA-adjusted "
        "IFC factors (app.services.ice_factors), grade-differentiated using "
        "ICE v4.1's CEM-I grade curve as a scaling ratio on top of IFC's "
        "cement-type anchor. Structural steel, aluminium, glass, brickwork, "
        "blockwork, plaster, and tile are now IFC-primary-source and "
        "CEA-adjusted where applicable (app.services.emission_factors) -- "
        "upgraded from this engine's own earlier un-adjusted placeholder "
        "copies; see that module's docstring and app/data/ice_db/"
        "emission_factors.json's per-category '_reconciliation' notes for "
        "exactly what changed. Paint remains an ICE-UK-proxy placeholder on "
        "both pipelines (no India-specific source identified yet). As of "
        "Workstream 07, plaster/tile/blockwork/aluminium-vs-uPVC each "
        "resolve to their real, distinct sub-category (plaster_cement vs. "
        "plaster_gypsum, tile_ceramic vs. natural_stone, blockwork_aac vs. "
        "blockwork_dense, aluminium vs. upvc_window_door_frame) instead of "
        "one blended default -- the classifier-split gap this disclaimer "
        "used to flag as deferred is closed; see classifier.py's own "
        "module docstring for the real factor gaps each split corrects "
        "(2.2x-7.4x) and the Workstream 01 reconciliation log for the prior "
        "state."
    )


def compute_line_gwp(
    category: Optional[str], cement_type: Optional[str], grade: Optional[str], uom: Optional[str], qty: Optional[float]
) -> tuple[Optional[float], str]:
    if category is None:
        return None, "unclassified"
    if qty is None or qty <= 0:
        return None, "no quantity"
    if uom is None:
        return None, "no unit"

    if category in (CATEGORY_RCC, CATEGORY_PCC):
        if _VOL_UNITS.match(uom):
            per_m3, factor_source = get_concrete_factor_per_m3(cement_type=cement_type, grade=grade, apply_cea=True)
            gwp = qty * per_m3
            return gwp, f"{qty:g} m3 x {per_m3:.1f} kgCO2e/m3 ({cement_type}, {grade}, {factor_source})"
        return None, f"{category} line with non-volume unit '{uom}'"

    if category == CATEGORY_STEEL_REBAR:
        per_kg, factor_source = get_steel_rebar_factor_per_kg(apply_cea=True)
        if _MASS_KG_UNITS.match(uom):
            return qty * per_kg, f"{qty:g} kg x {per_kg:.3f} kgCO2e/kg ({factor_source})"
        if _MASS_MT_UNITS.match(uom):
            return qty * 1000.0 * per_kg, f"{qty:g} MT x 1000 x {per_kg:.3f} kgCO2e/kg ({factor_source})"
        return None, f"reinforcement_steel line with non-mass unit '{uom}'"

    if category == CATEGORY_STEEL_SECTION:
        entry = get_factor("structural_steel")
        per_kg = entry["ef_kgco2e_per_kg"]
        tier = entry["evidence_tier"]
        if _MASS_KG_UNITS.match(uom):
            return qty * per_kg, f"{qty:g} kg x {per_kg} kgCO2e/kg ({tier}, CEA-adjusted)"
        if _MASS_MT_UNITS.match(uom):
            return qty * 1000.0 * per_kg, f"{qty:g} MT x 1000 x {per_kg} kgCO2e/kg ({tier}, CEA-adjusted)"
        return None, f"structural_steel line with non-mass unit '{uom}'"

    if category in (CATEGORY_BRICK, CATEGORY_BLOCKWORK_AAC, CATEGORY_BLOCKWORK_DENSE):
        # Workstream 07: category is now the exact canonical key
        # (blockwork_aac vs blockwork_dense resolved by classify_material
        # itself) rather than one classifier-wide AAC default -- see
        # classifier.py's WS07 section.
        entry = get_factor(category if category != CATEGORY_BRICK else "brickwork")
        per_kg = entry["ef_kgco2e_per_kg"]
        density = entry["density_kg_per_m3"]
        tier = entry["evidence_tier"]
        if _VOL_UNITS.match(uom):
            return qty * density * per_kg, f"{qty:g} m3 x {density} kg/m3 x {per_kg} kgCO2e/kg ({tier})"
        if _AREA_UNITS.match(uom):
            assumed_thickness_m = 0.2  # standard Indian block/brick wall thickness assumption
            gwp = qty * assumed_thickness_m * density * per_kg
            return gwp, f"{qty:g} m2 x {assumed_thickness_m}m assumed x {density} kg/m3 x {per_kg} kgCO2e/kg ({tier})"
        return None, f"{category} line with unhandled unit '{uom}'"

    if category == CATEGORY_MASONRY:
        # Directly areal (kgCO2e/m2), unlike brickwork/blockwork_aac/
        # blockwork_dense just above -- this entry has no per-kg figure
        # and no density to derive one from (a manual, unverified value --
        # see emission_factors.json's masonry entry), so a Cum/Kg-priced
        # masonry line is honestly excluded rather than inventing a
        # density/thickness assumption to force it through the same path
        # those categories use. Only ever reached for a line that said
        # "masonry" with no more specific brick/block keyword in the
        # first place (classify_material's masonry fallback is last-
        # priority), so this is expected to be rare.
        entry = get_factor(CATEGORY_MASONRY)
        per_sqm = entry["ef_kgco2e_per_sqm"]
        tier = entry["evidence_tier"]
        if _AREA_UNITS.match(uom):
            return qty * per_sqm, f"{qty:g} m2 x {per_sqm} kgCO2e/m2 ({tier}, directly areal, not independently verified)"
        return None, f"masonry line with unhandled unit '{uom}' -- only a directly-areal (m2) factor is recorded for masonry, no per-kg/per-m3 basis"

    if category in (CATEGORY_PLASTER_CEMENT, CATEGORY_PLASTER_GYPSUM):
        # Workstream 07: category is now the exact canonical key (cement
        # vs gypsum resolved by classify_material itself) rather than one
        # classifier-wide cement-based default -- see classifier.py's
        # WS07 section. Both entries share the same density/thickness
        # assumption, only the per-kg factor differs.
        entry = get_factor(category)
        per_kg, density, thickness = entry["ef_kgco2e_per_kg"], entry["density_kg_per_m3"], entry["assumed_thickness_m"]
        tier = entry["evidence_tier"]
        if _AREA_UNITS.match(uom):
            return qty * thickness * density * per_kg, f"{qty:g} m2 x {thickness}m x {density} kg/m3 x {per_kg} kgCO2e/kg ({tier}, {category})"
        if _VOL_UNITS.match(uom):
            return qty * density * per_kg, f"{qty:g} m3 x {density} kg/m3 x {per_kg} kgCO2e/kg ({tier}, {category})"
        return None, f"{category} line with unhandled unit '{uom}'"

    if category in (CATEGORY_TILE_CERAMIC, CATEGORY_NATURAL_STONE):
        # Workstream 07: granite/marble now resolve to natural_stone
        # instead of being priced as ceramic tile -- see classifier.py's
        # WS07 section (a 2.2x factor gap). natural_stone's canonical
        # entry carries no areal_mass_kg_per_m2 (unlike tile_ceramic) --
        # no sourced kg/m2 figure for stone slabs exists yet, so an area-
        # or linear-priced natural_stone line is honestly excluded rather
        # than reusing tile's areal-mass assumption for a different,
        # denser material -- exactly the same gap wo_carbon's own master
        # dataset already flags "NEEDS AREAL-MASS ASSUMPTION" for real
        # granite-flooring Activity Codes (see that file for confirmation
        # this isn't a new gap, just now visible on the boq_carbon side
        # too).
        entry = get_factor(category)
        per_kg = entry["ef_kgco2e_per_kg"]
        tier = entry["evidence_tier"]
        areal_mass = entry.get("areal_mass_kg_per_m2")
        if _MASS_KG_UNITS.match(uom):
            return qty * per_kg, f"{qty:g} kg x {per_kg} kgCO2e/kg ({tier}, {category})"
        if areal_mass is not None and _AREA_UNITS.match(uom):
            return qty * areal_mass * per_kg, f"{qty:g} m2 x {areal_mass} kg/m2 x {per_kg} kgCO2e/kg ({tier}, {category})"
        if areal_mass is not None and _LINEAR_UNITS.match(uom):
            # Skirting/coping priced per running metre -- convert to an
            # equivalent area using an assumed height, then price as area.
            # See ASSUMED_TILE_SKIRTING_HEIGHT_M's comment for the basis.
            h = ASSUMED_TILE_SKIRTING_HEIGHT_M
            gwp = qty * h * areal_mass * per_kg
            return gwp, (
                f"{qty:g} m (linear) x {h}m assumed height x {areal_mass} kg/m2 x "
                f"{per_kg} kgCO2e/kg ({tier}, {category}, linear-to-area assumption)"
            )
        if areal_mass is None and (_AREA_UNITS.match(uom) or _LINEAR_UNITS.match(uom)):
            return None, (
                f"natural_stone line with unhandled unit '{uom}' -- no documented areal-mass "
                f"assumption for natural stone yet (unlike tile_ceramic, its canonical entry "
                f"carries no areal_mass_kg_per_m2)"
            )
        return None, f"{category} line with unhandled unit '{uom}'"

    if category == CATEGORY_PAINT:
        entry = get_factor("paint")
        per_kg, paint_coverage = entry["ef_kgco2e_per_kg"], entry["coverage_kg_per_m2"]
        if _AREA_UNITS.match(uom):
            return qty * paint_coverage * per_kg, f"{qty:g} m2 x {paint_coverage} kg/m2 x {per_kg} kgCO2e/kg (placeholder)"
        return None, f"paint line with unhandled unit '{uom}'"

    if category in (CATEGORY_ALUMINIUM, CATEGORY_UPVC):
        # Workstream 07: uPVC window/door/frame lines now resolve to
        # upvc_window_door_frame instead of being priced as aluminium --
        # see classifier.py's WS07 section (a 7.4x factor gap). Expected,
        # disclosed consequence: upvc_window_door_frame's canonical entry
        # only has a sourced mass-basis conversion (KG/KGS) -- exactly
        # the same gap wo_carbon's own master dataset already flags
        # "NEEDS REVIEW" for real UPVC Activity Codes priced in Sqm/Nos --
        # so an area-priced uPVC line (the common real case, previously
        # silently and wrongly computed as aluminium) is now honestly
        # excluded rather than computed at all. Total computed GWP for a
        # BOQ with real uPVC content is therefore expected to go DOWN
        # after this fix, not up -- that's the correction working as
        # intended, not a regression.
        entry = get_factor(category)
        per_kg = entry["ef_kgco2e_per_kg"]
        tier = entry["evidence_tier"]
        areal_mass = entry.get("areal_mass_kg_per_m2")
        if _MASS_KG_UNITS.match(uom):
            return qty * per_kg, f"{qty:g} kg x {per_kg} kgCO2e/kg ({tier}, CEA-adjusted)"
        if areal_mass is not None and _AREA_UNITS.match(uom):
            return qty * areal_mass * per_kg, f"{qty:g} m2 x {areal_mass} kg/m2 x {per_kg} kgCO2e/kg ({tier}, CEA-adjusted)"
        if areal_mass is None and _AREA_UNITS.match(uom):
            return None, (
                f"upvc_window_door_frame line with unhandled unit '{uom}' -- no documented "
                f"areal-mass assumption for uPVC framing yet (unlike aluminium, its canonical "
                f"entry carries no areal_mass_kg_per_m2)"
            )
        return None, f"{category} line with unhandled unit '{uom}'"

    if category == CATEGORY_GLASS:
        entry = get_factor("glass")
        per_kg, areal_mass = entry["ef_kgco2e_per_kg"], entry["areal_mass_kg_per_m2"]
        tier = entry["evidence_tier"]
        if _AREA_UNITS.match(uom):
            return qty * areal_mass * per_kg, f"{qty:g} m2 x {areal_mass} kg/m2 x {per_kg} kgCO2e/kg ({tier}, CEA-adjusted)"
        return None, f"glass line with unhandled unit '{uom}'"

    if category == CATEGORY_TIMBER:
        entry = get_factor("timber_wood")
        per_kg = entry["ef_kgco2e_per_kg"]
        # Count units (Nos) first -- this is the ONLY unit real timber
        # lines were found priced in (see _COUNT_UNITS comment). Mass/
        # volume/area paths are kept as a fallback for BOQs that price
        # timber differently, but are unverified against real data the
        # way the Nos path is.
        if _COUNT_UNITS.match(uom):
            mass_per_frame = entry["assumed_mass_kg_per_frame"]
            gwp = qty * mass_per_frame * per_kg
            return gwp, (
                f"{qty:g} Nos x {mass_per_frame} kg/frame (assumed) x "
                f"{per_kg} kgCO2e/kg (ICE v4.1, excl. carbon storage)"
            )
        if _MASS_KG_UNITS.match(uom):
            return qty * per_kg, f"{qty:g} kg x {per_kg} kgCO2e/kg (ICE v4.1, excl. carbon storage)"
        if _MASS_MT_UNITS.match(uom):
            return qty * 1000.0 * per_kg, f"{qty:g} MT x 1000 x {per_kg} kgCO2e/kg (ICE v4.1, excl. carbon storage)"
        if _VOL_UNITS.match(uom):
            density = entry["assumed_density_kg_per_m3"]
            gwp = qty * density * per_kg
            return gwp, f"{qty:g} m3 x {density} kg/m3 (assumed) x {per_kg} kgCO2e/kg (ICE v4.1, excl. carbon storage)"
        if _AREA_UNITS.match(uom):
            areal_mass = entry["assumed_areal_mass_kg_per_m2"]
            gwp = qty * areal_mass * per_kg
            return gwp, f"{qty:g} m2 x {areal_mass} kg/m2 (assumed) x {per_kg} kgCO2e/kg (ICE v4.1, excl. carbon storage)"
        return None, f"timber line with unhandled unit '{uom}'"

    return None, "unclassified"


# Backward-compatible alias -- the function was renamed from a module-
# private name to a shared one (see module docstring) once
# substitution_engine.py needed to import it directly.
_compute_line_gwp = compute_line_gwp

# Workstream 07: the ~5 top-impact categories, expressed in boq_carbon's
# own category vocabulary. app.services.coverage.TOP5_MATERIAL_CATEGORIES
# uses "concrete" as one canonical entry; this classifier splits that into
# CATEGORY_RCC/CATEGORY_PCC instead (a real, deliberate distinction --
# plain/blinding concrete has a much lower carbon profile than structural
# RCC, see classifier.py's own docstring) so both count as top5 here.
_TOP5_CATEGORIES_BOQ = coverage_service.TOP5_MATERIAL_CATEGORIES | {CATEGORY_RCC, CATEGORY_PCC}


def _classify_boq_exclusion_reason(li: LineItemResult) -> str:
    """Buckets one excluded BOQ line item's basis_note into the fixed
    six-reason taxonomy (app.services.coverage). boq_carbon has no
    contributes-flag concept (unlike wo_carbon's curated master file), so
    it never emits NOT_CONTRIBUTING/NEEDS_REVIEW -- every excluded line
    here is either unclassified, missing a usable quantity/unit, or
    classified with no computable unit-conversion formula.
    """
    if li.category is None or li.basis_note == "unclassified":
        return coverage_service.REASON_UNCLASSIFIED
    if li.basis_note in ("no quantity", "no unit"):
        return coverage_service.REASON_NO_QUANTITY
    return coverage_service.REASON_UNHANDLED_UNIT


class BoqSource(BaseModel):
    """One uploaded workbook and the sheets of it to calculate. `sheets=None`
    means "every sheet that is a real BOQ table" (see sheets.default_sheets)."""
    file_path: str
    display_name: str
    sheets: Optional[list[str]] = None


def calculate_from_boq(
    file_path: str,
    sheet_name: Union[str, list[str], None] = None,
    floor_area_sqm: Optional[float] = None,
    floor_area_basis: Optional[FloorAreaBasis] = None,
) -> BoqCarbonResult:
    """Extracts, classifies, and carbon-costs every billable line item in
    one workbook. `sheet_name` may be one sheet, a list of sheets, or None
    -- None (the default) means EVERY sheet that is a real BOQ table, not
    just the first one (a workbook with Structure + Architecture sheets
    used to have its second sheet silently dropped).

    floor_area_sqm/floor_area_basis are optional (a totals-only result is
    still useful without them) but if you pass one you should pass both --
    a bare number with no basis is exactly the ambiguity that caused a
    real 8.5x mismatch on a real project, see the module docstring.
    """
    sheets = None if sheet_name is None else ([sheet_name] if isinstance(sheet_name, str) else list(sheet_name))
    display = file_path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return calculate_from_boq_sources(
        [BoqSource(file_path=file_path, display_name=display, sheets=sheets)],
        floor_area_sqm=floor_area_sqm,
        floor_area_basis=floor_area_basis,
    )


def calculate_from_boq_sources(
    sources: list[BoqSource],
    floor_area_sqm: Optional[float] = None,
    floor_area_basis: Optional[FloorAreaBasis] = None,
) -> BoqCarbonResult:
    """The same calculation as calculate_from_boq, over several workbooks
    and/or several sheets of each, combined into ONE result: one total, one
    category breakdown, one coverage figure, plus a per-sheet breakdown
    (`sources`) and overlap warnings (`warnings`)."""
    if not sources:
        raise ValueError("No BOQ file given.")
    if floor_area_sqm is not None and floor_area_basis is None:
        raise ValueError(
            "floor_area_basis is required whenever floor_area_sqm is given -- "
            "see engine.py's module docstring for why a bare area figure "
            "without its definition caused a real 8.5x mismatch on a real project."
        )

    items = []
    groups = []  # for overlap detection: one per (file, sheet)
    for src in sources:
        sheets = src.sheets if src.sheets is not None else default_sheets(src.file_path)
        for sh in sheets:
            try:
                sheet_items = extract_billable_items(src.file_path, sh, source_file=src.display_name)
            except KeyError:
                raise ValueError(f"Sheet '{sh}' was not found in '{src.display_name}'.")
            items.extend(sheet_items)
            groups.append({"label": f"{src.display_name} > {sh}", "file": src.display_name, "sheet": sh, "items": sheet_items})
    warnings = detect_overlaps(groups) if len(groups) > 1 else []
    if not items:
        raise ValueError("The selected sheet(s) contain no billable BOQ lines.")

    multi = len(groups) > 1
    file_names = list(dict.fromkeys(src.display_name for src in sources))
    combined_source_file = " + ".join(file_names)
    if multi:
        combined_sheet_name = ", ".join((g["sheet"] if len(file_names) == 1 else g["label"]) for g in groups)
    else:
        combined_sheet_name = groups[0]["sheet"]

    line_results: list[LineItemResult] = []
    category_totals: dict[str, dict] = {}

    for item in items:
        cls = classify_material(item.enriched_description)
        gwp, note = compute_line_gwp(cls.category, cls.cement_type, cls.grade, item.uom, item.qty)

        line_results.append(
            LineItemResult(
                row=item.row,
                enriched_description=item.enriched_description,
                uom=item.uom,
                qty=item.qty,
                category=cls.category,
                cement_type=cls.cement_type,
                grade=cls.grade,
                gwp_kg_co2e=gwp,
                basis_note=note,
                rate=item.rate,
                amount=item.amount,
                source_file=item.source_file,
                source_sheet=item.source_sheet,
            )
        )

        if gwp is not None:
            entry = category_totals.setdefault(cls.category, {"gwp": 0.0, "count": 0, "qty": 0.0, "units": set(), "top_gwp": -1.0, "top_note": None})
            entry["gwp"] += gwp
            entry["count"] += 1
            entry["qty"] += item.qty or 0.0
            entry["units"].add(item.uom)
            if gwp > entry["top_gwp"]:
                entry["top_gwp"] = gwp
                entry["top_note"] = note

    total_gwp = sum(v["gwp"] for v in category_totals.values())
    by_category = [
        CategoryTotal(
            category=cat,
            gwp_kg_co2e=v["gwp"],
            line_item_count=v["count"],
            pct_of_total=(v["gwp"] / total_gwp * 100) if total_gwp else 0.0,
            # Only a real, honest figure when every line that fed this
            # category's total shares one native unit (the common case --
            # see compute_line_gwp's per-category unit checks above).
            # A category whose computed lines mix units (e.g. some
            # reinforcement_steel rows in kg, others in MT) has no single
            # correct divisor, so this is left None rather than silently
            # averaging across incompatible magnitudes.
            representative_emission_factor=(v["gwp"] / v["qty"]) if v["qty"] and len(v["units"]) == 1 else None,
            dominant_factor_source=v["top_note"],
        )
        for cat, v in sorted(category_totals.items(), key=lambda kv: -kv[1]["gwp"])
    ]

    # all_materials: the same CategoryTotal objects already built above
    # for every category that DID compute (reused as-is, not
    # recalculated a second way), plus an explicit zero-valued stand-in
    # for every canonical category that had no computed line in this
    # BOQ at all -- see the field's own docstring on BoqCarbonResult.
    _by_category_lookup = {c.category: c for c in by_category}
    all_materials = sorted(
        (
            _by_category_lookup.get(cat)
            or CategoryTotal(category=cat, gwp_kg_co2e=0.0, line_item_count=0, pct_of_total=0.0)
            for cat in ALL_MATERIAL_CATEGORIES
        ),
        key=lambda c: (-c.gwp_kg_co2e, c.category),
    )

    # UX refinement (Phase C, Part A): classify every excluded line's
    # reason ONCE, store it on the line itself, then have coverage_rows
    # below just read it back -- same taxonomy, same function, now also
    # surfaced on line_items for the frontend drill-down.
    for r in line_results:
        if r.gwp_kg_co2e is None:
            r.exclusion_reason = _classify_boq_exclusion_reason(r)

    n_classified = sum(1 for r in line_results if r.category is not None)
    n_computed = sum(1 for r in line_results if r.gwp_kg_co2e is not None)

    def _row_value(r: LineItemResult) -> float:
        # Amount when it's real; otherwise rate*qty -- a real reference
        # BOQ was found with Rate populated but Amount zero-filled
        # throughout, confirmed elsewhere to satisfy amount == rate*qty
        # exactly wherever both are present, so this isn't an invented
        # number, just the same arithmetic the sheet's own Amount column
        # should already reflect.
        if r.amount:
            return r.amount
        if r.rate and r.qty:
            return r.rate * r.qty
        return 0.0

    coverage_rows = [
        {
            "value": _row_value(r),
            "computed": r.gwp_kg_co2e is not None,
            "is_top5": r.category in _TOP5_CATEGORIES_BOQ,
            "reason": r.exclusion_reason,
        }
        for r in line_results
    ]

    source_summaries = []
    for g in groups:
        f_name, sh_name = g["file"], g["sheet"]
        rows_here = [r for r in line_results if r.source_file == f_name and r.source_sheet == sh_name]
        source_summaries.append(
            SourceSummary(
                source_file=f_name,
                sheet_name=sh_name,
                n_lines_total=len(rows_here),
                n_lines_computed=sum(1 for r in rows_here if r.gwp_kg_co2e is not None),
                total_gwp_kg_co2e=sum(r.gwp_kg_co2e for r in rows_here if r.gwp_kg_co2e is not None),
                total_value=sum(_row_value(r) for r in rows_here),
            )
        )

    result = BoqCarbonResult(
        source_file=combined_source_file,
        sheet_name=combined_sheet_name,
        sources=source_summaries,
        warnings=warnings,
        n_lines_total=len(line_results),
        n_lines_classified=n_classified,
        n_lines_computed=n_computed,
        total_gwp_kg_co2e=total_gwp,
        total_gwp_tonnes_co2e=total_gwp / 1000.0,
        by_category=by_category,
        all_materials=all_materials,
        line_items=line_results,
        coverage=coverage_service.build_coverage(coverage_rows),
    )

    if floor_area_sqm and floor_area_basis:
        result.floor_area_sqm = floor_area_sqm
        result.floor_area_basis = floor_area_basis
        result.floor_area_basis_note = FLOOR_AREA_BASIS_NOTES[floor_area_basis]
        result.gwp_per_sqm = total_gwp / floor_area_sqm
        result.gwp_per_sqft = total_gwp / floor_area_sqm / SQM_TO_SQFT

    return result