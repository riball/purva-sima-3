"""UX refinement (Phase C): a file-based background-job status store, the
same "everything is a JSON file, no database" philosophy every other
storage module in this codebase already uses (see project_store.py's own
docstring). Chosen over a real task queue (Celery/Redis) deliberately --
this is a single-server app whose heaviest job is a ~37s PDF parse
(wo_pdf_parser.py's own docstring cites that figure), which doesn't
justify a new piece of run-time infrastructure. FastAPI's own
`BackgroundTasks` runs the job in-process; this module is just where its
status lives so a second HTTP request (the polling endpoint) can see it.

Storage: one file per job, data/companies/<company_id>/jobs/<job_id>.json.
Writes are atomic (write to a temp file in the same directory, then
os.replace) since a background task thread and a polling request can
legitimately race to read/write the same file.

Caveat, disclosed rather than silently assumed: `BackgroundTasks` runs
in-process, so a server restart mid-job loses that job's thread -- its
record is simply left sitting at status="running" forever. This module
doesn't try to detect or resurrect that (no supervisor/heartbeat exists
anywhere in this codebase to build that on top of); a frontend polling
`GET /jobs` should treat a "running" job that's stopped progressing for
an unreasonably long time as stalled, not silently keep waiting forever.
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

JobKind = Literal["boq", "wo"]
JobStatus = Literal["queued", "running", "succeeded", "failed"]


class JobRecord(BaseModel):
    job_id: str
    company_id: str
    kind: JobKind
    source_filename: str
    status: JobStatus
    created_at: str
    updated_at: str
    # Populated on success -- a compact summary of the computed result
    # (NOT the full line-item list, which can be megabytes for a large
    # BOQ/WO -- see phase3.py's own phase3_source_result_path for where
    # that full structured result actually lives once a baseline is
    # recorded from it). Enough for the frontend's JobResultsCompare to
    # show KPIs and let the user pick which upload becomes the baseline.
    result_summary: Optional[dict] = None
    # The project_id this job's result was recorded against, once the
    # user picks "Use as Baseline" or "Save as project" -- None until
    # then, since a job's calculation and its eventual project
    # attachment are two separate steps (per the locked "independent,
    # you choose" decision for combined BOQ+WO upload).
    project_id: Optional[str] = None
    error: Optional[str] = None


def _jobs_dir(company_id: str) -> Path:
    return company_store.company_dir(company_id) / "jobs"


def _job_path(company_id: str, job_id: str) -> Path:
    return _jobs_dir(company_id) / f"{job_id}.json"


def _write_atomic(path: Path, data: dict) -> None:
    company_store.write_json(path, data)


def create_job(company_id: str, kind: JobKind, source_filename: str) -> JobRecord:
    now = datetime.now(timezone.utc).isoformat()
    job = JobRecord(
        job_id=str(uuid.uuid4()),
        company_id=company_id,
        kind=kind,
        source_filename=source_filename,
        status="queued",
        created_at=now,
        updated_at=now,
    )
    _write_atomic(_job_path(company_id, job.job_id), job.model_dump())
    return job


def _update(company_id: str, job_id: str, **fields) -> JobRecord:
    job = load_job(company_id, job_id)
    if job is None:
        raise ValueError(f"No job '{job_id}' found for company '{company_id}'")
    data = job.model_dump()
    data.update(fields)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    updated = JobRecord.model_validate(data)
    _write_atomic(_job_path(company_id, job_id), updated.model_dump())
    return updated


def mark_running(company_id: str, job_id: str) -> JobRecord:
    return _update(company_id, job_id, status="running")


def mark_succeeded(company_id: str, job_id: str, result_summary: dict, project_id: Optional[str] = None) -> JobRecord:
    return _update(company_id, job_id, status="succeeded", result_summary=result_summary, project_id=project_id)


def mark_failed(company_id: str, job_id: str, error: str) -> JobRecord:
    return _update(company_id, job_id, status="failed", error=error)


def set_project_id(company_id: str, job_id: str, project_id: str) -> JobRecord:
    """Called once the user picks 'Use as Baseline' or 'Save as project'
    for this job's result -- links a completed job to the project it
    ended up attached to, so a later notification/history view can trace
    the two together."""
    return _update(company_id, job_id, project_id=project_id)


def load_job(company_id: str, job_id: str) -> Optional[JobRecord]:
    path = _job_path(company_id, job_id)
    raw = company_store.read_json(path)
    if raw is None:
        return None
    return JobRecord.model_validate(raw)


def delete_job(company_id: str, job_id: str) -> bool:
    """"I want to be able to delete some recent uploads" on the Analyze
    BOQ/Work Order page -- removes a job's status record AND its full
    computed result file (see upload_jobs._result_path's identical
    "<job_id>_result.json" naming, which list_jobs above already knows to
    skip when globbing). Deliberately does NOT touch anything downstream
    of the job: if the user already ran "Use as Baseline" on this job
    (job.project_id is set), that project and its baseline are untouched
    -- the job record is only this page's own upload history, not the
    project's data.

    Returns True if anything was actually removed, False if there was
    nothing to delete (route uses this to 404 rather than silently
    succeeding on an id that was never real, same pattern
    app/api/projects.py's delete_project already follows)."""
    job_path = _job_path(company_id, job_id)
    result_path = job_path.with_name(f"{job_id}_result.json")
    removed = company_store.delete_json(job_path)
    removed = company_store.delete_json(result_path) or removed
    return removed


def list_jobs(company_id: str, active_only: bool = False) -> list[JobRecord]:
    """Bugfix: this directory holds two different kinds of file side by
    side -- one JobRecord per job at "<job_id>.json" (what this function
    is supposed to read), and, once a job succeeds, its full computed
    result at "<job_id>_result.json" (written by
    upload_jobs._save_full_result -- a BoqCarbonResult/WoCarbonResult, a
    completely different schema, e.g. a top-level "source_file" key
    instead of JobRecord's "source_filename"). The old glob("*.json")
    matched BOTH, so as soon as one job succeeded, polling this endpoint
    started trying to validate that job's *_result.json as a JobRecord
    and crashing with a 500 on every single poll (every ~5s from the
    frontend's notification loop) -- also silently hiding every other
    job's status behind that crash. Skipping any "*_result.json" name
    here is the fix; a JobRecord's own filename is always exactly
    "<job_id>.json", never with that suffix.
    """
    jobs = [
        JobRecord.model_validate(raw)
        for raw in company_store.list_json_docs(_jobs_dir(company_id), exclude_suffix="_result.json")
    ]
    if active_only:
        jobs = [j for j in jobs if j.status in ("queued", "running")]
    return sorted(jobs, key=lambda j: j.created_at, reverse=True)
