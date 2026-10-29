"""
One-off maintenance script: re-locks every project whose Phase 3 baseline
is Conceptual-Estimate-sourced (baseline_is_estimated=True), so each picks
up two things this session added to the Conceptual Estimate carbon engine
and the baseline-lock path, neither of which an already-locked baseline
gets automatically (a locked baseline is an immutable snapshot, never
live-recomputed -- see phase3.py's Phase3Baseline docstring):

  1. Glazing carbon (glass + aluminium framing, sized from the Glazing %
     field) is now included in the estimate's total carbon figure, on top
     of concrete + steel. This means each project's "Baseline Target"
     number will shift slightly UPWARD after this script runs -- it is
     not just a cosmetic chart fix, the underlying estimated total
     changes too. See calculation_engine.py's FACADE_AREA_PER_SQM_GFA /
     ALUMINIUM_FRAME_FRACTION_OF_GLAZED_AREA for the disclosed assumptions
     behind that addition.
  2. The baseline now carries a `material_breakdown` snapshot (concrete /
     reinforcement_steel / glass / aluminium), which the Project
     Dashboard's Material Composition section and "Material Breakdown"
     chart card need in order to render anything for a project with no
     bills logged yet -- without this, those sections show "Add a bill
     to see its material breakdown here" even though the project was
     estimated, not just empty.

This is the "Update & Re-lock with Latest Estimate" action already exposed
in the Conceptual Estimate page's UI (POST /phase3/projects/{id}/baseline,
source_type=phase1_estimate, overwrite=true), just run here in bulk across
every estimate-sourced project rather than one at a time by hand -- same
call, same effect, nothing new added to the backend by this script itself.

It discovers which projects need this by calling GET /phase3/projects and
filtering for baseline_is_estimated=True, rather than hardcoding project
IDs (none were saved anywhere from the original bulk import) -- so this
will also pick up ANY OTHER Conceptual-Estimate-sourced project in this
company, including ones created by hand through the UI, not just the 18
originally bulk-imported from Project_Details.xlsx. That is intentional:
every one of them benefits from the same fix the same way.

Run this once, from the `backend` folder, with its venv active and the
backend's dev server already running (default http://localhost:8000):

    cd backend
    venv\\Scripts\\activate        (Windows)  /  source venv/bin/activate  (mac/linux)
    python scripts/relock_estimate_baselines.py

Safe to preview first with --dry-run (lists what would be re-locked,
writes nothing). Safe to re-run: each run just re-locks the same set of
projects again with whatever the Conceptual Estimate engine currently
computes -- idempotent, unlike the original bulk-import script.
"""
import argparse
import sys

try:
    import requests
except ImportError:
    print("This script needs the 'requests' package: pip install requests")
    sys.exit(1)


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

    targets = [p for p in projects if p.get("baseline_is_estimated")]
    print(f"{len(projects)} total projects, {len(targets)} with a Conceptual-Estimate-sourced baseline to re-lock.\n")

    if not targets:
        print("Nothing to do.")
        return 0

    if args.dry_run:
        print("(dry run) Would re-lock:")
        for p in targets:
            print(f"  - {p.get('project_name') or p.get('project_id')}  (project_id={p['project_id']})")
        return 0

    results = []
    for p in targets:
        project_id = p["project_id"]
        name = p.get("project_name") or project_id
        print(f"=== {name} ({project_id}) ===")
        try:
            r = requests.post(
                f"{base}/phase3/projects/{project_id}/baseline",
                data={"source_type": "phase1_estimate", "company_id": args.company_id, "overwrite": "true"},
                timeout=30,
            )
            r.raise_for_status()
            baseline = r.json()
            tonnes = (baseline.get("total_gwp_kg_co2e") or 0) / 1000
            n_categories = len(baseline.get("material_breakdown") or [])
            print(f"  re-locked: {tonnes:.1f} tCO2e, {n_categories} material categories")
            results.append({"name": name, "project_id": project_id, "status": "ok", "tonnes": tonnes})
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append({"name": name, "project_id": project_id, "status": "failed", "error": str(e)})

    print("\n\n=== SUMMARY ===")
    ok = [r for r in results if r["status"] == "ok"]
    failed = [r for r in results if r["status"] != "ok"]
    print(f"{len(ok)} re-locked, {len(failed)} failed (of {len(targets)})")
    for r in failed:
        print(f"  FAILED {r['name']} ({r['project_id']}): {r.get('error')}")

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
