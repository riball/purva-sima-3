"""UX refinement (Phase E): "chat can name-switch projects" -- the locked
decision from plan mode. Given a raw chat question, find whether it
mentions a specific project by name clearly enough to switch the
conversation's context to it.

Deliberately a DIFFERENT matching strategy from
project_registry.find_project_by_name(), even though both end up scoring
against the same project_registry.list_named_projects() candidates --
that function is built for "search-as-you-type" (a short query that is a
PREFIX/FRAGMENT of a longer project name, e.g. typing "Eco" to find
"Ecopolitan Tower B"). A chat question is the opposite shape: a long
sentence that might CONTAIN a short project name somewhere inside it
("how's Ecopolitan doing this month?"). Scoring the whole sentence
against a short name with SequenceMatcher.ratio() the way
find_project_by_name() does would produce a low score for almost every
real mention, because most of the sentence isn't the name. So this module
checks for the name (or a close fuzzy match) appearing INSIDE the
question, not the question matching the name.
"""

from __future__ import annotations

import difflib
from typing import Optional

from app.services import project_registry

# A name shorter than this is too likely to appear as a coincidental
# substring of ordinary chat text (e.g. a 2-3 letter project nickname
# matching a common word) to trust for an automatic context switch.
_MIN_NAME_LENGTH = 4

# Below this score, treat it as "no confident mention" rather than risk
# switching the user's active project under them by mistake -- silently
# staying on whatever project was already active is always the safer
# wrong answer here, since the caller falls back to active_project_id.
_DEFAULT_MIN_SCORE = 0.6


def resolve_project_mention(company_id: str, text: str, min_score: float = _DEFAULT_MIN_SCORE) -> Optional[dict]:
    """Best-guess project this `text` is naming, or None if nothing is
    confident enough to act on. Returns {project_id, project_name, score}
    -- same shape project_registry.find_project_by_name() already returns,
    so callers can treat either result identically.
    """
    text_lower = text.lower()
    if not text_lower.strip():
        return None

    candidates = project_registry.list_named_projects(company_id)
    best: Optional[dict] = None
    best_score = 0.0

    for c in candidates:
        name_lower = c["project_name"].lower()
        if len(name_lower) < _MIN_NAME_LENGTH:
            continue

        if name_lower in text_lower:
            # A direct, unambiguous substring mention -- the strongest
            # possible signal, always wins ties against a fuzzy score.
            score = 0.95
        else:
            score = difflib.SequenceMatcher(None, name_lower, text_lower).ratio()

        if score > best_score:
            best_score = score
            best = c

    if best is None or best_score < min_score:
        return None

    return {"project_id": best["project_id"], "project_name": best["project_name"], "score": round(best_score, 3)}
