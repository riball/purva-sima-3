"""Workstream 14: Phase 4 -- confirm, recalculate, audit.

Builds exactly the shape the roadmap's own "Phase 4 design sketch"
specified, and nothing more:

  1. Recommendation object. Whatever proposes a change -- for this pass,
     the substitution catalog Workstream 08 already built (the same one
     app/api/boq_carbon_substitute.py exposes for a one-off, stateless
     Phase 2 calculation) -- produces one common shape: source, the
     proposed change, and an ALREADY-COMPUTED delta. That delta is never
     estimated here: propose_recommendation() below calls straight into
     app.services.boq_carbon.substitution_engine's own real-recompute
     helpers (_lines_affected_by, _recompute_line_at_substitute) -- the
     exact functions the stateless Phase 2 substitution endpoint uses --
     rather than inventing a second calculation path. "No new
     calculation logic, just a new state to feed the old functions" is
     the roadmap's own phrase for this, and it's followed literally.

  2. A mutable overlay, not a second BOQ format. A confirmed
     recommendation is applied to the CURRENT state of the project's
     line items (app.services.phase3.load_source_result /
     save_source_result -- see that module's docstring for why this is
     a separate, mutable file from the immutable phase3_baseline.json)
     using the identical per-line blend math substitution_engine.py's
     apply_substitution() already uses for its aggregate SubstitutionResult.
     The difference here is that _apply_overlay_to_result() below carries
     that math through to every affected LINE ITEM, not just the total,
     so the result can be persisted as a new state rather than reported
     once and discarded.

  3. Audit trail by construction. Every CONFIRMED change appends one
     entry to phase4_audit_log.json -- source, timestamp, before/after
     totals -- and that file is only ever appended to, never rewritten.
     A rejected recommendation writes nothing there, because nothing
     about the project's numbers changed.

Deliberate scope cuts, disclosed rather than silently assumed:

  - BOQ-sourced baselines only. A WO-sourced baseline has no persisted
    source result yet (app/api/phase3.py's record_baseline only calls
    save_source_result on the 'boq' path) -- WoCarbonResult's line-item
    shape (WoLineItemResult) isn't what substitution_engine.py's catalog
    matching was built against, and extending it is real work, not a
    small addition. propose_recommendation() raises a clear ValueError
    for a WO-sourced or phase1_estimate-sourced project rather than
    silently doing nothing.
  - Carbon only, not cost. A confirmed overlay updates gwp_kg_co2e,
    total_gwp_kg_co2e, and by_category -- it does NOT re-estimate
    total_value/rate/amount for the substituted material, since that's a
    real new pricing lookup this workstream doesn't build. Cost stays as
    originally priced; only the carbon accounting reflects the change.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

from app.services import company_store, phase3
from app.services.boq_carbon import substitution_engine
from app.services.boq_carbon.engine import BoqCarbonResult, CategoryTotal, SQM_TO_SQFT
from app.services.supplier_catalog import get_entry as get_substitution

RecommendationSource = Literal["substitution_catalog"]
# "confirmed_as_beta" (added alongside confirm_recommendation_as_beta_twin()
# below): distinct from "confirmed" on purpose -- a plain "confirmed"
# recommendation overwrote THIS project's own current state
# (confirm_recommendation(), unchanged, still does exactly that); a
# "confirmed_as_beta" one never touched this project at all, it only
# forked a new one (see beta_project_id below). Collapsing both into one
# "confirmed" status would make a Beta-forked recommendation look like
# it mutated the project it's still attached to, when it didn't.
RecommendationStatus = Literal["pending", "confirmed", "rejected", "confirmed_as_beta"]


class Recommendation(BaseModel):
    id: str
    project_id: str
    company_id: str
    source: RecommendationSource
    substitution_id: str
    label: str
    user_pct: float
    description: str
    reasoning: str
    requires_engineering_review: bool
    affected_line_item_count: int
    carbon_kg_before: float
    carbon_kg_after: float
    delta_kg: float
    delta_pct: float
    status: RecommendationStatus
    created_at: str
    decided_at: Optional[str] = None
    # Set only when status == "confirmed_as_beta" -- the new project this
    # recommendation was forked into, so the UI can render "-> View Beta
    # Project" instead of looking un-actioned.
    beta_project_id: Optional[str] = None


class AuditLogEntry(BaseModel):
    id: str
    recommendation_id: str
    source: RecommendationSource
    substitution_id: str
    label: str
    user_pct: float
    description: str
    total_gwp_kg_co2e_before: float
    total_gwp_kg_co2e_after: float
    delta_kg: float
    delta_pct: float
    confirmed_at: str


class ConfirmResult(BaseModel):
    recommendation: Recommendation
    audit_entry: AuditLogEntry
    project_total_gwp_kg_co2e_before: float
    project_total_gwp_kg_co2e_after: float


class BetaForkResult(BaseModel):
    """Returned by confirm_recommendation_as_beta_twin() below -- no
    audit_entry (unlike ConfirmResult), because the source project's own
    audit log is never touched by a Beta fork (see that function's own
    docstring for why)."""

    recommendation: Recommendation
    new_project_id: str
    new_project_name: str
    new_project_total_gwp_kg_co2e: float


class CurrentStateSummary(BaseModel):
    project_id: str
    company_id: str
    baseline_total_gwp_kg_co2e: float
    current_total_gwp_kg_co2e: float
    total_delta_kg: float
    total_delta_pct: float
    confirmed_change_count: int
    pending_recommendation_count: int


# ---------------------------------------------------------------------------
# The real-recompute overlay -- reuses substitution_engine.py's own
# per-line math, carried through to every affected line item instead of
# just the aggregate.
# ---------------------------------------------------------------------------


def _apply_overlay_to_result(entry: dict, user_pct: float, result: BoqCarbonResult) -> BoqCarbonResult:
    matched_rows = {li.row for li in substitution_engine._lines_affected_by(entry, result)}
    frac = max(user_pct, 0.0) / 100.0

    new_line_items = []
    for li in result.line_items:
        if li.row not in matched_rows or li.gwp_kg_co2e is None:
            new_line_items.append(li)
            continue
        substitute_gwp = substitution_engine._recompute_line_at_substitute(entry, li)
        if substitute_gwp is None:
            # Same fallback substitution_engine.apply_substitution() uses:
            # this line's unit isn't one the substitute material's own
            # conversion path handles -- keep it at its original value
            # rather than silently zeroing it out.
            new_line_items.append(li)
            continue
        blended = li.gwp_kg_co2e * (1 - frac) + substitute_gwp * frac
        new_line_items.append(li.model_copy(update={"gwp_kg_co2e": blended}))

    new_total = sum(li.gwp_kg_co2e for li in new_line_items if li.gwp_kg_co2e is not None)

    by_cat: dict[str, list] = {}
    for li in new_line_items:
        if li.category is None or li.gwp_kg_co2e is None:
            continue
        by_cat.setdefault(li.category, []).append(li)
    new_by_category = [
        CategoryTotal(
            category=cat,
            gwp_kg_co2e=sum(x.gwp_kg_co2e for x in items),
            line_item_count=len(items),
            pct_of_total=(sum(x.gwp_kg_co2e for x in items) / new_total * 100) if new_total else 0.0,
        )
        for cat, items in sorted(by_cat.items())
    ]

    return result.model_copy(
        update={
            "line_items": new_line_items,
            "total_gwp_kg_co2e": new_total,
            "total_gwp_tonnes_co2e": new_total / 1000.0,
            "by_category": new_by_category,
            "gwp_per_sqm": (new_total / result.floor_area_sqm) if result.floor_area_sqm else None,
            "gwp_per_sqft": (new_total / result.floor_area_sqm / SQM_TO_SQFT) if result.floor_area_sqm else None,
        }
    )


def _load_current_state(company_id: str, project_id: str) -> BoqCarbonResult:
    current = phase3.load_source_result(company_id, project_id)
    if current is None:
        baseline = phase3.load_baseline(company_id, project_id)
        if baseline is None:
            raise ValueError(f"Project '{project_id}' has no Phase 3 baseline recorded yet.")
        if baseline.source_type != "boq":
            raise ValueError(
                f"Project '{project_id}'s baseline is source_type='{baseline.source_type}' -- Phase 4's "
                "confirm/recalculate/audit flow only supports BOQ-sourced baselines in this pass (see "
                "phase4.py's module docstring). Record a BOQ-sourced baseline (overwrite=True) to use it."
            )
        raise ValueError(f"No structured source result found for project '{project_id}' -- record its baseline again to populate one.")
    return current


# ---------------------------------------------------------------------------
# Recommendations -- storage
# ---------------------------------------------------------------------------


def _load_recommendations(company_id: str, project_id: str) -> list[Recommendation]:
    path = company_store.phase4_recommendations_path(company_id, project_id)
    if not path.exists():
        return []
    return [Recommendation.model_validate(r) for r in json.loads(path.read_text())]


def _save_recommendations(company_id: str, project_id: str, recs: list[Recommendation]) -> None:
    # Atomic write-then-rename -- see company_store.atomic_write_json's
    # docstring. A plain write_text() here left a window where a
    # concurrent GET (e.g. the recommendations list re-polling while a
    # confirm is in flight) could observe a truncated/empty file mid-write
    # and crash with a JSONDecodeError -- caught live by a concurrency
    # stress test against this app's other JSON stores.
    path = company_store.phase4_recommendations_path(company_id, project_id)
    company_store.atomic_write_json(path, [r.model_dump(mode="json") for r in recs])


def list_recommendations(company_id: str, project_id: str, status: Optional[RecommendationStatus] = None) -> list[Recommendation]:
    recs = _load_recommendations(company_id, project_id)
    if status is not None:
        recs = [r for r in recs if r.status == status]
    return recs


def get_recommendation(company_id: str, project_id: str, recommendation_id: str) -> Optional[Recommendation]:
    for r in _load_recommendations(company_id, project_id):
        if r.id == recommendation_id:
            return r
    return None


# ---------------------------------------------------------------------------
# Audit log -- append-only storage
# ---------------------------------------------------------------------------


def _load_audit_log(company_id: str, project_id: str) -> list[AuditLogEntry]:
    path = company_store.phase4_audit_log_path(company_id, project_id)
    if not path.exists():
        return []
    return [AuditLogEntry.model_validate(e) for e in json.loads(path.read_text())]


def _append_audit_entry(company_id: str, project_id: str, entry: AuditLogEntry) -> None:
    log = _load_audit_log(company_id, project_id)
    log.append(entry)  # append-only, by construction -- nothing in this module ever rewrites or removes an entry
    # Atomic write-then-rename -- see company_store.atomic_write_json's
    # docstring. This log is read-modify-written on every confirm, so a
    # plain write_text() left the same truncated-file race the stress
    # test reproduced elsewhere in this app.
    path = company_store.phase4_audit_log_path(company_id, project_id)
    company_store.atomic_write_json(path, [e.model_dump(mode="json") for e in log])


def list_audit_log(company_id: str, project_id: str) -> list[AuditLogEntry]:
    return _load_audit_log(company_id, project_id)


# ---------------------------------------------------------------------------
# Propose / confirm / reject
# ---------------------------------------------------------------------------


def propose_recommendation(company_id: str, project_id: str, substitution_id: str, user_pct: float) -> Recommendation:
    entry = get_substitution(substitution_id)
    if entry is None:
        raise ValueError(f"Unknown substitution_id '{substitution_id}'")

    current = _load_current_state(company_id, project_id)
    result = substitution_engine.apply_substitution(entry, user_pct, current)

    rec = Recommendation(
        id=str(uuid.uuid4()),
        project_id=project_id,
        company_id=company_id,
        source="substitution_catalog",
        substitution_id=substitution_id,
        label=result.label,
        user_pct=user_pct,
        description=f"{result.label} at {user_pct:g}% ({result.affected_line_item_count} affected line item{'s' if result.affected_line_item_count != 1 else ''})",
        reasoning=result.reasoning,
        requires_engineering_review=result.requires_engineering_review,
        affected_line_item_count=result.affected_line_item_count,
        carbon_kg_before=result.original_gwp_kg_co2e,
        carbon_kg_after=result.new_gwp_kg_co2e,
        delta_kg=result.savings_kg_co2e,
        delta_pct=result.savings_pct_of_affected_lines,
        status="pending",
        created_at=datetime.utcnow().isoformat(),
    )

    recs = _load_recommendations(company_id, project_id)
    recs.append(rec)
    _save_recommendations(company_id, project_id, recs)
    return rec


def confirm_recommendation(company_id: str, project_id: str, recommendation_id: str) -> ConfirmResult:
    recs = _load_recommendations(company_id, project_id)
    rec = next((r for r in recs if r.id == recommendation_id), None)
    if rec is None:
        raise ValueError(f"No recommendation '{recommendation_id}' found for project '{project_id}'")
    if rec.status != "pending":
        raise ValueError(f"Recommendation '{recommendation_id}' is already '{rec.status}' -- only a pending recommendation can be confirmed.")

    entry = get_substitution(rec.substitution_id)
    if entry is None:
        raise ValueError(f"Unknown substitution_id '{rec.substitution_id}' -- the catalog entry this recommendation referenced no longer exists.")

    current = _load_current_state(company_id, project_id)
    before_total = current.total_gwp_kg_co2e
    new_result = _apply_overlay_to_result(entry, rec.user_pct, current)
    after_total = new_result.total_gwp_kg_co2e

    phase3.save_source_result(company_id, project_id, new_result)

    now = datetime.utcnow().isoformat()
    rec.status = "confirmed"
    rec.decided_at = now
    _save_recommendations(company_id, project_id, recs)

    audit_entry = AuditLogEntry(
        id=str(uuid.uuid4()),
        recommendation_id=rec.id,
        source=rec.source,
        substitution_id=rec.substitution_id,
        label=rec.label,
        user_pct=rec.user_pct,
        description=rec.description,
        total_gwp_kg_co2e_before=before_total,
        total_gwp_kg_co2e_after=after_total,
        delta_kg=before_total - after_total,
        delta_pct=((before_total - after_total) / before_total * 100) if before_total else 0.0,
        confirmed_at=now,
    )
    _append_audit_entry(company_id, project_id, audit_entry)

    return ConfirmResult(
        recommendation=rec,
        audit_entry=audit_entry,
        project_total_gwp_kg_co2e_before=before_total,
        project_total_gwp_kg_co2e_after=after_total,
    )


def confirm_recommendation_as_beta_twin(company_id: str, project_id: str, recommendation_id: str) -> BetaForkResult:
    """The user-facing "Confirm Change" action in the Project Dashboard's
    Material Alternatives (Beta) section -- deliberately NOT a variant of
    confirm_recommendation() above, which is left completely untouched
    (still does its original in-place overwrite, in case anything else
    ever depends on it) and is simply no longer called by that UI.

    Instead of overwriting this project's own current state, this forks
    a brand-new sibling project carrying the substituted figures, and
    NEVER writes to this project's save_source_result or audit log --
    the source project is byte-for-byte unaffected by confirming a Beta
    change. The new project is a real project in every other respect
    (own baseline, own bills, openable/findable like any other); it's
    only grouped separately in the Directory via
    project_registry.mark_as_beta_twin()'s is_beta_twin flag.

    The new project's bill history is copied from the source project
    unchanged, except the LATEST bill's carbon figures (never its period/
    billed_date/value -- cost is deliberately untouched, see this
    module's own "carbon only, not cost" scope-cut note) are overwritten
    with the substituted total, so the twin's own dashboard/chart render
    exactly like any other project's, just ending on the substituted
    figure. A source project with no bills yet gets one synthetic bill
    instead, dated today, so the twin's Directory card has something to
    show.
    """
    from app.services import project_registry  # lazy import, same reason project_registry.py itself lazily imports phase3/project_store

    recs = _load_recommendations(company_id, project_id)
    rec = next((r for r in recs if r.id == recommendation_id), None)
    if rec is None:
        raise ValueError(f"No recommendation '{recommendation_id}' found for project '{project_id}'")
    if rec.status != "pending":
        raise ValueError(f"Recommendation '{recommendation_id}' is already '{rec.status}' -- only a pending recommendation can be confirmed.")

    entry = get_substitution(rec.substitution_id)
    if entry is None:
        raise ValueError(f"Unknown substitution_id '{rec.substitution_id}' -- the catalog entry this recommendation referenced no longer exists.")

    current = _load_current_state(company_id, project_id)
    new_result = _apply_overlay_to_result(entry, rec.user_pct, current)

    baseline = phase3.load_baseline(company_id, project_id)
    if baseline is None:
        # _load_current_state() above would already have raised if this
        # were missing -- defensive only, never expected to trigger.
        raise ValueError(f"Project '{project_id}' has no Phase 3 baseline recorded yet.")

    source_name = project_registry.get_project_name(company_id, project_id) or project_id
    new_project_id = f"{project_id}-beta-{uuid.uuid4().hex[:8]}"
    new_project_name = f"{source_name} — Material Change Projects (Beta)"
    now = datetime.utcnow().isoformat()

    new_baseline = baseline.model_copy(update={"project_id": new_project_id, "project_name": new_project_name})
    phase3.save_baseline(new_baseline)  # self-registers new_project_name via its own register_project() hook

    bills = phase3.list_bill_periods(company_id, project_id)
    new_category_breakdown = [c.model_dump() for c in new_result.by_category]
    if bills:
        for b in bills[:-1]:
            phase3.save_bill_period(b.model_copy(update={"project_id": new_project_id}), overwrite=True)
        latest = bills[-1]
        cost_per_kg = (latest.total_value_to_date / new_result.total_gwp_kg_co2e) if new_result.total_gwp_kg_co2e else None
        twin_latest = latest.model_copy(update={
            "project_id": new_project_id,
            "total_gwp_kg_co2e_to_date": new_result.total_gwp_kg_co2e,
            "category_breakdown": new_category_breakdown,
            "cost_per_kg_co2e_to_date": cost_per_kg,
            "recorded_at": now,
        })
        phase3.save_bill_period(twin_latest, overwrite=True)
    else:
        total_value = new_result.coverage.total_value if new_result.coverage else 0.0
        cost_per_kg = (total_value / new_result.total_gwp_kg_co2e) if new_result.total_gwp_kg_co2e else None
        synthetic_bill = phase3.BillPeriod(
            project_id=new_project_id,
            company_id=company_id,
            period="Beta Scenario",
            billed_date=now[:10],
            source_file=f"Material substitution scenario: {rec.label}",
            recorded_at=now,
            stated_percent_complete=100.0,
            total_gwp_kg_co2e_to_date=new_result.total_gwp_kg_co2e,
            total_value_to_date=total_value,
            cost_per_kg_co2e_to_date=cost_per_kg,
            coverage=new_result.coverage,
            n_lines_computed=new_result.n_lines_computed,
            n_lines_total=new_result.n_lines_total,
            bill_source=None,
            category_breakdown=new_category_breakdown,
        )
        phase3.save_bill_period(synthetic_bill, overwrite=True)

    # The twin's own source_result, so reopening ITS Alternatives section
    # later has a correct current-state baseline to compare further
    # scenarios against -- same reason record_baseline() saves one for
    # every new BOQ-sourced project.
    phase3.save_source_result(company_id, new_project_id, new_result)

    # Copy archetype/construction_stage/location from the source project
    # (purely descriptive metadata, same fields Portfolio Overview's
    # profile editor sets) so the twin's Directory card isn't blank.
    source_profile = next(
        (p for p in project_registry.list_named_projects(company_id) if p["project_id"] == project_id), None
    )
    if source_profile is not None:
        project_registry.set_project_profile(
            company_id, new_project_id,
            archetype=source_profile.get("archetype"),
            construction_stage=source_profile.get("construction_stage"),
            location=source_profile.get("location"),
        )
    project_registry.mark_as_beta_twin(company_id, new_project_id, source_project_id=project_id)

    rec.status = "confirmed_as_beta"
    rec.decided_at = now
    rec.beta_project_id = new_project_id
    _save_recommendations(company_id, project_id, recs)

    return BetaForkResult(
        recommendation=rec,
        new_project_id=new_project_id,
        new_project_name=new_project_name,
        new_project_total_gwp_kg_co2e=new_result.total_gwp_kg_co2e,
    )


def reject_recommendation(company_id: str, project_id: str, recommendation_id: str) -> Recommendation:
    recs = _load_recommendations(company_id, project_id)
    rec = next((r for r in recs if r.id == recommendation_id), None)
    if rec is None:
        raise ValueError(f"No recommendation '{recommendation_id}' found for project '{project_id}'")
    if rec.status != "pending":
        raise ValueError(f"Recommendation '{recommendation_id}' is already '{rec.status}' -- only a pending recommendation can be rejected.")
    rec.status = "rejected"
    rec.decided_at = datetime.utcnow().isoformat()
    _save_recommendations(company_id, project_id, recs)
    return rec


def get_current_state_summary(company_id: str, project_id: str) -> CurrentStateSummary:
    baseline = phase3.load_baseline(company_id, project_id)
    if baseline is None:
        raise ValueError(f"Project '{project_id}' has no Phase 3 baseline recorded yet.")
    current = phase3.load_source_result(company_id, project_id)
    current_total = current.total_gwp_kg_co2e if current is not None else baseline.total_gwp_kg_co2e

    recs = _load_recommendations(company_id, project_id)
    return CurrentStateSummary(
        project_id=project_id,
        company_id=company_id,
        baseline_total_gwp_kg_co2e=baseline.total_gwp_kg_co2e,
        current_total_gwp_kg_co2e=current_total,
        total_delta_kg=baseline.total_gwp_kg_co2e - current_total,
        total_delta_pct=((baseline.total_gwp_kg_co2e - current_total) / baseline.total_gwp_kg_co2e * 100) if baseline.total_gwp_kg_co2e else 0.0,
        confirmed_change_count=sum(1 for r in recs if r.status == "confirmed"),
        pending_recommendation_count=sum(1 for r in recs if r.status == "pending"),
    )