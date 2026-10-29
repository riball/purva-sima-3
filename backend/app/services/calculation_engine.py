"""Deterministic embodied carbon calculation engine.

Now uses IFC India data as the primary emission factor source (via
ice_factors.py), with CEA grid-factor adjustment applied (via
cea_adjustment.py), falling back to unadjusted ICE M-grade factors when
cement_type isn't available. Scope is still concrete + steel only --
cement/mortar, bricks, glass, insulation, paint, and MEP are not yet
included.

Workstream 08: calculate_embodied_carbon() gained an optional
`steel_factor_override_kgco2e_per_kg` parameter so a caller can recompute
against a specific supplier's own already-sourced per-kg GWP figure (e.g.
an EPD-verified low-carbon rebar product from the shared
app/services/supplier_catalog.py) instead of the default CEA-adjusted
IFC anchor -- same reasoning app/services/boq_carbon/substitution_engine.py
already established for its own fixed-factor substitutions: a supplier's
own declared, verified figure already reflects their real electricity
mix, so CEA (which exists to scale a generic anchor to a project's LOCAL
grid) is deliberately NOT applied on top of it. Defaults to None, which
reproduces the exact pre-Workstream-08 default-anchor behavior -- every
existing caller that doesn't pass this argument is unaffected.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.schemas.project_schema import CementType, FoundationType, ProjectSchema
from app.services.ice_factors import get_concrete_factor_per_m3, get_steel_rebar_factor_per_kg

SQM_TO_SQFT = 10.7639

# Used only when no BOQ-derived concrete volume ratio is available
# (i.e. no reference BOQ has GFA filled in yet and no own-BOQ refinement
# has run) -- a generic placeholder for RCC-framed residential/commercial
# construction. NOT derived from real reference projects -- replace with
# a BOQ-derived ratio as soon as one is available.
FALLBACK_CONCRETE_VOL_PER_SQM = 0.45  # m3 concrete per sqm GFA

# Used only when steel_reinforcement_ratio_kg_per_sqm is still unset
# after BOQ matching AND LLM fallback (shouldn't normally happen, but
# kept as a last-resort safety net).
FALLBACK_STEEL_RATIO_KG_PER_SQM = 65.0

# Foundation-type adjustment, applied ONLY to the two FALLBACK constants
# above (never to a real BOQ-matched or own-BOQ-extracted quantity, which
# already reflects a specific project's actual foundation and shouldn't
# be multiplied again). Added because a project with no BOQ match yet
# showed literally no change in total carbon when foundation type was
# switched -- calculate_embodied_carbon() previously never read
# foundation_type at all.
#
# DISCLOSED ASSUMPTION, NOT A VALIDATED COEFFICIENT: these multipliers
# encode the general, well-established civil-engineering relationship
# that deeper/more continuous foundation types use meaningfully more
# concrete and reinforcement per sqm of GFA than isolated footings on
# typical soil (isolated footing < combined footing < raft < pile, in
# rough order of substructure material intensity). They are NOT derived
# from Puravankara/Provident's own project data, and should be replaced
# with real, validated ratios (the same way BOQ matching already
# replaces the fallback constants with real data) as soon as your
# engineering team can supply them. Do not treat the numbers below as
# certified for compliance reporting until they are.
FOUNDATION_TYPE_CONCRETE_MULTIPLIER: dict[str, float] = {
    "isolated_footing": 1.00,
    "combined_footing": 1.08,
    "raft": 1.20,
    "pile": 1.35,
}
FOUNDATION_TYPE_STEEL_MULTIPLIER: dict[str, float] = {
    "isolated_footing": 1.00,
    "combined_footing": 1.05,
    "raft": 1.12,
    "pile": 1.20,
}

# --- Glazing (glass + aluminium framing) -----------------------------------
# Same "DISCLOSED ASSUMPTION, NOT A VALIDATED COEFFICIENT" footing as the
# two foundation-multiplier tables above -- Phase 1 has no real facade-area
# or window-schedule data to draw from (it's a GFA-only conceptual
# estimator), so these two single, GFA-anchored ratios stand in for it:
#
# - FACADE_AREA_PER_SQM_GFA: typical external (facade) wall area per sqm of
#   GFA for a mid/high-rise RCC building. A commonly cited architectural
#   rule of thumb, NOT derived from this project's own reference-project
#   data the way concrete/steel ratios can be once a BOQ match exists.
# - ALUMINIUM_FRAME_FRACTION_OF_GLAZED_AREA: of the glazed portion of that
#   facade (glazing_pct, already a real, user-set Tier 3 field), the share
#   that is aluminium framing rather than the glass pane itself -- a
#   commonly cited curtain-wall/window framing ratio.
#
# Both numbers should be replaced with real reference-project ratios the
# same way FALLBACK_CONCRETE_VOL_PER_SQM already gets superseded by a BOQ
# match, as soon as this app has real facade/glazing BOQ data to learn one
# from. The emission FACTORS multiplied against these areas (ef_kgco2e_per_kg
# and areal_mass_kg_per_m2 for glass/aluminium) are NOT placeholders --
# they're the same canonical, CEA-adjusted IFC India figures
# app/services/emission_factors.py already serves to the BOQ/Work Order
# carbon pipelines (app/data/ice_db/emission_factors.json).
FACADE_AREA_PER_SQM_GFA = 0.35  # sqm facade per sqm GFA
ALUMINIUM_FRAME_FRACTION_OF_GLAZED_AREA = 0.15  # fraction of glazed area that is frame, not glass


def _foundation_type_key(project: ProjectSchema) -> Optional[str]:
    """Same duck-typing pattern used for cement_type below -- tier2's
    foundation_type may be a real FoundationType enum member (a properly-
    typed API request) or a plain string (llm_fallback.py assigns an
    untyped FieldValue). Returns None if never set."""
    raw = project.tier2.foundation_type.value
    if isinstance(raw, FoundationType):
        return raw.value
    if raw is not None:
        return str(raw)
    return None


class MaterialBreakdown(BaseModel):
    material: str
    # UX refinement: "why is the estimated material breakdown only limited
    # to concrete and steel, i want it to add the top 5 materials just
    # like the other parts of this project" -- material_category is the
    # SAME fixed key set this app's BOQ/WO pipelines already use
    # (coverage.py's TOP5_MATERIAL_CATEGORIES, and the frontend's shared
    # MaterialBreakdownChart.jsx CATEGORY_COLORS/CATEGORY_LABELS):
    # "concrete" | "reinforcement_steel" | "structural_steel" |
    # "aluminium" | "glass". Added explicitly (rather than leaving the
    # frontend to infer a category from quantity_unit, which breaks the
    # moment two categories share a unit, e.g. glass/aluminium both being
    # area-based) so every consumer of this breakdown -- the Conceptual
    # Estimate donut AND the Project Dashboard's Material Composition
    # chart -- colors/labels it identically to a real BOQ/WO breakdown.
    material_category: str
    quantity: float
    quantity_unit: str
    factor_used: float
    factor_unit: str
    factor_source: str  # "ifc_india" | "ice_fallback"
    carbon_kg: float
    quantity_source: str  # "boq-matched" | "own-boq-extracted" | "llm-estimated" | "user-entered" | "fallback-default"


class CalculationResult(BaseModel):
    project_id: str
    gfa_sqm: float
    breakdown: list[MaterialBreakdown]
    total_carbon_kg: float
    total_carbon_tonnes: float
    carbon_per_sqm: float
    carbon_per_sqft: float
    scope_note: str = (
        "Concrete + steel + glazing (glass & aluminium framing, sized from "
        "the Glazing % field). Does not yet include cement/mortar, brick/"
        "blockwork, insulation, paint, structural (non-rebar) steel "
        "sections, or MEP -- Phase 1 has no field yet from which to size "
        "those honestly. Concrete/steel factors use IFC India data "
        "(CEA-adjusted) where cement_type is known, falling back to "
        "unadjusted ICE M-grade factors otherwise. Glass/aluminium use the "
        "same canonical, CEA-adjusted IFC India factors the BOQ/Work "
        "Order pipelines use, applied to a DISCLOSED, unvalidated facade-"
        "area assumption (see FACADE_AREA_PER_SQM_GFA) -- not a measured "
        "facade area."
    )


# Sanity ceiling on GFA -- see app/api/calculate.py's and
# app/api/substitute.py's matching MAX_GFA_SQM checks, and the frontend's
# own copy in Phase1FormContext.jsx, for the full story: there was no
# upper bound anywhere (client or server), so a fat-fingered extra digit
# or two on GFA silently produced a "successful" result with nonsense
# numbers. Kept here too, not just at the API layer, as defense in depth
# for any other caller of this function (e.g. phase3.py's
# baseline_from_phase1_estimate).
MAX_GFA_SQM = 10_000_000


def calculate_embodied_carbon(
    project: ProjectSchema,
    steel_factor_override_kgco2e_per_kg: Optional[float] = None,
    steel_factor_override_label: Optional[str] = None,
) -> CalculationResult:
    gfa = project.mandatory.gfa_sqm.value
    if gfa is None or gfa <= 0:
        raise ValueError("Cannot calculate without a valid GFA")
    if gfa > MAX_GFA_SQM:
        raise ValueError(f"GFA of {gfa:,.0f} sqm exceeds the sanity ceiling of {MAX_GFA_SQM:,} sqm -- check for a data-entry error")

    breakdown: list[MaterialBreakdown] = []

    # --- Concrete ---
    cement_type_field = project.tier3.cement_type
    raw_cement_value = cement_type_field.value
    # raw_cement_value may be a real CementType enum member (e.g. set via
    # a properly-typed API request) or a plain string (e.g. written by
    # llm_fallback.py, which assigns an untyped FieldValue and so bypasses
    # Pydantic's enum coercion -- validate_assignment is not enabled on
    # this schema). Handle both shapes rather than assuming one.
    if isinstance(raw_cement_value, CementType):
        cement_type = raw_cement_value.value
    elif raw_cement_value is not None:
        cement_type = str(raw_cement_value).upper()
    else:
        cement_type = None
    grade_field = project.tier3.concrete_grade_mix
    grade = grade_field.value

    if cement_type is None and grade is None:
        grade = "M30"  # last-resort default so calculation can still proceed
        grade_provenance = "fallback-default"
    else:
        grade_provenance = grade_field.source if grade_field.source != "unset" else "fallback-default"
    cement_provenance = cement_type_field.source if cement_type_field.source != "unset" else "fallback-default"

    concrete_factor_per_m3, factor_source = get_concrete_factor_per_m3(
        cement_type=cement_type, grade=grade, apply_cea=True
    )

    foundation_key = _foundation_type_key(project)

    derived = getattr(project, "_derived", {}) or {}
    concrete_vol_per_sqm = derived.get("concrete_vol_per_sqm")
    vol_source = derived.get("matched_reference")
    foundation_note = ""
    if concrete_vol_per_sqm is None:
        concrete_vol_per_sqm = FALLBACK_CONCRETE_VOL_PER_SQM
        vol_source = "fallback-default"
        concrete_mult = FOUNDATION_TYPE_CONCRETE_MULTIPLIER.get(foundation_key, 1.0)
        if concrete_mult != 1.0:
            concrete_vol_per_sqm *= concrete_mult
            foundation_note = f", foundation:{foundation_key}(x{concrete_mult})"
    elif vol_source == "own_boq":
        vol_source = "own-boq-extracted"
    else:
        vol_source = "boq-matched"

    concrete_vol_m3 = gfa * concrete_vol_per_sqm
    concrete_carbon_kg = concrete_vol_m3 * concrete_factor_per_m3

    material_label = f"Concrete ({cement_type or grade}, {factor_source})"
    breakdown.append(
        MaterialBreakdown(
            material=material_label,
            material_category="concrete",
            quantity=concrete_vol_m3,
            quantity_unit="m3",
            factor_used=concrete_factor_per_m3,
            factor_unit="kgCO2e/m3",
            factor_source=factor_source,
            carbon_kg=concrete_carbon_kg,
            quantity_source=f"cement_type:{cement_provenance}, grade:{grade_provenance}, volume:{vol_source}{foundation_note}",
        )
    )

    # --- Steel ---
    steel_field = project.tier3.steel_reinforcement_ratio_kg_per_sqm
    steel_ratio = steel_field.value
    steel_source = steel_field.source
    steel_foundation_note = ""
    if steel_ratio is None:
        steel_ratio = FALLBACK_STEEL_RATIO_KG_PER_SQM
        steel_source = "fallback-default"
        steel_mult = FOUNDATION_TYPE_STEEL_MULTIPLIER.get(foundation_key, 1.0)
        if steel_mult != 1.0:
            steel_ratio *= steel_mult
            steel_foundation_note = f", foundation:{foundation_key}(x{steel_mult})"

    steel_kg = gfa * steel_ratio
    if steel_factor_override_kgco2e_per_kg is not None:
        # A specific, already-sourced supplier figure (see module
        # docstring) -- used as-is, no CEA adjustment layered on top.
        steel_factor_per_kg = steel_factor_override_kgco2e_per_kg
        steel_factor_source = "supplier_epd_fixed"
        material_label = "Reinforcement steel (rebar)" + (
            f" -- {steel_factor_override_label}" if steel_factor_override_label else " -- supplier override"
        )
    else:
        steel_factor_per_kg, steel_factor_source = get_steel_rebar_factor_per_kg(apply_cea=True)
        material_label = "Reinforcement steel (rebar)"
    steel_carbon_kg = steel_kg * steel_factor_per_kg

    breakdown.append(
        MaterialBreakdown(
            material=material_label,
            material_category="reinforcement_steel",
            quantity=steel_kg,
            quantity_unit="kg",
            factor_used=steel_factor_per_kg,
            factor_unit="kgCO2e/kg",
            factor_source=steel_factor_source,
            carbon_kg=steel_carbon_kg,
            quantity_source=f"{steel_source}{steel_foundation_note}",
        )
    )

    # --- Glazing: glass + aluminium framing ---
    # Sized from glazing_pct (a real, already-collected Tier 3 field) via
    # the disclosed FACADE_AREA_PER_SQM_GFA/ALUMINIUM_FRAME_FRACTION_OF_
    # GLAZED_AREA assumptions above -- see their comment for the full
    # reasoning. Uses "m2" as the exposed quantity_unit (not "kg", which
    # app/services/cost_estimation.py's estimate_cost() already treats as
    # "this is reinforcement steel" -- an area unit keeps these two new
    # rows out of that branch entirely rather than silently mis-costing
    # them as steel). cost_estimation.py simply skips any non-m3/kg row,
    # so glass/aluminium carbon IS included in the total above, but their
    # cost is honestly left out of the Structural Cost Estimate -- there's
    # no sourced glazing cost rate to use instead of fabricating one.
    glazing_field = project.tier3.glazing_pct
    glazing_pct = glazing_field.value
    glazing_source = glazing_field.source if glazing_field.source != "unset" else "fallback-default"
    if glazing_pct is None:
        glazing_pct = 20.0  # same default llm_fallback.py already assigns when this field is left blank
        glazing_source = "fallback-default"

    if glazing_pct > 0:
        from app.services.emission_factors import get_factor

        facade_area_sqm = gfa * FACADE_AREA_PER_SQM_GFA
        glazed_area_sqm = facade_area_sqm * (glazing_pct / 100.0)
        aluminium_area_sqm = glazed_area_sqm * ALUMINIUM_FRAME_FRACTION_OF_GLAZED_AREA
        glass_area_sqm = glazed_area_sqm - aluminium_area_sqm

        glass_factor = get_factor("glass")
        glass_areal_factor = glass_factor["ef_kgco2e_per_kg"] * glass_factor["areal_mass_kg_per_m2"]
        glass_carbon_kg = glass_area_sqm * glass_areal_factor
        breakdown.append(
            MaterialBreakdown(
                material="Glass (glazing)",
                material_category="glass",
                quantity=glass_area_sqm,
                quantity_unit="m2",
                factor_used=glass_areal_factor,
                factor_unit="kgCO2e/m2",
                factor_source="ifc_india",
                carbon_kg=glass_carbon_kg,
                quantity_source=f"glazing_pct:{glazing_source}, facade_area:disclosed-assumption",
            )
        )

        aluminium_factor = get_factor("aluminium")
        aluminium_areal_factor = aluminium_factor["ef_kgco2e_per_kg"] * aluminium_factor["areal_mass_kg_per_m2"]
        aluminium_carbon_kg = aluminium_area_sqm * aluminium_areal_factor
        breakdown.append(
            MaterialBreakdown(
                material="Aluminium (window/curtain-wall framing)",
                material_category="aluminium",
                quantity=aluminium_area_sqm,
                quantity_unit="m2",
                factor_used=aluminium_areal_factor,
                factor_unit="kgCO2e/m2",
                factor_source="ifc_india",
                carbon_kg=aluminium_carbon_kg,
                quantity_source=f"glazing_pct:{glazing_source}, facade_area:disclosed-assumption, frame_fraction:disclosed-assumption",
            )
        )

    total_carbon_kg = sum(item.carbon_kg for item in breakdown)

    return CalculationResult(
        project_id=project.project_id,
        gfa_sqm=gfa,
        breakdown=breakdown,
        total_carbon_kg=total_carbon_kg,
        total_carbon_tonnes=total_carbon_kg / 1000,
        carbon_per_sqm=total_carbon_kg / gfa,
        carbon_per_sqft=total_carbon_kg / gfa / SQM_TO_SQFT,
    )