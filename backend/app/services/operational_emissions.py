"""Operational Emissions (Scope 1 & Scope 2) calculator.

New, deliberately separate module from this app's existing embodied-carbon
pipeline (Phase 1 conceptual estimate, Phase 2 BOQ/WO ingestion, Phase 3/4
baseline+swaps). Embodied carbon is about carbon locked into MATERIALS
(concrete, steel, etc.) for one construction project's BOQ. This module is
about OPERATIONAL carbon -- site fuel burned (DG sets, vehicles) and
purchased grid electricity -- a different GHG Protocol category (Scope 1 &
Scope 2) with a different entity concept (an HQ or a Project, under a PL or
PHL company group) than the existing `project_id`/`Phase3Baseline` model.
Kept as its own service + storage namespace on purpose, per the "where
should this go" discussion: reuse the app's existing infrastructure
(company_store's per-company JSON persistence pattern, the same
atomic-write approach job_store.py already uses) without entangling this
with the embodied-carbon data model.

Emission factors are checked against the real PL/PHL FY2024-25
sustainability report workbook's own `Emissions_consl` sheet -- same three
factors, same sources, matched exactly (not independently sourced/guessed):
  - Diesel: 2.66155 kg CO2e/litre (DEFRA - Fuel, Diesel (100% mineral diesel))
  - LPG: 2.93936 kg CO2e/kg (DEFRA - Gaseous Fuel, LPG)
  - Grid electricity: 0.727 kg CO2e/kWh (CEA India)
These are constants, not something a user enters per calculation -- same
pattern as app/services/ice_factors.py and emission_factors.py on the
embodied-carbon side. The CEA grid factor in particular is revised roughly
annually (a new CO2 Baseline Database each year) -- GRID_EF_NOTE below
records which vintage this value is, so updating it next year is a
one-constant change, not a hunt through code.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel

from app.services import company_store

# ---------------------------------------------------------------------------
# Emission factors (constants -- never user-entered; see module docstring)

DIESEL_EF_KG_CO2E_PER_LITRE = 2.66155
DIESEL_EF_SOURCE = "DEFRA - Fuel, Diesel (100% mineral diesel)"

LPG_EF_KG_CO2E_PER_KG = 2.93936
LPG_EF_SOURCE = "DEFRA - Gaseous Fuel, LPG"

GRID_EF_KG_CO2E_PER_KWH = 0.727
GRID_EF_SOURCE = "CEA (India) CO2 Baseline Database"
GRID_EF_NOTE = (
    "CEA's baseline database is typically revised annually -- this value "
    "matches the one used in the PL/PHL FY2024-25 sustainability report. "
    "Update GRID_EF_KG_CO2E_PER_KWH (and this note) when a newer CEA "
    "baseline is adopted."
)


# ---------------------------------------------------------------------------
# Models

class OperationalEmissionsInput(BaseModel):
    entity_name: Optional[str] = None
    company: Optional[Literal["PL", "PHL"]] = None
    # Values changed from "HQ"/"Project" to "Corporate Office"/"Provident"
    # per product decision -- the frontend dropdown (OperationalEmissionsView.jsx)
    # now sends these strings. Existing persisted entries with the old
    # "HQ"/"Project" values are untouched (this only constrains new writes)
    # and still display fine, since OperationalEmissionsResult.entity_type
    # below is a plain Optional[str], not re-validated against this Literal.
    entity_type: Optional[Literal["Corporate Office", "Provident"]] = None
    period: Optional[str] = None

    # Scope 1 -- fuel burned on-site
    diesel_dg_litres: float = 0.0
    diesel_vehicles_litres: float = 0.0
    lpg_kg: float = 0.0

    # Scope 2 -- purchased electricity
    grid_kwh: float = 0.0

    # Optional, for intensity metrics
    built_up_area_sqft: Optional[float] = None
    revenue_inr_lakhs: Optional[float] = None


class SourceBreakdown(BaseModel):
    source: str
    quantity: float
    unit: str
    emission_factor: float
    factor_unit: str
    factor_source: str
    kg_co2e: float


class OperationalEmissionsResult(BaseModel):
    entry_id: str
    company_id: str
    entity_name: Optional[str] = None
    company: Optional[str] = None
    entity_type: Optional[str] = None
    period: Optional[str] = None
    created_at: str

    scope1_breakdown: list[SourceBreakdown]
    scope1_total_kg_co2e: float
    scope1_total_tonnes_co2e: float

    scope2_breakdown: list[SourceBreakdown]
    scope2_total_kg_co2e: float
    scope2_total_tonnes_co2e: float

    combined_total_kg_co2e: float
    combined_total_tonnes_co2e: float
    scope1_pct_of_combined: float
    scope2_pct_of_combined: float

    built_up_area_sqft: Optional[float] = None
    revenue_inr_lakhs: Optional[float] = None
    intensity_kg_co2e_per_sqft: Optional[float] = None
    intensity_kg_co2e_per_lakh_revenue: Optional[float] = None


# ---------------------------------------------------------------------------
# Calculation

def _pct(part: float, whole: float) -> float:
    return (part / whole * 100.0) if whole else 0.0


def calculate(data: OperationalEmissionsInput, company_id: str) -> OperationalEmissionsResult:
    scope1_breakdown = [
        SourceBreakdown(
            source="diesel_dg",
            quantity=data.diesel_dg_litres,
            unit="litres",
            emission_factor=DIESEL_EF_KG_CO2E_PER_LITRE,
            factor_unit="kg CO2e/litre",
            factor_source=DIESEL_EF_SOURCE,
            kg_co2e=data.diesel_dg_litres * DIESEL_EF_KG_CO2E_PER_LITRE,
        ),
        SourceBreakdown(
            source="diesel_vehicles",
            quantity=data.diesel_vehicles_litres,
            unit="litres",
            emission_factor=DIESEL_EF_KG_CO2E_PER_LITRE,
            factor_unit="kg CO2e/litre",
            factor_source=DIESEL_EF_SOURCE,
            kg_co2e=data.diesel_vehicles_litres * DIESEL_EF_KG_CO2E_PER_LITRE,
        ),
        SourceBreakdown(
            source="lpg",
            quantity=data.lpg_kg,
            unit="kg",
            emission_factor=LPG_EF_KG_CO2E_PER_KG,
            factor_unit="kg CO2e/kg",
            factor_source=LPG_EF_SOURCE,
            kg_co2e=data.lpg_kg * LPG_EF_KG_CO2E_PER_KG,
        ),
    ]
    scope1_total_kg = sum(s.kg_co2e for s in scope1_breakdown)

    scope2_breakdown = [
        SourceBreakdown(
            source="grid_electricity",
            quantity=data.grid_kwh,
            unit="kWh",
            emission_factor=GRID_EF_KG_CO2E_PER_KWH,
            factor_unit="kg CO2e/kWh",
            factor_source=GRID_EF_SOURCE,
            kg_co2e=data.grid_kwh * GRID_EF_KG_CO2E_PER_KWH,
        ),
    ]
    scope2_total_kg = sum(s.kg_co2e for s in scope2_breakdown)

    combined_kg = scope1_total_kg + scope2_total_kg

    intensity_per_sqft = (
        combined_kg / data.built_up_area_sqft
        if data.built_up_area_sqft and data.built_up_area_sqft > 0
        else None
    )
    intensity_per_lakh = (
        combined_kg / data.revenue_inr_lakhs
        if data.revenue_inr_lakhs and data.revenue_inr_lakhs > 0
        else None
    )

    return OperationalEmissionsResult(
        entry_id=str(uuid.uuid4()),
        company_id=company_id,
        entity_name=data.entity_name,
        company=data.company,
        entity_type=data.entity_type,
        period=data.period,
        created_at=datetime.now(timezone.utc).isoformat(),
        scope1_breakdown=scope1_breakdown,
        scope1_total_kg_co2e=scope1_total_kg,
        scope1_total_tonnes_co2e=scope1_total_kg / 1000.0,
        scope2_breakdown=scope2_breakdown,
        scope2_total_kg_co2e=scope2_total_kg,
        scope2_total_tonnes_co2e=scope2_total_kg / 1000.0,
        combined_total_kg_co2e=combined_kg,
        combined_total_tonnes_co2e=combined_kg / 1000.0,
        scope1_pct_of_combined=_pct(scope1_total_kg, combined_kg),
        scope2_pct_of_combined=_pct(scope2_total_kg, combined_kg),
        built_up_area_sqft=data.built_up_area_sqft,
        revenue_inr_lakhs=data.revenue_inr_lakhs,
        intensity_kg_co2e_per_sqft=intensity_per_sqft,
        intensity_kg_co2e_per_lakh_revenue=intensity_per_lakh,
    )


# ---------------------------------------------------------------------------
# Persistence -- same atomic-write-per-record pattern as job_store.py,
# scoped under its own subdirectory so it never mixes with Phase 3/4's
# per-project directories or job_store's own jobs/ directory.

def _entries_dir(company_id: str) -> Path:
    return company_store.company_dir(company_id) / "operational_emissions"


def _entry_path(company_id: str, entry_id: str) -> Path:
    return _entries_dir(company_id) / f"{entry_id}.json"


def _write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f".{uuid.uuid4().hex[:8]}.tmp")
    tmp_path.write_text(json.dumps(data, indent=2))
    os.replace(tmp_path, path)  # atomic on every OS this runs on


def calculate_and_save(data: OperationalEmissionsInput, company_id: str) -> OperationalEmissionsResult:
    result = calculate(data, company_id)
    _write_atomic(_entry_path(company_id, result.entry_id), result.model_dump())
    return result


def load_entry(company_id: str, entry_id: str) -> Optional[OperationalEmissionsResult]:
    path = _entry_path(company_id, entry_id)
    if not path.exists():
        return None
    return OperationalEmissionsResult.model_validate(json.loads(path.read_text()))


def list_entries(company_id: str) -> list[OperationalEmissionsResult]:
    entries_dir = _entries_dir(company_id)
    if not entries_dir.exists():
        return []
    entries = [
        OperationalEmissionsResult.model_validate(json.loads(p.read_text()))
        for p in entries_dir.glob("*.json")
        if not p.name.endswith(".tmp")
    ]
    return sorted(entries, key=lambda e: e.created_at, reverse=True)


def delete_entry(company_id: str, entry_id: str) -> bool:
    path = _entry_path(company_id, entry_id)
    if not path.exists():
        return False
    path.unlink()
    return True