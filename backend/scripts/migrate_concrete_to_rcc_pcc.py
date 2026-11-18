"""One-off migration: relabel stored Work-Order / bill results from the single
"concrete" category to "rcc" + "pcc" (label only -- no carbon number changes).

Pure standard library (no app imports needed). Dry-run by default.

  python scripts/migrate_concrete_to_rcc_pcc.py                 # dry run, all projects
  python scripts/migrate_concrete_to_rcc_pcc.py --apply         # write (backs up first)
  python scripts/migrate_concrete_to_rcc_pcc.py --apply --bill-splits splits.json

* phase3_source_result.json (WO): every line with material_category=="concrete"
  is relabelled with the same rule the engines now use (concrete_subtype.py);
  by_category is rebuilt from the lines. Totals and every other category are
  verified unchanged, otherwise that file is skipped.
* bills/*.json store only aggregated rows (no line items), so they cannot be
  split from stored data. Pass --bill-splits: a JSON {period: {"rows": [...]}}
  produced by re-running the bill PDFs through the engine. The 'concrete' row is
  replaced by the rcc/pcc rows only if rcc+pcc == old concrete and the bill total
  is unchanged.
Originals are copied to <name>.bak_pre_rcc_pcc before any write.
"""
import argparse, importlib.util, json, shutil, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("concrete_subtype", HERE.parent / "app" / "services" / "concrete_subtype.py")
cs = importlib.util.module_from_spec(spec); spec.loader.exec_module(cs)

BAK = ".bak_pre_rcc_pcc"
close = lambda a, b: abs(a - b) <= 1e-6 * max(1.0, abs(a), abs(b))


def backup(p: Path):
    b = p.with_name(p.name + BAK)
    if not b.exists():
        shutil.copy2(p, b)


def migrate_source(p: Path, apply: bool):
    d = json.loads(p.read_text(encoding="utf-8"))
    lines = d.get("line_items") or []
    if not any(li.get("material_category") == "concrete" for li in lines) and \
       not any(c.get("category") == "concrete" for c in d.get("by_category", [])):
        return "no 'concrete' label -- skipped"
    old_total = d["total_gwp_kg_co2e"]
    old_cats = {c["category"]: c for c in d["by_category"]}
    n = {"rcc": 0, "pcc": 0}
    for li in lines:
        if li.get("material_category") == "concrete":
            cat = cs.classify_concrete_subtype(li.get("description"))[0]
            li["material_category"] = cat
            n[cat] += 1
    agg = {}
    for li in lines:
        g = li.get("gwp_kg_co2e")
        if g is None:
            continue
        a = agg.setdefault(li["material_category"], {"gwp": 0.0, "n": 0, "amt": 0.0})
        a["gwp"] += g; a["n"] += 1; a["amt"] += li.get("amount") or 0.0
    new_total = sum(a["gwp"] for a in agg.values())
    if not close(new_total, old_total):
        return f"ABORT: total changed {old_total} -> {new_total}"
    for k, o in old_cats.items():
        if k != "concrete" and (k not in agg or not close(agg[k]["gwp"], o["gwp_kg_co2e"])):
            return f"ABORT: category {k} changed"
    if not close(agg.get("rcc", {"gwp": 0})["gwp"] + agg.get("pcc", {"gwp": 0})["gwp"], old_cats["concrete"]["gwp_kg_co2e"]):
        return "ABORT: rcc+pcc != old concrete"
    d["by_category"] = [
        {"category": k, "gwp_kg_co2e": a["gwp"], "line_item_count": a["n"], "wo_amount_covered": a["amt"],
         "pct_of_total": (a["gwp"] / new_total * 100) if new_total else 0.0}
        for k, a in sorted(agg.items(), key=lambda kv: -kv[1]["gwp"])
    ]
    if apply:
        backup(p); p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"ok: {n['rcc']} rcc lines, {n['pcc']} pcc lines; total unchanged {old_total:.2f}"


def migrate_bill(p: Path, splits: dict, apply: bool):
    d = json.loads(p.read_text(encoding="utf-8"))
    rows = d.get("category_breakdown") or []
    old = next((r for r in rows if r["category"] == "concrete"), None)
    if not old:
        return "no 'concrete' row -- skipped"
    sp = (splits or {}).get(d.get("period"))
    if not sp:
        return "no split supplied for this period -- skipped"
    new = [r for r in sp["rows"] if r["category"] in ("rcc", "pcc")]
    if not close(sum(r["gwp_kg_co2e"] for r in new), old["gwp_kg_co2e"]) or \
       sum(r["line_item_count"] for r in new) != old["line_item_count"] or \
       not close(sp["total"], d["total_gwp_kg_co2e_to_date"]):
        return "ABORT: supplied split does not reconcile with stored bill"
    total = d["total_gwp_kg_co2e_to_date"]
    out = []
    for r in rows:
        if r["category"] == "concrete":
            out.extend(dict(x, pct_of_total=x["gwp_kg_co2e"] / total * 100) for x in new)
        else:
            out.append(r)
    d["category_breakdown"] = sorted(out, key=lambda r: -r["gwp_kg_co2e"])
    if apply:
        backup(p); p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    return "ok: concrete -> " + " + ".join(f"{r['category']} {r['gwp_kg_co2e']:.1f}" for r in new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(HERE.parent / "app" / "data" / "companies"))
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--bill-splits")
    a = ap.parse_args()
    splits = json.load(open(a.bill_splits)) if a.bill_splits else None
    print("APPLY" if a.apply else "DRY RUN")
    for p in sorted(Path(a.data).glob("*/projects/*/phase3_source_result.json")):
        print(p.parent.name[:8], "source_result:", migrate_source(p, a.apply))
    for p in sorted(Path(a.data).glob("*/projects/*/bills/*.json")):
        print(p.parent.parent.name[:8], p.name + ":", migrate_bill(p, splits, a.apply))


if __name__ == "__main__":
    main()
