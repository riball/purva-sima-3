"""Tests for app/services/chatbot.py (Phase 3's "what-if"/query/action
chatbot) -- Workstream 12 (swap tools), Workstream 13 (query tools), Phase
E (chat-driven propose/confirm/reject), and Workstream 15 (this pass's two
additions: extending the 4 query tools to also answer for a project with a
Phase 3 baseline but no Phase 1 record, and a retrieval-grounded free-form
fallback for a question outside the fixed tool vocabulary).

NOTE: this file previously, erroneously, contained a byte-for-byte copy of
app/services/llm_fallback.py's source code instead of any tests -- zero
`def test_*` functions were ever collected from it, so chatbot.py has had
no real test coverage at all until this pass. That mistake predates this
session (file mtime well before any change made here) and is unrelated to
the Workstream 15 changes; fixed here as part of building real coverage
for the module this phase actually modifies, per the approved plan's own
requirement that chatbot.py's test suite "must still pass before/after
changes" -- which first requires it to exist.

Isolated the same way tests/test_phase3.py already established: every
test redirects company_store.COMPANIES_DIR to a pytest tmp_path. No test
here depends on a live LLM provider being configured -- this sandbox has
none (LLM_PROVIDER=ollama with no `ollama` package installed), so every
answer_question()/parse_question() call already exercises the real,
deterministic keyword-fallback / context-summary-fallback paths this file
means to cover, not a mocked-out LLM call.
"""

from __future__ import annotations

import pytest

from app.schemas.project_schema import (
    FieldValue,
    MandatoryFields,
    ProjectSchema,
    StructuralSystemType,
    Tier2Fields,
    Typology,
)
from app.services import chatbot, company_store, phase3, project_store
from app.services.boq_carbon.engine import BoqCarbonResult, CategoryTotal

COMPANY = "provident"


@pytest.fixture(autouse=True)
def isolated_company_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(company_store, "COMPANIES_DIR", tmp_path / "companies")
    yield


# --------------------------------------------------------------------------
# Fixture builders
# --------------------------------------------------------------------------


def _phase1_project(project_id="p1-proj", company_id=COMPANY, gfa=50_000.0):
    project = ProjectSchema(
        project_id=project_id,
        company_id=company_id,
        project_name="Test Tower",
        mandatory=MandatoryFields(
            gfa_sqm=FieldValue(value=gfa, source="user-entered", confidence=1.0),
            location=FieldValue(value="Chennai", source="user-entered", confidence=1.0),
            structural_system_type=FieldValue(value=StructuralSystemType.rcc_frame, source="user-entered", confidence=1.0),
        ),
        tier2=Tier2Fields(
            typology=FieldValue(value=Typology.residential, source="user-entered", confidence=1.0),
            num_floors=FieldValue(value=20, source="user-entered", confidence=1.0),
        ),
    )
    project_store.save_project(project)
    return project


def _baseline(project_id="boq-proj", company_id=COMPANY, source_type="boq", total_gwp=200_000.0, total_value=20_000_000.0, floor_area=40_000.0, is_estimated=False):
    b = phase3.Phase3Baseline(
        project_id=project_id,
        company_id=company_id,
        source_type=source_type,
        source_file="test.xlsx",
        recorded_at="2026-01-01T00:00:00",
        total_gwp_kg_co2e=total_gwp,
        total_value=total_value,
        floor_area_sqm=floor_area,
        structural_system_type="rcc_frame",
        num_floors=20,
        typology="residential",
        is_estimated=is_estimated,
    )
    phase3.save_baseline(b)
    return b


def _boq_source_result(project_id="boq-proj", company_id=COMPANY, total_gwp=200_000.0, floor_area=40_000.0, categories=None):
    categories = categories if categories is not None else [
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
        floor_area_sqm=floor_area,
        gwp_per_sqm=(total_gwp / floor_area) if floor_area else None,
        gwp_per_sqft=None,
        line_items=[],
    )
    phase3.save_source_result(company_id, project_id, result)
    return result


# --------------------------------------------------------------------------
# Pre-existing behavior (Workstream 12/13/Phase E) -- sanity checks that
# answer_question()'s restructuring in this pass didn't change the Phase 1
# path at all.
# --------------------------------------------------------------------------


def test_swap_concrete_grade_on_phase1_project():
    _phase1_project()
    answer = chatbot.answer_question("p1-proj", COMPANY, "what if I use M40 instead of M30")
    assert answer.tool_call.tool == "swap_concrete_grade"
    assert answer.error is None
    assert answer.carbon_kg_before is not None
    assert answer.carbon_kg_after is not None


def test_get_totals_on_phase1_project():
    _phase1_project()
    answer = chatbot.answer_question("p1-proj", COMPANY, "what's my total carbon and cost so far")
    assert answer.tool_call.tool == "get_totals"
    assert answer.error is None
    assert answer.data["total_carbon_kg"] > 0
    assert "Phase 1" in answer.answer_text


def test_get_carbon_breakdown_steel_on_phase1_project():
    _phase1_project()
    answer = chatbot.answer_question("p1-proj", COMPANY, "what does the carbon breakdown look like for steel")
    assert answer.tool_call.tool == "get_carbon_breakdown"
    assert answer.data["material"] == "steel"
    assert answer.error is None


def test_swap_with_no_phase1_record_and_no_baseline_unchanged_message():
    answer = chatbot.answer_question("ghost-proj", COMPANY, "what if I use M40 instead of M30")
    assert answer.error == "no_phase1_record"
    assert "submit it via POST /form first" in answer.answer_text


def test_unparseable_question_with_zero_data_gets_plain_clarification():
    # No Phase 1 record AND no Phase 3 baseline at all for this project --
    # _gather_retrieval_context returns {}, so this must degrade to the
    # exact original pre-Workstream-15 behavior, not attempt a free-form
    # answer with nothing to ground it in.
    answer = chatbot.answer_question("ghost-proj", COMPANY, "what can you tell me about this project overall")
    assert answer.tool_call.tool is None
    assert answer.error == "unparseable_question"
    assert "what-if questions" in answer.answer_text


# --------------------------------------------------------------------------
# Workstream 15a -- query tools extended to a Phase-3-baseline-only
# project (no Phase 1 record), both for a BOQ-sourced baseline (with a
# persisted source_result, so a real category breakdown exists) and a
# WO-sourced one (baseline only, no persisted source_result).
# --------------------------------------------------------------------------


def test_get_totals_boq_no_phase1_record():
    _baseline(source_type="boq")
    _boq_source_result()
    answer = chatbot.answer_question("boq-proj", COMPANY, "what's my total carbon and cost so far")
    assert answer.tool_call.tool == "get_totals"
    assert answer.error is None
    assert answer.data["total_carbon_kg"] == 200_000.0
    assert answer.data["reflects_confirmed_substitutions"] is True
    assert "no Phase 1 record" in answer.answer_text
    assert "BOQ" in answer.answer_text


def test_get_totals_wo_no_phase1_record_falls_back_to_baseline_total():
    _baseline(project_id="wo-proj", source_type="wo", total_gwp=150_000.0, total_value=15_000_000.0, floor_area=30_000.0)
    # Deliberately no source_result saved -- matches phase4.py's own
    # documented scope cut (a WO-sourced baseline has no persisted source
    # result).
    answer = chatbot.answer_question("wo-proj", COMPANY, "what's my total carbon and cost so far")
    assert answer.tool_call.tool == "get_totals"
    assert answer.error is None
    assert answer.data["total_carbon_kg"] == 150_000.0
    assert answer.data["reflects_confirmed_substitutions"] is False
    assert "WO" in answer.answer_text


def test_get_carbon_breakdown_all_boq_no_phase1_record_uses_real_categories():
    _baseline(source_type="boq")
    _boq_source_result()
    answer = chatbot.answer_question("boq-proj", COMPANY, "give me a full carbon breakdown")
    assert answer.tool_call.tool == "get_carbon_breakdown"
    assert answer.error is None
    categories = {c["category"] for c in answer.data["by_category"]}
    assert categories == {"rcc", "reinforcement_steel", "brickwork"}
    # Sorted highest-carbon first
    assert answer.data["by_category"][0]["category"] == "rcc"


def test_get_carbon_breakdown_steel_boq_no_phase1_record_maps_to_reinforcement_steel():
    _baseline(source_type="boq")
    _boq_source_result()
    answer = chatbot.answer_question("boq-proj", COMPANY, "what does the carbon breakdown look like for steel")
    assert answer.tool_call.tool == "get_carbon_breakdown"
    assert answer.error is None
    assert answer.data["boq_category"] == "reinforcement_steel"
    assert answer.data["carbon_kg"] == 60_000.0


def test_get_carbon_breakdown_wo_no_phase1_record_is_an_honest_error_not_a_guess():
    _baseline(project_id="wo-proj", source_type="wo")
    answer = chatbot.answer_question("wo-proj", COMPANY, "what does the carbon breakdown look like for steel")
    assert answer.tool_call.tool == "get_carbon_breakdown"
    assert answer.error == "invalid_parameters"
    assert "Work-Order-sourced baseline doesn't retain a per-category" in answer.answer_text


def test_get_benchmark_comparison_boq_no_phase1_record():
    _baseline(source_type="boq", total_gwp=200_000.0, floor_area=40_000.0)
    _boq_source_result(total_gwp=200_000.0, floor_area=40_000.0)
    answer = chatbot.answer_question("boq-proj", COMPANY, "how does this compare to a typical building")
    assert answer.tool_call.tool == "get_benchmark_comparison"
    assert answer.error is None
    assert answer.data["actual_carbon_per_sqm"] == pytest.approx(200_000.0 / 40_000.0)
    assert answer.data["typical_carbon_per_sqm"] > 0


def test_get_project_end_estimate_boq_material_split_uses_real_boq_category():
    _baseline(source_type="boq", total_gwp=200_000.0)
    _boq_source_result(total_gwp=200_000.0)
    answer = chatbot.answer_question("boq-proj", COMPANY, "how much carbon will steel contribute by the end of this project")
    assert answer.tool_call.tool == "get_project_end_estimate"
    assert answer.error is None
    assert answer.data["material"] == "steel"
    assert answer.data["material_split_basis"] == "boq_category_reinforcement_steel"
    # 60,000 / 200,000 = 30% share of the (no-bills, so baseline-total) projection
    assert answer.data["material_share_pct"] == pytest.approx(30.0)
    assert "real" in answer.answer_text and "reinforcement_steel" in answer.answer_text


def test_get_project_end_estimate_wo_material_split_is_an_honest_error():
    _baseline(project_id="wo-proj", source_type="wo")
    answer = chatbot.answer_question("wo-proj", COMPANY, "how much carbon will steel contribute by the end of this project")
    assert answer.tool_call.tool == "get_project_end_estimate"
    assert answer.error == "invalid_parameters"
    assert "no persisted BOQ category breakdown" in answer.answer_text


def test_query_tool_no_data_at_all():
    answer = chatbot.answer_question("ghost-proj", COMPANY, "what's my total carbon and cost so far")
    assert answer.tool_call.tool == "get_totals"
    assert answer.error == "no_data"


# --------------------------------------------------------------------------
# Workstream 15b -- swap tool on a Phase-3-baseline-only project: a clear
# explanation, not the generic "no Phase 1 record" message.
# --------------------------------------------------------------------------


def test_swap_tool_on_boq_project_with_no_phase1_record_explains_why():
    _baseline(source_type="boq")
    answer = chatbot.answer_question("boq-proj", COMPANY, "what if I use M40 instead of M30")
    assert answer.tool_call.tool == "swap_concrete_grade"
    assert answer.error == "no_phase1_record_for_swap"
    assert "BOQ" in answer.answer_text
    assert "no concrete grade" in answer.answer_text


# --------------------------------------------------------------------------
# Workstream 15c -- retrieval-grounded free-form fallback for a question
# outside the fixed tool vocabulary.
# --------------------------------------------------------------------------


def test_freeform_fallback_uses_deterministic_summary_when_llm_unavailable():
    _baseline(source_type="boq", total_gwp=200_000.0, total_value=20_000_000.0)
    _boq_source_result(total_gwp=200_000.0)
    answer = chatbot.answer_question("boq-proj", COMPANY, "what can you tell me about this project overall")
    assert answer.tool_call.tool is None
    # No live LLM provider in this environment -- must degrade to the
    # deterministic context summary, not a bare failure.
    assert answer.error == "llm_unavailable_used_deterministic_summary"
    assert answer.data is not None
    assert "phase3_baseline" in answer.data
    assert "200,000" in answer.answer_text


def test_freeform_fallback_with_zero_data_matches_original_clarification():
    answer = chatbot.answer_question("ghost-proj", COMPANY, "what can you tell me about this project overall")
    assert answer.tool_call.tool is None
    assert answer.error == "unparseable_question"
    assert answer.data is None


def test_gather_retrieval_context_includes_phase1_and_phase3_sections():
    _phase1_project(project_id="combo-proj")
    phase3.save_baseline(phase3.Phase3Baseline(
        project_id="combo-proj", company_id=COMPANY, source_type="phase1_estimate",
        source_file="phase1-estimate:combo-proj", recorded_at="2026-01-01T00:00:00",
        total_gwp_kg_co2e=500_000.0, total_value=50_000_000.0, floor_area_sqm=50_000.0,
        is_estimated=True,
    ))
    context = chatbot._gather_retrieval_context("combo-proj", COMPANY)
    assert "phase1_concept_estimate" in context
    assert "phase3_baseline" in context
    assert context["phase3_baseline"]["is_estimated"] is True


def test_gather_retrieval_context_empty_for_unknown_project():
    assert chatbot._gather_retrieval_context("no-such-project", COMPANY) == {}
