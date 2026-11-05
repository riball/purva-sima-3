"""Material emission factor lookup -- IFC India data as PRIMARY source,
ICE v4.1 as FALLBACK.

Why the switch: IFC's figures are built from real Indian production data
(Sphera/GaBi modeling of Indian cement, concrete, and steel production),
whereas ICE's tables are UK/EU-basis figures. Real India-specific data
outranks an adjusted-from-elsewhere figure, even where it gives a higher
(less flattering) number -- confirmed true for both materials switched
here: IFC's steel rebar (2.6 kgCO2e/kg) is 51% higher than ICE's world
average (1.72), and this is used as the new default anyway, on the same
principle.

Real tradeoff, stated plainly: IFC gives concrete GWP by CEMENT TYPE
(OPC/PSC/PPC), not by M-GRADE the way ICE does. Switching to IFC as
primary means trading grade-level precision for cement-type-based real
data. The ICE M-grade table remains available as a fallback for when
cement type is unknown but grade is known.

--- Grade scaling (added after a real accuracy gap was found) ---
Until this fix, get_concrete_factor_per_m3() ignored `grade` entirely
whenever cement_type was known (which is almost always, since the BOQ
classifier defaults to a cement type when the text doesn't state one) --
M10 and M40 concrete were priced IDENTICALLY. Verified directly: every
grade from M10 to M40 returned exactly 201.26 kgCO2e/m3 for PPC. That's
wrong -- higher grades genuinely use more cement per m3 and have a real,
higher GWP.

The fix reuses data that was already sitting in ice_db_factors.json
unused for this purpose: concrete.by_grade.cem_i is ICE v4.1's own
CEM-I-cement, by-M-grade curve. It isn't applied as an absolute value
(that would throw away IFC's India-specific calibration) -- it's used
only for its SHAPE: the ratio of a given grade's GWP to M40's GWP in
that same curve, applied multiplicatively on top of IFC's India-
specific, cement-type-based anchor. IFC's own concrete table (Table 14)
is itself calibrated to M40 composition, so this ratio is being applied
against the same grade basis on both sides -- not mixing an M40 IFC
number with an ICE M25 number as if they were already comparable.

A grade absent from the ratio table (or no grade given at all) falls
back to a scale factor of 1.0 -- i.e. the M40-equivalent value, same as
before this fix -- rather than guessing or erroring.
"""

from __future__ import annotations
from functools import lru_cache
import json
from pathlib import Path
from typing import Optional

FACTORS_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "ice_db" / "ice_db_factors.json"
)

VALID_CEMENT_TYPES = ["OPC", "PSC", "PPC"]

# ICE v4.1's own CEM I grade curve is calibrated around M40 (its numbers
# run M10..M50), which lines up with IFC's concrete table also being an
# M40 calibration -- so M40 is the anchor grade for the ratio, not an
# arbitrary choice.
GRADE_SCALE_ANCHOR = "M40"

@lru_cache(maxsize=1)             # add this line directly above the function

def load_factors() -> dict:
    with open(FACTORS_PATH, "r") as f:
        return json.load(f)


def get_concrete_density_kg_per_m3() -> float:
    """The single density figure (2400 kg/m3, IFC India's own assumption)
    used to convert a Cum-priced concrete line to mass. Added as part of
    Workstream 01 (one emission-factor source) so boq_carbon/engine.py
    and wo_carbon/wo_carbon_engine.py both read this from here instead of
    each hardcoding their own '2400.0' constant -- harmless while the two
    copies agree, but a real drift risk the moment one of them is edited
    without the other, which is exactly the class of bug this workstream
    exists to close off.
    """
    return load_factors()["ifc_india"]["concrete"]["default_density_kg_per_m3"]


def get_concrete_grade_scale_factor(grade: Optional[str]) -> float:
    """Ratio of ICE's CEM I per-kg GWP for `grade` vs its M40 value.
    Multiply IFC's India-specific cement-type anchor by this to
    differentiate other grades while keeping the absolute level India-
    calibrated -- see module docstring for why this is a ratio, not an
    absolute substitution.

    Returns 1.0 (no scaling -- the M40-equivalent value) when grade is
    missing or not one of ICE's tabulated grades, rather than guessing.
    """
    if not grade:
        return 1.0
    factors = load_factors()
    grade_table = factors["concrete"]["by_grade"]["cem_i"]
    anchor = grade_table.get(GRADE_SCALE_ANCHOR)
    val = grade_table.get(grade.upper())
    if anchor is None or val is None:
        return 1.0
    return val / anchor


# ---------------------------------------------------------------------------
# Concrete
# ---------------------------------------------------------------------------

def get_concrete_factor_ifc(cement_type: str) -> dict:
    """Primary lookup: IFC's real Indian ready-mix concrete data, by
    cement type. Returns the full entry (gwp_kgco2e_per_kg,
    energy_derived_fraction_of_gwp, display_name) since the caller
    (calculation_engine.py) needs the energy fraction for CEA adjustment,
    not just the raw factor.
    """
    factors = load_factors()
    entry = factors["ifc_india"]["concrete"]["by_cement_type"].get(cement_type.upper())
    if entry is None:
        raise ValueError(
            f"No IFC concrete factor for cement_type '{cement_type}' -- "
            f"valid types are {VALID_CEMENT_TYPES}"
        )
    return entry


def get_concrete_factor_per_m3_ifc(
    cement_type: str, grade: Optional[str] = None, apply_cea: bool = True
) -> float:
    """Returns kgCO2e per m3 of concrete using IFC's cement-type-based
    factor, optionally CEA-adjusted (see cea_adjustment.py) and grade-
    scaled (see get_concrete_grade_scale_factor -- module docstring has
    the full reasoning). This is the primary path -- use when cement_type
    is known.
    """
    from app.services.cea_adjustment import apply_cea_adjustment_ifc

    factors = load_factors()
    entry = get_concrete_factor_ifc(cement_type)
    density = factors["ifc_india"]["concrete"]["default_density_kg_per_m3"]

    per_kg = entry["gwp_kgco2e_per_kg"]
    if apply_cea:
        per_kg = apply_cea_adjustment_ifc(per_kg, entry["energy_derived_fraction_of_gwp"])

    per_kg *= get_concrete_grade_scale_factor(grade)

    return per_kg * density


def get_concrete_factor_per_m3_ice_fallback(
    grade: str, cement_type: str = "uk_average_cement"
) -> float:
    """FALLBACK ONLY: ICE's M-grade-based table, used when cement_type is
    unknown but M-grade is known. No CEA adjustment applied here -- the
    UK/EU grid baseline ICE assumed hasn't been extracted from ICE's own
    methodology docs, so adjusting without that denominator would mean
    fabricating a number. This is a stated, known gap, not an oversight.
    """
    factors = load_factors()
    grade_table = factors["concrete"]["by_grade"].get(cement_type)
    if grade_table is None:
        raise ValueError(f"Unknown ICE cement_type '{cement_type}'")
    per_kg = grade_table.get(grade)
    if per_kg is None:
        raise ValueError(f"No ICE factor for concrete grade '{grade}'")
    density = factors["concrete"]["default_density_kg_per_m3"]
    return per_kg * density


def get_concrete_factor_per_m3(
    cement_type: Optional[str] = None, grade: Optional[str] = None, apply_cea: bool = True
) -> tuple[float, str]:
    """Top-level concrete lookup. Prefers IFC (cement_type-based) when
    cement_type is available; falls back to ICE (grade-based) when it
    isn't. Grade is now used on BOTH paths -- as a scaling ratio on the
    IFC path, as the direct lookup key on the ICE fallback path -- see
    module docstring for why this changed. Returns (factor_per_m3,
    source_label) so callers can record which path was actually used.

    At least one of cement_type or grade must be provided.
    """
    if cement_type:
        return get_concrete_factor_per_m3_ifc(cement_type, grade=grade, apply_cea=apply_cea), "ifc_india"
    if grade:
        return get_concrete_factor_per_m3_ice_fallback(grade), "ice_fallback"
    raise ValueError("Must provide either cement_type or grade to look up a concrete factor")


# ---------------------------------------------------------------------------
# Steel
# ---------------------------------------------------------------------------

def get_steel_rebar_factor_ifc() -> dict:
    factors = load_factors()
    return factors["ifc_india"]["steel_rebar"]


def get_steel_rebar_factor_per_kg(apply_cea: bool = True) -> tuple[float, str]:
    """Primary: IFC's India-specific rebar factor (2.6 kgCO2e/kg),
    optionally CEA-adjusted. Returns (factor, source_label).
    """
    from app.services.cea_adjustment import apply_cea_adjustment_ifc

    entry = get_steel_rebar_factor_ifc()
    per_kg = entry["gwp_kgco2e_per_kg"]
    if apply_cea:
        per_kg = apply_cea_adjustment_ifc(per_kg, entry["energy_derived_fraction_of_gwp"])
    return per_kg, "ifc_india"


def get_steel_rebar_factor_per_kg_ice_fallback() -> float:
    """FALLBACK ONLY: ICE's world-average rebar figure. No CEA
    adjustment applied -- same reasoning as the concrete fallback above.
    """
    factors = load_factors()
    return factors["steel"]["rebar"]["value"]


# ---------------------------------------------------------------------------
# Continuous blend-composition percentage (GGBS%, fly-ash%) -- added for
# the Material Swap Sandbox's custom-percentage feature (see
# swap_sandbox.py's module docstring for the user-facing side of this).
#
# IFC's own cement-type table gives exactly TWO real data points on each
# of these axes: OPC (0% of the component) and the one blend IFC actually
# measured (PSC = a real ~25% GGBS blend, PPC = a real ~30% fly-ash
# blend -- see substitution_catalog.json's opc_to_psc/opc_to_ppc
# `reasoning` fields, which say this explicitly). There is no third real
# point and no sourced curve. An arbitrary percentage is therefore a
# straight line drawn through those two real points, NOT a third sourced
# number -- every caller of get_blended_cement_factor_per_kg must
# disclose that plainly (see swap_sandbox.py's resolve_intent_to_entry).
# This module only computes the number and a confidence tier; it never
# writes disclosure prose itself.
#
# This deliberately does NOT extend to steel recycled-content or any
# other "percentage" in the catalog. brick_to_aac_block and
# steel_ifc_to_ars_eaf_recycled are both SCOPE swaps (what fraction of a
# project's total quantity switches to a different product), already
# handled by substitution_engine's split_pct/user_pct, not a composition
# blend within one product. Worse, for steel specifically,
# substitution_catalog.json's own evidence_log records real third-party
# EPD data showing recycled-content% does NOT predict GWP linearly
# (Raajratna at ~23% recycled scores essentially the same as the
# non-recycled IFC baseline; a 100% BF/BOF-route EPD scores *higher* than
# that same baseline). Treating "recycled-steel %" as an interpolatable
# axis the way GGBS%/fly-ash% are would fabricate a linear relationship
# this codebase's own on-file evidence contradicts -- so it's withheld
# on purpose, not an oversight.
BLEND_COMPONENTS: dict[str, dict] = {
    "ggbs": {
        "zero_cement_type": "OPC",
        "documented_cement_type": "PSC",
        "documented_pct": 25.0,
        "code_ceiling_pct": 50.0,
        "code_basis": "IS 455 / common Indian RMC-plant practice",
        "label": "GGBS/slag",
    },
    "fly_ash": {
        "zero_cement_type": "OPC",
        "documented_cement_type": "PPC",
        "documented_pct": 30.0,
        "code_ceiling_pct": 30.0,
        "code_basis": "IS 1489",
        "label": "fly-ash/pozzolana",
    },
}


def get_blended_cement_factor_per_kg(component: str, target_pct: float, apply_cea: bool = True) -> dict:
    """Linearly interpolates/extrapolates a per-kg concrete GWP figure
    for an arbitrary `target_pct` of `component` ("ggbs" or "fly_ash"),
    through the two real IFC data points on that axis (see
    BLEND_COMPONENTS above). The two anchors are each CEA-adjusted first
    (same apply_cea_adjustment_ifc() call the discrete get_concrete_
    factor_per_m3_ifc() path already makes), then a straight line is
    drawn through those two final numbers and evaluated at target_pct --
    this treats "the emission factor as a function of blend %" as the
    thing being interpolated, which is the real question being asked,
    rather than interpolating some intermediate quantity.

    Returns a dict: per_kg, confidence, documented_pct, code_ceiling_pct,
    code_basis, label. confidence is one of:
      - "interpolated" -- target_pct is between the real 0% point and
        the real documented_pct point (e.g. 0-25% for GGBS). The
        straight line connects two real measurements, so this is a
        reasonable estimate, but it is still NOT an independently
        measured number for exactly target_pct.
      - "extrapolated_within_code_ceiling" -- target_pct is past the one
        real documented point but still at or below the real IS-code
        recommended ceiling for this blend (code_ceiling_pct/code_basis).
        A rougher estimate -- the line is projected past the only point
        that actually anchors it on that side.
      - "extrapolated_beyond_code_ceiling" -- target_pct exceeds the
        real code-recommended ceiling. Still computed and returned (this
        function never refuses a request), but the caller should surface
        a strong caveat: the underlying emissions relationship may not
        even stay linear this far past the one point IFC measured, and
        a blend this high needs engineering review regardless of the
        carbon figure.

    Raises ValueError for an unknown component or a pct outside 0-100 --
    those are invalid inputs, not estimation-confidence questions.
    """
    from app.services.cea_adjustment import apply_cea_adjustment_ifc

    if component not in BLEND_COMPONENTS:
        raise ValueError(f"Unknown blend component '{component}' -- valid: {sorted(BLEND_COMPONENTS)}")
    if target_pct < 0 or target_pct > 100:
        raise ValueError(f"Blend percentage must be 0-100, got {target_pct:g}")

    axis = BLEND_COMPONENTS[component]
    zero_entry = get_concrete_factor_ifc(axis["zero_cement_type"])
    doc_entry = get_concrete_factor_ifc(axis["documented_cement_type"])

    zero_per_kg = zero_entry["gwp_kgco2e_per_kg"]
    doc_per_kg = doc_entry["gwp_kgco2e_per_kg"]
    if apply_cea:
        zero_per_kg = apply_cea_adjustment_ifc(zero_per_kg, zero_entry["energy_derived_fraction_of_gwp"])
        doc_per_kg = apply_cea_adjustment_ifc(doc_per_kg, doc_entry["energy_derived_fraction_of_gwp"])

    documented_pct = axis["documented_pct"]
    slope = (doc_per_kg - zero_per_kg) / documented_pct
    interpolated_per_kg = zero_per_kg + slope * target_pct

    if target_pct <= documented_pct:
        confidence = "interpolated"
    elif target_pct <= axis["code_ceiling_pct"]:
        confidence = "extrapolated_within_code_ceiling"
    else:
        confidence = "extrapolated_beyond_code_ceiling"

    return {
        "per_kg": interpolated_per_kg,
        "confidence": confidence,
        "documented_pct": documented_pct,
        "code_ceiling_pct": axis["code_ceiling_pct"],
        "code_basis": axis["code_basis"],
        "label": axis["label"],
    }


def get_concrete_factor_per_m3_blend(
    component: str, target_pct: float, grade: Optional[str] = None, apply_cea: bool = True
) -> tuple[float, dict]:
    """Same shape/role as get_concrete_factor_per_m3_ifc() above, but
    sourcing its per_kg figure from get_blended_cement_factor_per_kg()'s
    interpolation instead of a discrete cement-type lookup. Density and
    grade-scaling (get_concrete_grade_scale_factor) are applied
    identically to the discrete path -- only the per_kg origin differs.
    Returns (per_m3, blend_info) so the caller never has to recompute
    the confidence/disclosure metadata separately from the number.
    """
    factors = load_factors()
    density = factors["ifc_india"]["concrete"]["default_density_kg_per_m3"]
    blend = get_blended_cement_factor_per_kg(component, target_pct, apply_cea=apply_cea)
    per_kg = blend["per_kg"] * get_concrete_grade_scale_factor(grade)
    return per_kg * density, blend