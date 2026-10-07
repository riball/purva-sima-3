"""UX refinement: a first-class "named project" surface, on top of
app/services/project_registry.py (see that module's own docstring for
why it exists -- Phase 1's and Phase 3's own `project_name` fields were
each populated incidentally, with no shared place to look a project up
by name or save one before any phase-specific record exists yet).

Three endpoints, deliberately thin -- all the real logic lives in
project_registry.py, this module only turns HTTP into calls into it:

- POST /projects        -- mint a brand-new project_id + register a name.
  Used by the "save as project" action when NO Phase 1 record and NO
  Phase 3 baseline exists yet for this project (e.g. right after a
  Phase 2 background job finishes and the user wants to name/keep the
  result before it's tied to any baseline).
- GET  /projects/search  -- fuzzy name search, scoped to one company.
  Powers the Projects menu's search box and the chatbot's name-mention
  resolution (app/services/project_resolver.py).
- PATCH /projects/{id}/name -- rename. Best-effort syncs the name onto
  the Phase 1 record and/or Phase 3 baseline too, if either exists, so
  anything still reading THOSE fields directly (existing code, unchanged)
  sees the same name rather than a stale one.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import company_store, phase3, project_registry, project_store

router = APIRouter(prefix="/projects", tags=["projects"])


class CreateNamedProjectRequest(BaseModel):
    company_id: str = company_store.DEFAULT_COMPANY_ID
    project_name: str


class CreateNamedProjectResponse(BaseModel):
    project_id: str
    company_id: str
    project_name: str


@router.post("", response_model=CreateNamedProjectResponse)
def create_named_project(body: CreateNamedProjectRequest) -> CreateNamedProjectResponse:
    project_id = str(uuid.uuid4())
    try:
        entry = project_registry.register_project(body.company_id, project_id, body.project_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return CreateNamedProjectResponse(project_id=project_id, company_id=body.company_id, project_name=entry.project_name)


@router.get("/search")
def search_projects(company_id: str = company_store.DEFAULT_COMPANY_ID, q: str = "", limit: int = 5) -> list[dict]:
    if not q.strip():
        # An empty query returns every named project (sorted by name) --
        # useful for a "browse all projects" picker, not just a live
        # as-you-type search.
        return project_registry.list_named_projects(company_id)
    return project_registry.find_project_by_name(company_id, q, limit=limit)


class RenameProjectRequest(BaseModel):
    company_id: str = company_store.DEFAULT_COMPANY_ID
    project_name: str


@router.patch("/{project_id}/name", response_model=CreateNamedProjectResponse)
def rename_project(project_id: str, body: RenameProjectRequest) -> CreateNamedProjectResponse:
    try:
        entry = project_registry.rename_project(body.company_id, project_id, body.project_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Best-effort sync onto the Phase 1 record and/or Phase 3 baseline, if
    # either exists -- non-fatal: this endpoint's job is done once the
    # registry (the new source of truth for "what is this project called")
    # is updated. Any code that still reads project.project_name or
    # baseline.project_name directly (unchanged, pre-existing call sites)
    # sees the same name too, rather than one that's now stale relative
    # to the registry.
    try:
        phase1_project = project_store.load_project(project_id, company_id=body.company_id)
        if phase1_project is not None:
            phase1_project.project_name = entry.project_name
            project_store.save_project(phase1_project)
    except Exception:
        pass

    try:
        baseline = phase3.load_baseline(body.company_id, project_id)
        if baseline is not None:
            baseline.project_name = entry.project_name
            phase3.save_baseline(baseline)
    except Exception:
        pass

    return CreateNamedProjectResponse(project_id=project_id, company_id=body.company_id, project_name=entry.project_name)


class DeleteProjectResponse(BaseModel):
    deleted: bool
    project_id: str
    company_id: str


@router.delete("/{project_id}", response_model=DeleteProjectResponse)
def delete_project(project_id: str, company_id: str = company_store.DEFAULT_COMPANY_ID) -> DeleteProjectResponse:
    """UX refinement: "I want to be able to delete projects from the
    projects tab." Permanently removes everything this project ID owns --
    its name-registry entry, its Phase 1 record, and its whole Phase 3/4
    directory (baseline, every bill, the mutable source result, Phase 4's
    recommendations and audit log). Irreversible, with no soft-delete or
    undo -- matching how every other write in this codebase already works
    (no version history anywhere else either). 404s only when NONE of
    those three storage locations have anything for this project_id at
    all, so a caller can't accidentally "delete" an id that was never a
    real project; otherwise, missing pieces are silently skipped (a
    Phase-1-only project has no baseline directory to remove, and that's
    fine).
    """
    had_anything = (
        project_registry.get_project_name(company_id, project_id) is not None
        or project_store.load_project(project_id, company_id=company_id) is not None
        or phase3.load_baseline(company_id, project_id) is not None
    )
    if not had_anything:
        raise HTTPException(status_code=404, detail=f"No project '{project_id}' found for company '{company_id}'.")

    project_registry.remove_project(company_id, project_id)
    project_store.delete_project(project_id, company_id=company_id)
    phase3.delete_project_data(company_id, project_id)

    return DeleteProjectResponse(deleted=True, project_id=project_id, company_id=company_id)
