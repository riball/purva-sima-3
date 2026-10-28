"""Workstream 10: Phase 3 -- cumulative bills, running carbon, and the
data a dashboard needs. Builds on this project's roadmap design sketch
("Phase 3 design sketch" section) rather than inventing a new shape:

- Cumulative bill ingestion reuses boq_carbon's existing parser/engine --
  a bill IS shaped like a smaller, periodic BOQ (material, quantity-TO-
  DATE, amount), so calculate_from_boq() is called as-is, unmodified, on
  each uploaded bill file. No new parsing logic exists in this module.

- "Quantity-to-date" is the operative phrase from the roadmap's own
  design sketch: each bill is a CUMULATIVE snapshot (as of that billing
  date, here's everything executed so far), not an incremental delta
  since the last bill. That means the most recent bill period IS
  "billed to date" on its own -- periods are never summed together, only
  compared against each other as points on a time series. Getting this
  wrong (summing cumulative figures across periods) would double- or
  triple-count the same work; this module never does that.

- Running-carbon projection compares billed-to-date value against a
  recorded PROJECT BASELINE's total scope value to derive a percent-
  complete, then extrapolates a projected total -- "against the Phase 2
  benchmark's total scope (or against a stated percent-complete, when
  the bill provides one)", exactly as the roadmap specifies. The
  baseline itself is just a stored BoqCarbonResult/WoCarbonResult from
  the SAME Phase 2 engines every other workstream already uses --
  Phase 2 is normally stateless (see boq_carbon_substitute.py's own
  docstring), so this module is what gives ONE specific project's
  original full-scope calculation a place to live so later bills have
  something to compare against.

- Cost-carbon relationship: every BOQ/bill line item already carries
  both `amount` (Rupees) and `gwp_kg_co2e` (added across Workstream 07's
  coverage work) side by side -- so "cost per kg CO2e" is a division on
  data the engine already computed, never a new model.

- The dashboard's comparison line reuses benchmark.py's own "typical
  building held at typical material choices" concept (not a second
  benchmarking concept) -- see _typical_building_carbon_per_sqm below,
  which calls benchmark.py's own build_baseline_project() +
  calculate_embodied_carbon(), the exact same functions Phase 1's own
  /substitute and /calculate endpoints already use.

Storage layout (Workstream 04 company-scoped convention, extended):
    data/companies/<company_id>/projects/<project_id>/phase3_baseline.json
    data/companies/<company_id>/projects/<project_id>/bills/<period>.json

Workstream 11 additions:
- A third baseline source, "phase1_estimate" (baseline_from_phase1_estimate
  below), for a "running project without a [real] baseline" -- one being
  tracked before any Bill of Quantities exists. Reuses Phase 1's own
  calculate_embodied_carbon()/estimate_cost() functions (the same ones
  app/api/calculate.py already calls) against that project_id's existing
  Phase 1 record, rather than inventing a second estimation path.
  Phase3Baseline.is_estimated=True marks it so, surfaced on the dashboard
  so nothing mistakes an estimate for a priced baseline.
- list_projects() (+ ProjectSummary), answering "show me my projects to
  pick from" -- the union of every project with a Phase 1 record and
  every project with Phase 3 data, since a Phase-1-only project is
  exactly the case a user would want to see in order to start tracking
  it.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

from app.services import company_store, project_store
from app.services.boq_carbon.engine import BoqCarbonResult, FloorAreaBasis
from app.services.coverage import Coverage
from app.services.phase3_cop_engine import CopBillResult
from app.services.wo_carbon.wo_carbon_engine import WoCarbonResult

# Workstream 11: "phase1_estimate" is a project that hasn't been billed
# against a real Bill of Quantities/Work Order yet -- a "running project
# without a baseline" in the sense the roadmap always meant it (no real
# BOQ/WO baseline recorded), but still trackable by reusing Phase 1's own
# tiered conceptual estimator for a starting figure. See
# baseline_from_phase1_estimate() below.
BaselineSourceType = Literal["boq", "wo", "phase1_estimate"]


class Phase3Baseline(BaseModel):
    project_id: str
    company_id: str
    # Workstream 14: a human-readable label for a project that was created
    # straight from a BOQ/WO upload (no Phase 1 record, so there's nowhere
    # else to persist one). Optional -- omitting it falls back to
    # project_id for display, same as ProjectSummary already did before
    # this field existed. Never set for source_type="phase1_estimate" --
    # that project already has a name on its Phase 1 record, which
    # list_projects() below prefers over this field regardless.
    project_name: Optional[str] = None
    source_type: BaselineSourceType
    source_file: str
    recorded_at: str  # ISO datetime this baseline was recorded
    total_gwp_kg_co2e: float
    total_value: float  # the full scope's total priced value (Coverage.total_value -- computed + excluded lines alike)
    floor_area_sqm: Optional[float] = None
    floor_area_basis: Optional[FloorAreaBasis] = None
    structural_system_type: Optional[str] = None
    num_floors: Optional[int] = None
    typology: Optional[str] = None
    coverage: Optional[Coverage] = None
    # Workstream 11: True only for source_type="phase1_estimate" -- an
    # ESTIMATED figure from Phase 1's tiered conceptual estimator, not a
    # real Bill of Quantities/Work Order. Surfaced on the dashboard (see
    # compute_dashboard's notes) so nothing downstream mistakes an
    # estimate for a priced baseline. False (the honest default) for
    # every "boq"/"wo" baseline, which really is a full-scope calculation
    # from an uploaded document.
    is_estimated: bool = False
    note: str = (
        "The original, full-scope Phase 2 calculation for this project -- "
        "every bill recorded against this project is compared against "
        "this baseline's total_value/total_gwp_kg_co2e, never against "
        "another bill."
    )


BillSource = Literal["xlsx_boq", "pdf_cop"]


class BillPeriod(BaseModel):
    project_id: str
    company_id: str
    period: str  # a human label, also the storage filename -- e.g. "2026-Q3"
    billed_date: str  # ISO date -- the actual ordering key for the time series, NOT `period`'s string sort order
    source_file: str
    recorded_at: str
    stated_percent_complete: Optional[float] = None  # 0-100, if the bill itself states progress -- takes priority over a value-derived figure when present
    total_gwp_kg_co2e_to_date: float
    total_value_to_date: float
    cost_per_kg_co2e_to_date: Optional[float] = None  # total_value_to_date / total_gwp_kg_co2e_to_date -- a division on data the engine already computed, not a new model
    coverage: Optional[Coverage] = None
    n_lines_computed: int
    n_lines_total: int
    # "Phase 5": which upload path produced this bill -- an Excel BOQ-
    # shaped bill (the original Phase 3 path, calculate_from_boq) or a
    # Certificate of Payment PDF (app.services.phase3_cop_engine, an
    # Item-Code-keyed lookup against the same per-company
    # master_item_codes.json a Work Order upload already uses). Optional
    # and defaulted to "xlsx_boq" only for DISPLAY on a bill recorded
    # before this field existed -- never inferred for a new bill, which
    # always sets it explicitly (see bill_from_boq_result/
    # bill_from_cop_result below). Purely descriptive: every bill, of
    # either source, is compared against the SAME Phase 3 baseline by
    # the SAME compute_dashboard() logic below, unchanged.
    bill_source: Optional[BillSource] = None
    # "Phase 5" quantity-basis toggle: for a pdf_cop bill only, which of
    # the COP's Previous/Present/Cummu. columns drove this bill's totals
    # (see phase3_cop_engine.py's module docstring) -- "cummulative"
    # (total work done to date, the default/original behavior) or
    # "present" (this billing period's work only, NOT a running total).
    # None for an xlsx_boq bill (that format has no such split -- it's
    # always a to-date quantity by construction) and for any bill
    # recorded before this field existed. Surfaced on the dashboard so a
    # project with a mix of bases across periods is never silently read
    # as one continuous cumulative series.
    quantity_basis: Optional[Literal["cummulative", "present"]] = None
    # "Phase 5": a COP bill's own by-category GWP breakdown (see
    # CopBillResult.by_category), carried onto the stored BillPeriod so
    # a per-bill category chart doesn't need to re-parse the source PDF.
    # None for an xlsx_boq bill (boq_carbon's BoqCarbonResult has the
    # same shape of data, just not persisted onto BillPeriod historically
    # -- left that way here rather than changing what every existing
    # bill on disk means).
    category_breakdown: Optional[list[dict]] = None


class DashboardPoint(BaseModel):
    """One point on the running-carbon-over-time chart -- one bill period."""

    period: str
    billed_date: str
    total_gwp_kg_co2e_to_date: float
    total_value_to_date: float
    cost_per_kg_co2e_to_date: Optional[float] = None
    stated_percent_complete: Optional[float] = None
    quantity_basis: Optional[Literal["cummulative", "present"]] = None


class DashboardResult(BaseModel):
    project_id: str
    company_id: str
    baseline: Phase3Baseline
    points: list[DashboardPoint]  # ordered by billed_date, oldest first
    has_bills: bool

    latest_period: Optional[str] = None
    billed_to_date_gwp_kg_co2e: Optional[float] = None
    billed_to_date_value: Optional[float] = None
    cost_per_kg_co2e_to_date: Optional[float] = None

    # UX refinement: "Billed to Date" above is deliberately always anchored
    # to the latest CUMULATIVE-basis bill (never a present-only one --
    # see the cumulative_bills/present_only_bills split below), because
    # percent-complete and the projected total both need a true running
    # total to be correct. But that means a project tracked entirely (or
    # most recently) via 'present' bills showed a stale/zero "Billed to
    # Date" with no indication the user's own latest upload wasn't
    # reflected at all. These three fields describe the single MOST
    # RECENT bill regardless of basis, so the frontend can show it
    # honestly labeled ("Present period only" vs "Cumulative") alongside
    # (or instead of) the cumulative-only figure above.
    latest_bill_period: Optional[str] = None
    latest_bill_quantity_basis: Optional[Literal["cummulative", "present"]] = None
    latest_bill_gwp_kg_co2e: Optional[float] = None

    percent_complete: Optional[float] = None
    percent_complete_source: Optional[str] = None  # "stated_by_latest_bill" | "derived_from_billed_value_vs_baseline_value"

    projected_total_gwp_kg_co2e: Optional[float] = None
    projected_vs_baseline_pct: Optional[float] = None  # positive = tracking to exceed the original full-scope estimate

    benchmark_available: bool = False
    typical_carbon_per_sqm: Optional[float] = None
    projected_carbon_per_sqm: Optional[float] = None
    pct_difference_from_typical: Optional[float] = None
    benchmark_floor_band_used: Optional[str] = None

    notes: list[str] = []


class ProjectSummary(BaseModel):
    """Workstream 11: one row in "show me my projects to pick from" --
    the gap flagged right after WS10 shipped, that a frontend had no way
    to list what projects exist without already knowing their
    project_id. Deliberately the UNION of two sources, not just whichever
    projects already have Phase 3 data: a project that only ever went
    through Phase 1's tiered form (no BOQ/WO/estimate baseline recorded
    yet) still needs to show up here, since that's exactly the case a
    user would pick "track this as a running project" for.
    """

    project_id: str
    company_id: str
    project_name: Optional[str] = None  # from the Phase 1 record at this project_id, if one exists; falls back to project_id itself for display when absent
    has_phase1_record: bool
    has_baseline: bool
    baseline_source_type: Optional[BaselineSourceType] = None
    baseline_is_estimated: bool = False
    n_bills: int
    latest_bill_period: Optional[str] = None
    latest_billed_date: Optional[str] = None
    # Purely descriptive project-profile metadata from project_registry.py
    # (archetype/construction_stage have no source other than that
    # registry; location falls back to the Phase 1 record's own field
    # when the registry has no override -- see list_projects() below).
    # Never read by any calculation.
    archetype: Optional[str] = None
    construction_stage: Optional[str] = None
    location: Optional[str] = None
    # "Beta fork" (project_registry.py's mark_as_beta_twin, set by
    # app/services/phase4.py's confirm_recommendation_as_beta_twin) --
    # lets the frontend Directory group Beta twins into their own
    # "Material Change Projects (Beta)" section instead of mixing them
    # into the main grid, and link a twin's card back to the project it
    # was forked from. Never read by any calculation, same as
    # archetype/construction_stage/location above.
    is_beta_twin: bool = False
    beta_source_project_id: Optional[str] = None


def list_projects(company_id: str) -> list[ProjectSummary]:
    """Every project_id this company has EITHER a Phase 1 record for
    (projects/<id>.json) OR any Phase 3 data for (projects/<id>/ --
    a baseline and/or at least one bill) -- the union, not just one
    source, so a brand-new Phase-1-only project and an established
    Phase-3-tracked one both show up in the same list. See
    company_store.project_dir()'s own docstring for why a file and a
    directory of the same name coexist safely here.
    """
    projects_root = company_store.projects_dir(company_id)
    project_ids: set[str] = set()
    if projects_root.exists():
        for entry in projects_root.iterdir():
            if entry.is_dir():
                project_ids.add(entry.name)  # has Phase 3 data (baseline and/or bills)
            elif entry.suffix == ".json":
                project_ids.add(entry.stem)  # a Phase 1 record only

    # UX refinement: the project_registry is the canonical name source
    # when it has an entry (it's kept in sync by save_project()/
    # save_baseline()'s own hooks, and by an explicit rename via
    # PATCH /projects/{id}/name) -- falls back to the old "Phase 1 record,
    # else baseline" lookup only for a project the registry doesn't know
    # about yet, so existing data with no registry entry still displays a
    # name exactly as it did before this field existed.
    from app.services import project_registry

    registry_entries = {e["project_id"]: e for e in project_registry.list_named_projects(company_id)}
    registry_names = {pid: e["project_name"] for pid, e in registry_entries.items()}

    summaries = []
    for project_id in sorted(project_ids):
        phase1_project = project_store.load_project(project_id, company_id=company_id)
        baseline = load_baseline(company_id, project_id)
        bills = list_bill_periods(company_id, project_id)
        registry_entry = registry_entries.get(project_id, {})
        # location: the registry's manual override wins when set (it's
        # the only place a BOQ/WO-only project -- no Phase 1 record --
        # could ever have one); otherwise fall back to the Phase 1
        # record's own `location` field, same fallback shape as
        # project_name just above.
        location = registry_entry.get("location") or (
            phase1_project.mandatory.location.value if phase1_project else None
        )
        summaries.append(
            ProjectSummary(
                project_id=project_id,
                company_id=company_id,
                project_name=registry_names.get(project_id)
                or (phase1_project.project_name if phase1_project else None)
                or (baseline.project_name if baseline else None),
                has_phase1_record=phase1_project is not None,
                has_baseline=baseline is not None,
                archetype=registry_entry.get("archetype"),
                construction_stage=registry_entry.get("construction_stage"),
                location=location,
                is_beta_twin=registry_entry.get("is_beta_twin") or False,
                beta_source_project_id=registry_entry.get("beta_source_project_id"),
                baseline_source_type=baseline.source_type if baseline else None,
                baseline_is_estimated=baseline.is_estimated if baseline else False,
                n_bills=len(bills),
                latest_bill_period=bills[-1].period if bills else None,
                latest_billed_date=bills[-1].billed_date if bills else None,
            )
        )
    return summaries


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------


def save_baseline(baseline: Phase3Baseline) -> None:
    # Atomic write-then-rename -- see company_store.atomic_write_json's
    # docstring. A plain write_text() here left a window where a
    # concurrent GET /phase3/projects/{id}/dashboard (or any other
    # baseline read) could observe a truncated/empty file mid-write and
    # crash with a JSONDecodeError -- caught live by a concurrency stress
    # test against this app's other JSON stores.
    path = company_store.phase3_baseline_path(baseline.company_id, baseline.project_id)
    company_store.atomic_write_json(path, baseline.model_dump(mode="json"))

    # UX refinement: same registration hook as project_store.save_project()
    # -- a project that gets its name for the first time via a Phase 2/3
    # baseline upload (no Phase 1 record ever submitted) still becomes
    # findable by name everywhere. Lazy import to avoid a circular import
    # (project_registry.list_named_projects calls back into this module).
    if baseline.project_name and baseline.project_name.strip():
        from app.services import project_registry

        project_registry.register_project(baseline.company_id, baseline.project_id, baseline.project_name)


def load_baseline(company_id: str, project_id: str) -> Optional[Phase3Baseline]:
    path = company_store.phase3_baseline_path(company_id, project_id)
    if not path.exists():
        return None
    return Phase3Baseline.model_validate(json.loads(path.read_text()))


def delete_project_data(company_id: str, project_id: str) -> bool:
    """UX refinement: "delete a project" support -- removes this
    project's WHOLE Phase 3/4 directory (company_store.project_dir): the
    baseline, every logged bill, the mutable Phase 4 source result, the
    recommendations file, and the append-only audit log all live under
    that one directory (see company_store.project_dir's own docstring for
    why it's a directory, coexisting alongside the Phase 1 record's
    separate `<project_id>.json` file). One rmtree is correct here
    precisely because nothing outside this directory is Phase 3/4 state
    for this project. Returns False (a no-op, not an error) when the
    project never had any Phase 3 data to begin with -- e.g. a Phase
    1-only project being deleted.
    """
    import shutil

    directory = company_store.project_dir(company_id, project_id)
    if not directory.exists():
        return False
    shutil.rmtree(directory)
    return True


def save_source_result(company_id: str, project_id: str, result: "BoqCarbonResult") -> None:
    """Workstream 14: persists the full BOQ result (line items included)
    alongside the baseline -- see company_store.phase3_source_result_path's
    own docstring for why this is a separate, mutable file. Called once at
    baseline-recording time (app/api/phase3.py's record_baseline) with the
    ORIGINAL computed result; from then on, only app/services/phase4.py's
    confirm_recommendation() ever overwrites it, each time with a new
    result that's still the product of the same real calculation math,
    never a hand-edited number.
    """
    # Atomic write-then-rename -- see company_store.atomic_write_json's
    # docstring. The Phase 4 confirm flow and Phase 3's own dashboard
    # both read this file; a plain write_text() left a window where one
    # could observe a truncated/empty file mid-write.
    path = company_store.phase3_source_result_path(company_id, project_id)
    company_store.atomic_write_json(path, result.model_dump(mode="json"))


def load_source_result(company_id: str, project_id: str) -> Optional["BoqCarbonResult"]:
    path = company_store.phase3_source_result_path(company_id, project_id)
    if not path.exists():
        return None
    return BoqCarbonResult.model_validate(json.loads(path.read_text()))


def save_bill_period(bill: BillPeriod, overwrite: bool = False) -> None:
    path = company_store.project_bill_path(bill.company_id, bill.project_id, bill.period)
    if path.exists() and not overwrite:
        raise ValueError(
            f"A bill for period '{bill.period}' already exists for project '{bill.project_id}' -- "
            f"pass overwrite=True to replace it, or use a different period label."
        )
    # Atomic write-then-rename -- see company_store.atomic_write_json's
    # docstring.
    company_store.atomic_write_json(path, bill.model_dump(mode="json"))


def load_bill_period(company_id: str, project_id: str, period: str) -> Optional[BillPeriod]:
    path = company_store.project_bill_path(company_id, project_id, period)
    if not path.exists():
        return None
    return BillPeriod.model_validate(json.loads(path.read_text()))


def delete_bill_period(company_id: str, project_id: str, period: str) -> bool:
    """UX refinement: "remove an uploaded bill" -- a bill logged by
    mistake (wrong file, wrong period, a present-basis COP accidentally
    mixed into the cumulative series -- see compute_dashboard's own
    present/cumulative split) needs a way back out, the same way a
    project itself can be deleted (project_store.delete_project) or a
    baseline overwritten. Deliberately only removes this one period's
    file -- every other bill, and the baseline itself, are untouched, and
    compute_dashboard() naturally reflects the removal on its next call
    since it always re-reads list_bill_periods() fresh. A no-op (returns
    False), not an error, if the period was never recorded -- same
    "delete is idempotent" convention project_store.delete_project
    already follows.
    """
    path = company_store.project_bill_path(company_id, project_id, period)
    if not path.exists():
        return False
    path.unlink()
    return True


def list_bill_periods(company_id: str, project_id: str) -> list[BillPeriod]:
    """Every recorded bill for this project, ordered by billed_date
    (oldest first) -- NOT by the `period` label's string sort order,
    since period labels are free-text and not guaranteed to sort
    chronologically.

    Post-delivery correction: reported live as "when I upload Sept, Oct,
    Nov present-period bills, the chart plots them out of order" -- root
    cause was that `billed_date` ties (the frontend's "Add a Bill" date
    picker doesn't reset between uploads, so a user who doesn't
    deliberately change it each time ends up logging several bills
    against the exact same billed_date) broke the ordering guarantee
    this function's own docstring promises. `sorted()` is stable, so a
    tie fell back to `bills_dir.glob("*.json")`'s filesystem iteration
    order -- NOT upload order, and not guaranteed to be any particular
    order at all. Every BillPeriod already carries `recorded_at` (an
    ISO server-side timestamp set once, at upload time, in
    bill_from_boq_result/bill_from_cop_result below) that was simply
    never used as a tiebreaker. Sorting by (billed_date, recorded_at)
    keeps billed_date as the primary, user-meaningful ordering key but
    now guarantees "logged in the same order they were uploaded" for any
    bills that happen to share a date, instead of an arbitrary one.
    """
    bills_dir = company_store.project_bills_dir(company_id, project_id)
    if not bills_dir.exists():
        return []
    bills = [BillPeriod.model_validate(json.loads(p.read_text())) for p in bills_dir.glob("*.json")]
    return sorted(bills, key=lambda b: (b.billed_date, b.recorded_at))


# --------------------------------------------------------------------------
# Building a Phase3Baseline / BillPeriod from an already-computed engine result
# --------------------------------------------------------------------------


def baseline_from_boq_result(
    result: BoqCarbonResult,
    project_id: str,
    company_id: str,
    structural_system_type: Optional[str] = None,
    num_floors: Optional[int] = None,
    typology: Optional[str] = None,
    project_name: Optional[str] = None,
) -> Phase3Baseline:
    total_value = result.coverage.total_value if result.coverage else result.total_gwp_kg_co2e  # extremely unlikely fallback -- coverage is always set by calculate_from_boq as of Workstream 07
    return Phase3Baseline(
        project_id=project_id,
        company_id=company_id,
        project_name=project_name,
        source_type="boq",
        source_file=result.source_file,
        recorded_at=datetime.utcnow().isoformat(),
        total_gwp_kg_co2e=result.total_gwp_kg_co2e,
        total_value=total_value,
        floor_area_sqm=result.floor_area_sqm,
        floor_area_basis=result.floor_area_basis,
        structural_system_type=structural_system_type,
        num_floors=num_floors,
        typology=typology,
        coverage=result.coverage,
    )


def baseline_from_wo_result(
    result: WoCarbonResult,
    project_id: str,
    company_id: str,
    structural_system_type: Optional[str] = None,
    num_floors: Optional[int] = None,
    typology: Optional[str] = None,
    project_name: Optional[str] = None,
) -> Phase3Baseline:
    total_value = result.coverage.total_value if result.coverage else result.total_wo_amount
    return Phase3Baseline(
        project_id=project_id,
        company_id=company_id,
        project_name=project_name,
        source_type="wo",
        source_file=result.source_file,
        recorded_at=datetime.utcnow().isoformat(),
        total_gwp_kg_co2e=result.total_gwp_kg_co2e,
        total_value=total_value,
        floor_area_sqm=result.floor_area_sqm,
        floor_area_basis=result.floor_area_basis,
        structural_system_type=structural_system_type,
        num_floors=num_floors,
        typology=typology,
        coverage=result.coverage,
    )


def baseline_from_phase1_estimate(project_id: str, company_id: str) -> Phase3Baseline:
    """Workstream 11: builds a Phase3Baseline from a project's existing
    Phase 1 record instead of an uploaded BOQ/WO -- for a "running
    project without a [real] baseline", i.e. one being tracked before any
    Bill of Quantities exists yet. Deliberately reuses Phase 1's OWN
    calculation functions (calculate_embodied_carbon, estimate_cost) --
    the same ones app/api/calculate.py already calls -- rather than
    inventing a second estimation path; this module's only job is to
    reshape that result into a Phase3Baseline.

    Requires a Phase 1 project to already exist at this exact project_id
    (via POST /form) -- this is intentional: it's what makes a Phase 3
    project's project_id the SAME identifier as its Phase 1 record,
    rather than a second id space the frontend has to keep in sync by
    hand.
    """
    from app.services.calculation_engine import calculate_embodied_carbon
    from app.services.cost_estimation import estimate_cost

    project = project_store.load_project(project_id, company_id=company_id)
    if project is None:
        raise ValueError(
            f"No Phase 1 project record found for '{project_id}' in company '{company_id}' -- "
            f"submit it via POST /form first (Phase 1's tiered estimator), or record a real "
            f"BOQ/WO baseline instead via source_type='boq'/'wo'."
        )
    if project.mandatory.gfa_sqm.value is None:
        raise ValueError(
            f"Project '{project_id}' has no gfa_sqm set yet -- Phase 1's calculation engine needs "
            f"at least a valid GFA before an estimated baseline can be computed."
        )

    carbon_result = calculate_embodied_carbon(project)
    cost_result = estimate_cost(project, carbon_result)

    return Phase3Baseline(
        project_id=project_id,
        company_id=company_id,
        source_type="phase1_estimate",
        source_file=f"phase1-estimate:{project_id}",
        recorded_at=datetime.utcnow().isoformat(),
        total_gwp_kg_co2e=carbon_result.total_carbon_kg,
        total_value=cost_result.total_cost_inr,
        floor_area_sqm=carbon_result.gfa_sqm,
        # Phase 1's GFA isn't classified into Phase 2's net/built-up/
        # carpet taxonomy -- "other" is the honest choice rather than
        # guessing one of the three real bases.
        floor_area_basis="other",
        # structural_system_type was removed from Phase 1's MandatoryFields
        # entirely (see project_schema.py's own comment on MandatoryFields) --
        # a Phase 1 project has no such field to read any more, so this
        # Phase3Baseline is simply recorded without one (the reference-
        # project cataloging feature that still uses a field of this name
        # is a separate, string-only concept unrelated to Phase 1 projects).
        structural_system_type=None,
        # .value here is FieldValue's own wrapper attribute; typology is
        # itself FieldValue[Typology], so a second .value is needed to get
        # the raw string out of the enum member (Typology is a `str, Enum`
        # mixin -- storing the member itself would technically still
        # serialize correctly, but the second .value is explicit and
        # matches every other call site in this module, which always
        # passes a plain str here).
        num_floors=project.tier2.num_floors.value,
        typology=(
            project.tier2.typology.value.value
            if project.tier2.typology.value is not None
            else None
        ),
        is_estimated=True,
        note=(
            "An ESTIMATED baseline from Phase 1's tiered conceptual estimator "
            f"(scope: {carbon_result.scope_note}) -- not a Bill of Quantities, so this total is "
            "narrower in scope and less precise than a real BOQ/WO baseline. Every bill recorded "
            "against this project is still compared only against this baseline's total_value/"
            "total_gwp_kg_co2e, never against another bill. Replace this with a real baseline "
            "(source_type='boq' or 'wo', overwrite=True) once a Bill of Quantities exists."
        ),
    )


def bill_from_boq_result(
    result: BoqCarbonResult,
    project_id: str,
    company_id: str,
    period: str,
    billed_date: str,
    stated_percent_complete: Optional[float] = None,
) -> BillPeriod:
    total_value = result.coverage.total_value if result.coverage else 0.0
    cost_per_kg = (total_value / result.total_gwp_kg_co2e) if result.total_gwp_kg_co2e else None
    return BillPeriod(
        project_id=project_id,
        company_id=company_id,
        period=period,
        billed_date=billed_date,
        source_file=result.source_file,
        recorded_at=datetime.utcnow().isoformat(),
        stated_percent_complete=stated_percent_complete,
        total_gwp_kg_co2e_to_date=result.total_gwp_kg_co2e,
        total_value_to_date=total_value,
        cost_per_kg_co2e_to_date=cost_per_kg,
        coverage=result.coverage,
        n_lines_computed=result.n_lines_computed,
        n_lines_total=result.n_lines_total,
        bill_source="xlsx_boq",
        # Historical gap, not a deliberate difference from
        # bill_from_cop_result() below: BoqCarbonResult.by_category has
        # always had this data available at this call site, it just
        # wasn't being carried onto the stored BillPeriod. Fixed so a
        # per-bill (and, aggregated across bills, per-project/portfolio)
        # material-category breakdown works for Excel-BOQ bills exactly
        # like it already does for Work-Order/COP-PDF bills.
        category_breakdown=[c.model_dump() for c in result.by_category],
    )


def bill_from_cop_result(
    result: CopBillResult,
    project_id: str,
    company_id: str,
    period: str,
    billed_date: str,
    stated_percent_complete: Optional[float] = None,
) -> BillPeriod:
    """"Phase 5": builds a BillPeriod from a parsed Certificate of Payment
    PDF (app.services.phase3_cop_engine.calculate_from_cop_pdf) -- the
    exact same BillPeriod shape and the exact same downstream
    compute_dashboard() every xlsx-sourced bill already goes through.
    Mirrors bill_from_boq_result() above field-for-field; the only real
    difference is that a CopBillResult's `total_value`/`computed_value`
    are already the value figures (COP bills have no boq_carbon.Coverage-
    shaped `.coverage.total_value` distinct from the result's own total --
    CopBillResult.coverage IS the same Coverage model, just built
    directly rather than nested under a separate BoqCarbonResult).
    """
    total_value = result.coverage.total_value if result.coverage else result.total_value
    cost_per_kg = (total_value / result.total_gwp_kg_co2e) if result.total_gwp_kg_co2e else None
    return BillPeriod(
        project_id=project_id,
        company_id=company_id,
        period=period,
        billed_date=billed_date,
        source_file=result.source_file,
        recorded_at=datetime.utcnow().isoformat(),
        stated_percent_complete=stated_percent_complete,
        total_gwp_kg_co2e_to_date=result.total_gwp_kg_co2e,
        total_value_to_date=total_value,
        cost_per_kg_co2e_to_date=cost_per_kg,
        coverage=result.coverage,
        n_lines_computed=result.n_lines_computed,
        n_lines_total=result.n_lines_total,
        bill_source="pdf_cop",
        category_breakdown=[c.model_dump() for c in result.by_category],
        quantity_basis=result.quantity_basis,
    )


# --------------------------------------------------------------------------
# The dashboard's "typical building" comparison line -- reuses benchmark.py
# --------------------------------------------------------------------------


def _typical_building_carbon_per_sqm(
    floor_area_sqm: float,
    structural_system_type: Optional[str],
    num_floors: Optional[int],
    typology: Optional[str],
) -> tuple[float, str]:
    """Returns (typical_carbon_per_sqm, floor_band_used) by reusing
    benchmark.py's own synthetic "typical building" construction --
    build_baseline_project() + calculate_embodied_carbon() -- the exact
    same functions Phase 1's /substitute and /calculate endpoints already
    run. Not a second benchmarking concept: a genuinely minimal
    ProjectSchema is built here purely as the INPUT geometry
    build_baseline_project() needs (it forces its own typical material
    choices regardless of what this input project's tier3 fields say, so
    those are never set).
    """
    from app.schemas.project_schema import FieldValue, ProjectSchema
    from app.services.benchmark import _get_floor_band, build_baseline_project
    from app.services.calculation_engine import calculate_embodied_carbon

    geometry = ProjectSchema(project_id="phase3-benchmark-geometry")
    geometry.mandatory.gfa_sqm = FieldValue(value=floor_area_sqm, source="user-entered", confidence=1.0)
    # structural_system_type was removed from Phase 1's MandatoryFields
    # entirely (see project_schema.py's own comment on MandatoryFields) --
    # there's no field left to set it on, and the docstring above already
    # notes build_baseline_project() forces its own typical choices
    # regardless, so the parameter is accepted (callers still pass a
    # project's recorded structural_system_type, a separate string-only
    # concept) but has nothing to feed into this synthetic geometry.
    if num_floors is not None:
        geometry.tier2.num_floors = FieldValue(value=num_floors, source="user-entered", confidence=1.0)
    if typology:
        geometry.tier2.typology = FieldValue(value=typology, source="user-entered", confidence=1.0)

    baseline_project = build_baseline_project(geometry)
    baseline_result = calculate_embodied_carbon(baseline_project)
    floor_band = _get_floor_band(num_floors)
    return baseline_result.carbon_per_sqm, floor_band


def get_typical_building_carbon_per_sqm(
    floor_area_sqm: float,
    structural_system_type: Optional[str],
    num_floors: Optional[int],
    typology: Optional[str],
) -> tuple[float, str]:
    """Public wrapper around _typical_building_carbon_per_sqm above, for
    callers outside this module. Workstream 15 (chatbot.py's query-tool
    fallback for a project with a Phase 3 baseline but no Phase 1 record)
    needs this exact synthetic-geometry benchmark, and this codebase's own
    convention (see chatbot.py's _clone_project docstring) is a public
    wrapper rather than reaching into another module's underscore-prefixed
    helper directly -- keeps the two modules decoupled the same way."""
    return _typical_building_carbon_per_sqm(floor_area_sqm, structural_system_type, num_floors, typology)


# --------------------------------------------------------------------------
# The dashboard itself
# --------------------------------------------------------------------------


def compute_dashboard(company_id: str, project_id: str) -> DashboardResult:
    baseline = load_baseline(company_id, project_id)
    if baseline is None:
        raise ValueError(
            f"No Phase 3 baseline recorded for project '{project_id}' (company '{company_id}') -- "
            f"record one first via POST /phase3/projects/{{project_id}}/baseline before uploading bills "
            f"or requesting a dashboard."
        )

    bills = list_bill_periods(company_id, project_id)
    notes: list[str] = []

    if baseline.is_estimated:
        notes.append(
            "This project's baseline is an ESTIMATED figure from Phase 1's conceptual estimator, "
            "not a real Bill of Quantities -- treat percent-complete, the projected total, and the "
            "benchmark comparison below as correspondingly rougher until a real BOQ/WO baseline "
            "replaces it (POST the baseline again with source_type='boq' or 'wo' and overwrite=True)."
        )

    points = [
        DashboardPoint(
            period=b.period,
            billed_date=b.billed_date,
            total_gwp_kg_co2e_to_date=b.total_gwp_kg_co2e_to_date,
            total_value_to_date=b.total_value_to_date,
            cost_per_kg_co2e_to_date=b.cost_per_kg_co2e_to_date,
            stated_percent_complete=b.stated_percent_complete,
            quantity_basis=b.quantity_basis,
        )
        for b in bills
    ]

    result = DashboardResult(
        project_id=project_id,
        company_id=company_id,
        baseline=baseline,
        points=points,
        has_bills=bool(bills),
    )

    if not bills:
        notes.append("No bills recorded yet -- upload at least one via POST /phase3/projects/{project_id}/bills to see running carbon.")
        result.notes = notes
        return result

    # bills is already sorted oldest-first (see list_bill_periods), so
    # the last element is the single most recent upload regardless of
    # its quantity_basis -- set before the cumulative-only early return
    # below so a project tracked only (or most recently) via present-
    # basis bills still reports its latest activity here.
    most_recent_bill = bills[-1]
    result.latest_bill_period = most_recent_bill.period
    result.latest_bill_quantity_basis = most_recent_bill.quantity_basis or "cummulative"
    result.latest_bill_gwp_kg_co2e = most_recent_bill.total_gwp_kg_co2e_to_date

    # A 'present'-basis bill (see phase3_cop_engine.py's quantity_basis)
    # reports only ITS OWN billing period's quantities, not a running
    # total -- so it must never be picked as "the current state of the
    # project" the way a cumulative-basis bill can be. Mixing the two
    # into one running-total series would make the chart's "Billed
    # cumulative" line drop every time a present-basis bill lands after a
    # cumulative one (its much-smaller period-only figure gets read as
    # the new to-date total), and would corrupt percent-complete/the
    # projected total the same way (both are derived from "the latest
    # bill", which assumes that bill IS a to-date figure). A bill with no
    # quantity_basis recorded (an xlsx_boq bill, or any bill saved before
    # this option existed) was always cumulative by construction, so it
    # counts as cumulative here too.
    cumulative_bills = [b for b in bills if b.quantity_basis != "present"]
    present_only_bills = [b for b in bills if b.quantity_basis == "present"]

    if present_only_bills:
        notes.append(
            f"{len(present_only_bills)} bill(s) recorded with quantity_basis='present' (this "
            "billing period's quantities only, not a running total) -- excluded from the "
            "running-total chart, percent-complete, and the projected total below, which only "
            "ever advance from cumulative-basis bills. Present-basis bills still appear in the "
            "full bill history (list_bill_periods / GET .../bills)."
        )

    if not cumulative_bills:
        notes.append(
            "No cumulative-basis bill recorded yet -- percent-complete and the projected total "
            "need at least one 'Cumulative to date' bill to compute; a 'Present period only' "
            "bill alone isn't a running total and can't seed them."
        )
        result.notes = notes
        return result

    latest = cumulative_bills[-1]  # cumulative-to-date semantics -- the most recent CUMULATIVE-BASIS bill IS the current state, never a present-only one, and never summed with earlier ones
    result.latest_period = latest.period
    result.billed_to_date_gwp_kg_co2e = latest.total_gwp_kg_co2e_to_date
    result.billed_to_date_value = latest.total_value_to_date
    result.cost_per_kg_co2e_to_date = latest.cost_per_kg_co2e_to_date

    if latest.stated_percent_complete is not None:
        percent_complete = latest.stated_percent_complete
        percent_source = "stated_by_latest_bill"
    elif baseline.total_value:
        percent_complete = min(latest.total_value_to_date / baseline.total_value * 100, 999.0)  # capped display-wise, not silently clamped to 100 -- billing ahead of the original scope estimate is real, useful information
        percent_source = "derived_from_billed_value_vs_baseline_value"
    else:
        percent_complete = None
        percent_source = None
        notes.append("Baseline has no total_value to derive percent-complete from, and no bill has stated one -- projection cannot be computed.")

    result.percent_complete = percent_complete
    result.percent_complete_source = percent_source

    if percent_complete and percent_complete > 0:
        projected_total = latest.total_gwp_kg_co2e_to_date / (percent_complete / 100)
        result.projected_total_gwp_kg_co2e = projected_total
        if baseline.total_gwp_kg_co2e:
            result.projected_vs_baseline_pct = round(
                (projected_total - baseline.total_gwp_kg_co2e) / baseline.total_gwp_kg_co2e * 100, 2
            )
    else:
        notes.append("percent_complete is zero or unavailable -- cannot extrapolate a projected total yet.")

    if baseline.floor_area_sqm and result.projected_total_gwp_kg_co2e:
        try:
            typical_per_sqm, floor_band = _typical_building_carbon_per_sqm(
                baseline.floor_area_sqm,
                baseline.structural_system_type,
                baseline.num_floors,
                baseline.typology,
            )
            projected_per_sqm = result.projected_total_gwp_kg_co2e / baseline.floor_area_sqm
            result.benchmark_available = True
            result.typical_carbon_per_sqm = typical_per_sqm
            result.projected_carbon_per_sqm = projected_per_sqm
            result.pct_difference_from_typical = (
                round((projected_per_sqm - typical_per_sqm) / typical_per_sqm * 100, 2) if typical_per_sqm else None
            )
            result.benchmark_floor_band_used = floor_band
        except ValueError as e:
            notes.append(f"Benchmark comparison unavailable: {e}")
    elif not baseline.floor_area_sqm:
        notes.append("Baseline has no floor_area_sqm recorded -- the typical-building benchmark comparison isn't available for this project.")

    result.notes = notes
    return result