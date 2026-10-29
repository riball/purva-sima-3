"""UX refinement (Phase C): the background-task bodies for a BOQ/WO
upload, plus the "use this job's result as a project's baseline" step
that closes the loop without re-uploading the file.

Deliberately calls the SAME core engine functions the existing
synchronous endpoints already use --
app.services.boq_carbon.engine.calculate_from_boq and
app.services.wo_carbon.wo_carbon_engine.calculate_from_work_order --
so there is exactly one place the actual carbon math happens, same as
before this module existed. What's new here is only the surrounding
control flow: running that calculation on a background thread
(FastAPI's BackgroundTasks, scheduled from app/api/uploads.py) instead of
inline in the request handler, and persisting BOTH a compact summary (for
job_store.JobRecord, cheap to poll) and the FULL structured result (for
the eventual "use this as my baseline" action, so the file never has to
be re-uploaded/re-parsed).

app/api/boq_carbon.py and app/api/wo_carbon.py's own synchronous
endpoints are left completely unchanged by this module -- they remain the
single-file, blocking path for any caller that wants a result back in
one request/response (e.g. a script, or the existing What-If Substitution
Sandbox). This module is an additional path to the same calculation, not
a replacement.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from app.services import company_store, job_store, phase3, reference_store
from app.services.boq_cache import save_extraction
from app.services.boq_carbon.engine import BoqCarbonResult, FloorAreaBasis, calculate_from_boq
from app.services.boq_carbon.parser import extract_from_first_primary_sheet
from app.services.boq_extractor import SUPPLEMENTARY_SHEET_PATTERNS, extract_boq
from app.services.wo_carbon.wo_carbon_engine import WoCarbonResult, calculate_from_work_order


def _result_path(company_id: str, job_id: str) -> Path:
    return company_store.company_dir(company_id) / "jobs" / f"{job_id}_result.json"


def _save_full_result(company_id: str, job_id: str, result: BoqCarbonResult | WoCarbonResult) -> None:
    # Atomic write-then-rename -- see company_store.atomic_write_json's
    # docstring (part of the backend-wide fix for the truncated-file race
    # a concurrency stress test reproduced live in this app).
    path = _result_path(company_id, job_id)
    company_store.atomic_write_json(path, result.model_dump(mode="json"))


def load_full_result(company_id: str, job_id: str, kind: str):
    path = _result_path(company_id, job_id)
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    return BoqCarbonResult.model_validate(data) if kind == "boq" else WoCarbonResult.model_validate(data)


def _summarize_boq(result: BoqCarbonResult) -> dict:
    return {
        "total_gwp_kg_co2e": result.total_gwp_kg_co2e,
        "total_gwp_tonnes_co2e": result.total_gwp_tonnes_co2e,
        "gwp_per_sqm": result.gwp_per_sqm,
        "gwp_per_sqft": result.gwp_per_sqft,
        "n_lines_computed": result.n_lines_computed,
        "n_lines_total": result.n_lines_total,
        "coverage_pct": result.coverage.coverage_pct if result.coverage else None,
        "top5_coverage_pct": result.coverage.top5_coverage_pct if result.coverage else None,
        "source_file": result.source_file,
    }


def _summarize_wo(result: WoCarbonResult) -> dict:
    return {
        "total_gwp_kg_co2e": result.total_gwp_kg_co2e,
        "total_gwp_tonnes_co2e": result.total_gwp_tonnes_co2e,
        "gwp_per_sqm": result.gwp_per_sqm,
        "gwp_per_sqft": result.gwp_per_sqft,
        "n_lines_computed": result.n_line_items_computed,
        "n_lines_total": result.n_line_items_parsed,
        "coverage_pct": result.coverage.coverage_pct if result.coverage else None,
        "top5_coverage_pct": result.coverage.top5_coverage_pct if result.coverage else None,
        "source_file": result.source_file,
    }


def run_boq_job(
    company_id: str,
    job_id: str,
    tmp_path: str,
    original_filename: str,
    sheet_name: Optional[str],
    floor_area_sqm: Optional[float],
    floor_area_basis: Optional[FloorAreaBasis],
    register_as_reference: bool,
    structural_system_type: Optional[str],
    typology: Optional[str],
    reference_slug: Optional[str],
) -> None:
    """Background-task body for a BOQ upload. `tmp_path` must be a file
    this function owns and is responsible for deleting -- the caller
    (app/api/uploads.py) copies the UploadFile's bytes to it SYNCHRONOUSLY
    before scheduling this task, since an UploadFile's underlying stream
    is closed once the request that created it returns.
    """
    job_store.mark_running(company_id, job_id)
    try:
        resolved_sheet = sheet_name
        if resolved_sheet is None:
            resolved_sheet, _ = extract_from_first_primary_sheet(tmp_path, SUPPLEMENTARY_SHEET_PATTERNS)

        result = calculate_from_boq(tmp_path, resolved_sheet, floor_area_sqm=floor_area_sqm, floor_area_basis=floor_area_basis)
        result.source_file = original_filename

        if register_as_reference:
            slug = reference_slug or reference_store.slugify(Path(original_filename).stem)
            extraction = extract_boq(tmp_path, use_llm_fallback=True)
            save_extraction(slug, extraction, company_id=company_id)
            reference_store.upsert_metadata(
                slug, structural_system_type=structural_system_type, typology=typology,
                gfa_sqm=floor_area_sqm, company_id=company_id,
            )
            result.registered_as_reference = True
            result.reference_slug = slug

        _save_full_result(company_id, job_id, result)
        job_store.mark_succeeded(company_id, job_id, _summarize_boq(result))
    except Exception as e:  # noqa: BLE001 -- a background task with no request/response to raise into; the job record IS the error channel
        job_store.mark_failed(company_id, job_id, str(e))
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass


def run_wo_job(
    company_id: str,
    job_id: str,
    tmp_path: str,
    original_filename: str,
    floor_area_sqm: Optional[float],
    floor_area_basis: Optional[FloorAreaBasis],
    register_as_reference: bool,
    structural_system_type: Optional[str],
    typology: Optional[str],
    reference_slug: Optional[str],
) -> None:
    job_store.mark_running(company_id, job_id)
    try:
        master_path = company_store.master_item_codes_path(company_id)
        if not master_path.exists():
            raise ValueError(f"Master item-code dataset not found for company '{company_id}'.")

        result = calculate_from_work_order(tmp_path, str(master_path), floor_area_sqm=floor_area_sqm, floor_area_basis=floor_area_basis)
        if result.n_line_items_parsed == 0:
            raise ValueError("Could not extract any line items from this PDF -- it may be a scanned/image-only document.")
        result.source_file = original_filename

        if register_as_reference:
            slug = reference_slug or reference_store.slugify(Path(original_filename).stem)
            reference_store.upsert_metadata(
                slug, structural_system_type=structural_system_type, typology=typology,
                gfa_sqm=floor_area_sqm, company_id=company_id,
            )
            result.registered_as_reference = True
            result.reference_slug = slug

        _save_full_result(company_id, job_id, result)
        job_store.mark_succeeded(company_id, job_id, _summarize_wo(result))
    except Exception as e:  # noqa: BLE001
        job_store.mark_failed(company_id, job_id, str(e))
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass


def use_job_as_baseline(
    company_id: str,
    job_id: str,
    project_id: str,
    structural_system_type: Optional[str] = None,
    num_floors: Optional[int] = None,
    typology: Optional[str] = None,
    project_name: Optional[str] = None,
    overwrite: bool = False,
) -> phase3.Phase3Baseline:
    """The "Use as Baseline" action (JobResultsCompare.jsx, Phase C
    frontend) -- records a succeeded job's ALREADY-COMPUTED result as a
    project's Phase 3 baseline, reusing phase3.baseline_from_boq_result/
    baseline_from_wo_result + save_baseline/save_source_result exactly as
    app/api/phase3.py's record_baseline endpoint does, just without
    re-parsing the source file (it was already parsed once, in the
    background job). Raises ValueError on any problem -- no job, job not
    succeeded, or (per phase4.py's own documented scope cut) a WO result
    picked as baseline still records fine here (baseline_from_wo_result
    supports it), it's specifically PHASE 4's live-substitution overlay
    that stays BOQ-only, unchanged.
    """
    job = job_store.load_job(company_id, job_id)
    if job is None:
        raise ValueError(f"No job '{job_id}' found for company '{company_id}'.")
    if job.status != "succeeded":
        raise ValueError(f"Job '{job_id}' is '{job.status}', not 'succeeded' -- nothing to record as a baseline yet.")

    if not overwrite and phase3.load_baseline(company_id, project_id) is not None:
        raise ValueError(f"Project '{project_id}' already has a Phase 3 baseline recorded. Pass overwrite=True to replace it.")

    result = load_full_result(company_id, job_id, job.kind)
    if result is None:
        raise ValueError(f"Job '{job_id}'s full result is no longer available.")

    if job.kind == "boq":
        baseline = phase3.baseline_from_boq_result(
            result, project_id, company_id,
            structural_system_type=structural_system_type, num_floors=num_floors, typology=typology,
            project_name=project_name,
        )
        phase3.save_source_result(company_id, project_id, result)
    else:
        baseline = phase3.baseline_from_wo_result(
            result, project_id, company_id,
            structural_system_type=structural_system_type, num_floors=num_floors, typology=typology,
            project_name=project_name,
        )
        # Bug fix (found while building Phase 4's catalog-preview grid): this
        # branch recorded the baseline but never persisted the structured
        # source result, unlike the boq branch above and unlike
        # api/phase3.py's own record_baseline endpoint (which saves it for
        # WO too). Without it, phase4._load_current_state can't find a
        # structured result at all for any project baselined via "Use as
        # Baseline" from a WO upload job -- not even a legitimate
        # applicable: false, just a hard "record its baseline again" error.
        phase3.save_source_result(company_id, project_id, result)

    phase3.save_baseline(baseline)
    job_store.set_project_id(company_id, job_id, project_id)
    return baseline
