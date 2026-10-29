"""Workstream 14: HTTP surface for Phase 4 -- confirm, recalculate,
audit (app/services/phase4.py). See that module's own docstring for the
full design and its two disclosed scope cuts (BOQ-sourced baselines
only; carbon recomputed, not cost).

Every recompute here is real, not estimated -- propose_recommendation()
and confirm_recommendation() both call straight into
substitution_engine.py's own per-line math, the same engine Phase 2's
stateless /boq-carbon/substitute endpoint already uses.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import company_store, phase4

router = APIRouter(prefix="/phase4", tags=["phase4"])


class ProposeRequest(BaseModel):
    substitution_id: str
    user_pct: float


@router.post("/projects/{project_id}/recommendations", response_model=phase4.Recommendation)
def propose_recommendation(
    project_id: str, body: ProposeRequest, company_id: str = company_store.DEFAULT_COMPANY_ID
) -> phase4.Recommendation:
    try:
        return phase4.propose_recommendation(company_id, project_id, body.substitution_id, body.user_pct)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/recommendations", response_model=list[phase4.Recommendation])
def list_recommendations(
    project_id: str, status: str | None = None, company_id: str = company_store.DEFAULT_COMPANY_ID
) -> list[phase4.Recommendation]:
    return phase4.list_recommendations(company_id, project_id, status=status)  # type: ignore[arg-type]


@router.post("/projects/{project_id}/recommendations/{recommendation_id}/confirm", response_model=phase4.ConfirmResult)
def confirm_recommendation(
    project_id: str, recommendation_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID
) -> phase4.ConfirmResult:
    try:
        return phase4.confirm_recommendation(company_id, project_id, recommendation_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/projects/{project_id}/recommendations/{recommendation_id}/confirm-as-beta", response_model=phase4.BetaForkResult)
def confirm_recommendation_as_beta(
    project_id: str, recommendation_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID
) -> phase4.BetaForkResult:
    """Project Dashboard's "Material Alternatives (Beta)" section calls
    this instead of /confirm above -- see phase4.confirm_recommendation_as_beta_twin's
    own docstring for why this forks a new project rather than mutating
    this one's own figures."""
    try:
        return phase4.confirm_recommendation_as_beta_twin(company_id, project_id, recommendation_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/projects/{project_id}/recommendations/{recommendation_id}/reject", response_model=phase4.Recommendation)
def reject_recommendation(
    project_id: str, recommendation_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID
) -> phase4.Recommendation:
    try:
        return phase4.reject_recommendation(company_id, project_id, recommendation_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/audit-log", response_model=list[phase4.AuditLogEntry])
def get_audit_log(project_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> list[phase4.AuditLogEntry]:
    return phase4.list_audit_log(company_id, project_id)


@router.get("/projects/{project_id}/current-state", response_model=phase4.CurrentStateSummary)
def get_current_state(project_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> phase4.CurrentStateSummary:
    try:
        return phase4.get_current_state_summary(company_id, project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/projects/{project_id}/catalog-preview", response_model=list[phase4.CatalogPreviewEntry])
def get_catalog_preview(project_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> list[phase4.CatalogPreviewEntry]:
    """Powers the Alternatives card grid -- every catalog entry evaluated
    against this project's current state at once (see
    phase4.evaluate_catalog_preview's own docstring), instead of the
    frontend asking for one substitution_id at a time."""
    try:
        return phase4.evaluate_catalog_preview(company_id, project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))