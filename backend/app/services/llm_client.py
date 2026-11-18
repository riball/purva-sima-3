"""Shared LLM client abstraction.

Both llm_fallback.py (tier-field estimation) and boq_extractor.py
(ambiguous-row resolution) call through chat_json() instead of each
having their own provider-specific code. Provider is chosen by
LLM_PROVIDER in .env (default and currently only provider: "groq").
Groq needs an internet connection and a valid GROQ_API_KEY; without
one every caller falls back to its own keyword/placeholder logic.
"""

from __future__ import annotations

import json

from app.core.config import (
    GROQ_API_KEY,
    GROQ_MODEL,
    LLM_PROVIDER,
)


class LLMUnavailableError(Exception):
    """Raised when the configured provider can't be reached or fails.
    Callers should catch this and fall back to their own placeholder logic
    -- this module never silently falls back to a different provider on
    its own, since that would hide which provider actually produced a
    given result.
    """


def _strip_json_fences(text: str) -> str:
    return text.replace("```json", "").replace("```", "").strip()


def _call_groq(prompt: str) -> dict:
    from groq import Groq

    if not GROQ_API_KEY:
        raise LLMUnavailableError("GROQ_API_KEY is not set")

    client = Groq(api_key=GROQ_API_KEY)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    text = _strip_json_fences(response.choices[0].message.content.strip())
    return json.loads(text)


def chat_json(prompt: str) -> dict:
    """Sends prompt to the configured provider, returns parsed JSON.
    Raises LLMUnavailableError (or lets the underlying exception surface)
    on any failure -- callers decide what to do next (placeholder
    defaults, leave rows unclassified, etc.), this function doesn't
    silently swap providers or retry on its own.
    """
    if LLM_PROVIDER == "groq":
        return _call_groq(prompt)
    else:
        raise LLMUnavailableError(f"Unknown LLM_PROVIDER '{LLM_PROVIDER}' -- must be 'groq'")