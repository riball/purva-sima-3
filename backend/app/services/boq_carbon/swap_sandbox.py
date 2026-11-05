"""Material Swap Sandbox: free-text, typo-tolerant swap requests that
still only ever produce a REAL recompute, never an LLM-guessed number.

This module is the backend half of the user's own request: "a swapping
sandbox where the user gets to define the swaps in plain words, no
strict keywords ... this system should be able to tolerate spelling
mistakes, human errors, etc just like how LLMs work." The hard rule
carried over unchanged from chatbot.py (see that module's own docstring):
an LLM may parse intent into parameters, and -- new here, scoped
carefully -- may write qualitative advisory prose, but it NEVER computes
or invents a carbon number. Every number in a CustomSwapEvaluation comes
from substitution_engine.apply_substitution(), the exact same
real-recompute function the fixed catalog already uses.

Reuse, not reimplementation:
  - `_lines_affected_by` / `_recompute_line_at_substitute`
    (substitution_engine.py) both already operate on a plain `entry:
    dict` -- they don't require it to come from substitution_catalog.json.
    This module's whole job is to turn free text into that same dict
    shape, then hand it to the exact same functions.
  - `apply_substitution()` is called directly, unchanged -- no new
    blend math exists in this module.
  - `detect_cement_type()` / `detect_grade()` (emission_factors.py) are
    reused for the keyword-fallback parse path, not re-implemented --
    same regexes classifier.py already uses for real BOQ lines, so a
    sandbox request is interpreted with the identical vocabulary a real
    BOQ line would be.

Honesty discipline for a swap with no catalog backing (the common case,
since a free-text request is unlikely to exactly match one of the four
fixed catalog entries): resolve_intent_to_entry() still returns a
complete, usable entry. When no real catalog entry conceptually
overlaps, the entry is still marked honestly -- evidence_tier=
"sandbox_custom", always_requires_review_if_load_bearing=True -- rather
than borrowing a catalog entry's confidence level for a combination
nobody has actually reviewed.

Custom composition percentages (GGBS%, fly-ash%): CementType is a fixed
3-value enum (OPC/PSC/PPC) with no continuous blend field, but IFC's data
does give two real points on each of two axes -- OPC at 0% of the
component, and the one real blend IFC measured (PSC ~25% GGBS, PPC ~30%
fly-ash). A request for an arbitrary percentage (e.g. "20% GGBS") is
answered by linearly interpolating/extrapolating a straight line through
those two real points (ice_factors.get_blended_cement_factor_per_kg),
NOT by snapping to the nearest fixed value -- per the user's own
confirmed choice. The result is always labeled plainly as an estimate,
with an escalating disclosure depending on how far target_pct sits from
the one real measured point (resolve_intent_to_entry's three-tier
"interpolated" / "extrapolated_within_code_ceiling" /
"extrapolated_beyond_code_ceiling" confidence).

This deliberately does NOT extend to every "percentage" in the catalog.
brick_to_aac_block and the ARS recycled-steel entry are both SCOPE swaps
(what fraction of a project's total quantity switches products) --
already continuous today via split_pct, nothing to add. Steel recycled-
content specifically is withheld from composition-interpolation on
purpose: substitution_catalog.json's own evidence_log shows recycled-
content% does not predict steel's GWP linearly (a real EPD at ~23%
recycled scores the same as the non-recycled baseline), so treating it
as an interpolatable axis the way GGBS%/fly-ash% are would fabricate a
relationship this codebase's own on-file evidence contradicts.
"""

from __future__ import annotations

import re
import uuid
from difflib import SequenceMatcher
from typing import Literal, Optional

from pydantic import BaseModel

from app.services.boq_carbon.classifier import (
    CATEGORY_ALUMINIUM,
    CATEGORY_BLOCKWORK_AAC,
    CATEGORY_BLOCKWORK_DENSE,
    CATEGORY_BRICK,
    CATEGORY_GLASS,
    CATEGORY_MASONRY,
    CATEGORY_NATURAL_STONE,
    CATEGORY_PAINT,
    CATEGORY_PCC,
    CATEGORY_PLASTER_CEMENT,
    CATEGORY_PLASTER_GYPSUM,
    CATEGORY_RCC,
    CATEGORY_STEEL_REBAR,
    CATEGORY_STEEL_SECTION,
    CATEGORY_TILE_CERAMIC,
    CATEGORY_TIMBER,
    CATEGORY_UPVC,
)
from app.services.boq_carbon.engine import ALL_MATERIAL_CATEGORIES
from app.services.boq_carbon.substitution_engine import (
    AnyCarbonResult,
    SubstitutionResult,
    apply_substitution,
)
from app.services.emission_factors import detect_cement_type, detect_grade
from app.services.ice_factors import get_blended_cement_factor_per_kg, load_factors
from app.services.llm_client import chat_json
from app.services.supplier_catalog import list_entries_for_category
from app.schemas.project_schema import CementType

# ---------------------------------------------------------------------------
# Human-readable labels -- a small, backend-local copy of the same
# mapping frontend/src/components/common/materialCategoryLabels.js
# carries (can't literally share a module across Python/JS), used only
# for interpretation-summary text and the LLM advisory prompt, never for
# anything that feeds a number.
# ---------------------------------------------------------------------------
_CATEGORY_LABELS: dict[str, str] = {
    CATEGORY_RCC: "RCC (Reinforced Cement Concrete)",
    CATEGORY_PCC: "PCC (Plain Cement Concrete)",
    CATEGORY_STEEL_REBAR: "Reinforcement Steel",
    CATEGORY_STEEL_SECTION: "Structural Steel",
    CATEGORY_BRICK: "Brickwork",
    CATEGORY_BLOCKWORK_AAC: "AAC Blockwork",
    CATEGORY_BLOCKWORK_DENSE: "Dense Blockwork",
    CATEGORY_MASONRY: "Masonry (Generic)",
    CATEGORY_PLASTER_CEMENT: "Cement Plaster",
    CATEGORY_PLASTER_GYPSUM: "Gypsum Plaster",
    CATEGORY_TILE_CERAMIC: "Ceramic Tile",
    CATEGORY_NATURAL_STONE: "Natural Stone",
    CATEGORY_PAINT: "Paint",
    CATEGORY_ALUMINIUM: "Aluminium",
    CATEGORY_UPVC: "uPVC Window/Door Frame",
    CATEGORY_GLASS: "Glass",
    CATEGORY_TIMBER: "Timber",
}


def _category_label(category: Optional[str]) -> str:
    if not category:
        return "the material"
    return _CATEGORY_LABELS.get(category, category.replace("_", " ").title())


# Keyword -> canonical category synonyms for the keyword-fallback parser.
# Deliberately a SEPARATE, looser map from classifier.py's own
# _ORDERED_RULES regexes -- those are tuned for real BOQ line-item text
# (hierarchy context, incidental-mention collisions, etc.); a sandbox
# question is a short, direct sentence ("reduce RCC...", "switch the
# blockwork to AAC...") where a plain substring match is both sufficient
# and easier to reason about. Longest keys checked first so e.g. "dense
# block" wins over the bare "block" it contains.
_CATEGORY_SYNONYMS: list[tuple[str, str]] = sorted(
    [
        ("reinforced cement concrete", CATEGORY_RCC),
        ("reinforced concrete", CATEGORY_RCC),
        ("rcc", CATEGORY_RCC),
        ("plain cement concrete", CATEGORY_PCC),
        ("blinding concrete", CATEGORY_PCC),
        ("pcc", CATEGORY_PCC),
        ("reinforcement steel", CATEGORY_STEEL_REBAR),
        ("rebar", CATEGORY_STEEL_REBAR),
        ("tmt", CATEGORY_STEEL_REBAR),
        ("structural steel", CATEGORY_STEEL_SECTION),
        ("steel section", CATEGORY_STEEL_SECTION),
        ("brickwork", CATEGORY_BRICK),
        ("brick", CATEGORY_BRICK),
        ("aac block", CATEGORY_BLOCKWORK_AAC),
        ("aac", CATEGORY_BLOCKWORK_AAC),
        ("aircrete", CATEGORY_BLOCKWORK_AAC),
        ("dense block", CATEGORY_BLOCKWORK_DENSE),
        ("solid block", CATEGORY_BLOCKWORK_DENSE),
        ("concrete block", CATEGORY_BLOCKWORK_DENSE),
        ("blockwork", CATEGORY_BLOCKWORK_AAC),  # bare "blockwork" -- same AAC default classifier.py uses
        ("masonry", CATEGORY_MASONRY),
        ("cement plaster", CATEGORY_PLASTER_CEMENT),
        ("gypsum plaster", CATEGORY_PLASTER_GYPSUM),
        ("gypsum", CATEGORY_PLASTER_GYPSUM),
        ("plaster of paris", CATEGORY_PLASTER_GYPSUM),
        ("pop", CATEGORY_PLASTER_GYPSUM),
        ("plaster", CATEGORY_PLASTER_CEMENT),  # bare "plaster" -- same cement default classifier.py uses
        ("natural stone", CATEGORY_NATURAL_STONE),
        ("granite", CATEGORY_NATURAL_STONE),
        ("marble", CATEGORY_NATURAL_STONE),
        ("ceramic tile", CATEGORY_TILE_CERAMIC),
        ("vitrified tile", CATEGORY_TILE_CERAMIC),
        ("tile", CATEGORY_TILE_CERAMIC),
        ("paint", CATEGORY_PAINT),
        ("distemper", CATEGORY_PAINT),
        ("emulsion", CATEGORY_PAINT),
        ("upvc", CATEGORY_UPVC),
        ("aluminium", CATEGORY_ALUMINIUM),
        ("aluminum", CATEGORY_ALUMINIUM),
        ("glass", CATEGORY_GLASS),
        ("glazing", CATEGORY_GLASS),
        ("timber", CATEGORY_TIMBER),
        ("plywood", CATEGORY_TIMBER),
    ],
    key=lambda pair: -len(pair[0]),
)

# "%" or the spelled-out word -- "convert 50 percent" is at least as
# common in spoken/typed free text as "convert 50%", so both are
# accepted everywhere a percentage is matched below.
_PCT_UNIT = r"(?:%|percent)"
_PCT_RE = re.compile(rf"(\d{{1,3}}(?:\.\d+)?)\s*{_PCT_UNIT}", re.I)
# "reduce/cut/drop/lower ... to X%" -- X is what REMAINS unchanged, so the
# converting fraction is 100-X. This is the user's own example phrasing
# ("reduce the current quantity of RCC cement to 80%").
_REDUCE_TO_RE = re.compile(rf"\b(?:reduce|cut|drop|lower)\w*\b[^%]{{0,60}}?\bto\s*(\d{{1,3}}(?:\.\d+)?)\s*{_PCT_UNIT}", re.I)
# "convert/change/switch X% ..." -- X IS the converting fraction directly.
_CONVERT_PCT_RE = re.compile(rf"\b(?:convert|change|switch)\w*\b[^%]{{0,60}}?(\d{{1,3}}(?:\.\d+)?)\s*{_PCT_UNIT}", re.I)
# "(20%)GGBS" / "20% fly ash" -- a blend-concentration request, distinct
# from the split/conversion fraction above. See module docstring's
# "snap to nearest real option" discipline for why this is tracked
# separately as target_blend_pct_requested rather than folded into
# split_pct.
_BLEND_PCT_RE = re.compile(
    rf"\(?\s*(\d{{1,3}}(?:\.\d+)?)\s*{_PCT_UNIT}\s*\)?\s*(ggbs|slag|fly\s*ash|flyash|pozzolana|psc|ppc)", re.I
)


def _valid_grades() -> list[str]:
    """Single source of truth for which grades actually mean something to
    the engine -- a small, deliberate duplicate of chatbot.py's own
    private _valid_grades() (not imported from there, to avoid taking a
    dependency on chatbot.py from this lower-level module), for the exact
    same reason that module states: get_concrete_grade_scale_factor()
    silently returns 1.0 (no scaling, not an error) for an unrecognized
    grade, so a made-up grade needs to be caught and disclosed here
    rather than silently producing a "no difference" result."""
    factors = load_factors()
    return sorted(factors["concrete"]["by_grade"]["cem_i"].keys())


# Typo tolerance for the keyword-fallback parser (the LLM path, when a
# provider is configured, tolerates typos on its own just by being an
# LLM -- this threshold exists for when it isn't). Chosen against real
# typo examples ("blockwrk"/"blockwork" -> 0.94, "natual stone"/"natural
# stone" -> 0.96, "reinforcment steel"/"reinforcement steel" -> 0.97)
# while staying well above common short-word coincidental matches (no
# false positive found against "the"/"for"/"mix"/etc. in testing).
_FUZZY_MIN_RATIO = 0.82
# Below this length, a fuzzy match is unreliable (a 3-letter acronym like
# "rcc"/"pop"/"tmt" is too short for edit-distance similarity to mean
# anything) -- rely on the exact match for these instead.
_FUZZY_MIN_KEYWORD_LEN = 5


def _find_category_mentions(text: str) -> list[str]:
    """Every distinct canonical category this text mentions, in the
    order each FIRST appears -- used by the keyword-fallback parser to
    tell a within-category change ("RCC... to PSC") from a flat
    category-to-category swap ("natural stone... to ceramic tile").
    Exact substring matches are tried first; a fuzzy pass (see
    _FUZZY_MIN_RATIO above) then catches a category an exact match
    missed only due to a spelling mistake -- e.g. "blockwrk" for
    "blockwork" -- without needing a live LLM to tolerate it."""
    lower = text.lower()
    found: dict[str, int] = {}

    def _record(category: str, pos: int) -> None:
        if category not in found or pos < found[category]:
            found[category] = pos

    for keyword, category in _CATEGORY_SYNONYMS:
        idx = lower.find(keyword)
        if idx != -1:
            _record(category, idx)

    already_exact = set(found.keys())
    # Real character offsets (not just word indices), so a fuzzy match's
    # position compares correctly against an exact match's position --
    # "switch the blockwrk to ceramic tile" needs the (fuzzy) blockwork
    # mention to still sort BEFORE the (exact) tile mention, matching the
    # sentence's actual left-to-right order, not fuzzy-always-last.
    word_spans = list(re.finditer(r"[a-z]+", lower))
    words = [m.group() for m in word_spans]
    for keyword, category in _CATEGORY_SYNONYMS:
        if category in already_exact or len(keyword) < _FUZZY_MIN_KEYWORD_LEN:
            continue
        kw_word_count = len(keyword.split())
        best_ratio, best_index = 0.0, None
        for i in range(max(0, len(words) - kw_word_count + 1)):
            window = " ".join(words[i : i + kw_word_count])
            ratio = SequenceMatcher(None, window, keyword).ratio()
            if ratio > best_ratio:
                best_ratio, best_index = ratio, i
        if best_ratio >= _FUZZY_MIN_RATIO and best_index is not None:
            _record(category, word_spans[best_index].start())

    return [cat for cat, _ in sorted(found.items(), key=lambda kv: kv[1])]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class SwapIntent(BaseModel):
    source_category: Optional[str] = None
    source_cement_type: Optional[str] = None  # filters WHICH lines of source_category (rcc/pcc only)
    target_grade: Optional[str] = None
    target_cement_type: Optional[str] = None
    # A flat category-to-category swap (e.g. natural_stone -> tile_ceramic).
    # Mutually exclusive in practice with target_cement_type/target_grade --
    # see resolve_intent_to_entry()'s own note on why a combined
    # category-AND-cement-type change in one request isn't supported yet.
    target_category: Optional[str] = None
    target_description: str = ""  # raw free-text fragment describing the target, for advisory context only
    split_pct: float = 100.0  # % of matching lines that convert -- same meaning as SubstitutionRequest.user_pct
    target_blend_pct_requested: Optional[float] = None  # e.g. "20% GGBS" -- distinct from split_pct, see module docstring
    # The raw blend-component word the request used ("GGBS", "fly ash",
    # "slag", "PSC", "pozzolana", "PPC"), captured but NOT resolved to an
    # enum value here -- resolve_intent_to_entry maps it to a canonical
    # interpolation axis ("ggbs"/"fly_ash") instead of snapping it to a
    # discrete CementType, see module docstring.
    target_blend_component: Optional[str] = None
    confidence: float = 0.5
    needs_clarification: Optional[str] = None
    parse_source: Literal["llm", "keyword_fallback"] = "keyword_fallback"


class SwapAdvisory(BaseModel):
    advantages: list[str] = []
    disadvantages: list[str] = []
    better_approach: Optional[str] = None
    source: Literal["ai_generated", "catalog_grounded", "unavailable"]


class CustomSwapEvaluation(BaseModel):
    question: str
    intent: SwapIntent
    needs_clarification: Optional[str] = None
    # Deterministic, templated restatement of what was understood --
    # NEVER LLM-generated, so it can never misstate a number (see module
    # docstring's hard rule).
    interpretation_summary: Optional[str] = None
    entry: Optional[dict] = None
    disclosures: list[str] = []
    computed: Optional[SubstitutionResult] = None
    advisory: Optional[SwapAdvisory] = None


# ---------------------------------------------------------------------------
# Parsing -- LLM-first, keyword-fallback-on-any-failure, exactly
# chatbot.py's own dual-path pattern.
# ---------------------------------------------------------------------------


def _build_parse_prompt(question: str, current_state: AnyCarbonResult) -> str:
    present_categories = sorted({c.category for c in current_state.by_category})
    return f"""You are parsing a construction project manager's free-text material-swap request into structured parameters. Tolerate typos, spelling mistakes, and informal phrasing.

This project's BOQ currently has computed quantities in these material categories: {present_categories}
The full set of categories this app can compute a carbon figure for: {list(ALL_MATERIAL_CATEGORIES)}
Valid cement types: OPC, PSC (a real ~25% GGBS/slag blend), PPC (a real ~30% fly-ash blend). If the request names a specific GGBS/slag or fly-ash/pozzolana PERCENTAGE (e.g. "20% GGBS", "40% fly ash"), any value 0-100 is acceptable -- this app estimates the carbon figure for percentages other than the two real measured points (0% and the one above) by interpolating/extrapolating, and will disclose that plainly. Do NOT round or resolve a stated percentage to the nearest of OPC/PSC/PPC yourself -- return it exactly as stated via target_blend_pct_requested/target_blend_component below.
Valid concrete grades this app has real data for: {_valid_grades()}

The request: "{question}"

Return ONLY a JSON object with these fields:
- "source_category": one of the categories listed above that the request is changing, or null if not named (omit null if genuinely ambiguous)
- "source_cement_type": "OPC"/"PSC"/"PPC" if the request specifies which cement-type lines to change, else null
- "target_category": one of the categories above, ONLY if this is a flat category-to-category swap (e.g. natural stone to ceramic tile), else null
- "target_cement_type": "OPC"/"PSC"/"PPC" if the request asks for a cement-type change, else null
- "target_grade": e.g. "M25", if the request asks for a grade change, else null
- "target_blend_pct_requested": a number, ONLY if the request states a specific GGBS/fly-ash/slag blend percentage (e.g. "20% GGBS" -> 20), else null. Return the exact number stated -- do not snap it to 25/30 or to OPC/PSC/PPC.
- "target_blend_component": the literal word used for the blend material when target_blend_pct_requested is set (e.g. "GGBS", "fly ash", "slag", "pozzolana", "PSC", "PPC"), else null.
- "split_pct": the percentage of matching material that should actually convert to the new spec (0-100). If the request says "reduce to X%" meaning X% stays unchanged, split_pct is 100-X. If no percentage is given at all, use 100. This is DIFFERENT from target_blend_pct_requested -- split_pct is how much of the project's material changes at all, target_blend_pct_requested is the composition percentage within the new mix itself.
- "target_description": a short plain-text echo of what the target material/spec is, for display only
- "confidence": your confidence (0.0-1.0) that you understood this correctly
- "needs_clarification": a short question to ask the user, ONLY if the request is genuinely too ambiguous to proceed (e.g. no material and no target at all), else null

Do not compute or guess any carbon number yourself -- your only job is to extract these parameters."""


def _parse_with_keywords(question: str, current_state: AnyCarbonResult) -> SwapIntent:
    mentions = _find_category_mentions(question)
    source_category = mentions[0] if mentions else None
    target_category = mentions[1] if len(mentions) >= 2 else None

    target_cement_type = detect_cement_type(question)
    target_grade = detect_grade(question)

    blend_match = _BLEND_PCT_RE.search(question)
    target_blend_pct_requested = float(blend_match.group(1)) if blend_match else None
    target_blend_component = blend_match.group(2) if blend_match else None

    reduce_match = _REDUCE_TO_RE.search(question)
    convert_match = _CONVERT_PCT_RE.search(question)
    if reduce_match:
        split_pct = 100.0 - float(reduce_match.group(1))
    elif convert_match:
        split_pct = float(convert_match.group(1))
    else:
        all_pcts = [float(m) for m in _PCT_RE.findall(question)]
        # Fall back to the smallest mentioned percentage as a reasonable
        # default for "the part that changes" (a full 100% swap is rare
        # to phrase with a percentage at all) -- low-confidence, and
        # resolve_intent_to_entry's disclosures will say so plainly.
        split_pct = min(all_pcts) if all_pcts else 100.0

    has_target = any([target_category, target_cement_type, target_grade])
    needs_clarification = None
    confidence = 0.55
    if source_category is None and not has_target:
        needs_clarification = (
            "I couldn't tell what material you want to swap or what you want to swap it for -- try "
            "phrasing it like 'replace 30% of my RCC with PSC cement' or 'change the blockwork to AAC block'."
        )
        confidence = 0.1
    elif source_category is None:
        confidence = 0.35  # a target was understood but which material it applies to wasn't named
    elif not has_target:
        confidence = 0.35

    return SwapIntent(
        source_category=source_category,
        target_category=target_category,
        target_cement_type=target_cement_type,
        target_grade=target_grade,
        target_blend_pct_requested=target_blend_pct_requested,
        target_blend_component=target_blend_component,
        split_pct=max(0.0, min(100.0, split_pct)),
        target_description=question,
        confidence=confidence,
        needs_clarification=needs_clarification,
        parse_source="keyword_fallback",
    )


def parse_swap_intent(question: str, current_state: AnyCarbonResult) -> SwapIntent:
    try:
        raw = chat_json(_build_parse_prompt(question, current_state))
    except Exception as e:
        # Any failure (no provider configured, network error, malformed
        # JSON, LLMUnavailableError) falls back to the keyword parser --
        # same discipline as chatbot.py's own parse_question().
        print(f"[swap_sandbox] LLM parse call failed ({e}), using keyword-based fallback parsing instead.")
        return _parse_with_keywords(question, current_state)

    return SwapIntent(
        source_category=raw.get("source_category"),
        source_cement_type=raw.get("source_cement_type"),
        target_category=raw.get("target_category"),
        target_cement_type=raw.get("target_cement_type"),
        target_grade=raw.get("target_grade"),
        target_blend_pct_requested=raw.get("target_blend_pct_requested"),
        target_blend_component=raw.get("target_blend_component"),
        split_pct=float(raw.get("split_pct", 100.0) or 100.0),
        target_description=str(raw.get("target_description") or question),
        confidence=float(raw.get("confidence", 0.6) or 0.6),
        needs_clarification=raw.get("needs_clarification"),
        parse_source="llm",
    )


# ---------------------------------------------------------------------------
# Resolving an intent into a real, engine-consumable entry dict.
# ---------------------------------------------------------------------------


# Raw blend-component word (from either parse path) -> canonical
# interpolation axis key (see ice_factors.BLEND_COMPONENTS). "psc"/"ppc"
# are included because a request can name the blended cement type
# directly alongside a percentage ("30% PSC") instead of the component
# itself ("30% GGBS") -- both mean the same axis.
_BLEND_COMPONENT_SYNONYMS: dict[str, str] = {
    "ggbs": "ggbs",
    "slag": "ggbs",
    "psc": "ggbs",
    "fly ash": "fly_ash",
    "flyash": "fly_ash",
    "fly-ash": "fly_ash",
    "pozzolana": "fly_ash",
    "ppc": "fly_ash",
}


def _find_grounding_catalog_entry(
    source_category: str, target_cement_type: Optional[str], target_category: Optional[str]
) -> Optional[dict]:
    """A real catalog entry that conceptually overlaps this sandbox swap,
    used purely to BORROW its already-sourced reasoning/structural_caveat
    text for grounding -- deliberately NOT matched on the catalog entry's
    own base_cement_type filter, since bypassing that exact-match
    restriction (e.g. applying a PSC swap to a project that's already
    PPC, not OPC) is the entire reason this sandbox exists. A caller
    still gets the catalog's real engineering caveat text even though the
    sandbox entry itself is marked evidence_tier='sandbox_custom'."""
    for entry in list_entries_for_category(source_category):
        if target_category is not None and entry.get("substitute_category") == target_category:
            return entry
        if target_cement_type is not None and entry.get("substitute_cement_type") == target_cement_type:
            return entry
    return None


def resolve_intent_to_entry(
    intent: SwapIntent, current_state: AnyCarbonResult
) -> tuple[Optional[dict], list[str], Optional[str]]:
    """Returns (entry, disclosures, needs_clarification). entry is None
    only when needs_clarification is set -- every other path returns a
    complete, apply_substitution()-ready dict, even one that will
    legitimately report zero affected lines (e.g. the named category
    isn't present in this BOQ at all -- reported honestly via
    SubstitutionResult.affected_line_item_count, not hidden here)."""
    disclosures: list[str] = []

    if intent.needs_clarification:
        return None, disclosures, intent.needs_clarification

    source_category = intent.source_category
    if source_category is None:
        present = sorted(current_state.by_category, key=lambda c: -c.gwp_kg_co2e)
        if not present:
            return None, disclosures, (
                "This project doesn't have any computed material breakdown yet to apply a swap against -- "
                "upload or confirm a BOQ/Work Order baseline first."
            )
        source_category = present[0].category
        disclosures.append(
            f"No material was named in the request, so this was applied to {_category_label(source_category)}, "
            f"this project's single largest carbon contributor."
        )
    elif source_category not in ALL_MATERIAL_CATEGORIES:
        return None, disclosures, (
            f"'{source_category}' isn't a material category this app can compute a carbon figure for -- "
            f"try naming one of: {', '.join(_category_label(c) for c in ALL_MATERIAL_CATEGORIES)}."
        )

    source_present = any(c.category == source_category and c.line_item_count > 0 for c in current_state.by_category)
    if not source_present:
        disclosures.append(
            f"{_category_label(source_category)} has a stored emission factor, but this project's current BOQ has "
            f"no computed line items in that category -- this swap will show 0 affected lines rather than a "
            f"guessed figure."
        )

    source_cement_type = None
    if intent.source_cement_type and source_category in (CATEGORY_RCC, CATEGORY_PCC):
        try:
            source_cement_type = CementType(intent.source_cement_type.upper()).value
        except ValueError:
            disclosures.append(
                f"Couldn't recognize '{intent.source_cement_type}' as a cement type (OPC/PSC/PPC) to filter by -- "
                f"matching {_category_label(source_category)} lines of any cement type instead."
            )

    target_category = intent.target_category
    if target_category is not None:
        if target_category not in ALL_MATERIAL_CATEGORIES:
            disclosures.append(
                f"Couldn't recognize '{target_category}' as a material this app has a stored factor for -- "
                f"ignoring that part of the request."
            )
            target_category = None
        elif target_category == source_category:
            target_category = None  # not actually a category change

    target_cement_type = intent.target_cement_type
    if target_cement_type is not None:
        try:
            target_cement_type = CementType(target_cement_type.upper()).value
        except ValueError:
            disclosures.append(f"Couldn't recognize '{target_cement_type}' as a cement type -- ignoring it.")
            target_cement_type = None

    # A stated GGBS/slag/fly-ash blend percentage: this app's two real
    # IFC data points per axis are OPC (0%) and the one blend IFC
    # actually measured (PSC ~25% GGBS, PPC ~30% fly-ash) -- see
    # ice_factors.get_blended_cement_factor_per_kg's own docstring. Per
    # the user's own confirmed choice, an arbitrary percentage is
    # answered by interpolating/extrapolating a straight line through
    # those two real points, not by snapping to the nearest of the two.
    blend_entry_info: Optional[tuple[str, float, dict]] = None
    grounding_cement_type = target_cement_type
    if intent.target_blend_pct_requested is not None:
        raw_component = (intent.target_blend_component or "").strip().lower()
        component = _BLEND_COMPONENT_SYNONYMS.get(raw_component)
        if component is None and target_cement_type in ("PSC", "PPC"):
            # No explicit component word, but a cement type was already
            # named/detected -- infer the axis from that.
            component = "ggbs" if target_cement_type == "PSC" else "fly_ash"
        if component is None:
            # detect_cement_type() on the raw description already
            # resolves a bare "GGBS"/"slag" mention to PSC and "fly
            # ash"/"pozzolana" to PPC -- reuse that as a last resort.
            detected = detect_cement_type(intent.target_description)
            if detected in ("PSC", "PPC"):
                component = "ggbs" if detected == "PSC" else "fly_ash"

        if component is None:
            disclosures.append(
                f"Couldn't tell whether the {intent.target_blend_pct_requested:g}% blend you mentioned is "
                f"GGBS/slag or fly-ash/pozzolana -- ignoring the percentage."
            )
        elif source_category not in (CATEGORY_RCC, CATEGORY_PCC):
            disclosures.append(
                f"A GGBS/fly-ash blend percentage only applies to concrete (RCC/PCC), not "
                f"{_category_label(source_category)} -- ignoring the percentage."
            )
        else:
            target_pct = max(0.0, min(100.0, intent.target_blend_pct_requested))
            blend = get_blended_cement_factor_per_kg(component, target_pct, apply_cea=True)
            blend_entry_info = (component, target_pct, blend)
            # The blend-pct lever replaces a discrete cement-type pick
            # entirely -- but grounding (below) still looks for the
            # catalog's real PSC/PPC entry, since its reasoning/caveat
            # text is still the right thing to borrow -- remember that
            # separately before clearing target_cement_type.
            grounding_cement_type = "PSC" if component == "ggbs" else "PPC"
            target_cement_type = None

            if blend["confidence"] == "interpolated":
                disclosures.append(
                    f"The {target_pct:g}% {blend['label']} figure below is a linear interpolation between this "
                    f"app's two real sourced data points (OPC at 0%, and IFC's own measured {blend['documented_pct']:g}% "
                    f"{blend['label']} blend) -- not an independently sourced number for exactly {target_pct:g}%."
                )
            elif blend["confidence"] == "extrapolated_within_code_ceiling":
                disclosures.append(
                    f"The {target_pct:g}% {blend['label']} figure below is extrapolated past IFC's own measured "
                    f"data point ({blend['documented_pct']:g}%) along a straight line through it and OPC's 0% "
                    f"point -- still within {blend['code_basis']}'s recommended ceiling of {blend['code_ceiling_pct']:g}%, "
                    f"but this is a rougher estimate than an interpolated figure, not an independently sourced one."
                )
            else:
                disclosures.append(
                    f"{target_pct:g}% {blend['label']} exceeds {blend['code_basis']}'s recommended ceiling of "
                    f"{blend['code_ceiling_pct']:g}% for structural use -- the figure below is still a real "
                    f"extrapolation through this app's two sourced data points, but a qualified engineer should "
                    f"review a blend this high before it's specified, and the underlying emissions relationship "
                    f"may not even stay linear this far past the one point IFC actually measured."
                )

    target_grade = intent.target_grade
    if target_grade is not None:
        normalized = target_grade.upper().replace(" ", "")
        if not normalized.startswith("M"):
            normalized = f"M{normalized}"
        valid_grades = _valid_grades()
        if normalized not in valid_grades:
            disclosures.append(
                f"'{target_grade}' isn't in this app's grade-scaling dataset (valid grades: "
                f"{', '.join(valid_grades)}) -- computed with no additional grade scaling applied "
                f"(same treatment as this engine's M40 anchor), rather than guessing a factor for it."
            )
        target_grade = normalized

    if target_category is not None and (target_cement_type is not None or target_grade is not None or blend_entry_info is not None):
        disclosures.append(
            f"A category change AND a cement-type/grade/blend-percentage change in the same request isn't "
            f"supported yet -- applying only the change to {_category_label(target_category)}."
        )
        target_cement_type = None
        target_grade = None
        blend_entry_info = None

    if target_category is None and target_cement_type is None and target_grade is None and blend_entry_info is None:
        return None, disclosures, (
            f"I understood this is about {_category_label(source_category)}, but couldn't tell what you want to "
            f"change it TO -- name a cement type (OPC/PSC/PPC), a GGBS/fly-ash percentage, a grade (e.g. M25), or "
            f"another material category."
        )

    split_pct = max(0.0, min(100.0, intent.split_pct))
    if split_pct != intent.split_pct:
        disclosures.append(f"The requested split percentage was clamped to {split_pct:g}% (valid range 0-100).")

    grounding = _find_grounding_catalog_entry(source_category, grounding_cement_type, target_category)

    entry: dict = {
        "id": f"sandbox_custom_{uuid.uuid4().hex[:8]}",
        "base_category": source_category,
    }
    if source_cement_type is not None:
        entry["base_cement_type"] = source_cement_type
    if target_category is not None:
        entry["substitute_category"] = target_category
        entry["substitute_label"] = _category_label(target_category)
    elif blend_entry_info is not None:
        component, blend_target_pct, blend = blend_entry_info
        entry["substitute_blend_pct"] = {"component": component, "pct": blend_target_pct}
        if target_grade is not None:
            entry["substitute_grade"] = target_grade
        label_bits = [f"{blend_target_pct:g}% {blend['label']} blend", target_grade]
        entry["substitute_label"] = " / ".join(b for b in label_bits if b)
    else:
        if target_cement_type is not None:
            entry["substitute_cement_type"] = target_cement_type
        if target_grade is not None:
            entry["substitute_grade"] = target_grade
        label_bits = [b for b in [target_cement_type, target_grade] if b]
        entry["substitute_label"] = " / ".join(label_bits) if label_bits else intent.target_description

    if grounding is not None:
        entry["max_recommended_pct"] = split_pct  # sandbox requests aren't capped by a borrowed entry's own ceiling
        entry["reasoning"] = grounding["reasoning"]
        entry["structural_caveat"] = grounding["structural_caveat"]
        entry["source"] = grounding["source"] + " (applied here to a combination this catalog entry doesn't itself cover -- see evidence_tier)"
        entry["evidence_tier"] = "sandbox_custom"
        entry["always_requires_review_if_load_bearing"] = True
        entry["requires_supplier_match"] = grounding.get("requires_supplier_match")
        disclosures.append(
            f"No catalog entry exactly matches this combination, but '{grounding.get('substitute_label', grounding['id'])}' "
            f"is conceptually similar -- its sourced engineering notes are shown below for context, though this exact "
            f"combination hasn't itself been reviewed."
        )
    else:
        entry["max_recommended_pct"] = split_pct
        entry["reasoning"] = (
            "No catalog entry exists for this exact combination. The figures below are a real recompute through "
            "this app's own emission-factor engine (the same ICE/IFC-sourced data every other calculation in this "
            "app uses), not an estimate -- but no third party has reviewed this specific material combination."
        )
        entry["structural_caveat"] = (
            "This exact combination hasn't been checked against any sourced catalog entry in this app. Treat this "
            "as a sandbox exploration of the carbon numbers only -- a qualified structural engineer should review "
            "it before it's specified on a real project, particularly for any load-bearing element."
        )
        entry["source"] = "sandbox_custom -- no catalog entry matched this combination"
        entry["evidence_tier"] = "sandbox_custom"
        entry["always_requires_review_if_load_bearing"] = True
        entry["requires_supplier_match"] = None

    return entry, disclosures, None


# ---------------------------------------------------------------------------
# Advisory -- the one place in this module an LLM writes prose, scoped
# to structured JSON given only real computed numbers (see module
# docstring's hard rule).
# ---------------------------------------------------------------------------


def _build_advisory_prompt(intent: SwapIntent, entry: dict, result: SubstitutionResult) -> str:
    return f"""You are a construction materials sustainability advisor. A project manager asked: "{intent.target_description}"

Here are the REAL, already-computed numbers for this swap (do not recompute, restate with different values, or invent any number):
- Material category: {_category_label(entry['base_category'])}
- Affected line items: {result.affected_line_item_count}
- Carbon before: {result.original_gwp_kg_co2e:.1f} kgCO2e
- Carbon after: {result.new_gwp_kg_co2e:.1f} kgCO2e
- Savings: {result.savings_kg_co2e:.1f} kgCO2e ({result.savings_pct_of_affected_lines:.1f}% of the affected material, {result.savings_pct_of_total_boq:.1f}% of the whole project)
- Requires engineering review: {result.requires_engineering_review}

Sourced engineering context for this swap: {entry['reasoning']}
Structural caveat: {entry['structural_caveat']}

Write a JSON object with:
- "advantages": a list of 1-4 short, concrete advantage strings (carbon, cost, availability, schedule -- grounded in the numbers/context above, don't invent new numbers)
- "disadvantages": a list of 1-4 short, concrete disadvantage/risk strings
- "better_approach": one short sentence suggesting a refinement (a different split percentage, a different target, a caveat to check with an engineer), or null if there isn't one

Return ONLY the JSON object. Never state a carbon or cost figure other than the ones given above."""


def generate_swap_advisory(intent: SwapIntent, entry: dict, result: SubstitutionResult) -> SwapAdvisory:
    try:
        raw = chat_json(_build_advisory_prompt(intent, entry, result))
        return SwapAdvisory(
            advantages=[str(a) for a in raw.get("advantages", [])][:4],
            disadvantages=[str(d) for d in raw.get("disadvantages", [])][:4],
            better_approach=raw.get("better_approach"),
            source="ai_generated",
        )
    except Exception as e:
        print(f"[swap_sandbox] LLM advisory call failed ({e}), falling back to catalog-grounded/plain text.")
        # entry['source'] starts with "sandbox_custom" only when NO real
        # catalog entry was found to ground this swap (see
        # resolve_intent_to_entry) -- in that case there's no sourced
        # reasoning text to fall back to, just the honest caveat.
        if entry["source"].startswith("sandbox_custom"):
            return SwapAdvisory(
                advantages=[],
                disadvantages=[entry["structural_caveat"]],
                better_approach=None,
                source="unavailable",
            )
        return SwapAdvisory(
            advantages=[entry["reasoning"]],
            disadvantages=[entry["structural_caveat"]],
            better_approach=None,
            source="catalog_grounded",
        )


# ---------------------------------------------------------------------------
# Top-level entry point -- pure, stateless (no I/O, no persistence). The
# caller (phase4.py, per the approved plan) is responsible for loading
# current_state and persisting the result as a Recommendation.
# ---------------------------------------------------------------------------


def _build_interpretation_summary(intent: SwapIntent, entry: dict) -> str:
    src_label = _category_label(entry["base_category"])
    cement_note = f" ({entry['base_cement_type']} only)" if entry.get("base_cement_type") else ""
    if entry.get("substitute_category"):
        target_desc = f"to {_category_label(entry['substitute_category'])}"
    elif entry.get("substitute_blend_pct"):
        spec = entry["substitute_blend_pct"]
        component_label = "GGBS/slag" if spec["component"] == "ggbs" else "fly-ash/pozzolana"
        bits = [f"a {spec['pct']:g}% {component_label} blend", entry.get("substitute_grade")]
        target_desc = "to " + " at ".join(b for b in bits if b)
    else:
        bits = [b for b in [entry.get("substitute_cement_type"), entry.get("substitute_grade")] if b]
        target_desc = ("to " + " with ".join(bits)) if bits else "to the described target"
    return f"Converting {intent.split_pct:g}% of this project's {src_label}{cement_note} {target_desc}."


def evaluate_custom_swap(question: str, current_state: AnyCarbonResult) -> CustomSwapEvaluation:
    intent = parse_swap_intent(question, current_state)
    if intent.needs_clarification:
        return CustomSwapEvaluation(question=question, intent=intent, needs_clarification=intent.needs_clarification)

    entry, disclosures, needs_clarification = resolve_intent_to_entry(intent, current_state)
    if needs_clarification or entry is None:
        return CustomSwapEvaluation(
            question=question, intent=intent, needs_clarification=needs_clarification, disclosures=disclosures
        )

    result = apply_substitution(entry, intent.split_pct, current_state)
    advisory = generate_swap_advisory(intent, entry, result)

    return CustomSwapEvaluation(
        question=question,
        intent=intent,
        interpretation_summary=_build_interpretation_summary(intent, entry),
        entry=entry,
        disclosures=disclosures,
        computed=result,
        advisory=advisory,
    )
