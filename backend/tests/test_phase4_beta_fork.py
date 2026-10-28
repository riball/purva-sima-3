"""Tests for confirm_recommendation_as_beta_twin() (app/services/phase4.py)
-- the "Confirm Change" action in the Project Dashboard's Material
Alternatives (Beta) section forks a new sibling project instead of
overwriting the source project's own current state (the behavior
confirm_recommendation() still has, unchanged, for anything else that
calls it). See that function's own docstring for the full design.

These tests are about the FORK ARCHITECTURE -- byte-for-byte source
project isolation, bill-history copy-with-latest-overwritten, the
no-bills synthetic-bill fallback, registry flags, and recommendation
status -- not about substitution-matching chemistry (that's
tests/test_substitution.py's job). A substitution_id that matches zero
line items in a fixture's empty line_items=[] is a perfectly valid,
still-meaningful case here: the fork mechanics must work correctly even
when the substitution itself has no effect.

Isolated the same way tests/test_chatbot.py and tests/test_phase3.py
already establish: company_store.COMPANIES_DIR redirected to a pytest
tmp_path, and the same _baseline()/_boq_source_result() fixture-builder
pattern test_chatbot.py already uses.
"""

from __future__ import annotations

import pytest

from app.services import company_store, phase3, phase4, project_registry
from app.services.boq_carbon.engine import BoqCarbonResult, CategoryTotal

COMPANY = "provident"
PROJECT = "boq-proj"


@pytest.fixture(autouse=True)
def isolated_company_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(company_store, "COMPANIES_DIR", tmp_path / "companies")
    yield


def _baseline(project_id=PROJECT, company_id=COMPANY, total_gwp=200_000.0, total_value=20_000_000.0):
    b = phase3.Phase3Baseline(
        project_id=project_id,
        company_id=company_id,
        source_type="boq",
        source_file="test.xlsx",
        recorded_at="2026-01-01T00:00:00",
        total_gwp_kg_co2e=total_gwp,
        total_value=total_value,
        floor_area_sqm=40_000.0,
        structural_system_type="rcc_frame",
        num_floors=20,
        typology="residential",
        is_estimated=False,
        project_name="Test Tower",
    )
    phase3.save_baseline(b)
    return b


def _boq_source_result(project_id=PROJECT, company_id=COMPANY, total_gwp=200_000.0):
    categories = [
        CategoryTotal(category="rcc", gwp_kg_co2e=120_000.0, line_item_count=50, pct_of_total=60.0),
        CategoryTotal(category="reinforcement_steel", gwp_kg_co2e=60_000.0, line_item_count=20, pct_of_total=30.0),
        CategoryTotal(category="brickwork", gwp_kg_co2e=20_000.0, line_item_count=10, pct_of_total=10.0),
    ]
    result = BoqCarbonResult(
        source_file="test_boq.xlsx",
        sheet_name="Sheet1",
        n_lines_total=80,
        n_lines_classified=80,
        n_lines_computed=80,
        total_gwp_kg_co2e=total_gwp,
        total_gwp_tonnes_co2e=total_gwp / 1000,
        by_category=categories,
        floor_area_sqm=40_000.0,
        line_items=[],
    )
    phase3.save_source_result(company_id, project_id, result)
    return result


def _bill(period, billed_date, total_gwp, total_value, project_id=PROJECT, company_id=COMPANY):
    bill = phase3.BillPeriod(
        project_id=project_id,
        company_id=company_id,
        period=period,
        billed_date=billed_date,
        source_file="bill.xlsx",
        recorded_at="2026-01-01T00:00:00",
        total_gwp_kg_co2e_to_date=total_gwp,
        total_value_to_date=total_value,
        n_lines_computed=10,
        n_lines_total=10,
        bill_source="xlsx_boq",
    )
    phase3.save_bill_period(bill)
    return bill


def _propose(project_id=PROJECT, company_id=COMPANY, substitution_id="opc_to_ppc", user_pct=50.0):
    return phase4.propose_recommendation(company_id, project_id, substitution_id, user_pct)


# --------------------------------------------------------------------------
# Source-project isolation -- the core guarantee
# --------------------------------------------------------------------------


def test_source_project_source_result_untouched_by_a_beta_confirm():
    _baseline()
    before = _boq_source_result()
    rec = _propose()

    phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)

    after = phase3.load_source_result(COMPANY, PROJECT)
    assert after.model_dump(mode="json") == before.model_dump(mode="json")


def test_source_project_bills_untouched_by_a_beta_confirm():
    _baseline()
    _boq_source_result()
    _bill("2026-Q1", "2026-01-15", 50_000.0, 5_000_000.0)
    _bill("2026-Q2", "2026-04-15", 90_000.0, 9_000_000.0)
    before = [b.model_dump(mode="json") for b in phase3.list_bill_periods(COMPANY, PROJECT)]
    rec = _propose()

    phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)

    after = [b.model_dump(mode="json") for b in phase3.list_bill_periods(COMPANY, PROJECT)]
    assert after == before


def test_source_project_has_no_audit_log_entry_from_a_beta_confirm():
    _baseline()
    _boq_source_result()
    rec = _propose()

    phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)

    assert phase4.list_audit_log(COMPANY, PROJECT) == []


# --------------------------------------------------------------------------
# The twin project itself
# --------------------------------------------------------------------------


def test_twin_project_created_with_substituted_total_and_registry_flags():
    _baseline()
    _boq_source_result(total_gwp=200_000.0)
    _bill("2026-Q1", "2026-01-15", 50_000.0, 5_000_000.0)
    _bill("2026-Q2", "2026-04-15", 90_000.0, 9_000_000.0)
    rec = _propose()

    result = phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)

    assert result.new_project_id != PROJECT
    assert result.new_project_id.startswith(PROJECT)
    assert "Beta" in result.new_project_name

    twin_bills = phase3.list_bill_periods(COMPANY, result.new_project_id)
    assert len(twin_bills) == 2
    # Earlier bill copied unchanged (only project_id differs).
    assert twin_bills[0].period == "2026-Q1"
    assert twin_bills[0].total_gwp_kg_co2e_to_date == 50_000.0
    # Latest bill's carbon figures are the substituted total; its
    # period/billed_date/value are untouched (carbon only, not cost).
    assert twin_bills[1].period == "2026-Q2"
    assert twin_bills[1].billed_date == "2026-04-15"
    assert twin_bills[1].total_value_to_date == 9_000_000.0
    assert twin_bills[1].total_gwp_kg_co2e_to_date == pytest.approx(result.new_project_total_gwp_kg_co2e)

    named = {p["project_id"]: p for p in project_registry.list_named_projects(COMPANY)}
    assert named[result.new_project_id]["is_beta_twin"] is True
    assert named[result.new_project_id]["beta_source_project_id"] == PROJECT


def test_twin_project_synthesizes_a_bill_when_source_has_none():
    _baseline()
    _boq_source_result()
    rec = _propose()

    result = phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)

    twin_bills = phase3.list_bill_periods(COMPANY, result.new_project_id)
    assert len(twin_bills) == 1
    assert twin_bills[0].stated_percent_complete == 100.0
    assert twin_bills[0].total_gwp_kg_co2e_to_date == pytest.approx(result.new_project_total_gwp_kg_co2e)


def test_twin_inherits_profile_metadata_from_source():
    _baseline()
    _boq_source_result()
    project_registry.set_project_profile(
        COMPANY, PROJECT, archetype="Residential High-Rise", construction_stage="Superstructure", location="Chennai"
    )
    rec = _propose()

    result = phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)

    named = {p["project_id"]: p for p in project_registry.list_named_projects(COMPANY)}
    twin = named[result.new_project_id]
    assert twin["archetype"] == "Residential High-Rise"
    assert twin["construction_stage"] == "Superstructure"
    assert twin["location"] == "Chennai"


# --------------------------------------------------------------------------
# Recommendation status
# --------------------------------------------------------------------------


def test_recommendation_marked_confirmed_as_beta_not_confirmed():
    _baseline()
    _boq_source_result()
    rec = _propose()

    result = phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)

    stored = phase4.get_recommendation(COMPANY, PROJECT, rec.id)
    assert stored.status == "confirmed_as_beta"
    assert stored.beta_project_id == result.new_project_id


def test_cannot_confirm_as_beta_twice():
    _baseline()
    _boq_source_result()
    rec = _propose()
    phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)

    with pytest.raises(ValueError):
        phase4.confirm_recommendation_as_beta_twin(COMPANY, PROJECT, rec.id)


def test_plain_confirm_recommendation_still_works_unchanged():
    # confirm_recommendation() (the pre-existing in-place-overwrite path)
    # must still behave exactly as before this feature -- nothing about
    # adding the Beta fork sibling should change it.
    _baseline()
    before = _boq_source_result()
    rec = _propose()

    phase4.confirm_recommendation(COMPANY, PROJECT, rec.id)

    stored = phase4.get_recommendation(COMPANY, PROJECT, rec.id)
    assert stored.status == "confirmed"
    assert stored.beta_project_id is None
    # And it DID overwrite this project's own source_result -- with an
    # empty line_items=[] fixture, _apply_overlay_to_result's own
    # recompute-from-line-items naturally lands on 0.0 regardless of
    # the fixture's original total_gwp_kg_co2e (200_000.0, never read
    # by that recompute), so the real assertion here is "it changed",
    # not "it stayed the same".
    after = phase3.load_source_result(COMPANY, PROJECT)
    assert after.total_gwp_kg_co2e != before.total_gwp_kg_co2e
    assert after.total_gwp_kg_co2e == 0.0
