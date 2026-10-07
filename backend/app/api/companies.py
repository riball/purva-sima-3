"""Workstream 15: HTTP surface for the company registry
(app/services/company_registry.py) -- lets the frontend show a real
company picker (list existing companies, create a new one) instead of
the free-text company_id field it previously carried, which only ever
became "real" as a side effect of the first save under it.

GET /companies and GET /companies/{company_id} both fold in a
project_count, purely for display -- reads it from
app.services.phase3.list_projects, the same "union of Phase 1 records
and Phase 3 data" figure a company already exposes at
GET /phase3/projects, just counted rather than listed in full. A picker
that just says "provident" with no sense of how much is in it isn't
much better than a bare text field.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import company_registry, phase3

router = APIRouter(prefix="/companies", tags=["companies"])


class CompanyCreateRequest(BaseModel):
    display_name: str
    company_id: str | None = None  # auto-slugified from display_name when omitted -- see company_registry.slugify_company_id


class CompanyOut(BaseModel):
    company_id: str
    display_name: str
    created_at: str
    project_count: int


def _to_out(meta: company_registry.CompanyMeta) -> CompanyOut:
    project_count = len(phase3.list_projects(meta.company_id))
    return CompanyOut(**meta.model_dump(), project_count=project_count)


@router.get("", response_model=list[CompanyOut])
def list_companies() -> list[CompanyOut]:
    return [_to_out(m) for m in company_registry.list_companies()]


@router.post("", response_model=CompanyOut)
def create_company(body: CompanyCreateRequest) -> CompanyOut:
    try:
        meta = company_registry.create_company(body.display_name, body.company_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _to_out(meta)


@router.get("/{company_id}", response_model=CompanyOut)
def get_company(company_id: str) -> CompanyOut:
    meta = company_registry.get_company(company_id)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"No company found with id '{company_id}'")
    return _to_out(meta)