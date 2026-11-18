"""Sheet discovery and duplicate-scope detection for multi-sheet / multi-file
BOQ uploads.

Why this exists: the calculation used to read exactly ONE sheet per upload
(the first one whose name didn't look supplementary), so a workbook with
"BOQ-Structure" and "BOQ-Architecture" silently dropped the second. Now every
sheet that really is a BOQ table is a candidate; this module decides which
sheets are candidates (and says why the others are not), and warns when two
selected sheets look like they describe the SAME scope (e.g. a "Combined"
sheet that is the Structure + Architecture sheets merged), because adding
both would double-count it.

Nothing here calculates carbon. It only reads the sheets' own rows through
parser.extract_billable_items, the same extractor the calculation uses, so
what is listed here is exactly what would be calculated.
"""

from __future__ import annotations

import itertools
import re
from typing import Optional

import openpyxl
from pydantic import BaseModel

from app.services.boq_carbon.parser import BoqLineItem, _find_header_anchor, extract_billable_items
from app.services.boq_extractor import SUPPLEMENTARY_SHEET_PATTERNS


class SheetInfo(BaseModel):
    name: str
    n_lines: int = 0
    n_with_quantity: int = 0
    total_amount: float = 0.0
    # True when this sheet is a real BOQ table that should be calculated
    # unless the user unticks it. False sheets are still listed, with
    # `skip_reason`, so the user can see what was left out and why -- and
    # can still tick one on if the automatic call was wrong.
    selected_by_default: bool = False
    skip_reason: Optional[str] = None


def _row_value(i: BoqLineItem) -> float:
    if i.amount:
        return i.amount
    if i.rate and i.qty:
        return i.rate * i.qty
    return 0.0


def inspect_workbook(path: str) -> list[SheetInfo]:
    wb = openpyxl.load_workbook(path, read_only=True)
    try:
        names = list(wb.sheetnames)
        infos: list[SheetInfo] = []
        for name in names:
            info = SheetInfo(name=name)
            matched = next((p for p in SUPPLEMENTARY_SHEET_PATTERNS if re.search(p, name, re.IGNORECASE)), None)
            try:
                rows = list(wb[name].iter_rows(values_only=True, max_row=40))
            except Exception as e:  # noqa: BLE001 -- an unreadable sheet is reported, never fatal to the upload
                info.skip_reason = f"could not be read ({e})"
                infos.append(info)
                continue
            has_header = _find_header_anchor(rows) is not None
            if has_header:
                try:
                    items = extract_billable_items(path, name)
                except Exception as e:  # noqa: BLE001
                    items = []
                    info.skip_reason = f"could not be parsed ({e})"
                info.n_lines = len(items)
                info.n_with_quantity = sum(1 for i in items if i.qty)
                info.total_amount = sum(_row_value(i) for i in items)
            if info.skip_reason:
                pass
            elif matched:
                info.skip_reason = "sheet name looks like a derived / supplementary / summary sheet"
            elif not has_header:
                info.skip_reason = "no BOQ table header (item no + description) found -- looks like a rate or price list, not a BOQ"
            elif info.n_lines == 0:
                info.skip_reason = "BOQ header found but no billable lines"
            elif info.n_with_quantity == 0:
                info.skip_reason = "no line has a quantity -- looks like a rate or price list, not a BOQ"
            else:
                info.selected_by_default = True
            infos.append(info)
        return infos
    finally:
        wb.close()


def default_sheets(path: str) -> list[str]:
    """Every sheet that is a real BOQ table (what an upload calculates when
    the user hasn't picked sheets). Raises ValueError if there is none."""
    chosen = [i.name for i in inspect_workbook(path) if i.selected_by_default]
    if not chosen:
        raise ValueError(f"No BOQ sheet found in {path} -- no sheet has a BOQ table header with billable lines.")
    return chosen


# --- duplicate / overlapping scope detection --------------------------------

_NON_WORD = re.compile(r"\W+")


def _fingerprint(i: BoqLineItem) -> tuple:
    desc = _NON_WORD.sub(" ", (i.description or "").lower()).strip()[:100]
    return (desc, (i.uom or "").strip().lower(), round(i.qty, 2) if i.qty else None)


def detect_overlaps(groups: list[dict]) -> list[str]:
    """`groups`: [{"label": "file.xlsx > Sheet", "items": [BoqLineItem, ...]}].
    Returns plain-language warnings (empty list = nothing suspicious).
    Two heuristics, both deliberately conservative and warn-only:
      1. two sheets share at least half of the smaller sheet's lines (same
         description, unit and quantity);
      2. one sheet's total equals (within 1%) the sum of two to four other
         selected sheets -- the signature of a "Combined"/"Summary" sheet.
    """
    warnings: list[str] = []
    prints = [{_fingerprint(i) for i in g["items"]} for g in groups]
    totals = [sum(_row_value(i) for i in g["items"]) for g in groups]

    flagged_pairs: set[tuple[int, int]] = set()
    for a, b in itertools.combinations(range(len(groups)), 2):
        smaller = min(len(prints[a]), len(prints[b]))
        if smaller < 3:
            continue
        shared = len(prints[a] & prints[b])
        if shared / smaller >= 0.5:
            flagged_pairs.add((a, b))
            warnings.append(
                f"'{groups[a]['label']}' and '{groups[b]['label']}' share {shared} identical lines "
                f"({shared / smaller:.0%} of the smaller one) -- they may describe the same scope. "
                f"Counting both would double-count it; untick one if so."
            )

    if len(groups) >= 3:
        for g in range(len(groups)):
            if totals[g] <= 0:
                continue
            others = [i for i in range(len(groups)) if i != g and totals[i] > 0]
            hit = None
            for size in (2, 3, 4):
                for combo in itertools.combinations(others, size):
                    if abs(sum(totals[i] for i in combo) - totals[g]) <= 0.01 * totals[g]:
                        hit = combo
                        break
                if hit:
                    break
            if hit:
                names = " + ".join(f"'{groups[i]['label']}'" for i in hit)
                warnings.append(
                    f"'{groups[g]['label']}' (value {totals[g]:,.0f}) equals the sum of {names} to within 1% -- "
                    f"it looks like a combined/summary sheet. Counting it together with those sheets double-counts everything."
                )
    return warnings
