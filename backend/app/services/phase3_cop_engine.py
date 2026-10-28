""""Phase 5" -- Certificate of Payment (COP) bill -> embodied carbon,
compared against a project's existing Phase 3 baseline.

This is deliberately NOT a new state/storage layer: a COP bill IS a
Phase 3 bill (a cumulative-to-date snapshot compared against the fixed
baseline -- see app/services/phase3.py's own module docstring), just
sourced from a different document format than the Excel BOQ-shaped bills
Phase 3 already accepts. app/api/phase3.py's upload_bill() dispatches
here for a .pdf upload and to boq_carbon's calculate_from_boq() for an
.xlsx/.xls upload, unchanged; both paths land on the same
phase3.BillPeriod / phase3.compute_dashboard() -- one baseline, one
dashboard, one time series, whichever format a given quarter's bill
happens to be.

Classification/calculation is intentionally NOT reinvented here: a COP's
Item Code ("13000389") is drawn from the exact same per-company
master_item_codes.json keyspace a Work Order's Activity Number already
resolves against (confirmed directly: every Item Code on both real COPs
on hand was present there with a real material_category -- see
cop_bill_parser.py's module docstring). So this module reuses
wo_carbon_engine.py's own _resolve_ef()/compute_line_gwp_kg() unchanged
-- the same emission-factor resolution (CEA-adjusted concrete/rebar,
canonical per-kg factors for everything else) and the same per-category
unit-conversion formulas a Work Order upload already gets, rather than a
second, parallel implementation that could silently drift from it.

Quantity basis (added after the initial build): a COP's "Cummulative
Quanity Summary" table states three numbers per line -- Previous,
Present, and Cummu. (= Previous + Present) -- for both Quantity and
Value. This module can compute the carbon total off EITHER of two of
those, chosen per-call via `quantity_basis`:

  - "cummulative" (the default, and the original/only behavior before
    this option existed): qty_cummulative, this bill's cumulative-to-
    date quantity -- matches Phase 3's general "quantity-to-date, not
    incremental" bill semantics, so the resulting BillPeriod represents
    total work done on the project as of this bill.
  - "present": qty_present, just THIS billing period's (this RA bill's)
    own quantity -- NOT cumulative. A BillPeriod built this way
    represents one period's work only, not a running total, and is
    labeled as such (see phase3.py's BillPeriod.quantity_basis) so the
    dashboard never silently mixes the two meanings across periods.

Every line item's raw qty_previous/qty_present/qty_cummulative (and the
matching value_* trio) are kept on CopLineItemResult regardless of which
basis drove the total, for a full audit trail -- `qty`/`value` are what
was actually fed into the GWP formula and Coverage's value accounting
for THIS call's chosen basis. A small number of lump-sum "rate
adjustment" rows have no recoverable quantity at all in either basis
(see cop_bill_parser.py) -- those are excluded from the gwp total with
reason=no_quantity, same honest-reporting discipline as every other
exclusion reason here, but still counted in Coverage's total_value.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel

from app.services import coverage as coverage_service
from app.services.cop_bill_parser import parse_cop_pdf
from app.services.wo_carbon.wo_carbon_engine import _load_master_factors, _resolve_ef, compute_line_gwp_kg

QuantityBasis = Literal["cummulative", "present"]


class CopLineItemResult(BaseModel):
    item_code: str
    description: str
    unit: str
    # The quantity/value actually used for this line's GWP calc and
    # value accounting, per this call's quantity_basis -- either equals
    # qty_cummulative/value_cummulative or qty_present/value_present
    # below, depending on which basis was requested.
    qty: Optional[float] = None
    value: float
    # Raw, unconditionally-populated trio from the parser -- kept
    # regardless of quantity_basis, purely for audit/traceability (see
    # module docstring).
    qty_previous: Optional[float] = None
    qty_present: Optional[float] = None
    qty_cummulative: Optional[float] = None
    value_previous: Optional[float] = None
    value_present: Optional[float] = None
    value_cummulative: Optional[float] = None
    contributes: Optional[str] = None
    material_category: Optional[str] = None
    evidence_tier: Optional[str] = None
    gwp_kg_co2e: Optional[float] = None
    basis_note: str
    top5: Optional[bool] = None
    qty_derivation: str = "direct"
    value_derivation: str = "direct"


class CopCategoryTotal(BaseModel):
    category: str
    gwp_kg_co2e: float
    line_item_count: int
    value_covered: float
    pct_of_total: float
    # Same two additions, same reasoning, as boq_carbon/engine.py's
    # CategoryTotal (see that model's own docstring) -- for the Project
    # Dashboard's Materials table. A COP line already carries a clean,
    # structured `evidence_tier`/`basis_note` (CopLineItemResult), so
    # dominant_factor_source here is that highest-GWP line's basis_note,
    # same "a real line really did compute this way" framing.
    representative_emission_factor: Optional[float] = None
    dominant_factor_source: Optional[str] = None


class CopBillResult(BaseModel):
    source_file: str
    quantity_basis: QuantityBasis = "cummulative"
    n_lines_total: int
    n_lines_computed: int
    total_gwp_kg_co2e: float
    total_gwp_tonnes_co2e: float
    by_category: list[CopCategoryTotal]
    total_value: float
    computed_value: float
    parse_checksum_ok: Optional[bool] = None
    work_done_cumulative_value: Optional[float] = None
    line_items: list[CopLineItemResult] = []
    coverage: Optional[coverage_service.Coverage] = None
    # "Phase 5b": the real bill date read off the document itself (see
    # cop_bill_parser.py's WORK_DONE_PERIOD_RE) -- work_done_period_end is
    # the one app/api/phase3.py's upload_bill() uses as billed_date,
    # overriding whatever date the uploader typed, when present. The
    # other two are carried through for display/audit only.
    work_done_period_start: Optional[str] = None
    work_done_period_end: Optional[str] = None
    cop_date: Optional[str] = None
    ra_bill_no: Optional[str] = None


def _classify_cop_exclusion_reason(basis_note: str, contributes: Optional[str], qty: Optional[float]) -> str:
    if qty is None:
        return coverage_service.REASON_NO_QUANTITY
    if contributes is not None and contributes != "yes":
        return coverage_service.REASON_NOT_CONTRIBUTING if contributes == "no" else coverage_service.REASON_NEEDS_REVIEW
    if basis_note == "Item Code not found in master item-code dataset":
        return coverage_service.REASON_UNCLASSIFIED
    if basis_note == "no emission factor on file for this code":
        return coverage_service.REASON_NO_EMISSION_FACTOR
    return coverage_service.REASON_UNHANDLED_UNIT


def calculate_from_cop_pdf(pdf_path: str, master_json_path: str, quantity_basis: QuantityBasis = "cummulative") -> CopBillResult:
    parsed = parse_cop_pdf(pdf_path)
    master = _load_master_factors(master_json_path)

    line_results: list[CopLineItemResult] = []
    by_cat: dict[str, dict] = {}

    for it in parsed.items:
        # The quantity/value this call actually uses, per quantity_basis --
        # everything below computes off qty/val, never the raw qty_present/
        # qty_cummulative fields directly, so "present" vs "cummulative"
        # is a single switch, not two parallel code paths.
        qty = it.qty_present if quantity_basis == "present" else it.qty_cummulative
        val = it.value_present if quantity_basis == "present" else it.value_cummulative
        raw_fields = dict(
            qty_previous=it.qty_previous, qty_present=it.qty_present, qty_cummulative=it.qty_cummulative,
            value_previous=it.value_previous, value_present=it.value_present, value_cummulative=it.value_cummulative,
        )

        m = master.get(it.item_code)
        if m is None:
            line_results.append(CopLineItemResult(
                item_code=it.item_code, description=it.description, unit=it.unit,
                qty=qty, value=val or 0.0, **raw_fields,
                basis_note="Item Code not found in master item-code dataset",
                qty_derivation=it.qty_derivation, value_derivation=it.value_derivation,
            ))
            continue

        contributes = (m.get("contributes") or "").strip().lower()
        category = m.get("material_category") or None
        desc = m.get("desc") or it.description
        top5_raw = m.get("top5")
        top5 = top5_raw if isinstance(top5_raw, bool) else (str(top5_raw).strip().lower() == "yes" if top5_raw is not None else None)

        if contributes != "yes":
            line_results.append(CopLineItemResult(
                item_code=it.item_code, description=desc, unit=it.unit,
                qty=qty, value=val or 0.0, **raw_fields,
                contributes=contributes, material_category=category, top5=top5,
                basis_note=f"Contributes to Carbon = '{contributes}'",
                qty_derivation=it.qty_derivation, value_derivation=it.value_derivation,
            ))
            continue

        if qty is None:
            line_results.append(CopLineItemResult(
                item_code=it.item_code, description=desc, unit=it.unit,
                qty=None, value=val or 0.0, **raw_fields,
                contributes=contributes, material_category=category, top5=top5,
                basis_note=f"No recoverable {quantity_basis} quantity for this row (value only)",
                qty_derivation=it.qty_derivation, value_derivation=it.value_derivation,
            ))
            continue

        ef, ef_note, evidence_tier = _resolve_ef(category, desc)
        gwp_kg, note = compute_line_gwp_kg(category, m.get("unit"), qty, ef, m.get("unit_note"), m.get("kg_per_unit"))
        if gwp_kg is not None:
            note = f"{note} ({ef_note})"

        line_results.append(CopLineItemResult(
            item_code=it.item_code, description=desc, unit=it.unit,
            qty=qty, value=val or 0.0, **raw_fields,
            contributes=contributes, material_category=category, evidence_tier=evidence_tier,
            gwp_kg_co2e=gwp_kg, basis_note=note, top5=top5,
            qty_derivation=it.qty_derivation, value_derivation=it.value_derivation,
        ))

        if gwp_kg is not None:
            c = by_cat.setdefault(category, {"gwp": 0.0, "count": 0, "value": 0.0, "qty": 0.0, "units": set(), "top_gwp": -1.0, "top_note": None})
            c["gwp"] += gwp_kg
            c["count"] += 1
            c["value"] += (val or 0.0)
            c["qty"] += qty or 0.0
            c["units"].add(it.unit)
            if gwp_kg > c["top_gwp"]:
                c["top_gwp"] = gwp_kg
                c["top_note"] = note

    total_gwp = sum(v["gwp"] for v in by_cat.values())
    by_category = [
        CopCategoryTotal(
            category=cat, gwp_kg_co2e=v["gwp"], line_item_count=v["count"],
            value_covered=v["value"],
            pct_of_total=(v["gwp"] / total_gwp * 100) if total_gwp else 0.0,
            # See boq_carbon/engine.py's CategoryTotal.representative_emission_factor
            # docstring -- same "only when every computed line shares one
            # native unit" guard against averaging across incompatible
            # magnitudes (confirmed a real risk: a real COP's own
            # reinforcement_steel rows were observed in both 'NOS' and
            # 'MT', even though only one of those actually computes).
            representative_emission_factor=(v["gwp"] / v["qty"]) if v["qty"] and len(v["units"]) == 1 else None,
            dominant_factor_source=v["top_note"],
        )
        for cat, v in sorted(by_cat.items(), key=lambda kv: -kv[1]["gwp"])
    ]

    total_value = sum((r.value or 0.0) for r in line_results)
    computed_value = sum(v["value"] for v in by_cat.values())
    n_computed = sum(1 for r in line_results if r.gwp_kg_co2e is not None)

    coverage_rows = [
        {
            "value": r.value or 0.0,
            "computed": r.gwp_kg_co2e is not None,
            "is_top5": bool(r.top5),
            "reason": None if r.gwp_kg_co2e is not None else _classify_cop_exclusion_reason(r.basis_note, r.contributes, r.qty),
        }
        for r in line_results
    ]

    return CopBillResult(
        source_file=Path(pdf_path).name,
        quantity_basis=quantity_basis,
        n_lines_total=len(parsed.items),
        n_lines_computed=n_computed,
        total_gwp_kg_co2e=total_gwp,
        total_gwp_tonnes_co2e=total_gwp / 1000.0,
        by_category=by_category,
        total_value=total_value,
        computed_value=computed_value,
        parse_checksum_ok=parsed.parse_checksum_ok,
        work_done_cumulative_value=parsed.work_done_cumulative_value,
        line_items=line_results,
        coverage=coverage_service.build_coverage(coverage_rows),
        work_done_period_start=parsed.work_done_period_start,
        work_done_period_end=parsed.work_done_period_end,
        cop_date=parsed.cop_date,
        ra_bill_no=parsed.ra_bill_no,
    )
