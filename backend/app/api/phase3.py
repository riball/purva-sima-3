"""Workstream 10: Phase 3 endpoints -- record a project's Phase 2 baseline,
upload periodic bills against it, and read back the dashboard data.

Deliberately mirrors app/api/boq_carbon.py and app/api/wo_carbon.py's
shape (temp-file handling, paired floor_area_sqm/floor_area_basis
validation, restoring the original filename) since a bill or a baseline
IS a BOQ/WO upload underneath -- see app/services/phase3.py's module
docstring for why no new parsing logic exists here.

Workstream 12 adds the "what-if" chatbot endpoints at the bottom of this
file -- see app/services/chatbot.py's module docstring for the full
design (LLM-parsed tool call, real-engine recompute, deterministic
narration).
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pdfplumber.utils.exceptions import PdfminerException
from pydantic import BaseModel

from app.services import chatbot, company_store, phase3, project_resolver
from app.services.boq_carbon.engine import FloorAreaBasis, calculate_from_boq
from app.services.boq_carbon.parser import extract_from_first_primary_sheet
from app.services.boq_extractor import SUPPLEMENTARY_SHEET_PATTERNS
from app.services.phase3_cop_engine import calculate_from_cop_pdf
from app.services.wo_carbon.wo_carbon_engine import calculate_from_work_order

router = APIRouter(prefix="/phase3", tags=["phase3"])


@router.get("/projects", response_model=list[phase3.ProjectSummary])
def list_projects(company_id: str = company_store.DEFAULT_COMPANY_ID) -> list[phase3.ProjectSummary]:
    """Workstream 11: "show me my projects to pick from" -- every project
    this company has either a Phase 1 record for or any Phase 3 data for.
    A project that's Phase-1-only (has_baseline=False) is exactly the
    case for POST .../baseline with source_type='phase1_estimate' -- a
    running project without a real baseline yet.
    """
    return phase3.list_projects(company_id)


def _validate_floor_area(floor_area_sqm: Optional[float], floor_area_basis: Optional[FloorAreaBasis]) -> None:
    if (floor_area_sqm is None) != (floor_area_basis is None):
        raise HTTPException(
            status_code=400,
            detail="floor_area_sqm and floor_area_basis must be given together, or not at all.",
        )


@router.post("/projects/{project_id}/baseline", response_model=phase3.Phase3Baseline)
async def record_baseline(
    project_id: str,
    source_type: phase3.BaselineSourceType = Form(...),
    file: Optional[UploadFile] = File(None, description="A BOQ (.xlsx/.xls) when source_type='boq', or a Work Order (.pdf) when source_type='wo'. Omit entirely when source_type='phase1_estimate' -- that path reads the project's existing Phase 1 record instead."),
    sheet_name: Optional[str] = Form(None),
    floor_area_sqm: Optional[float] = Form(None),
    floor_area_basis: Optional[FloorAreaBasis] = Form(None),
    company_id: str = Form(company_store.DEFAULT_COMPANY_ID),
    master_json_path: Optional[str] = Form(None),
    structural_system_type: Optional[str] = Form(None),
    num_floors: Optional[int] = Form(None),
    typology: Optional[str] = Form(None),
    overwrite: bool = Form(False),
    project_name: Optional[str] = Form(None, description="A human-readable label for this project. Only meaningful for source_type='boq'/'wo' -- a project with a Phase 1 record already has a name there, which takes priority in GET /phase3/projects regardless of what's passed here."),
) -> phase3.Phase3Baseline:
    """Records THIS project's original, full-scope calculation as its
    Phase 3 baseline -- every bill uploaded afterward is compared against
    this, never against another bill. Recording a second baseline for the
    same project requires overwrite=True (a project should normally have
    exactly one baseline; replacing it silently would invalidate every
    dashboard figure already derived from the old one).

    source_type='phase1_estimate' (Workstream 11) is the "running project
    without a [real] baseline" path -- for a project that hasn't been
    billed against a Bill of Quantities yet. It takes no file at all: it
    reads this project_id's EXISTING Phase 1 record (submitted earlier
    via POST /form) and reuses Phase 1's own calculate_embodied_carbon()/
    estimate_cost() to produce an estimated baseline, flagged
    is_estimated=True on the response. Swap it for a real one later with
    source_type='boq'/'wo' and overwrite=True once a BOQ/WO exists.

    Passing floor_area_sqm (and, ideally, structural_system_type/
    num_floors/typology) enables the dashboard's typical-building
    benchmark comparison later -- see app/services/phase3.py's
    _typical_building_carbon_per_sqm. None of these are required to
    record a baseline at all (and are ignored for source_type=
    'phase1_estimate', which pulls the same information straight off the
    Phase 1 record instead); they just unlock that one comparison.
    """
    if source_type != "phase1_estimate":
        _validate_floor_area(floor_area_sqm, floor_area_basis)

    if not overwrite and phase3.load_baseline(company_id, project_id) is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Project '{project_id}' already has a Phase 3 baseline recorded. Pass overwrite=True to replace it.",
        )

    if source_type == "phase1_estimate":
        try:
            baseline = phase3.baseline_from_phase1_estimate(project_id, company_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        phase3.save_baseline(baseline)
        return baseline

    if file is None:
        raise HTTPException(
            status_code=400,
            detail="A file is required when source_type is 'boq' or 'wo' (only 'phase1_estimate' skips it).",
        )

    if source_type == "boq":
        if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Expected an .xlsx or .xls file when source_type='boq'")
        suffix = ".xlsx"
    else:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Expected a .pdf file when source_type='wo'")
        suffix = ".pdf"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        if source_type == "boq":
            resolved_sheet = sheet_name
            if resolved_sheet is None:
                resolved_sheet, _ = extract_from_first_primary_sheet(str(tmp_path), SUPPLEMENTARY_SHEET_PATTERNS)
            result = calculate_from_boq(
                str(tmp_path), resolved_sheet, floor_area_sqm=floor_area_sqm, floor_area_basis=floor_area_basis
            )
            result.source_file = file.filename
            baseline = phase3.baseline_from_boq_result(
                result, project_id, company_id,
                structural_system_type=structural_system_type, num_floors=num_floors, typology=typology,
                project_name=project_name,
            )
            # Workstream 14 (Phase 4): stash the full structured result
            # (line items included) alongside the baseline -- this is
            # what confirm_recommendation() overlays confirmed changes
            # onto later. WO-sourced baselines don't get this yet (see
            # phase4.py's module docstring for why that's a disclosed,
            # deliberate scope cut, not an oversight).
            phase3.save_source_result(company_id, project_id, result)
        else:
            resolved_master_path = (
                Path(master_json_path) if master_json_path else company_store.master_item_codes_path(company_id)
            )
            if not resolved_master_path.exists():
                raise HTTPException(
                    status_code=500,
                    detail=f"Master item-code dataset not found for company '{company_id}' at {resolved_master_path}",
                )
            result = calculate_from_work_order(
                str(tmp_path), str(resolved_master_path), floor_area_sqm=floor_area_sqm, floor_area_basis=floor_area_basis
            )
            if result.n_line_items_parsed == 0:
                raise HTTPException(
                    status_code=422,
                    detail="Could not extract any line items from this PDF -- it may be a scanned/image-only document.",
                )
            result.source_file = file.filename
            baseline = phase3.baseline_from_wo_result(
                result, project_id, company_id,
                structural_system_type=structural_system_type, num_floors=num_floors, typology=typology,
                project_name=project_name,
            )

        phase3.save_baseline(baseline)
        return baseline
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PdfminerException as e:
        raise HTTPException(status_code=400, detail=f"Could not read this file as a PDF: {e}")
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError as e:
            print(f"[phase3] Warning: could not delete temp file {tmp_path}: {e}")


@router.post("/projects/{project_id}/bills", response_model=phase3.BillPeriod)
async def upload_bill(
    project_id: str,
    period: str = Form(..., description="A human label for this billing period, e.g. '2026-Q3'. Also used as this bill's storage id."),
    billed_date: str = Form(..., description="ISO date (YYYY-MM-DD) this bill is as-of -- the real ordering key for the dashboard's time series."),
    bill_file: UploadFile = File(..., description="A BOQ-shaped Excel file (.xlsx/.xls) with quantities-TO-DATE, not incremental quantities since the last bill -- OR a Certificate of Payment PDF (.pdf, 'Phase 5') with its own Cummulative Quanity Summary table, Item-Code-keyed against the same master item-code dataset a Work Order upload uses."),
    sheet_name: Optional[str] = Form(None),
    stated_percent_complete: Optional[float] = Form(None, description="0-100. If given, used directly for the projection instead of deriving it from billed value vs. the baseline's total_value."),
    company_id: str = Form(company_store.DEFAULT_COMPANY_ID),
    overwrite: bool = Form(False),
    quantity_basis: str = Form("cummulative", description="PDF (Certificate of Payment) bills only, ignored for .xlsx/.xls -- 'cummulative' (default: this bill's total quantity to date, from the COP's Cummu. column) or 'present' (this billing period's quantity only, from the COP's Present column -- NOT cumulative)."),
) -> phase3.BillPeriod:
    if quantity_basis not in ("cummulative", "present"):
        raise HTTPException(status_code=400, detail="quantity_basis must be 'cummulative' or 'present'.")

    baseline = phase3.load_baseline(company_id, project_id)
    if baseline is None:
        raise HTTPException(
            status_code=400,
            detail=f"Project '{project_id}' has no Phase 3 baseline recorded yet -- "
            f"record one via POST /phase3/projects/{{project_id}}/baseline before uploading bills.",
        )

    if stated_percent_complete is not None and not (0 <= stated_percent_complete <= 100):
        raise HTTPException(status_code=400, detail="stated_percent_complete must be between 0 and 100.")

    filename_lower = (bill_file.filename or "").lower()
    is_pdf = filename_lower.endswith(".pdf")
    is_excel = filename_lower.endswith((".xlsx", ".xls"))
    if not filename_lower or not (is_pdf or is_excel):
        raise HTTPException(status_code=400, detail="Expected an .xlsx/.xls file, or a .pdf Certificate of Payment ('Phase 5')")

    if not overwrite and phase3.load_bill_period(company_id, project_id, period) is not None:
        raise HTTPException(
            status_code=400,
            detail=f"A bill for period '{period}' already exists for project '{project_id}'. Pass overwrite=True to replace it.",
        )

    with tempfile.NamedTemporaryFile(suffix=".pdf" if is_pdf else ".xlsx", delete=False) as tmp:
        shutil.copyfileobj(bill_file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        if is_pdf:
            # "Phase 5": a Certificate of Payment PDF -- Item-Code-keyed
            # against this company's own master_item_codes.json, the
            # exact same dataset a Work Order upload already resolves
            # against (see app/services/phase3_cop_engine.py's module
            # docstring). Still the SAME BillPeriod/compute_dashboard()
            # every xlsx-sourced bill goes through -- one baseline, one
            # dashboard, whichever format a given quarter's bill is.
            master_path = company_store.master_item_codes_path(company_id)
            if not master_path.exists():
                raise HTTPException(
                    status_code=500,
                    detail=f"Master item-code dataset not found for company '{company_id}' at {master_path}",
                )
            cop_result = calculate_from_cop_pdf(str(tmp_path), str(master_path), quantity_basis=quantity_basis)
            if cop_result.n_lines_total == 0:
                raise HTTPException(
                    status_code=422,
                    detail="Could not extract any line items from this PDF -- it may be a scanned/image-only "
                    "document, or not laid out as a 'Cummulative Quanity Summary' Certificate of Payment.",
                )
            cop_result.source_file = bill_file.filename
            bill = phase3.bill_from_cop_result(
                cop_result, project_id, company_id, period=period, billed_date=billed_date,
                stated_percent_complete=stated_percent_complete,
            )
        else:
            resolved_sheet = sheet_name
            if resolved_sheet is None:
                resolved_sheet, _ = extract_from_first_primary_sheet(str(tmp_path), SUPPLEMENTARY_SHEET_PATTERNS)

            # Reuse the baseline's own floor area for a per-sqm figure on
            # this bill too, when the baseline recorded one -- a bill is
            # the SAME building, so its floor area can't differ from the
            # baseline's.
            result = calculate_from_boq(
                str(tmp_path), resolved_sheet,
                floor_area_sqm=baseline.floor_area_sqm, floor_area_basis=baseline.floor_area_basis,
            )
            result.source_file = bill_file.filename

            bill = phase3.bill_from_boq_result(
                result, project_id, company_id, period=period, billed_date=billed_date,
                stated_percent_complete=stated_percent_complete,
            )

        phase3.save_bill_period(bill, overwrite=overwrite)
        return bill
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PdfminerException as e:
        raise HTTPException(status_code=400, detail=f"Could not read this file as a PDF: {e}")
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError as e:
            print(f"[phase3] Warning: could not delete temp file {tmp_path}: {e}")


@router.get("/projects/{project_id}/bills", response_model=list[phase3.BillPeriod])
def list_bills(project_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> list[phase3.BillPeriod]:
    return phase3.list_bill_periods(company_id, project_id)


class DeleteBillResponse(BaseModel):
    deleted: bool
    project_id: str
    period: str


@router.delete("/projects/{project_id}/bills/{period}", response_model=DeleteBillResponse)
def delete_bill(project_id: str, period: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> DeleteBillResponse:
    """UX refinement: "remove an uploaded bill" -- a bill logged by
    mistake (wrong file, wrong period, or a present-basis COP that
    shouldn't have been mixed into the chart) can now be removed instead
    of having to overwrite it with a correct re-upload under the same
    period label. Irreversible, no soft-delete, matching every other
    delete in this app (DELETE /projects/{id}, DELETE /{company}/...) --
    not an error to delete a period that doesn't exist, same "delete is
    idempotent" convention those already follow.
    """
    deleted = phase3.delete_bill_period(company_id, project_id, period)
    return DeleteBillResponse(deleted=deleted, project_id=project_id, period=period)


@router.get("/projects/{project_id}/dashboard", response_model=phase3.DashboardResult)
def get_dashboard(project_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> phase3.DashboardResult:
    try:
        return phase3.compute_dashboard(company_id, project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# --------------------------------------------------------------------------
# Workstream 12: the "what-if" chatbot
# --------------------------------------------------------------------------


class ChatRequest(BaseModel):
    question: str


@router.get("/chat/tools")
def list_chat_tools() -> dict:
    """The closed set of what-if questions the chatbot can currently
    answer -- for a frontend to render as suggested prompts/buttons
    rather than guessing what's askable. Static metadata, not a live
    call -- see app/services/chatbot.py's TOOL_CATALOG.
    """
    return chatbot.TOOL_CATALOG


@router.post("/projects/{project_id}/chat", response_model=chatbot.ChatAnswer)
def chat(
    project_id: str, request: ChatRequest, company_id: str = company_store.DEFAULT_COMPANY_ID
) -> chatbot.ChatAnswer:
    """Answers a natural-language what-if question about this project's
    Phase 1 record with a REAL recomputed number -- never an LLM-guessed
    one. See app/services/chatbot.py's module docstring for the full
    design and its two disclosed scope decisions (deterministic
    narration; Phase 1-record-only tool surface).

    Always returns 200 -- an unparseable question, a project with no
    Phase 1 record, or an invalid parameter all come back as a normal
    ChatAnswer with applied=False and an explanatory answer_text/error,
    not an HTTP error, since each of these is a legitimate conversational
    outcome a chat UI should render as a reply, not a failure toast.
    """
    return chatbot.answer_question(project_id, company_id, request.question)


# --------------------------------------------------------------------------
# UX refinement (Phase E): the Tracking & Chat hub's chat bar posts here
# instead of directly to a fixed project's own /chat endpoint above, so a
# question can name a DIFFERENT project mid-conversation and the chat
# follows it there -- the locked "chat can name-switch projects" plan
# decision. This is a thin router: it resolves a project mention (Phase
# A's name registry, fuzzy-matched by project_resolver) and then
# delegates to the exact same chatbot.answer_question() the per-project
# endpoint above already uses -- no duplicated chat logic.
# --------------------------------------------------------------------------


class HubChatRequest(BaseModel):
    company_id: str = company_store.DEFAULT_COMPANY_ID
    question: str
    active_project_id: Optional[str] = None


class HubChatResponse(BaseModel):
    answer: chatbot.ChatAnswer
    # Set only when the question named a DIFFERENT project than
    # active_project_id confidently enough to switch to it -- an ordinary
    # question with no project name in it always keeps talking about
    # active_project_id, exactly like the original per-project endpoint.
    switched_to: Optional[dict] = None


@router.post("/chat", response_model=HubChatResponse)
def hub_chat(request: HubChatRequest) -> HubChatResponse:
    resolved = project_resolver.resolve_project_mention(request.company_id, request.question)
    target_project_id = request.active_project_id
    switched_to = None
    if resolved and resolved["project_id"] != request.active_project_id:
        target_project_id = resolved["project_id"]
        switched_to = resolved

    if target_project_id is None:
        raise HTTPException(
            status_code=400,
            detail="No project is selected, and none could be resolved from the question -- mention a project by name, or select one first.",
        )

    answer = chatbot.answer_question(target_project_id, request.company_id, request.question)
    return HubChatResponse(answer=answer, switched_to=switched_to)