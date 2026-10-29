"""
One-off maintenance script: shortens the 18 real imported projects' full,
verbose legal/survey names to a client-facing "Purva <Tag>" format --
"For the name of the project, reduce all the names to 'Purva' being the
prefix and from the project name take a specific tag name like
Ecopoliton, westend, Botanico, etc." The mapping below was derived by hand
from each project's real current name (confirmed against GET
/phase3/projects on this sandbox backend) and the two genuinely ambiguous
cases were resolved directly with the user:
  - "Sunwort Residential Apartment & Commercial Building...(Equinox)"
    -> "Purva Equinox" (the parenthetical brand name, same pattern as
    "Hebbagodi (Purva Silver Sky)" -> "Purva Silver Sky").
  - "Development of Residential Apartment with Clubhouse & Retail" (no
    brand name, generic location) -> "Purva Clubhouse" -- the user chose
    to rename this one too, using "Clubhouse" as the placeholder tag,
    rather than leave the full name as-is.

This calls the EXISTING PATCH /projects/{id}/name endpoint once per
project -- the real rename-propagation logic (onto the project registry,
the Phase 1 record, and the Phase 3 baseline all at once) already lives
in app/api/projects.py's rename_project / app/services/project_registry.py
(see that module's docstring); this script is purely the bulk-apply, no
new rename logic of its own.

Keyed by project_id (not by matching the current name string) so it's
unambiguous and safe to re-run -- renaming is idempotent, a project
already renamed just gets the same name again. project_ids below were
looked up once via GET /phase3/projects on THIS sandbox backend; if ever
run against a different backend/company where these ids don't exist, the
script reports which ones it couldn't find rather than silently skipping.

Run this once, from the `backend` folder, with its venv active and the
backend's dev server already running (default http://localhost:8000):

    cd backend
    venv\\Scripts\\activate        (Windows)  /  source venv/bin/activate  (mac/linux)
    python scripts/rename_projects_purva.py --dry-run     # preview first
    python scripts/rename_projects_purva.py                # then for real

Per the user's explicit instruction, this script is only ever run against
the SANDBOX's own backend for this task -- never against the real
machine's backend -- until the whole six-item batch has been reviewed and
approved to go live.
"""
import argparse
import sys

try:
    import requests
except ImportError:
    print("This script needs the 'requests' package: pip install requests")
    sys.exit(1)

# project_id -> new "Purva <Tag>" name. See this script's own docstring
# for how each tag was derived and how the two ambiguous cases were
# resolved with the user.
RENAME_MAP = {
    "05700e11-1c99-4635-9293-8014201950e4": "Purva Vajarahalli",
    "0f6727fb-9067-4269-ab2e-8fb84f63828d": "Purva Aerocity",
    "11706280-f429-4802-aa35-435d45b17362": "Purva Orient Grand",
    "1cd596c2-b569-462e-9c8d-dfee9ace96ae": "Purva Highland",
    "3fc32bc5-a5f6-4e92-9fad-bdcb80062d40": "Purva Ecopolitan",
    "5ae9ed1a-62a3-4511-92d0-14ed8b9f5458": "Purva Winworth",
    "63c44a0f-6bfb-46bf-ad33-83c6990d2588": "Purva Bayscape",
    "82c2f54e-c6b7-4fda-beeb-1af86c9492f0": "Purva Equinox",
    "9006efad-406a-4eed-a3d2-e4d7014f5561": "Purva Silver Sky",
    "a12caccf-7559-477f-8597-265da5679e63": "Purva Mallasandra 28",
    "aae30b6d-cd0d-4b69-a220-84f18f734566": "Purva Westend 2",
    "acf5d591-a89b-44d3-bdf0-1b6d7f309de9": "Purva Deansgate",
    "bf8c9e25-6bf4-4c70-a3c5-7af28a114de8": "Purva Hennur",
    "bfd8d075-2637-4e83-a47f-6ce23c16ff63": "Purva Balagere",
    "c051768b-28cd-441b-adad-87740f9aa71f": "Purva Zentech",
    "d64ec86b-dd29-4959-be8f-766d44df5b4c": "Purva Botanico",
    "dd2efad5-8b25-40ae-a7e5-dcf5dab7b17a": "Purva Clubhouse",
    "ee4c831f-e7c3-4076-8f12-20cec2be4939": "Purva Blue Bells",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--company-id", default="provident",
                     help="Must match an existing company_id in this backend's data/companies/ folder.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")

    try:
        r = requests.get(f"{base}/phase3/projects", params={"company_id": args.company_id}, timeout=30)
        r.raise_for_status()
        projects = r.json()
    except Exception as e:
        print(f"FAILED to list projects from {base}/phase3/projects: {e}")
        print("Is the backend dev server running? (uvicorn app.main:app, default port 8000)")
        return 1

    known_ids = {p["project_id"] for p in projects}
    by_id = {p["project_id"]: p for p in projects}

    missing = [pid for pid in RENAME_MAP if pid not in known_ids]
    if missing:
        print(f"WARNING: {len(missing)} project_id(s) in RENAME_MAP were not found via GET /phase3/projects "
              f"(company_id='{args.company_id}') -- skipping them:")
        for pid in missing:
            print(f"  - {pid}")
        print()

    targets = [(pid, new_name) for pid, new_name in RENAME_MAP.items() if pid in known_ids]
    print(f"{len(projects)} total projects, {len(targets)} to rename to 'Purva <Tag>'.\n")

    if args.dry_run:
        print("(dry run) Would rename:")
        for pid, new_name in targets:
            current_name = by_id[pid].get("project_name") or pid
            print(f"  - {current_name!r}  ->  {new_name!r}  (project_id={pid})")
        return 0

    results = []
    for pid, new_name in targets:
        current_name = by_id[pid].get("project_name") or pid
        print(f"=== {current_name} -> {new_name} ({pid}) ===")
        try:
            r = requests.patch(
                f"{base}/projects/{pid}/name",
                json={"company_id": args.company_id, "project_name": new_name},
                timeout=30,
            )
            r.raise_for_status()
            renamed = r.json()
            print(f"  renamed OK -> {renamed.get('project_name')!r}")
            results.append({"project_id": pid, "status": "ok", "new_name": renamed.get("project_name")})
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append({"project_id": pid, "status": "failed", "error": str(e)})

    print("\n\n=== SUMMARY ===")
    ok = [r for r in results if r["status"] == "ok"]
    failed = [r for r in results if r["status"] != "ok"]
    print(f"{len(ok)} renamed, {len(failed)} failed (of {len(targets)})")
    for r in failed:
        print(f"  FAILED {r['project_id']}: {r.get('error')}")

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
