"""Copy this app's local JSON data into the database (Supabase / Postgres).

What is copied (everything the app EDITS at runtime):
  app/data/companies/**/*.json          projects, bills, baselines, jobs, results,
                                        master item codes, onboarding jobs, ...
  app/data/companies_registry.json
  app/data/canonical_material_categories.json

NOT copied (read-only reference data that ships with the code): app/data/ice_db/*.

Usage (from the backend/ folder, with DATABASE_URL in backend/.env or the environment):

    python scripts/migrate_files_to_database.py            # dry run: lists what would be copied
    python scripts/migrate_files_to_database.py --apply    # copy, then verify every document

Safe to re-run: documents are upserted by path, so a second run just refreshes them.
Local files are never modified or deleted.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import config  # noqa: E402  (loads .env)
from app.services import doc_store  # noqa: E402

DATA_ROOT = Path(__file__).resolve().parent.parent / "app" / "data"


def collect() -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for p in sorted((DATA_ROOT / "companies").rglob("*.json")) if (DATA_ROOT / "companies").exists() else []:
        found.append((p.relative_to(DATA_ROOT).as_posix(), p))
    for name in ("companies_registry.json", "canonical_material_categories.json"):
        p = DATA_ROOT / name
        if p.exists():
            found.append((name, p))
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually copy (default is a dry run)")
    ap.add_argument("--database-url", default=config.DATABASE_URL, help="defaults to DATABASE_URL from .env")
    args = ap.parse_args()

    docs = collect()
    total_mb = sum(p.stat().st_size for _, p in docs) / 1_048_576
    print(f"Found {len(docs)} documents ({total_mb:.1f} MB) under {DATA_ROOT}")
    if not args.apply:
        for key, p in docs:
            print(f"  {key}  ({p.stat().st_size / 1024:.0f} KB)")
        print("\nDry run only. Re-run with --apply to copy them into the database.")
        return 0

    if not args.database_url:
        print("ERROR: no DATABASE_URL. Put it in backend/.env or pass --database-url.", file=sys.stderr)
        return 2

    db = doc_store.PostgresBackend(args.database_url)
    bad = 0
    try:
        for i, (key, p) in enumerate(docs, 1):
            data = json.loads(p.read_text(encoding="utf-8"))
            db.write(key, data)
            back = db.read(key)
            ok = back == data
            bad += 0 if ok else 1
            print(f"[{i}/{len(docs)}] {'ok ' if ok else 'MISMATCH'} {key}")
    finally:
        db.close()
    if bad:
        print(f"\n{bad} document(s) did not verify -- do NOT switch over yet.", file=sys.stderr)
        return 1
    print(f"\nDone: {len(docs)} documents copied and verified. Set DATABASE_URL on the app to start using them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
