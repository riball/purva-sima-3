"""Material Swap Sandbox: HTTP surface for free-text swap requests (see
app/services/boq_carbon/swap_sandbox.py's own docstring for the full
design). Deliberately a THIN router -- the one new endpoint here just
hands a question to app.services.phase4.evaluate_and_propose_custom_swap()
and returns its result.

Everything downstream of "evaluate" reuses the EXISTING Phase 4 endpoints
unchanged (see app/api/phase4.py): a custom-swap evaluation is persisted
as a real Recommendation (source="custom_swap"), so
/phase4/projects/{id}/recommendations/{rec_id}/confirm-as-beta and
/reject already work on it -- no new confirm/reject/fork endpoint was
needed, exactly as the approved plan called for. Listing a project's past
sandbox asks is also just the existing
GET /phase4/projects/{id}/recommendations, filtered client-side to
source=="custom_swap" -- no new list endpoint either.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import company_store, phase4

router = APIRouter(prefix="/swap-sandbox", tags=["swap-sandbox"])


class EvaluateSwapRequest(BaseModel):
    question: str


@router.post("/projects/{project_id}/evaluate", response_model=phase4.CustomSwapProposalResult)
def evaluate_custom_swap(
    project_id: str, body: EvaluateSwapRequest, company_id: str = company_store.DEFAULT_COMPANY_ID
) -> phase4.CustomSwapProposalResult:
    try:
        return phase4.evaluate_and_propose_custom_swap(company_id, project_id, body.question)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
