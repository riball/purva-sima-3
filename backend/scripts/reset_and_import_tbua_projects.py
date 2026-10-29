"""
Full reset + re-import, per explicit request: "remove the current projects
completely and add these projects using the TBUA value ... name of the
project should be exactly as the name mentioned in the excel sheet ...
there are 18 projects with the TBUA value, i want all these to be seen in
the projects page."

Replaces bulk_import_hyc_projects.py (the original one-off import) with a
corrected version:

  1. DELETES EVERY PROJECT currently in this company's workspace (confirmed
     explicitly: "delete everything, then add the 18" -- not just the ones
     this script re-creates). This is irreversible on this backend -- there
     is no undo once a project is deleted (DELETE /projects/{id} removes
     its Phase 1 record, baseline, and bills). The script will NOT do this
     without an explicit typed confirmation unless you pass --yes.
  2. Re-creates exactly the 18 of the 20 HYC tracker rows that have a TBUA
     (Total Built-Up Area) figure -- Windermere (sl_no 15) and ADG Goa
     (sl_no 20) are the two without one, same two the original import
     skipped, confirmed again here by re-parsing the sheet fresh.

What's different from the original bulk_import_hyc_projects.py:
  - project_name is now the FULL, EXACT "Project Name" column text from
    Project_Details.xlsx, typos and all (e.g. "Sunwort" -- yes, missing
    the 'h', that's what the sheet says) -- the original script used
    shortened/paraphrased names instead.
  - gfa_sqm is unchanged: it already was each project's EC-column TBUA
    value (falling back to the CTE-column TBUA when EC's was absent --
    none of these 18 needed that fallback), matching this app's
    established "EC over CTE where they conflict" decision from the
    original import. Re-verified by re-parsing the sheet directly rather
    than assumed.
  - location/typology per project are UNCHANGED from the original
    import's own best-effort values (derived from each project's name/
    address text in the sheet, since the sheet has no dedicated location
    column) -- this request didn't ask to change those, so they're kept
    exactly as they were, not re-derived or guessed again here.

Each of the 18 goes through the same real pipeline the UI itself uses:
    1. POST   /form                                   -> creates the Phase 1 record
    2. POST   /calculate/{project_id}                  -> runs the real carbon/cost calc
    3. POST   /phase3/projects/{project_id}/baseline    -> locks it (source_type=phase1_estimate)

Run this once, from the `backend` folder, with its venv active and the
backend's dev server already running (default http://localhost:8000):

    cd backend
    venv\\Scripts\\activate        (Windows)  /  source venv/bin/activate  (mac/linux)
    python scripts/reset_and_import_tbua_projects.py --dry-run

--dry-run lists every project that WOULD be deleted and every project that
WOULD be created, without changing anything. Drop --dry-run to run for
real -- it will print the full delete list, then ask you to type DELETE
to confirm before deleting anything (skip the prompt with --yes, e.g. for
an unattended re-run).
"""
import argparse
import sys
import time

try:
    import requests
except ImportError:
    print("This script needs the 'requests' package: pip install requests")
    sys.exit(1)


PROJECTS = [
    {
        "sl_no": 1,
        "project_name": 'Balagere',
        "gfa_sqm": 113522.28,
        "location": 'Balagere, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 2,
        "project_name": 'Westend II',
        "gfa_sqm": 37061.797,
        "location": 'Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 3,
        "project_name": 'Hebbagodi (Purva Silver Sky)',
        "gfa_sqm": 92655.2,
        "location": 'Hebbagodi, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 4,
        "project_name": 'Development of Residential Apartment with Clubhouse & Retail',
        "gfa_sqm": 440986.42,
        "location": 'Bengaluru, Karnataka',
        "typology": 'mixed_use',
    },
    {
        "sl_no": 5,
        "project_name": 'Proposed Residential cum Commercial Complex Project (Winworth 2 & 3), Edappally',
        "gfa_sqm": 464924.55,
        "location": 'Edappally, Kochi, Kerala',
        "typology": 'mixed_use',
    },
    {
        "sl_no": 6,
        "project_name": 'Sunwort Residential Apartment & Commercial Building at Venkatapura Village, Kengeri Hobli, Bangalore South Taluk (Equinox)',
        "gfa_sqm": 640828.6,
        "location": 'Kengeri Hobli, Bangalore South Taluk, Karnataka',
        "typology": 'mixed_use',
    },
    {
        "sl_no": 7,
        "project_name": 'Purva Highland Residential Apartment Project, Mallasandra Village, Uttarahalli Hobli, Kanakapura Road, Bengaluru South Taluk',
        "gfa_sqm": 283722.62,
        "location": 'Mallasandra, Kanakapura Road, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 8,
        "project_name": 'Mallasandra - Sy No 28 Residential Apartment at Sy. No. 28, Mallasandra Village, Kanakapura Road, Uttarahalli Hobli, Bengaluru Urban',
        "gfa_sqm": 112730.86,
        "location": 'Mallasandra, Kanakapura Road, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 9,
        "project_name": 'Modification of Residential Apartment Project at Vajarahalli Village',
        "gfa_sqm": 69364.77,
        "location": 'Vajarahalli, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 10,
        "project_name": 'Modification of Residential Apartment Project at Hennur Village (Varishtha Property Developers Private Limited & Others)',
        "gfa_sqm": 57270.3,
        "location": 'Hennur, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 11,
        "project_name": 'Development of Residential Apartment Project (Ecopolitan Phase-II Expansion) by Provident White Oaks LLP',
        "gfa_sqm": 180871.15,
        "location": 'Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 12,
        "project_name": 'Blue Bells - Residential Apartment at Municipal No.74, PID No.32-1-74, Magadi Main Road, Kempapura Agrahara, Bengaluru',
        "gfa_sqm": 67102.49,
        "location": 'Magadi Main Road, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 13,
        "project_name": 'Orient Grand - Residential Group Housing Project at Municipal No. 5, Lalbagh Road, Ward No. 48, Sudhamanagar, Bengaluru (POG)',
        "gfa_sqm": 27794.6,
        "location": 'Sudhamanagar, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 14,
        "project_name": 'Zentech Commercial (Office & Retail) Development Project at Doddakalsandra Village, Kanakapura Main Road, Bengaluru',
        "gfa_sqm": 102557.95,
        "location": 'Doddakalsandra, Kanakapura Main Road, Bengaluru, Karnataka',
        "typology": 'commercial',
    },
    {
        "sl_no": 16,
        "project_name": 'Bayscape - Proposed Construction of High-Rise Building at Sathankuppam Village (Hamlet of Pudupakkam) & Padur Village, Chengalpattu District, Tamil Nadu',
        "gfa_sqm": 100732.88,
        "location": 'Padur, Chengalpattu District, Tamil Nadu',
        "typology": None,
    },
    {
        "sl_no": 17,
        "project_name": 'Botanico Residential Apartment at Samethanahalli, Hosakote Taluk',
        "gfa_sqm": 181194.52,
        "location": 'Samethanahalli, Hosakote Taluk, Bengaluru, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 18,
        "project_name": 'Residential Group Houses at Uganavadi Village, Devanahalli Taluk, Bengaluru Rural District - Deansgate',
        "gfa_sqm": 52618.75,
        "location": 'Uganavadi, Devanahalli Taluk, Bengaluru Rural, Karnataka',
        "typology": 'residential',
    },
    {
        "sl_no": 19,
        "project_name": 'Devas Global Services LLP (Aerocity Township & Area Development Project)',
        "gfa_sqm": 235621.59,
        "location": 'Devanahalli, Bengaluru, Karnataka',
        "typology": 'mixed_use',
    },
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--company-id", default="provident",
                     help="Must match an existing company_id in this backend's data/companies/ folder.")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true", help="Skip the typed DELETE confirmation prompt.")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")

    # --- Step 1: list every project currently in the workspace ---
    try:
        r = requests.get(f"{base}/phase3/projects", params={"company_id": args.company_id}, timeout=30)
        r.raise_for_status()
        existing = r.json()
    except Exception as e:
        print(f"FAILED to list projects from {base}/phase3/projects: {e}")
        print("Is the backend dev server running? (uvicorn app.main:app, default port 8000)")
        return 1

    print(f"=== {len(existing)} project(s) currently in workspace '{args.company_id}' ===")
    for p in existing:
        print(f"  - {p.get('project_name') or p.get('project_id')}  (project_id={p['project_id']})")

    print(f"\n=== {len(PROJECTS)} project(s) will be created from Project_Details.xlsx (the 18 with a TBUA value) ===")
    for p in PROJECTS:
        print(f"  [{p['sl_no']}] {p['project_name']}  -- {p['gfa_sqm']} sqm")

    if args.dry_run:
        print("\n(dry run) Nothing was deleted or created.")
        return 0

    # --- Step 2: confirm, then delete everything that currently exists ---
    if existing and not args.yes:
        print(f"\nThis will PERMANENTLY delete all {len(existing)} project(s) listed above -- their Phase 1")
        print("records, baselines, and any logged bills. This cannot be undone.")
        typed = input("Type DELETE to confirm: ")
        if typed.strip() != "DELETE":
            print("Confirmation not received -- aborting. Nothing was deleted or created.")
            return 1

    deleted, delete_failed = 0, []
    for p in existing:
        project_id = p["project_id"]
        try:
            r = requests.delete(f"{base}/projects/{project_id}", params={"company_id": args.company_id}, timeout=30)
            r.raise_for_status()
            deleted += 1
        except Exception as e:
            delete_failed.append((p.get("project_name") or project_id, str(e)))
    print(f"\nDeleted {deleted}/{len(existing)} existing project(s).")
    for name, err in delete_failed:
        print(f"  FAILED to delete {name}: {err}")

    # --- Step 3: create the 18 ---
    results = []
    for p in PROJECTS:
        name = p["project_name"]
        print(f"\n=== [{p['sl_no']}] {name} ===")

        payload = {
            "company_id": args.company_id,
            "project_name": name,
            "gfa_sqm": p["gfa_sqm"],
            "location": p["location"],
        }
        if p.get("typology"):
            payload["typology"] = p["typology"]

        try:
            r = requests.post(f"{base}/form", json=payload, timeout=30)
            r.raise_for_status()
            project_id = r.json()["project_id"]
            print(f"  created project_id={project_id}")
        except Exception as e:
            print(f"  FAILED at /form: {e}")
            results.append({"sl_no": p["sl_no"], "name": name, "status": "failed_form", "error": str(e)})
            continue

        try:
            r = requests.post(
                f"{base}/calculate/{project_id}",
                params={"company_id": args.company_id},
                json={},
                timeout=30,
            )
            r.raise_for_status()
            calc = r.json()
            tonnes = calc["carbon"]["total_carbon_tonnes"]
            print(f"  calculated: {tonnes:.1f} tCO2e")
        except Exception as e:
            print(f"  FAILED at /calculate: {e}")
            results.append({"sl_no": p["sl_no"], "name": name, "project_id": project_id, "status": "failed_calculate", "error": str(e)})
            continue

        try:
            r = requests.post(
                f"{base}/phase3/projects/{project_id}/baseline",
                data={"source_type": "phase1_estimate", "company_id": args.company_id},
                timeout=30,
            )
            r.raise_for_status()
            print("  baseline locked")
        except Exception as e:
            print(f"  FAILED at /phase3 baseline: {e}")
            results.append({"sl_no": p["sl_no"], "name": name, "project_id": project_id, "status": "failed_baseline", "error": str(e)})
            continue

        results.append({"sl_no": p["sl_no"], "name": name, "project_id": project_id, "status": "ok", "total_carbon_tonnes": tonnes})
        time.sleep(0.2)

    print("\n\n=== SUMMARY ===")
    ok = [r for r in results if r.get("status") == "ok"]
    failed = [r for r in results if r.get("status") != "ok"]
    print(f"Deleted {deleted}/{len(existing)} existing project(s).")
    print(f"Created {len(ok)}/{len(PROJECTS)} new project(s), {len(failed)} failed.")
    for r in failed:
        print(f"  FAILED [{r['sl_no']}] {r['name']}: {r['status']} - {r.get('error')}")

    return 0 if not failed and not delete_failed else 1


if __name__ == "__main__":
    sys.exit(main())
