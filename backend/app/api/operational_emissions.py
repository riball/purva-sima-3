"""UX: "Operational Emissions" (Scope 1 & Scope 2) -- new, standalone nav
tab. The user enters fuel/electricity quantities for one entity (an HQ or a
Project, under PL or PHL); this calculates Scope 1 (diesel DG + diesel
vehicles + LPG) and Scope 2 (grid electricity) using the fixed emission
factors in app/services/operational_emissions.py, and saves the result so
past calculations can be revisited (GET below) or removed (DELETE below).

Deliberately its own router/prefix/storage namespace, not layered onto
app/api/projects.py or phase3.py -- see operational_emissions.py's module
docstring for why (a different GHG Protocol category and entity concept
than the embodied-carbon project model).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services import company_store, operational_emissions

router = APIRouter(prefix="/operational-emissions", tags=["operational-emissions"])


class CreateOperationalEmissionsRequest(operational_emissions.OperationalEmissionsInput):
    company_id: str = company_store.DEFAULT_COMPANY_ID


@router.post("", response_model=operational_emissions.OperationalEmissionsResult)
def create_entry(body: CreateOperationalEmissionsRequest) -> operational_emissions.OperationalEmissionsResult:
    data = operational_emissions.OperationalEmissionsInput(**body.model_dump(exclude={"company_id"}))
    return operational_emissions.calculate_and_save(data, body.company_id)


@router.get("", response_model=list[operational_emissions.OperationalEmissionsResult])
def list_entries(company_id: str = company_store.DEFAULT_COMPANY_ID) -> list[operational_emissions.OperationalEmissionsResult]:
    return operational_emissions.list_entries(company_id)


@router.get("/{entry_id}", response_model=operational_emissions.OperationalEmissionsResult)
def get_entry(entry_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> operational_emissions.OperationalEmissionsResult:
    entry = operational_emissions.load_entry(company_id, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No operational emissions entry '{entry_id}' found.")
    return entry


@router.delete("/{entry_id}")
def delete_entry(entry_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> dict:
    deleted = operational_emissions.delete_entry(company_id, entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No operational emissions entry '{entry_id}' found.")
    return {"deleted": True, "entry_id": entry_id}