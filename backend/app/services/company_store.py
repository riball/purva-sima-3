"""Workstream 04: company-scoped storage roots.

Everything this project persists at runtime -- a Phase 1 project record
(project_store.py), a reference project's metadata + cached BOQ
extraction (reference_store.py / boq_cache.py), and a company's own
item-code dataset (previously the single global
app/data/master_item_codes/master_item_code_factors.json) -- used to
live in one global location, shared by every user of the app. That's
fine for one company; it's wrong for the "not specifically for Provident
but for other companies too" product this is becoming, since company
B's Phase 1 estimates would otherwise learn from company A's reference
projects, and a Work Order upload would have nowhere to look but
Provident's own item-code dataset.

This module is the single place that knows where a given company's data
lives on disk -- the same role project_store.py's own docstring already
described for itself ("swapping this for a real database later means
changing only this file"), just one level up. Every other storage
module (project_store, boq_cache, reference_store) and every API
endpoint that touches persisted data resolves its paths through here,
never by constructing a `data/companies/...` path itself.

Deliberately storage-only, per Workstream 04's scope: this introduces
WHERE a company's data lives, not any new classification or calculation
logic -- that's Workstream 05 (the onboarding pipeline that actually
populates a new company's master_item_codes.json).

Layout
------
data/companies/<company_id>/
    projects/<project_id>.json         -- Phase 1 project records (was data/projects/)
    reference_projects/
        reference_stats.json           -- was data/reference_boqs/reference_stats.json
        cache/<slug>.json              -- was data/reference_boqs/cache/
    master_item_codes.json             -- was app/data/master_item_codes/master_item_code_factors.json

What does NOT move: the raw uploaded source documents themselves
(app/data/reference_boqs/*.xlsx, app/data/work_orders/*.pdf) stay where
they are. They're read-only fixtures the golden-file tests pin exact
paths to (see tests/golden/*.json's _meta.source_path) -- moving them
would be a test-breaking change for zero storage-correctness benefit,
since it's the DERIVED data (extractions, metadata, item-code datasets)
that actually needs to be per-company, not the original file someone
uploaded.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

# The one company this project has ever served. Every existing project
# record, reference project, and the existing master_item_code_factors.json
# belong to Provident -- see scripts/migrate_to_company_storage.py, which
# moves them here under this exact id. Every storage function in this
# codebase defaults to this company_id so nothing that already works
# breaks by omission; a caller only needs to pass a different company_id
# once a second company's data actually exists.
DEFAULT_COMPANY_ID = "provident"

COMPANIES_DIR = Path(__file__).resolve().parent.parent / "data" / "companies"


def company_dir(company_id: str) -> Path:
    return COMPANIES_DIR / company_id


def projects_dir(company_id: str) -> Path:
    return company_dir(company_id) / "projects"


def reference_projects_dir(company_id: str) -> Path:
    return company_dir(company_id) / "reference_projects"


def reference_projects_cache_dir(company_id: str) -> Path:
    return reference_projects_dir(company_id) / "cache"


def master_item_codes_path(company_id: str) -> Path:
    return company_dir(company_id) / "master_item_codes.json"


def onboarding_jobs_dir(company_id: str) -> Path:
    """Workstream 05: where a company's onboarding-pipeline job records
    live -- one JSON file per upload, holding the ingested/deduped/
    classified rows, the impact-ranked review queue, and (once a human
    has reviewed it) the confirmed decisions. See
    app/services/onboarding/pipeline.py.
    """
    return company_dir(company_id) / "onboarding_jobs"


def onboarding_job_path(company_id: str, job_id: str) -> Path:
    return onboarding_jobs_dir(company_id) / f"{job_id}.json"


def project_dir(company_id: str, project_id: str) -> Path:
    """Workstream 10: a per-project DIRECTORY for Phase 3 data (bills,
    the Phase 3 baseline) -- deliberately separate from
    projects_dir(company_id) / f"{project_id}.json" (the Phase 1 project
    record FILE projects_dir() already resolves via project_store.py).
    The two coexist without colliding: 'projects/<id>.json' is a file,
    'projects/<id>/' is a directory -- same parent, different path shape,
    same convention project_store.py's own docstring already established
    ("swapping this for a real database later means changing only this
    file").
    """
    return projects_dir(company_id) / project_id


def phase3_baseline_path(company_id: str, project_id: str) -> Path:
    return project_dir(company_id, project_id) / "phase3_baseline.json"


def project_bills_dir(company_id: str, project_id: str) -> Path:
    return project_dir(company_id, project_id) / "bills"


def project_bill_path(company_id: str, project_id: str, period: str) -> Path:
    return project_bills_dir(company_id, project_id) / f"{period}.json"


def phase3_source_result_path(company_id: str, project_id: str) -> Path:
    """Workstream 14 (Phase 4): the full, structured BOQ/WO carbon result
    -- line items included, not just the totals Phase3Baseline itself
    keeps -- captured at baseline-recording time. This is Phase 4's
    "original Phase 2 upload, in structured form" that a confirmed
    recommendation gets overlaid onto (see app/services/phase4.py).

    Deliberately a SEPARATE file from phase3_baseline.json, and
    deliberately mutable where phase3_baseline.json is not: the baseline
    stays the fixed, never-overwritten benchmark a project is measured
    against (see phase3.py's own module docstring), while this file is
    the CURRENT working state -- it starts as an exact copy of the
    baseline's source result and gets permanently updated every time a
    Phase 4 recommendation is confirmed. Only ever written for
    source_type='boq'/'wo' baselines; a 'phase1_estimate' baseline has no
    real line items to overlay.
    """
    return project_dir(company_id, project_id) / "phase3_source_result.json"


def phase4_recommendations_path(company_id: str, project_id: str) -> Path:
    """Workstream 14: pending/confirmed/rejected Recommendation objects
    for this project -- see app/services/phase4.py."""
    return project_dir(company_id, project_id) / "phase4_recommendations.json"


def phase4_audit_log_path(company_id: str, project_id: str) -> Path:
    """Workstream 14: the append-only log of every CONFIRMED change --
    source, timestamp, before/after numbers. Never overwritten, only
    appended to -- see app/services/phase4.py."""
    return project_dir(company_id, project_id) / "phase4_audit_log.json"


def canonical_categories_path() -> Path:
    """Workstream 05: the ONE thing in this module that is deliberately
    NOT company-scoped. A company's own item-code -> category mapping is
    private to that company (master_item_codes_path, above); but the
    material-category taxonomy itself (what "steel_structural" or
    "plaster (gypsum)" even means, and its sourced emission factor) is
    the same physical reality for every company and should be shared and
    grown together, not reinvented per company -- see
    app/services/onboarding/canonical_categories.py.

    Deliberately derived from COMPANIES_DIR.parent (not a separate
    hardcoded path) so that tests which monkeypatch COMPANIES_DIR (see
    tests/test_company_storage.py's isolated_company_storage fixture)
    automatically isolate this path too, without needing a second
    monkeypatch.
    """
    return COMPANIES_DIR.parent / "canonical_material_categories.json"


def atomic_write_json(path: Path, data: Any, *, indent: int = 2, sort_keys: bool = False) -> None:
    """Write JSON to `path` without ever leaving a reader able to observe
    a partially-written or empty file.

    This was the single real bug a concurrency stress test turned up in
    this app: most of this app's storage modules wrote with a plain
    `path.write_text(json.dumps(...))` (or `open(path, "w")` +
    `json.dump`), and `open(..., "w")` TRUNCATES the file to zero bytes
    the instant it opens, before a single byte of new content is
    written. Any concurrent request that reads that same file in that
    window -- e.g. two PATCH /form/{id} calls on the same project
    landing close together, each doing its own read-modify-write with no
    locking -- gets `json.JSONDecodeError: Expecting value: line 1
    column 1 (char 0)` and a 500, and depending on timing can also
    silently lose whichever of the two concurrent writes finishes first
    (the classic read-modify-write race: both read the old state before
    either writes back, so the second write simply overwrites the
    first's change). Reproduced live: firing ~17 concurrent PATCHes at
    one project, at least two crashed with exactly this JSONDecodeError
    and five of the (otherwise valid) field updates were silently lost
    to the race.

    The fix used throughout this codebase's job_store.py and
    operational_emissions.py already (this just gives every OTHER
    storage module, which didn't have it, the same pattern instead of
    reinventing it per-file): write the new content to a throwaway
    temp file in the SAME directory, then `os.replace()` it onto the
    real path. `os.replace` is an atomic rename on every OS this runs
    on -- a reader either sees the old complete file or the new
    complete file, never a truncated one, and two concurrent writers
    each produce a complete file, so the "last one to replace() wins"
    instead of "whoever truncated last, interleaved with whoever's
    write happened to land" -- still a last-write-wins race at the
    field level (that part needs real per-project locking or a database
    to fully solve, out of scope for a storage-layer fix), but no
    longer a CORRUPTION or crash risk.

    Post-delivery correction (reported live from a Windows deployment,
    traceback ending inside this function at the os.replace call): on
    Windows, os.replace() can still raise `PermissionError: [WinError 32]
    The process cannot access the file because it is being used by
    another process` even though nothing in THIS app has the destination
    file open -- Windows Defender's real-time scanner, a OneDrive/
    Dropbox sync client, or Windows Search indexing briefly opening a
    just-written file is enough to trigger it. This has no equivalent on
    Linux/macOS (a rename can replace a file something else still has
    open there), which is why this app's own concurrency stress testing
    -- run on Linux -- never caught it: crashed a real "Add a Bill"
    upload with exactly this error. The lock is virtually always
    released within milliseconds, so this retries briefly instead of
    letting one of these innocent, momentary Windows locks surface as a
    crash. encoding="utf-8" is now explicit for the same reason --
    Path.write_text()'s default encoding is the OS's locale-preferred
    one, which is not UTF-8 on a typical English-locale Windows machine.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    tmp_path.write_text(json.dumps(data, indent=indent, sort_keys=sort_keys), encoding="utf-8")
    last_err = None
    for attempt in range(6):
        try:
            os.replace(tmp_path, path)  # atomic on every OS this runs on
            return
        except PermissionError as e:
            # Windows-only transient lock (see docstring above) -- back
            # off briefly and retry rather than failing the whole request.
            last_err = e
            time.sleep(0.05 * (attempt + 1))
    # Retries exhausted -- clean up the orphaned temp file so a repeated
    # failure doesn't litter the directory with <name>.<hex>.tmp files,
    # then surface the real error.
    try:
        tmp_path.unlink(missing_ok=True)
    except OSError:
        pass
    raise last_err


def list_company_ids() -> list[str]:
    """Every company with at least one file under data/companies/ --
    not a registry of "valid" companies, just what's actually on disk.
    """
    if not COMPANIES_DIR.exists():
        return []
    return sorted(p.name for p in COMPANIES_DIR.iterdir() if p.is_dir())