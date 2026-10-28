"""Substitution suggestion endpoint -- returns individual suggestions
plus their combined effect if all were applied together.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import company_store, project_store
from app.services.calculation_engine import MAX_GFA_SQM, calculate_embodied_carbon
from app.services.substitution import (
    CombinedSubstitutionImpact,
    SubstitutionSuggestion,
    compute_combined_impact,
    suggest_substitutions,
)

router = APIRouter()


class SubstituteResponse(BaseModel):
    project_id: str
    suggestions: list[SubstitutionSuggestion]
    combined_impact: CombinedSubstitutionImpact | None


@router.post("/substitute/{project_id}", response_model=SubstituteResponse)
def substitute(project_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> SubstituteResponse:
    project = project_store.load_project(project_id, company_id=company_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"No project found with id '{project_id}'")

    # Same guard gap as app/api/calculate.py had -- see that file's
    # comment. calculate_embodied_carbon() raises a plain ValueError for
    # gfa <= 0, not just gfa is None, and nothing here caught it.
    gfa = project.mandatory.gfa_sqm.value
    if gfa is None or gfa <= 0:
        raise HTTPException(status_code=400, detail="Cannot compute substitutions without a valid GFA")
    if gfa > MAX_GFA_SQM:
        raise HTTPException(
            status_code=400,
            detail=f"GFA of {gfa:,.0f} sqm exceeds the sanity ceiling of {MAX_GFA_SQM:,} sqm -- check for a data-entry error",
        )

    actual_result = calculate_embodied_carbon(project)
    suggestions = suggest_substitutions(project, actual_result)
    combined = compute_combined_impact(project, actual_result, suggestions)

    return SubstituteResponse(project_id=project_id, suggestions=suggestions, combined_impact=combined)