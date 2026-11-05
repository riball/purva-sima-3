"""Material substitution: REAL recompute, not an estimated delta.

Same principle Phase 1's substitute.py already established: a
substitution's carbon savings comes from actually re-running the carbon
calculation on the affected line items with the substitute material's
own factor, not from an LLM-guessed percentage reduction. This module
does that for Phase 2's raw-BOQ pipeline -- given an already-computed
BoqCarbonResult (from engine.calculate_from_boq) plus a list of
requested substitutions (each referencing an entry in
substitution_catalog.json and a user-chosen percentage), it recomputes
exactly the affected line items at a blended factor and reports the
real before/after difference.

UX contract this maps onto (as specified): each substitution has a
catalog-defined max_recommended_pct. A user-chosen pct at or below that
is a normal, unflagged substitution. A pct ABOVE that is still allowed
-- the user can slide past the recommended ceiling -- but the response
carries requires_engineering_review=True and the catalog's own sourced
structural_caveat text, so the frontend can show a "not recommended"
warning with a real reason rather than a generic one.

Workstream 08: the catalog itself now lives behind one shared module,
app/services/supplier_catalog.py -- this file still works entirely in
the raw catalog-entry dict shape (get_entry()) since that's what
_recompute_line_at_substitute() below needs; see that module's docstring
for the uniform SupplierAlternative view used elsewhere (Phase 1's new
supplier-steel suggestion, and any future chatbot tool surface).

Combining multiple substitutions: only done when the sets of BOQ rows
each substitution actually affects are pairwise disjoint. Two
substitutions that both target the same OPC-classified rcc rows (e.g.
"convert 40% to PSC" and "convert 30% to PPC" requested together) can't
be summed as if independent -- there's no defined rule for what
fraction of the SAME concrete ends up as which blend, so combined_impact
is intentionally left unset with an explanatory note in that case,
rather than silently producing a number that doesn't correspond to any
real, buildable mix.
"""

from __future__ import annotations

from typing import Optional, Union

from pydantic import BaseModel

from app.services.boq_carbon.classifier import CATEGORY_PCC, CATEGORY_RCC
from app.services.boq_carbon.engine import (
    BoqCarbonResult,
    LineItemResult,
    compute_line_gwp,
    _MASS_KG_UNITS,
    _MASS_MT_UNITS,
    _VOL_UNITS,
)
from app.services.ice_factors import get_concrete_factor_per_m3_blend
from app.services.supplier_catalog import get_entry as get_substitution
from app.services.wo_carbon.wo_carbon_engine import WoCarbonResult, WoLineItemResult

AnyCarbonResult = Union[BoqCarbonResult, WoCarbonResult]
AnyLineItem = Union[LineItemResult, WoLineItemResult]


def _line_category(li: AnyLineItem) -> Optional[str]:
    """BOQ's `category` and WO's `material_category` are the SAME
    vocabulary (confirmed: wo_carbon_engine.py classifies into
    "reinforcement_steel" etc., the identical strings boq_carbon's
    `category` field uses) -- just different field names on the two
    Pydantic classes."""
    return li.material_category if isinstance(li, WoLineItemResult) else li.category


def _line_unit(li: AnyLineItem) -> Optional[str]:
    return li.unit if isinstance(li, WoLineItemResult) else li.uom


def _line_cement_type(li: AnyLineItem) -> Optional[str]:
    # WO line items never carry cement-grade granularity -- always None,
    # so a cement-blend-filtered catalog entry (base_cement_type) never
    # matches a WO line. Honest "0 affected lines," not a guess.
    return None if isinstance(li, WoLineItemResult) else li.cement_type


def _line_grade(li: AnyLineItem) -> Optional[str]:
    return None if isinstance(li, WoLineItemResult) else li.grade


class SubstitutionRequest(BaseModel):
    substitution_id: str
    user_pct: float  # 0-100+ ; values above the catalog's max_recommended_pct are allowed, just flagged


class SubstitutionResult(BaseModel):
    substitution_id: str
    label: str
    user_pct: float
    max_recommended_pct: float
    exceeds_recommended: bool
    requires_engineering_review: bool
    reasoning: str
    structural_caveat: str
    source: str
    evidence_tier: str
    requires_supplier_match: Optional[str] = None
    affected_line_item_count: int
    original_gwp_kg_co2e: float
    new_gwp_kg_co2e: float
    savings_kg_co2e: float
    savings_pct_of_affected_lines: float
    savings_pct_of_total_boq: float


class CombinedImpact(BaseModel):
    total_savings_kg_co2e: float
    total_savings_pct_of_total_boq: float
    requires_engineering_review: bool
    note: Optional[str] = None


class BoqSubstitutionResponse(BaseModel):
    base_result: BoqCarbonResult
    substitutions: list[SubstitutionResult]
    combined_impact: Optional[CombinedImpact] = None


def _lines_affected_by(entry: dict, base_result: AnyCarbonResult) -> list:
    """Which of the base result's line items this catalog entry applies
    to -- matched on category (and cement_type, for cement-blend
    substitutions) exactly as the catalog entry specifies. Works against
    either a BoqCarbonResult or a WoCarbonResult: _line_category/
    _line_cement_type read the right field per line-item type (WO lines
    always report cement_type=None, so a cement-blend entry's
    base_cement_type filter correctly matches zero WO lines rather than
    guessing)."""
    base_category = entry["base_category"]
    base_cement_type = entry.get("base_cement_type")  # present for cement-blend entries only

    matched = []
    for li in base_result.line_items:
        if _line_category(li) != base_category:
            continue
        if li.gwp_kg_co2e is None:
            continue  # wasn't part of the total to begin with -- nothing to substitute
        if base_cement_type is not None and _line_cement_type(li) != base_cement_type:
            continue
        matched.append(li)
    return matched


def _recompute_line_at_substitute(entry: dict, li: AnyLineItem) -> Optional[float]:
    """The line's GWP if it were 100% the substitute material, using the
    SAME qty/uom(unit)/grade -- only the cement_type, category, or (for a
    fixed EPD-sourced factor) the per-kg number itself changes. Reads
    _line_unit/_line_grade so this works identically for a WO line item
    (unit/material_category field names) as for a BOQ one
    (uom/category) -- compute_line_gwp itself is boq_carbon's own
    category/unit-dispatch function, reused unchanged since both engines
    share the same category vocabulary and unit-string conventions
    (m3/m2/kg/MT/...)."""
    if "substitute_gwp_kgco2e_per_kg_fixed" in entry:
        # A real, specific, already-measured factor (e.g. a supplier's own
        # verified EPD) -- NOT run through get_steel_rebar_factor_per_kg's
        # CEA regional-grid adjustment, because that adjustment exists to
        # scale a generic IFC/ICE anchor to a project's local grid mix, and
        # this number already reflects the supplier's own real, declared
        # electricity mix. Applying CEA on top of it would double-count.
        per_kg = entry["substitute_gwp_kgco2e_per_kg_fixed"]
        unit = _line_unit(li)
        if unit is None:
            return None
        if _MASS_KG_UNITS.match(unit):
            return li.qty * per_kg
        if _MASS_MT_UNITS.match(unit):
            return li.qty * 1000.0 * per_kg
        return None
    if "substitute_blend_pct" in entry:
        # Continuous GGBS%/fly-ash% composition lever (the Swap Sandbox's
        # custom-percentage feature -- see ice_factors.py's
        # get_blended_cement_factor_per_kg docstring for why this is an
        # interpolated/extrapolated estimate, not a third sourced number,
        # and swap_sandbox.py's resolve_intent_to_entry for where that
        # gets disclosed). Only meaningful for RCC/PCC concrete priced by
        # volume -- same honest-exclusion discipline compute_line_gwp
        # itself uses for every other category/unit mismatch: return
        # None (not a guess) rather than forcing a line this lever can't
        # actually apply to.
        spec = entry["substitute_blend_pct"]
        category = _line_category(li)
        unit = _line_unit(li)
        if category not in (CATEGORY_RCC, CATEGORY_PCC) or unit is None or not _VOL_UNITS.match(unit):
            return None
        new_grade = entry.get("substitute_grade", _line_grade(li))
        per_m3, _blend_info = get_concrete_factor_per_m3_blend(
            spec["component"], spec["pct"], grade=new_grade, apply_cea=True
        )
        return li.qty * per_m3
    if "substitute_cement_type" in entry or "substitute_grade" in entry:
        # Either or both may be set -- a combined grade+cement_type swap
        # ("M25 with a GGBS/PSC blend", the swap sandbox's own motivating
        # example) is ONE recompute call, not two: compute_line_gwp (via
        # ice_factors.get_concrete_factor_per_m3) already accepts
        # cement_type and grade together, scaling IFC's India-specific
        # cement-type anchor by ICE's own grade-ratio curve -- see that
        # module's docstring. Whichever of the two isn't being changed
        # keeps the line's own original value (not a default), so a
        # cement-type-only catalog entry (e.g. opc_to_psc) behaves
        # identically to before this branch existed -- new_grade falls
        # back to _line_grade(li), exactly what the old, narrower branch
        # always passed.
        new_cement_type = entry.get("substitute_cement_type", _line_cement_type(li))
        new_grade = entry.get("substitute_grade", _line_grade(li))
        gwp, _note = compute_line_gwp(_line_category(li), new_cement_type, new_grade, _line_unit(li), li.qty)
        return gwp
    if "substitute_category" in entry:
        gwp, _note = compute_line_gwp(entry["substitute_category"], None, None, _line_unit(li), li.qty)
        return gwp
    raise ValueError(
        f"Catalog entry '{entry['id']}' has none of substitute_cement_type, "
        f"substitute_category, or substitute_gwp_kgco2e_per_kg_fixed"
    )


def apply_substitution(entry: dict, user_pct: float, base_result: BoqCarbonResult) -> SubstitutionResult:
    matched = _lines_affected_by(entry, base_result)

    original_total = sum(li.gwp_kg_co2e for li in matched)
    new_total = 0.0
    frac = max(user_pct, 0.0) / 100.0

    for li in matched:
        substitute_gwp = _recompute_line_at_substitute(entry, li)
        if substitute_gwp is None:
            # The substitute material's own unit-conversion path can't
            # handle this line's unit (rare, but possible if a category
            # swap crosses a unit the substitute category doesn't
            # support) -- fall back to the ORIGINAL value for this line
            # rather than silently treating the un-recomputable portion
            # as zero-carbon.
            new_total += li.gwp_kg_co2e
            continue
        new_total += li.gwp_kg_co2e * (1 - frac) + substitute_gwp * frac

    savings = original_total - new_total
    exceeds = user_pct > entry["max_recommended_pct"]
    requires_review = exceeds or entry.get("always_requires_review_if_load_bearing", False)

    return SubstitutionResult(
        substitution_id=entry["id"],
        label=entry.get("substitute_label", entry["id"]),
        user_pct=user_pct,
        max_recommended_pct=entry["max_recommended_pct"],
        exceeds_recommended=exceeds,
        requires_engineering_review=requires_review,
        reasoning=entry["reasoning"],
        structural_caveat=entry["structural_caveat"],
        source=entry["source"],
        evidence_tier=entry.get("evidence_tier", "unspecified"),
        requires_supplier_match=entry.get("requires_supplier_match"),
        affected_line_item_count=len(matched),
        original_gwp_kg_co2e=original_total,
        new_gwp_kg_co2e=new_total,
        savings_kg_co2e=savings,
        savings_pct_of_affected_lines=(savings / original_total * 100) if original_total else 0.0,
        savings_pct_of_total_boq=(savings / base_result.total_gwp_kg_co2e * 100) if base_result.total_gwp_kg_co2e else 0.0,
    )


def apply_substitutions(
    requests: list[SubstitutionRequest], base_result: BoqCarbonResult
) -> BoqSubstitutionResponse:
    results: list[SubstitutionResult] = []
    row_sets: list[set] = []

    for req in requests:
        entry = get_substitution(req.substitution_id)
        if entry is None:
            raise ValueError(f"Unknown substitution_id '{req.substitution_id}'")
        matched_rows = {li.row for li in _lines_affected_by(entry, base_result)}
        row_sets.append(matched_rows)
        results.append(apply_substitution(entry, req.user_pct, base_result))

    combined: Optional[CombinedImpact] = None
    if len(results) > 1:
        overlap = False
        for i in range(len(row_sets)):
            for j in range(i + 1, len(row_sets)):
                if row_sets[i] & row_sets[j]:
                    overlap = True
        if overlap:
            combined = CombinedImpact(
                total_savings_kg_co2e=0.0,
                total_savings_pct_of_total_boq=0.0,
                requires_engineering_review=any(r.requires_engineering_review for r in results),
                note=(
                    "Not computed -- two or more of the requested substitutions apply to the "
                    "SAME underlying BOQ line items (e.g. both a PSC and a PPC blend targeting "
                    "the same OPC-classified concrete). There's no defined rule for what fraction "
                    "of the same concrete volume ends up as which blend, so summing their savings "
                    "would not correspond to any single real, buildable mix. Apply one at a time, "
                    "or choose a single blend that already represents your intended combination."
                ),
            )
        else:
            total_savings = sum(r.savings_kg_co2e for r in results)
            combined = CombinedImpact(
                total_savings_kg_co2e=total_savings,
                total_savings_pct_of_total_boq=(
                    total_savings / base_result.total_gwp_kg_co2e * 100 if base_result.total_gwp_kg_co2e else 0.0
                ),
                requires_engineering_review=any(r.requires_engineering_review for r in results),
            )
    elif len(results) == 1:
        combined = CombinedImpact(
            total_savings_kg_co2e=results[0].savings_kg_co2e,
            total_savings_pct_of_total_boq=results[0].savings_pct_of_total_boq,
            requires_engineering_review=results[0].requires_engineering_review,
        )

    return BoqSubstitutionResponse(base_result=base_result, substitutions=results, combined_impact=combined)