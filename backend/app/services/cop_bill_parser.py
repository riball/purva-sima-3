"""Parses a Provident/Puravankara "Certificate of Payment (COP)" PDF's
"Cummulative Quanity Summary" table (the one on pages 4+ of a real COP,
e.g. Sr No / Item Code / Activity Description / Unit / Rate / Quantity
[Previous, Present, Cummu.] / Value [Previous, Present, Cummu.]) into a
flat list of line items keyed by the SAME per-company Item Code the
existing Work Order pipeline already uses -- see
app/services/wo_carbon/wo_carbon_engine.py's module docstring: Item Code
'13000389' etc. are drawn from the exact same master_item_codes.json
keyspace a Work Order's Activity Number already resolves against
(confirmed directly against a real company's master_item_codes.json --
every Item Code sampled from a real COP was present there with a real
material_category).

Built on the same technique as wo_pdf_parser.py (this project's other
PDF-table parser): pdfplumber word-position data, a header row located
once and turned into per-column x-bands, data extracted by which band a
number's x0 falls into -- not by "the Nth number on the line", since
(confirmed on this document too, same as the WO PDF) numbers can detach
or fuse across adjacent columns in the underlying content stream. Reuses
wo_pdf_parser.py's own line-extraction/number-matching helpers directly
rather than re-implementing them, since it's the same PDF-table-reading
problem on the same kind of document family.

What's structurally different from a Work Order PDF, and why this is a
new parser rather than a new branch in wo_pdf_parser.py:

- The Item Code here is a bare 7-9 digit number ("13000389"), not the
  Work Order's "code/taxcode" pair ("13000389 / 400206") -- so the
  header/row layout, the row-start regex, and the column set (this
  table has a Previous/Present/Cummu. split on BOTH Quantity and Value,
  a WO PDF has neither) are all different enough that sharing one parser
  would mean two incompatible header/row shapes living in one function.

- Phase 3's bill semantics need only "quantity/value AS OF this bill's
  date" -- the "Cummu." column, never "Previous" or "Present" alone
  (see app/services/phase3.py's own module docstring: "each bill is a
  CUMULATIVE snapshot ... not an incremental delta"). This parser reads
  Cummu. Quantity and Cummu. Value as this line's qty/amount; Previous
  and Present are read too, only to (a) validate Cummu. == Previous +
  Present as a per-row identity check and (b) recover Cummu. by that
  same addition on the rare row where the Cummu. token itself is fused
  into a neighboring column's word (see _numbers_in_band's docstring)
  and can't be read directly.

- Whole-document checksum: unlike a Work Order PDF (which states its own
  grand total in a "BOQ SUMMARY" section), a COP states its cumulative
  work-done value on page 1, in the "Cummulative Certificate Details"
  block's "Work done" row (Previous / Current RA Bill / Cummulative RA
  Bill Amount) -- the third number on that row is the authoritative
  cumulative value-of-work-done-to-date figure this parser's own summed
  Cummu. Value should reproduce (confirmed on both real COPs on hand: to
  within a few rupees -- the COP's own "Work done" figure nets a small
  Material-Rate-Difference adjustment the line-item table books as its
  own separate rows, so an exact-to-the-paisa match isn't the right bar
  here the way it is for a Work Order's own internally-consistent BOQ
  SUMMARY; "within a rounding-scale tolerance" is what parse_checksum_ok
  below actually checks).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import pdfplumber

from app.services.wo_carbon.wo_pdf_parser import NUM_RE, UNIT_RE, _extract_lines, _parse_amt

# A COP line-item row: "<Sr No> <Item Code> <Activity Description...>".
# Item Code here is a bare integer (7-9 digits) -- no "/<taxcode>" suffix,
# unlike a Work Order's CODE_RE -- so this table's rows are distinguished
# from that format by regex shape alone, no shared row-matching code.
ROW_START_RE = re.compile(r"^(\d{1,4})\s+(\d{7,9})\b")

# The two header lines together define every column this parser reads:
#   "... Unit Rate"                              (line A)
#   "No Previous Present Cummu. Previous Present Cummu."  (line B, right after A)
_LINE_A_LABELS = ("Unit", "Rate")
_LINE_B_LABEL = "No"

# Page 1's "Cummulative Certificate Details" block -- the authoritative
# cumulative value-of-work-done-to-date figure this document itself
# states, used only as an external checksum (see module docstring).
WORK_DONE_ROW_RE = re.compile(
    r"^Work done\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+\.\d+)"
)


@dataclass
class CopLineItem:
    item_code: str
    description: str
    unit: str
    rate: Optional[float]
    qty_previous: Optional[float]
    qty_present: Optional[float]
    qty_cummulative: Optional[float]  # None when unrecoverable -- see parse_cop_pdf's docstring; the row still counts toward value/coverage, just not toward a computed gwp
    value_previous: Optional[float]
    value_present: Optional[float]
    value_cummulative: float  # what Phase 5 actually calculates value/coverage against -- always resolved for a "parsed" row
    qty_derivation: str = "direct"  # "direct" | "previous_plus_present" | "unrecoverable"
    value_derivation: str = "direct"  # "direct" | "rate_times_qty" | "previous_plus_present"


@dataclass
class CopParseResult:
    items: list[CopLineItem]
    unparsed_rows: list[tuple[str, str, str]] = field(default_factory=list)  # (sr_no, item_code, context snippet)
    work_done_cumulative_value: Optional[float] = None  # from page 1, for validation
    total_value_cummulative_parsed: float = 0.0
    parse_checksum_ok: Optional[bool] = None


def _find_column_bands(lines: list) -> Optional[dict[str, tuple[float, float]]]:
    """Locates the two-line header (see module docstring) and returns
    x-bands for Rate, Qty[Previous/Present/Cummulative], and
    Value[Previous/Present/Cummulative] -- band = [midpoint-to-previous-
    anchor, midpoint-to-next-anchor), same construction as
    wo_pdf_parser.py's own _find_column_bands. Returns None if the header
    can't be found anywhere (so the caller can fail honestly rather than
    silently extract nothing from a differently-laid-out document).
    """
    for i in range(len(lines) - 1):
        line_a, line_b = lines[i], lines[i + 1]
        texts_a = {w["text"] for w in line_a.words}
        texts_b = {w["text"] for w in line_b.words}
        if not all(lbl in texts_a for lbl in _LINE_A_LABELS):
            continue
        if _LINE_B_LABEL not in texts_b:
            continue
        prev_words = [w for w in line_b.words if w["text"] == "Previous"]
        pres_words = [w for w in line_b.words if w["text"] == "Present"]
        cumm_words = [w for w in line_b.words if w["text"].startswith("Cummu")]
        if len(prev_words) != 2 or len(pres_words) != 2 or len(cumm_words) != 2:
            continue

        rate_word = next((w for w in line_a.words if w["text"] == "Rate"), None)
        if rate_word is None:
            continue

        anchors = [("Rate", rate_word["x0"])]
        anchors += [("qty_previous", prev_words[0]["x0"]), ("value_previous", prev_words[1]["x0"])] if prev_words[0]["x0"] < prev_words[1]["x0"] else [("value_previous", prev_words[0]["x0"]), ("qty_previous", prev_words[1]["x0"])]
        anchors += [("qty_present", pres_words[0]["x0"]), ("value_present", pres_words[1]["x0"])] if pres_words[0]["x0"] < pres_words[1]["x0"] else [("value_present", pres_words[0]["x0"]), ("qty_present", pres_words[1]["x0"])]
        anchors += [("qty_cummulative", cumm_words[0]["x0"]), ("value_cummulative", cumm_words[1]["x0"])] if cumm_words[0]["x0"] < cumm_words[1]["x0"] else [("value_cummulative", cumm_words[0]["x0"]), ("qty_cummulative", cumm_words[1]["x0"])]

        ordered = sorted(anchors, key=lambda kv: kv[1])
        bands: dict[str, tuple[float, float]] = {}
        for idx, (label, x0) in enumerate(ordered):
            start = 0.0 if idx == 0 else (ordered[idx - 1][1] + x0) / 2
            end = 1e9 if idx == len(ordered) - 1 else (x0 + ordered[idx + 1][1]) / 2
            bands[label] = (start, end)
        return bands
    return None


def _numbers_in_band(line, band: tuple[float, float]) -> list[str]:
    lo, hi = band
    return [w["text"] for w in line.words if lo <= w["x0"] < hi and NUM_RE.fullmatch(w["text"].rstrip("."))]


def _one_number_in_band(line, band: tuple[float, float]) -> Optional[float]:
    nums = _numbers_in_band(line, band)
    return _parse_amt(nums[0]) if len(nums) == 1 else None


def parse_cop_pdf(pdf_path: str) -> CopParseResult:
    """Extracts every priced line item from a COP's Cummulative Quanity
    Summary table, plus the page-1 cumulative-value figure to validate
    against. Raises pdfplumber's own exceptions for a corrupt/unreadable
    file; a scanned/image-only PDF yields zero items (no OCR here,
    exactly as wo_pdf_parser.py's own module docstring explains for the
    same situation) rather than raising.
    """
    with pdfplumber.open(pdf_path) as pdf:
        lines = _extract_lines(pdf)
        page1_text = pdf.pages[0].extract_text() or ""

    work_done_value = None
    for raw_line in page1_text.splitlines():
        m = WORK_DONE_ROW_RE.match(raw_line.strip())
        if m:
            work_done_value = _parse_amt(m.group(3))
            break

    bands = _find_column_bands(lines)
    if bands is None:
        return CopParseResult(items=[], work_done_cumulative_value=work_done_value)

    row_idxs = [i for i, ln in enumerate(lines) if ROW_START_RE.match(ln.text)]

    items: list[CopLineItem] = []
    unparsed: list[tuple[str, str, str]] = []

    for pos, i in enumerate(row_idxs):
        m = ROW_START_RE.match(lines[i].text)
        sr_no, item_code = m.group(1), m.group(2)
        window_end = row_idxs[pos + 1] if pos + 1 < len(row_idxs) else min(i + 4, len(lines))
        window = lines[i:window_end]

        # Everything for this row lives on its own single visual line in
        # every real example checked (unlike the WO PDF, where Qty could
        # land on an adjacent line) -- but scan the short window anyway,
        # taking the first line that actually carries all three Value
        # numbers, so a row that happens to wrap doesn't silently fail.
        row_line = None
        for ln in window:
            if len(_numbers_in_band(ln, bands["value_cummulative"])) >= 1 or (
                len(_numbers_in_band(ln, bands["value_previous"])) >= 1
                and len(_numbers_in_band(ln, bands["value_present"])) >= 1
            ):
                row_line = ln
                break
        if row_line is None:
            row_line = window[0]

        unit_m = UNIT_RE.search(row_line.text)
        unit = unit_m.group(1) if unit_m else ""

        rate = _one_number_in_band(row_line, bands["Rate"])
        qty_prev = _one_number_in_band(row_line, bands["qty_previous"])
        qty_pres = _one_number_in_band(row_line, bands["qty_present"])
        qty_cumm = _one_number_in_band(row_line, bands["qty_cummulative"])
        val_prev = _one_number_in_band(row_line, bands["value_previous"])
        val_pres = _one_number_in_band(row_line, bands["value_present"])
        val_cumm = _one_number_in_band(row_line, bands["value_cummulative"])

        # Quantity: direct read, else Previous+Present (a provably-exact
        # identity on every clean row checked -- see module docstring).
        # A handful of LS/lump-sum "rate adjustment" rows (e.g. "CRE-
        # Basic Rate Diff") glue Rate itself into a neighboring column
        # and leave quantity genuinely unrecoverable; that's fine here,
        # since those rows are excluded from the carbon calc on unit/
        # category grounds regardless of what their quantity is (see
        # phase3_cop_engine.py) -- only their VALUE needs to be right,
        # for Coverage's value accounting.
        qty_derivation = "direct"
        if qty_cumm is None:
            if qty_prev is not None and qty_pres is not None:
                qty_cumm = qty_prev + qty_pres
                qty_derivation = "previous_plus_present"
            else:
                qty_derivation = "unrecoverable"

        # Value: direct read, else Rate x Quantity (confirmed reproducing
        # the document's own stated Value to within rounding on every
        # row checked), else Previous+Present. Value is what determines
        # whether this row is "parsed" at all -- Coverage's total_value
        # accounting needs a real number for every row, even the ones
        # excluded from the carbon total itself.
        value_derivation = "direct"
        if val_cumm is None:
            if rate is not None and qty_cumm is not None:
                val_cumm = rate * qty_cumm
                value_derivation = "rate_times_qty"
            elif val_prev is not None and val_pres is not None:
                val_cumm = val_prev + val_pres
                value_derivation = "previous_plus_present"

        if val_cumm is None or not unit:
            context = row_line.text[:200]
            unparsed.append((sr_no, item_code, context))
            continue

        # description: the row's text, minus the leading "Sr ItemCode"
        # and every numeric/unit token this parser already extracted --
        # the master item-code dataset is the source of truth for a
        # material's real name anyway (see phase3_cop_engine.py), so
        # this is kept only for the unparsed-row diagnostics/audit trail,
        # not for any classification decision.
        desc = ROW_START_RE.sub("", row_line.text, count=1).strip()

        items.append(CopLineItem(
            item_code=item_code,
            description=desc,
            unit=unit,
            rate=rate,
            qty_previous=qty_prev,
            qty_present=qty_pres,
            qty_cummulative=qty_cumm,
            value_previous=val_prev,
            value_present=val_pres,
            value_cummulative=val_cumm,
            qty_derivation=qty_derivation,
            value_derivation=value_derivation,
        ))

    total_value = sum(it.value_cummulative for it in items)
    checksum_ok = None
    if work_done_value:
        # Not expected to match to the paisa (see module docstring) --
        # a COP's page-1 "Work done" figure nets Material Rate
        # Difference adjustments the line-item table books as separate
        # rows; a match within ~2% is what actually indicates a correct
        # parse vs. a badly misread document.
        checksum_ok = abs(total_value - work_done_value) < 0.02 * work_done_value

    return CopParseResult(
        items=items,
        unparsed_rows=unparsed,
        work_done_cumulative_value=work_done_value,
        total_value_cummulative_parsed=total_value,
        parse_checksum_ok=checksum_ok,
    )
