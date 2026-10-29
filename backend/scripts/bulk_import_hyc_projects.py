"""
One-off bulk import: adds the 18 real projects from the uploaded
Project_Details.xlsx (HYC Environmental Clearance / Consent to Establish
compliance tracker) into Sima CarbonOS through the REAL Conceptual Estimate
pipeline -- the exact same three calls the ConceptualEstimatePage UI makes:

  1. POST   /form                                   -> creates the Phase 1 record
  2. POST   /calculate/{project_id}                  -> runs the real carbon/cost calc
  3. POST   /phase3/projects/{project_id}/baseline    -> locks it as a tracked baseline
                                                          (source_type=phase1_estimate)

Only gfa_sqm + location (+ typology where the source data makes it
unambiguous) are set explicitly below -- every other Tier2/Tier3 field is
left for the backend's own match_boq_defaults/fill_missing_fields auto-fill,
exactly as it would behave for a real user who only fills in Basics.
Nothing here fabricates data the Excel source doesn't provide.

Two projects in the source sheet (Windermere, ADG Goa) had zero usable data
(no GFA, no entity, nothing) and are intentionally skipped -- per decision.

Of the 20 real projects, 9 had the EC (Environmental Clearance) and CTE
(Consent to Establish) figures disagree on built-up area; the EC figure was
used throughout, per decision (EC is the broader/primary approval; CTE often
covers only a sub-phase or was simply missing).

Run this once, from the `backend` folder, with its venv active and the
backend's dev server already running (default http://localhost:8000):

    cd backend
    venv\\Scripts\\activate        (Windows)  /  source venv/bin/activate  (mac/linux)
    python scripts\\bulk_import_hyc_projects.py

Safe to re-run with --dry-run first to preview without writing anything.
Re-running for real a second time will create 18 NEW duplicate projects
(POST /form always mints a fresh project_id) -- it is not idempotent by
design, matching how the real form behaves.
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
        "sl_no": 1, "project_name": "Balagere",
        "gfa_sqm": 113522.28, "location": "Balagere, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 2, "project_name": "Westend II",
        "gfa_sqm": 37061.797, "location": "Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 3, "project_name": "Hebbagodi (Purva Silver Sky)",
        "gfa_sqm": 92655.2, "location": "Hebbagodi, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 4, "project_name": "Development of Residential Apartment with Clubhouse & Retail",
        "gfa_sqm": 440986.42, "location": "Bengaluru, Karnataka",
        "typology": "mixed_use",
    },
    {
        "sl_no": 5, "project_name": "Winworth 2 & 3 - Residential cum Commercial Complex, Edappally",
        "gfa_sqm": 464924.55, "location": "Edappally, Kochi, Kerala",
        "typology": "mixed_use",
    },
    {
        "sl_no": 6, "project_name": "Sunworth Residential Apartment & Commercial Building (Equinox), Venkatapura Village, Kengeri Hobli",
        "gfa_sqm": 640828.6, "location": "Kengeri Hobli, Bangalore South Taluk, Karnataka",
        "typology": "mixed_use",
    },
    {
        "sl_no": 7, "project_name": "Purva Highland, Mallasandra Village, Kanakapura Road",
        "gfa_sqm": 283722.62, "location": "Mallasandra, Kanakapura Road, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 8, "project_name": "Mallasandra - Sy No 28 Residential Apartment, Kanakapura Road",
        "gfa_sqm": 112730.86, "location": "Mallasandra, Kanakapura Road, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 9, "project_name": "Residential Apartment Project, Vajarahalli Village",
        "gfa_sqm": 69364.77, "location": "Vajarahalli, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 10, "project_name": "Residential Apartment Project, Hennur Village",
        "gfa_sqm": 57270.3, "location": "Hennur, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 11, "project_name": "Ecopolitan Phase-II Expansion, Provident White Oaks",
        "gfa_sqm": 180871.15, "location": "Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 12, "project_name": "Blue Bells, Magadi Main Road, Kempapura Agrahara",
        "gfa_sqm": 67102.49, "location": "Magadi Main Road, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 13, "project_name": "Orient Grand, Lalbagh Road, Sudhamanagar",
        "gfa_sqm": 27794.6, "location": "Sudhamanagar, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 14, "project_name": "Zentech Commercial (Office & Retail), Doddakalsandra Village",
        "gfa_sqm": 102557.95, "location": "Doddakalsandra, Kanakapura Main Road, Bengaluru, Karnataka",
        "typology": "commercial",
    },
    {
        "sl_no": 16, "project_name": "Bayscape, Sathankuppam & Padur Village",
        "gfa_sqm": 100732.88, "location": "Padur, Chengalpattu District, Tamil Nadu",
        "typology": None,
    },
    {
        "sl_no": 17, "project_name": "Botanico Residential Apartment, Samethanahalli",
        "gfa_sqm": 181194.52, "location": "Samethanahalli, Hosakote Taluk, Bengaluru, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 18, "project_name": "Deansgate, Uganavadi Village, Devanahalli Taluk",
        "gfa_sqm": 52618.75, "location": "Uganavadi, Devanahalli Taluk, Bengaluru Rural, Karnataka",
        "typology": "residential",
    },
    {
        "sl_no": 19, "project_name": "Devas Global - Aerocity Township & Area Development Project",
        "gfa_sqm": 235621.59, "location": "Devanahalli, Bengaluru, Karnataka",
        "typology": "mixed_use",
    },
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--company-id", default="provident",
                     help="Must match an existing company_id in this backend's data/companies/ folder.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    results = []

    for p in PROJECTS:
        name = p["project_name"]
        print(f"\n=== [{p['sl_no']}] {name} ===")

        if args.dry_run:
            print(f"  (dry run) gfa_sqm={p['gfa_sqm']} location={p['location']} typology={p['typology']}")
            continue

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
    print(f"{len(ok)} succeeded, {len(failed)} failed (of {len(PROJECTS)})")
    for r in failed:
        print(f"  FAILED [{r['sl_no']}] {r['name']}: {r['status']} - {r.get('error')}")

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
