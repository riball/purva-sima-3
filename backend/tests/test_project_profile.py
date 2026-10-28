"""Tests for the new purely-descriptive project-profile metadata
(archetype, construction_stage, location) added to
app/services/project_registry.py and surfaced via:
  - PATCH /projects/{id}/profile (app/api/projects.py)
  - GET /phase3/projects (ProjectSummary, app/services/phase3.py)

None of these three fields feeds any calculation (that's the whole point
-- see the plan this was built from). These tests only check the
storage/API plumbing: set -> read back, preserved across a rename,
invalid-enum rejection, and the location fallback-to-Phase-1 behavior.

Isolated the same way test_project_naming.py isolates storage:
company_store.COMPANIES_DIR redirected to a pytest tmp_path.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services import company_store, project_registry

client = TestClient(__import__("app.main", fromlist=["app"]).app)

COMPANY = "provident"


@pytest.fixture(autouse=True)
def isolated_company_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(company_store, "COMPANIES_DIR", tmp_path / "companies")
    yield


def _create_named_project(name="Test Project"):
    r = client.post("/projects", json={"company_id": COMPANY, "project_name": name})
    assert r.status_code == 200
    return r.json()["project_id"]


def test_set_project_profile_round_trips_through_list_named_projects():
    pid = _create_named_project("Ecopolitan Tower B")

    entry = project_registry.set_project_profile(
        COMPANY, pid, archetype="Residential High-Rise", construction_stage="Superstructure", location="Bengaluru"
    )
    assert entry.archetype == "Residential High-Rise"
    assert entry.construction_stage == "Superstructure"
    assert entry.location == "Bengaluru"

    listed = {e["project_id"]: e for e in project_registry.list_named_projects(COMPANY)}
    assert listed[pid]["archetype"] == "Residential High-Rise"
    assert listed[pid]["construction_stage"] == "Superstructure"
    assert listed[pid]["location"] == "Bengaluru"


def test_set_project_profile_only_changes_passed_fields():
    pid = _create_named_project("Partial Update Test")

    project_registry.set_project_profile(COMPANY, pid, archetype="Low-Rise Villa Community")
    project_registry.set_project_profile(COMPANY, pid, construction_stage="Fit-out")

    entry = project_registry._load_registry(COMPANY)[pid]
    # Setting construction_stage alone must not have clobbered the
    # archetype set in the earlier call.
    assert entry.archetype == "Low-Rise Villa Community"
    assert entry.construction_stage == "Fit-out"


def test_rename_preserves_already_set_profile_fields():
    pid = _create_named_project("Original Name")
    project_registry.set_project_profile(
        COMPANY, pid, archetype="Commercial Grade-A Office", construction_stage="Enclosure / Facade", location="Chennai"
    )

    project_registry.rename_project(COMPANY, pid, "Renamed Project")

    entry = project_registry._load_registry(COMPANY)[pid]
    assert entry.project_name == "Renamed Project"
    assert entry.archetype == "Commercial Grade-A Office"
    assert entry.construction_stage == "Enclosure / Facade"
    assert entry.location == "Chennai"


def test_set_project_profile_self_heals_a_registry_entry_for_an_unnamed_project():
    # A project that only has Phase 3 data (a baseline), never explicitly
    # "saved" by name via POST /projects -- set_project_profile() should
    # still work, by self-healing a registry entry into existence first
    # (same as list_named_projects() already does elsewhere).
    from app.services import phase3

    pid = "boq-only-project"
    baseline = phase3.Phase3Baseline(
        project_id=pid,
        company_id=COMPANY,
        project_name="BOQ-Only Project",
        source_type="boq",
        source_file="some_boq.xlsx",
        recorded_at="2026-01-01T00:00:00+00:00",
        total_gwp_kg_co2e=1000.0,
        total_value=50000.0,
    )
    phase3.save_baseline(baseline)

    entry = project_registry.set_project_profile(COMPANY, pid, archetype="Mixed-Use Retail & Living")
    assert entry.archetype == "Mixed-Use Retail & Living"
    assert entry.project_name == "BOQ-Only Project"


def test_set_project_profile_raises_for_truly_unknown_project():
    with pytest.raises(ValueError):
        project_registry.set_project_profile(COMPANY, "does-not-exist-anywhere", archetype="Residential High-Rise")


def test_patch_profile_endpoint_round_trips():
    pid = _create_named_project("API Round Trip Test")

    r = client.patch(
        f"/projects/{pid}/profile",
        json={"company_id": COMPANY, "archetype": "Affordable Housing (Mivan)", "construction_stage": "Commissioning"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["archetype"] == "Affordable Housing (Mivan)"
    assert body["construction_stage"] == "Commissioning"
    assert body["location"] is None


def test_patch_profile_endpoint_rejects_invalid_archetype():
    pid = _create_named_project("Invalid Enum Test")

    r = client.patch(
        f"/projects/{pid}/profile",
        json={"company_id": COMPANY, "archetype": "Not A Real Archetype"},
    )
    assert r.status_code == 422


def test_patch_profile_endpoint_404s_for_unknown_project():
    r = client.patch(
        "/projects/totally-unknown-project/profile",
        json={"company_id": COMPANY, "archetype": "Residential High-Rise"},
    )
    assert r.status_code == 404


def test_get_phase3_projects_surfaces_archetype_stage_and_location():
    # GET /phase3/projects only discovers projects with a Phase 1 record
    # and/or Phase 3 baseline (see ProjectSummary's own docstring) -- a
    # project that exists ONLY in the name registry (bare POST /projects,
    # nothing else) isn't discoverable there, which is pre-existing,
    # unrelated behavior this test isn't exercising. Use a Phase 1
    # project instead, same as the fallback tests below.
    r_form = client.post(
        "/form",
        json={"gfa_sqm": 18000, "location": "Pune", "structural_system_type": "rcc_frame", "company_id": COMPANY, "project_name": "Surfaced On Summary"},
    )
    assert r_form.status_code == 200
    pid = r_form.json()["project_id"]

    project_registry.set_project_profile(
        COMPANY, pid, archetype="Low-Rise Villa Community", construction_stage="Substructure", location="Mysore"
    )

    r = client.get("/phase3/projects", params={"company_id": COMPANY})
    assert r.status_code == 200
    rows = {row["project_id"]: row for row in r.json()}
    assert rows[pid]["archetype"] == "Low-Rise Villa Community"
    assert rows[pid]["construction_stage"] == "Substructure"
    assert rows[pid]["location"] == "Mysore"


def test_location_falls_back_to_phase1_record_when_registry_has_no_override():
    # A Phase 1 project submitted with a location, with no explicit
    # profile location override set -- GET /phase3/projects should still
    # show the Phase 1 record's own location.
    r = client.post(
        "/form",
        json={"gfa_sqm": 25000, "location": "Hyderabad", "structural_system_type": "rcc_frame", "company_id": COMPANY},
    )
    assert r.status_code == 200
    pid = r.json()["project_id"]

    rows = {row["project_id"]: row for row in client.get("/phase3/projects", params={"company_id": COMPANY}).json()}
    assert rows[pid]["location"] == "Hyderabad"
    assert rows[pid]["archetype"] is None  # never set, correctly absent rather than fabricated


def test_registry_location_override_wins_over_phase1_location():
    r = client.post(
        "/form",
        json={"gfa_sqm": 25000, "location": "Hyderabad", "structural_system_type": "rcc_frame", "company_id": COMPANY},
    )
    pid = r.json()["project_id"]

    project_registry.set_project_profile(COMPANY, pid, location="Hyderabad (Gachibowli Phase 2)")

    rows = {row["project_id"]: row for row in client.get("/phase3/projects", params={"company_id": COMPANY}).json()}
    assert rows[pid]["location"] == "Hyderabad (Gachibowli Phase 2)"
