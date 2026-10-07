"""Named-project registry -- the missing "save with a name tag, find it
again from anywhere" layer the UX refinement asked for.

Before this module, `project_name` was an incidental byproduct of
whichever phase happened to touch a project first: Phase 1's
`ProjectSchema.project_name` if a tiered form was ever submitted, else
Phase 3's `Phase3Baseline.project_name` if a baseline was ever recorded
with one, else nothing at all. There was no single place to look up "what
is this project called" without already knowing which phase populated it,
and no way to search projects by name.

This module is the same self-healing-registry pattern
`app/services/company_registry.py` already established one level up (see
that module's own docstring) -- a lightweight, explicit index on top of
storage that already exists, not a replacement for it. It never becomes
the source of truth for anything except the name itself; Phase 1's and
Phase 3's own `project_name` fields keep working exactly as before for any
code that doesn't know this registry exists.

Storage: one file per company, `data/companies/<company_id>/project_registry.json`,
mapping `project_id -> {project_name, created_at, updated_at}`.
"""

from __future__ import annotations

import difflib
import json
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel

from app.services import company_store


class ProjectNameEntry(BaseModel):
    project_id: str
    project_name: str
    created_at: str
    updated_at: str


def _registry_path(company_id: str):
    return company_store.company_dir(company_id) / "project_registry.json"


def _load_registry(company_id: str) -> dict[str, ProjectNameEntry]:
    path = _registry_path(company_id)
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    return {pid: ProjectNameEntry(**entry) for pid, entry in raw.items()}


def _save_registry(company_id: str, registry: dict[str, ProjectNameEntry]) -> None:
    path = _registry_path(company_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({pid: entry.model_dump() for pid, entry in registry.items()}, indent=2))


def register_project(company_id: str, project_id: str, project_name: str) -> ProjectNameEntry:
    """Upsert a project's name into the registry. Called automatically
    from `project_store.save_project()` (whenever a Phase 1 record has a
    name) and from `phase3.save_baseline()` (whenever a baseline is first
    recorded with one) -- see those modules' own hooks -- as well as
    directly from `POST /projects` and `PATCH /projects/{id}/name`
    (app/api/projects.py) for an explicit "save as project"/rename action.
    A blank/whitespace-only name is a no-op (returns the existing entry,
    or raises if there isn't one) -- registering an empty name would make
    a project unfindable by name while still claiming to have one.
    """
    name = project_name.strip()
    if not name:
        raise ValueError("project_name cannot be blank.")

    registry = _load_registry(company_id)
    now = datetime.now(timezone.utc).isoformat()
    existing = registry.get(project_id)
    entry = ProjectNameEntry(
        project_id=project_id,
        project_name=name,
        created_at=existing.created_at if existing else now,
        updated_at=now,
    )
    registry[project_id] = entry
    _save_registry(company_id, registry)
    return entry


def rename_project(company_id: str, project_id: str, new_name: str) -> ProjectNameEntry:
    """Same as register_project -- a rename IS just re-registering a name
    onto a project_id that may already have one. Kept as a distinctly
    named function since app/api/projects.py's PATCH endpoint reads more
    clearly calling "rename" than "register" for an existing project."""
    return register_project(company_id, project_id, new_name)


def get_project_name(company_id: str, project_id: str) -> Optional[str]:
    registry = _load_registry(company_id)
    entry = registry.get(project_id)
    return entry.project_name if entry else None


def remove_project(company_id: str, project_id: str) -> bool:
    """UX refinement: drops this project's entry from the name registry --
    one piece of the "delete a project" flow (app/api/projects.py's
    DELETE /projects/{id}, which also deletes the Phase 1 record and the
    whole Phase 3/4 directory via project_store.delete_project /
    phase3.delete_project_data). A no-op, not an error, if the project
    was never registered by name -- deleting a project that predates this
    registry, or was never given a name at all, should still succeed.
    """
    registry = _load_registry(company_id)
    if project_id not in registry:
        return False
    del registry[project_id]
    _save_registry(company_id, registry)
    return True


def find_project_by_name(company_id: str, query: str, limit: int = 5) -> list[dict]:
    """Fuzzy name search, scored 0-1 by difflib.SequenceMatcher (no new
    dependency -- stdlib is sufficient for matching short project-name
    strings, and keeps this module dependency-free like the rest of the
    storage layer). Also matches on list_named_projects()'s self-healed
    names, not just the registry's own raw entries, so a project that
    predates this registry (e.g. named only via its Phase 1 record or
    baseline) is still findable by name on the first search, not just
    after it happens to get registered some other way.

    Returns a list of {project_id, project_name, score}, best match
    first, filtered to score > 0.3 (below that, showing it as a "name
    match" would be misleading) and capped at `limit`.
    """
    q = query.strip().lower()
    if not q:
        return []

    candidates = list_named_projects(company_id)
    scored = []
    for c in candidates:
        name_lower = c["project_name"].lower()
        score = difflib.SequenceMatcher(None, q, name_lower).ratio()
        # A direct substring match (e.g. "ecopolitan" inside "Ecopolitan
        # Tower B") is a much stronger signal than difflib's whole-string
        # ratio would otherwise give it, since the query is usually
        # shorter than the full project name -- boost it above the
        # ratio-only score without letting it exceed 1.0.
        if q in name_lower:
            score = max(score, 0.75)
        if score > 0.3:
            scored.append({"project_id": c["project_id"], "project_name": c["project_name"], "score": round(score, 3)})

    scored.sort(key=lambda s: s["score"], reverse=True)
    return scored[:limit]


def list_named_projects(company_id: str) -> list[dict]:
    """Every project this company has, WITH a name -- self-healing exactly
    like company_registry.list_companies(): any project_id already known
    to project_store/phase3 (a Phase 1 record and/or Phase 3 baseline)
    but missing from this registry gets a name derived on the spot (Phase
    1's own project_name, else the baseline's, else
    "Untitled Project <id[:8]>") and lazily written back, so every future
    call (and every search) sees it without needing a project to be
    explicitly "saved" first.

    Imports project_store/phase3 lazily to avoid a circular import --
    both of those modules import this one for their own registration
    hooks.
    """
    from app.services import phase3, project_store

    registry = _load_registry(company_id)
    changed = False

    all_ids: set[str] = set(registry.keys())
    projects_root = company_store.projects_dir(company_id)
    if projects_root.exists():
        for entry in projects_root.iterdir():
            if entry.is_dir():
                all_ids.add(entry.name)
            elif entry.suffix == ".json":
                all_ids.add(entry.stem)

    now = datetime.now(timezone.utc).isoformat()
    for project_id in all_ids:
        if project_id in registry:
            continue
        phase1_project = project_store.load_project(project_id, company_id=company_id)
        baseline = phase3.load_baseline(company_id, project_id)
        name = (
            (phase1_project.project_name if phase1_project else None)
            or (baseline.project_name if baseline else None)
            or f"Untitled Project {project_id[:8]}"
        )
        registry[project_id] = ProjectNameEntry(
            project_id=project_id, project_name=name, created_at=now, updated_at=now
        )
        changed = True

    if changed:
        _save_registry(company_id, registry)

    return [
        {"project_id": e.project_id, "project_name": e.project_name, "updated_at": e.updated_at}
        for e in sorted(registry.values(), key=lambda e: e.project_name.lower())
    ]
