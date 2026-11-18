"""UX refinement (Phase C): background-job endpoints for a BOQ/Work
Order upload, plus the combined "upload both at once" endpoint the user
asked for. See app/services/job_store.py and app/services/upload_jobs.py
for the storage/execution design -- this module is deliberately thin,
turning HTTP into a FastAPI BackgroundTasks call and nothing more.

The existing synchronous endpoints (`POST /boq-carbon/calculate`,
`POST /wo-carbon/calculate`) are untouched and still work exactly as
before -- this is an ADDITIONAL path to the same calculation
(upload_jobs.py calls the identical calculate_from_boq/
calculate_from_work_order functions), for a frontend that wants to kick
off the ~37s-worst-case calculation and keep browsing rather than block
on it.

Locked design decision (confirmed with the user before this was built):
a combined BOQ+WO upload runs as two INDEPENDENT jobs -- their results
are never merged into one total. The user reviews both once they finish
and explicitly picks which one (if either) becomes the project's Phase 3
baseline via `POST /uploads/jobs/{job_id}/use-as-baseline`.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.services import company_store, job_store, upload_jobs
from app.services.boq_carbon import sheets as boq_sheets
from app.services.boq_carbon.engine import FloorAreaBasis
from app.services.phase3 import Phase3Baseline

router = APIRouter(prefix="/uploads", tags=["uploads"])


def _save_upload_to_tmp(upload: UploadFile, suffix: str) -> str:
    """Copies an UploadFile's bytes to a durable temp file SYNCHRONOUSLY,
    inside the request handler -- required before scheduling a
    BackgroundTasks call, since UploadFile's underlying stream closes the
    moment this request returns, before a background task would ever get
    a chance to read it. The background task (run_boq_job/run_wo_job)
    owns deleting this file once it's done."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(upload.file, tmp)
        return tmp.name


def _unique_display_names(filenames: list[str]) -> list[str]:
    """Two uploaded files may share a name (e.g. "BOQ.xlsx" from two
    folders); the per-sheet breakdown and overlap warnings identify a
    sheet by file name, so repeats get " (2)", " (3)"... appended."""
    seen: dict[str, int] = {}
    out = []
    for name in filenames:
        seen[name] = seen.get(name, 0) + 1
        out.append(name if seen[name] == 1 else f"{Path(name).stem} ({seen[name]}){Path(name).suffix}")
    return out


def _parse_sheet_selection(raw: Optional[str], n_files: int) -> list[Optional[list[str]]]:
    """`raw` is a JSON list aligned with the uploaded BOQ files, each entry
    the list of sheet names to calculate for that file (null = every BOQ
    sheet; [] = none of this file's sheets). Missing = every BOQ sheet of
    every file."""
    if not raw:
        return [None] * n_files
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="boq_sheets must be a JSON list of sheet-name lists, one per BOQ file.")
    if not isinstance(data, list) or len(data) != n_files or any(e is not None and not isinstance(e, list) for e in data):
        raise HTTPException(status_code=400, detail="boq_sheets must be a JSON list with one entry (a list of sheet names, or null) per BOQ file.")
    return data  # null = every BOQ sheet; [] = deliberately no sheet of this file


def _check_boq_names(files: list[UploadFile]) -> None:
    for f in files:
        if not f.filename or not f.filename.lower().endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is not an .xlsx or .xls file")


@router.post("/boq/inspect")
async def inspect_boq_files(
    boq_files: list[UploadFile] = File(...),
    boq_sheets_selected: Optional[str] = Form(None),
) -> dict:
    """Lists, for each uploaded BOQ workbook, every sheet with its line count
    and value, whether it would be calculated by default, and -- if not --
    why (rate list, summary sheet, no BOQ header...). Also returns overlap
    warnings across the sheets that are (or, when `boq_sheets_selected` is
    given, are chosen to be) included, e.g. a 'Combined' sheet that is the
    other sheets merged. Calculates nothing and stores nothing; the temp
    copies are deleted before returning.
    """
    _check_boq_names(boq_files)
    names = _unique_display_names([f.filename for f in boq_files])
    selection = _parse_sheet_selection(boq_sheets_selected, len(boq_files))
    tmp_paths: list[str] = []
    out_files: list[dict] = []
    groups: list[dict] = []
    try:
        for f, name, chosen in zip(boq_files, names, selection):
            tmp = _save_upload_to_tmp(f, ".xlsx")
            tmp_paths.append(tmp)
            try:
                infos = boq_sheets.inspect_workbook(tmp)
            except Exception as e:  # noqa: BLE001 -- a corrupt workbook is reported per file, not a 500
                out_files.append({"filename": name, "error": f"Could not read this workbook: {e}", "sheets": []})
                continue
            out_files.append({"filename": name, "sheets": [i.model_dump() for i in infos]})
            use = chosen if chosen is not None else [i.name for i in infos if i.selected_by_default]
            for sh in use:
                if any(i.name == sh for i in infos):
                    groups.append({"label": f"{name} > {sh}", "items": boq_sheets.extract_billable_items(tmp, sh, source_file=name)})
        warnings = boq_sheets.detect_overlaps(groups) if len(groups) > 1 else []
    finally:
        for p in tmp_paths:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
    return {"files": out_files, "warnings": warnings}


@router.post("/boq/jobs")
async def create_boq_job(
    background_tasks: BackgroundTasks,
    boq_file: UploadFile = File(...),
    sheet_name: Optional[str] = Form(None),
    floor_area_sqm: Optional[float] = Form(None),
    floor_area_basis: Optional[FloorAreaBasis] = Form(None),
    register_as_reference: bool = Form(False),
    company_id: str = Form(company_store.DEFAULT_COMPANY_ID),
    structural_system_type: Optional[str] = Form(None),
    typology: Optional[str] = Form(None),
    reference_slug: Optional[str] = Form(None),
) -> dict:
    if not boq_file.filename or not boq_file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Expected an .xlsx or .xls file")
    if (floor_area_sqm is None) != (floor_area_basis is None):
        raise HTTPException(status_code=400, detail="floor_area_sqm and floor_area_basis must be given together, or not at all.")
    if register_as_reference and (floor_area_sqm is None or not structural_system_type or not typology):
        raise HTTPException(status_code=400, detail="floor_area_sqm, structural_system_type and typology are all required when register_as_reference=True.")

    tmp_path = _save_upload_to_tmp(boq_file, ".xlsx")
    job = job_store.create_job(company_id, "boq", boq_file.filename)
    background_tasks.add_task(
        upload_jobs.run_boq_job, company_id, job.job_id, tmp_path, boq_file.filename,
        sheet_name, floor_area_sqm, floor_area_basis, register_as_reference,
        structural_system_type, typology, reference_slug,
    )
    return {"job_id": job.job_id, "kind": "boq", "status": job.status}


@router.post("/wo/jobs")
async def create_wo_job(
    background_tasks: BackgroundTasks,
    wo_file: UploadFile = File(...),
    floor_area_sqm: Optional[float] = Form(None),
    floor_area_basis: Optional[FloorAreaBasis] = Form(None),
    register_as_reference: bool = Form(False),
    company_id: str = Form(company_store.DEFAULT_COMPANY_ID),
    structural_system_type: Optional[str] = Form(None),
    typology: Optional[str] = Form(None),
    reference_slug: Optional[str] = Form(None),
) -> dict:
    if not wo_file.filename or not wo_file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Expected a .pdf file")
    if (floor_area_sqm is None) != (floor_area_basis is None):
        raise HTTPException(status_code=400, detail="floor_area_sqm and floor_area_basis must be given together, or not at all.")
    if register_as_reference and (floor_area_sqm is None or not structural_system_type or not typology):
        raise HTTPException(status_code=400, detail="floor_area_sqm, structural_system_type and typology are all required when register_as_reference=True.")

    tmp_path = _save_upload_to_tmp(wo_file, ".pdf")
    job = job_store.create_job(company_id, "wo", wo_file.filename)
    background_tasks.add_task(
        upload_jobs.run_wo_job, company_id, job.job_id, tmp_path, wo_file.filename,
        floor_area_sqm, floor_area_basis, register_as_reference, structural_system_type, typology, reference_slug,
    )
    return {"job_id": job.job_id, "kind": "wo", "status": job.status}


@router.post("/combined")
async def create_combined_jobs(
    background_tasks: BackgroundTasks,
    boq_file: Optional[UploadFile] = File(None),
    boq_files: Optional[list[UploadFile]] = File(None),
    boq_sheets: Optional[str] = Form(None),
    wo_file: Optional[UploadFile] = File(None),
    floor_area_sqm: Optional[float] = Form(None),
    floor_area_basis: Optional[FloorAreaBasis] = Form(None),
    company_id: str = Form(company_store.DEFAULT_COMPANY_ID),
) -> dict:
    """Upload a BOQ and/or a Work Order in ONE request -- at least one of
    the two files is required. Each is calculated as its own independent
    background job (see this module's docstring for why they're never
    merged); the response carries whichever job id(s) were actually
    started, so a frontend that submitted only one file still gets a
    normal single-job response shape.

    BOQ side: send `boq_file` (one workbook) or `boq_files` (one or more).
    All BOQ workbooks sent together are calculated as ONE combined BOQ job
    -- one total, with a per-sheet breakdown -- and every BOQ sheet of each
    workbook is included unless `boq_sheets` (a JSON list aligned with the
    files, each entry the sheet names to use or null for all) says
    otherwise. The Work Order stays its own independent job, as before.
    """
    all_boq = ([boq_file] if boq_file is not None else []) + [f for f in (boq_files or []) if f is not None and f.filename]
    if not all_boq and wo_file is None:
        raise HTTPException(status_code=400, detail="Provide at least one BOQ file or a work order (wo_file).")

    response: dict = {}

    if all_boq:
        _check_boq_names(all_boq)
        selection = _parse_sheet_selection(boq_sheets, len(all_boq))
        for f, chosen in zip(all_boq, selection):
            if chosen is not None and len(chosen) == 0:
                raise HTTPException(status_code=400, detail=f"No sheet is selected for '{f.filename}' -- select at least one sheet, or leave that file out.")
        names = _unique_display_names([f.filename for f in all_boq])
        sources = [
            {"tmp_path": _save_upload_to_tmp(f, ".xlsx"), "filename": name, "sheets": chosen}
            for f, name, chosen in zip(all_boq, names, selection)
        ]
        label = names[0] if len(names) == 1 else f"{names[0]} + {len(names) - 1} more"
        boq_job = job_store.create_job(company_id, "boq", label)
        background_tasks.add_task(
            upload_jobs.run_boq_multi_job, company_id, boq_job.job_id, sources, floor_area_sqm, floor_area_basis,
        )
        response["boq_job_id"] = boq_job.job_id

    if wo_file is not None:
        if not wo_file.filename or not wo_file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="wo_file must be a .pdf file")
        tmp_path = _save_upload_to_tmp(wo_file, ".pdf")
        wo_job = job_store.create_job(company_id, "wo", wo_file.filename)
        background_tasks.add_task(
            upload_jobs.run_wo_job, company_id, wo_job.job_id, tmp_path, wo_file.filename,
            floor_area_sqm, floor_area_basis, False, None, None, None,
        )
        response["wo_job_id"] = wo_job.job_id

    return response


@router.get("/jobs/{job_id}", response_model=job_store.JobRecord)
def get_job(job_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> job_store.JobRecord:
    job = job_store.load_job(company_id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"No job '{job_id}' found.")
    return job


@router.get("/jobs/{job_id}/result")
def get_job_result(job_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> dict:
    """The FULL computed result (line items, coverage, category breakdown
    included) for a succeeded job -- job_store.JobRecord.result_summary is
    deliberately compact (cheap to poll for every active job at once);
    this endpoint is the detailed view a frontend fetches once, for the
    ONE job the user is actually looking at (JobResultsCompare.jsx).
    Returns a plain dict (shape is BoqCarbonResult for a 'boq' job,
    WoCarbonResult for a 'wo' job -- the frontend already knows which
    from the job's own `kind`, same pattern api/client.js's calculateBoq/
    calculateWo results already follow).
    """
    job = job_store.load_job(company_id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"No job '{job_id}' found.")
    if job.status != "succeeded":
        raise HTTPException(status_code=400, detail=f"Job '{job_id}' is '{job.status}', not 'succeeded' -- no result available yet.")
    result = upload_jobs.load_full_result(company_id, job_id, job.kind)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}'s result is no longer available.")
    return result.model_dump(mode="json")


@router.get("/jobs", response_model=list[job_store.JobRecord])
def list_jobs(company_id: str = company_store.DEFAULT_COMPANY_ID, active_only: bool = False) -> list[job_store.JobRecord]:
    """Powers the frontend's notification poll -- `active_only=true`
    returns just the still-running jobs, cheap to poll every few seconds.
    """
    return job_store.list_jobs(company_id, active_only=active_only)


class DeleteJobResponse(BaseModel):
    deleted: bool
    job_id: str
    company_id: str


@router.delete("/jobs/{job_id}", response_model=DeleteJobResponse)
def delete_job(job_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> DeleteJobResponse:
    """"I want to be able to delete some recent uploads" on the Analyze
    BOQ/Work Order page -- see job_store.delete_job's own docstring for
    exactly what this does and doesn't touch. 404s only when the job_id
    was never real (same shape as projects.py's delete_project), so a
    caller can't accidentally believe a no-op succeeded."""
    removed = job_store.delete_job(company_id, job_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"No job '{job_id}' found for company '{company_id}'.")
    return DeleteJobResponse(deleted=True, job_id=job_id, company_id=company_id)


class UseAsBaselineRequest(BaseModel):
    project_id: str
    company_id: str = company_store.DEFAULT_COMPANY_ID
    structural_system_type: Optional[str] = None
    num_floors: Optional[int] = None
    typology: Optional[str] = None
    project_name: Optional[str] = None
    overwrite: bool = False


@router.post("/jobs/{job_id}/use-as-baseline", response_model=Phase3Baseline)
def use_job_as_baseline(job_id: str, body: UseAsBaselineRequest) -> Phase3Baseline:
    try:
        return upload_jobs.use_job_as_baseline(
            body.company_id, job_id, body.project_id,
            structural_system_type=body.structural_system_type, num_floors=body.num_floors,
            typology=body.typology, project_name=body.project_name, overwrite=body.overwrite,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
