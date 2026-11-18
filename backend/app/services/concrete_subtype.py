"""Splits the Work-Order / bill engines' single "concrete" category into
"rcc" and "pcc", the same two categories the BOQ engine
(app/services/boq_carbon/classifier.py) already reports, so a Work-Order or
bill project's Material Breakdown reads the same way a BOQ project's does and
the Swap Sandbox can find its concrete lines.

LABEL ONLY -- by design this changes nothing about how a line is *calculated*.
Both engines keep computing every concrete line through the unchanged
"concrete" path (qty x density x grade-based PPC factor); only the category
NAME stored on the finished line, and therefore the per-category totals built
from it, changes. So the concrete total, the grand total and every other
material's share are identical before and after. (Re-computing PCC lines with
the BOQ's PCC defaults instead -- e.g. its M10 fallback grade -- WOULD change
numbers; that is deliberately not done here.)

Why this is its own module and not the BOQ's _PCC_RE: that expression is
`\\bpcc\\b`, which does not match "P.C.C. 1:3:6" (the dots), and it has no
word for "plain concrete". Item descriptions in the master item-code list use
all of these spellings, so descriptions are normalised first (case, dots,
dashes and stray spaces between the letters) and then matched.

Rule (agreed with the project owner): a concrete line is PCC when its
description names plain / plum / blinding / levelling concrete or any spelling
of "PCC"; every other concrete line is RCC. This includes two lines that are
PCC by name but not pours (demolition of existing PCC, and IPS-flooring
concrete levelling) -- both explicitly decided as PCC. "Non Structural wall"
lines are explicitly decided as RCC (they match no PCC word, so the default
already gives that).
"""

from __future__ import annotations

import re
from typing import Optional

CATEGORY_RCC = "rcc"
CATEGORY_PCC = "pcc"
_MASTER_CONCRETE = "concrete"

# P.C.C. / p c c / P-C-C / PCC -- letters separated by at most dots, dashes,
# slashes or spaces, and not part of a longer word (so "pccs" or "upcc" don't
# match, nor "P & A primer").
_PCC_LETTERS_RE = re.compile(r"(?<![a-z])p[\s.\-/]*c[\s.\-/]*c(?![a-z])", re.I)
_PCC_WORDS_RE = re.compile(
    r"plain\s*(?:cement\s*)?concrete"   # "Plain Concrete", "Plain Cement Concrete"
    r"|plum\s*concrete"
    r"|blinding"
    r"|levell?ing"                      # "Levelling" / "Leveling" (concrete)
    r"|lean\s*(?:mix|concrete)",
    re.I,
)


def classify_concrete_subtype(description: Optional[str]) -> tuple[str, str]:
    """Returns (category, rule) for one concrete line -- category is
    "rcc" or "pcc"; rule is a short human-readable reason, so the choice can
    be traced and explained line by line."""
    text = description or ""
    if _PCC_LETTERS_RE.search(text):
        return CATEGORY_PCC, "description contains 'PCC' (any spelling, e.g. P.C.C.)"
    m = _PCC_WORDS_RE.search(text)
    if m:
        return CATEGORY_PCC, f"description contains '{m.group(0).strip()}'"
    return CATEGORY_RCC, "default: structural / ready-mix concrete"


def refine_category(master_category: Optional[str], description: Optional[str]) -> Optional[str]:
    """The category to REPORT for a line. Only the master list's single
    "concrete" category is split; every other category (and None) is
    returned unchanged. Computation must still use `master_category`."""
    if master_category == _MASTER_CONCRETE:
        return classify_concrete_subtype(description)[0]
    return master_category
