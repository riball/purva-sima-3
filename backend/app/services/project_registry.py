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
mapping `project_id -> {project_name, created_at, updated_at, archetype, construction_stage, location}`.

The last three fields (added alongside this docstring update) are purely descriptive
project-profile metadata -- display/filter labels for screens like Portfolio Overview,
never read by any calculation. They live here rather than on Phase1's ProjectSchema or
Phase3Baseline for the same reason project_name does: this registry is the one place
that exists for EVERY project regardless of which phase (if any) a project has gone
through, so a BOQ/WO-only project (no Phase 1 record) can still carry an archetype,
stage, and location the same as a Phase-1-sourced one can.
"""

from __future__ import annotations

import difflib
import json
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel

from app.services import company_store

# Purely descriptive project-profile taxonomies -- never read by any calculation
# (Typology, on Phase1's ProjectSchema, is the separate field that actually feeds
# benchmark matching; this is deliberately not that). Backend-enforced Literal
# types rather than free text so a frontend dropdown and this API always agree
# on the valid set.
#
# ArchetypeOption is tailored to Puravankara/Provident's own real project mix
# (reused from the same uploaded Sima CarbonOS mockup's OWN Conceptual-Estimate
# archetype list, which is already Mivan/India-specific) rather than the
# mockup's separate, more generic international Portfolio-page categories
# (Commercial High-Rise, Mass Timber Campus, etc.), which don't reflect this
# company's actual portfolio.
ArchetypeOption = Literal[
    "Residential High-Rise",
    "Affordable Housing (Mivan)",
    "Commercial Grade-A Office",
    "Mixed-Use Retail & Living",
    "Low-Rise Villa Community",
]

# Industry-standard construction-phase names, kept as the mockup had them --
# these aren't fictional sample data the way the archetype categories above were.
ConstructionStage = Literal[
    "Substructure",
    "Superstructure",
    "Enclosure / Facade",
    "Fit-out",
    "Commissioning",
    "Completed",
]


class ProjectNameEntry(BaseModel):
    project_id: str
    project_name: str
    created_at: str
    updated_at: str
    archetype: Optional[ArchetypeOption] = None
    construction_stage: Optional[ConstructionStage] = None
    # Manual override. Only meaningful on its own for a project with no
    # Phase 1 record -- location otherwise lives on
    # ProjectSchema.mandatory.location (see phase3.list_projects(), which
    # falls back to that when this is unset and a Phase 1 record exists).
    location: Optional[str] = None
    # "Beta fork" (app/services/phase4.py's confirm_recommendation_as_beta_twin):
    # a Beta twin is a REAL project in every other respect (its own
    # baseline, its own bills, findable/openable like any other) -- these
    # two fields are purely so the Directory can group it under "Material
    # Change Projects (Beta)" at the bottom of the grid instead of mixing
    # it in with real tracked projects, and so its card can link back to
    # the project it was forked from. Set once, at fork time, by
    # mark_as_beta_twin() below; never True for a project created any
    # other way.
    is_beta_twin: bool = False
    beta_source_project_id: Optional[str] = None


def _registry_path(company_id: str):
    return company_store.company_dir(company_id) / "project_registry.json"


def _load_registry(company_id: str) -> dict[str, ProjectNameEntry]:
    path = _registry_path(company_id)
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    return {pid: ProjectNameEntry(**entry) for pid, entry in raw.items()}


def _save_registry(company_id: str, registry: dict[str, ProjectNameEntry]) -> None:
    # Atomic write-then-rename -- see company_store.atomic_write_json's
    # docstring. This exact file (project_registry.json) is the one a
    # live concurrency stress test caught mid-truncate: register_project()
    # is called from inside project_store.save_project(), so two
    # concurrent PATCH /form/{id} calls on a named project can both try
    # to update this registry at once, and the plain write this used to
    # do left a window where a concurrent reader saw a zero-byte file
    # and crashed with json.JSONDecodeError (a real 500, reproduced
    # live, not theoretical).
    path = _registry_path(company_id)
    company_store.atomic_write_json(path, {pid: entry.model_dump() for pid, entry in registry.items()})


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
        # Preserve any already-set profile metadata across a plain
        # rename, the same way created_at above is preserved -- a rename
        # must never silently wipe out an archetype/stage/location
        # someone already set via set_project_profile(), or a Beta-twin
        # flag set via mark_as_beta_twin() (register_project() is also
        # what confirm_recommendation_as_beta_twin() calls, indirectly
        # via save_baseline(), to name the new twin in the first place --
        # see that function's own docstring).
        archetype=existing.archetype if existing else None,
        construction_stage=existing.construction_stage if existing else None,
        location=existing.location if existing else None,
        is_beta_twin=existing.is_beta_twin if existing else False,
        beta_source_project_id=existing.beta_source_project_id if existing else None,
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


def set_project_profile(
    company_id: str,
    project_id: str,
    *,
    archetype: Optional[ArchetypeOption] = None,
    construction_stage: Optional[ConstructionStage] = None,
    location: Optional[str] = None,
) -> ProjectNameEntry:
    """Upsert archetype/construction_stage/location onto a project's
    registry entry. Only the fields actually passed are changed -- an
    unpassed (None) argument leaves that field as it already was, so
    setting the archetype in one call doesn't clobber a stage set in an
    earlier one. (This means these three fields can never be explicitly
    CLEARED back to None through this function once set -- not needed by
    anything that calls it today; revisit if that ever changes.)

    Calls list_named_projects() first so a project with no registry entry
    yet (e.g. a BOQ/WO-only project nobody has named) gets one
    self-healed into existence -- same self-healing this registry already
    does for project_name everywhere else -- rather than this function
    requiring a project to already be explicitly "saved" by name first.
    """
    list_named_projects(company_id)  # self-heal a registry entry into existence if needed
    registry = _load_registry(company_id)
    existing = registry.get(project_id)
    if existing is None:
        raise ValueError(f"No project '{project_id}' found for company '{company_id}'.")

    now = datetime.now(timezone.utc).isoformat()
    entry = existing.model_copy(
        update={
            "updated_at": now,
            **({"archetype": archetype} if archetype is not None else {}),
            **({"construction_stage": construction_stage} if construction_stage is not None else {}),
            **({"location": location} if location is not None else {}),
        }
    )
    registry[project_id] = entry
    _save_registry(company_id, registry)
    return entry


def mark_as_beta_twin(company_id: str, project_id: str, source_project_id: str) -> ProjectNameEntry:
    """Flags `project_id` as a Beta twin forked from `source_project_id`
    (see confirm_recommendation_as_beta_twin() in app/services/phase4.py,
    the only caller). Same self-healing pattern as set_project_profile()
    above -- calls list_named_projects() first so this never needs the
    twin to already have a registry entry, though in practice the fork
    flow always registers its name (via save_baseline()) before calling
    this. Deliberately a one-way flag: nothing ever un-marks a Beta twin,
    the same way nothing in this registry's other setters ever clears a
    field back to its default once set (see set_project_profile's own
    docstring).
    """
    list_named_projects(company_id)
    registry = _load_registry(company_id)
    existing = registry.get(project_id)
    if existing is None:
        raise ValueError(f"No project '{project_id}' found for company '{company_id}'.")

    now = datetime.now(timezone.utc).isoformat()
    entry = existing.model_copy(
        update={"updated_at": now, "is_beta_twin": True, "beta_source_project_id": source_project_id}
    )
    registry[project_id] = entry
    _save_registry(company_id, registry)
    return entry


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
        {
            "project_id": e.project_id,
            "project_name": e.project_name,
            "updated_at": e.updated_at,
            "archetype": e.archetype,
            "construction_stage": e.construction_stage,
            "location": e.location,
            "is_beta_twin": e.is_beta_twin,
            "beta_source_project_id": e.beta_source_project_id,
        }
        for e in sorted(registry.values(), key=lambda e: e.project_name.lower())
    ]
