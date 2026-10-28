"""Workstream 15: a real company registry -- the API-visible half of the
per-company storage Workstream 04 already built (see
app/services/company_store.py's own docstring for the storage layer).

Before this, "company_id" was pure free text: nothing enforced that one
existed, nothing let the frontend show a company picker instead of a
raw text field, and a company only ever came into being as a SIDE
EFFECT of writing to it (the first project saved under a new company_id
implicitly created data/companies/<id>/, since every storage module
does Path.mkdir(parents=True, exist_ok=True) on first write -- see e.g.
project_store.save_project). That's workable for one company
(Provident) but not for "not specifically for Provident but for other
companies too", the same gap company_store.py's own docstring already
named as the reason company-scoped storage exists at all.

This module adds a thin, explicit layer on top: a registry file
(data/companies_registry.json) mapping company_id -> {display_name,
created_at}, so a company can be CREATED before any data exists under
it, and so a frontend can show real display names in a picker instead
of asking the user to remember/retype a raw id.

Deliberately does not replace company_store.py's directory-is-the-
source-of-truth model, it complements it: list_companies() below treats
the registry as authoritative for DISPLAY metadata but still discovers
any company_store.list_company_ids() directory that has no registry
entry (the pre-existing "provident" company, or one some other script
created directly against the storage layer) and self-heals by
backfilling a registry entry for it on the spot, using the id as its
own display name. Nothing that already works (every endpoint that
takes a bare company_id string) breaks -- this is purely additive.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel

from app.services import company_store

_REGISTRY_PATH = company_store.COMPANIES_DIR.parent / "companies_registry.json"

# lowercase letters/digits, hyphens allowed (not leading), 1-64 chars --
# safe as both a URL path segment and a directory name on every OS this
# runs on.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


class CompanyMeta(BaseModel):
    company_id: str
    display_name: str
    created_at: str  # ISO datetime


def slugify_company_id(name: str) -> str:
    """lowercase, hyphen-separated, filesystem/URL-safe -- e.g. 'Acme
    Builders Pvt Ltd' -> 'acme-builders-pvt-ltd'. A separate function
    from (not reused from) reference_store.slugify, which underscores
    rather than hyphenates -- a company id is used as a URL path segment
    (see app/api/companies.py), where a hyphen is the conventional word
    separator, unlike a reference-project slug, which never appears in
    a URL.
    """
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower())
    s = s.strip("-")[:64]
    return s or "company"


def _load_registry() -> dict[str, CompanyMeta]:
    if not _REGISTRY_PATH.exists():
        return {}
    raw = json.loads(_REGISTRY_PATH.read_text())
    return {cid: CompanyMeta(**meta) for cid, meta in raw.items()}


def _save_registry(registry: dict[str, CompanyMeta]) -> None:
    # Atomic write-then-rename -- see company_store.atomic_write_json's
    # docstring (part of the backend-wide fix for the truncated-file race
    # a concurrency stress test reproduced live in this app).
    company_store.atomic_write_json(_REGISTRY_PATH, {cid: meta.model_dump() for cid, meta in registry.items()})


def create_company(display_name: str, company_id: Optional[str] = None) -> CompanyMeta:
    """Explicitly registers a new company. company_id is derived from
    display_name via slugify_company_id() when not given explicitly.
    Raises ValueError if the resulting id is malformed or already taken
    -- by either a registry entry or an existing data/companies/<id>/
    directory (e.g. one created by an earlier direct-storage caller,
    never through this registry).
    """
    display_name = display_name.strip()
    if not display_name:
        raise ValueError("display_name is required")

    resolved_id = (company_id or slugify_company_id(display_name)).strip().lower()
    if not _SLUG_RE.match(resolved_id):
        raise ValueError(
            f"'{resolved_id}' is not a valid company id -- lowercase letters, numbers, and hyphens only, "
            "starting with a letter or number, max 64 characters."
        )

    registry = _load_registry()
    if resolved_id in registry or resolved_id in company_store.list_company_ids():
        raise ValueError(f"Company id '{resolved_id}' already exists.")

    meta = CompanyMeta(
        company_id=resolved_id,
        display_name=display_name,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    registry[resolved_id] = meta
    _save_registry(registry)
    # Materialize the directory immediately -- every other storage
    # module already does mkdir(parents=True, exist_ok=True) on first
    # write, but doing it here too means this company shows up in
    # company_store.list_company_ids() (and therefore survives a
    # registry-file loss, or a caller that only ever reads the
    # directory listing) even before any project/bill/onboarding job is
    # ever saved under it.
    company_store.company_dir(resolved_id).mkdir(parents=True, exist_ok=True)
    return meta


def get_company(company_id: str) -> Optional[CompanyMeta]:
    registry = _load_registry()
    if company_id in registry:
        return registry[company_id]
    if company_id in company_store.list_company_ids():
        # Self-heal: a directory exists with no registry entry (e.g.
        # "provident", created before this module existed). Backfill one
        # now so it has a real registry entry from here on.
        registry[company_id] = CompanyMeta(
            company_id=company_id, display_name=company_id, created_at=datetime.now(timezone.utc).isoformat()
        )
        _save_registry(registry)
        return registry[company_id]
    return None


def list_companies() -> list[CompanyMeta]:
    """Every company that exists, by either signal: a registry entry, or
    a data/companies/<id>/ directory with no registry entry yet (which
    this call backfills so future lookups skip that self-heal path).
    Sorted by display_name for a stable, human-friendly picker order.
    """
    registry = _load_registry()
    changed = False
    for company_id in company_store.list_company_ids():
        if company_id not in registry:
            registry[company_id] = CompanyMeta(
                company_id=company_id, display_name=company_id, created_at=datetime.now(timezone.utc).isoformat()
            )
            changed = True
    if changed:
        _save_registry(registry)
    return sorted(registry.values(), key=lambda m: m.display_name.lower())