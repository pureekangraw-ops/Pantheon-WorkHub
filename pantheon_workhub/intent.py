"""Strict, side-effect-free HERMES intent validation.

Model output is untrusted. Validation never authorizes or executes a tool.
"""
from __future__ import annotations

import json
from typing import Any

ALLOWED_INTENTS = frozenset({"CREATE_TASK", "SHOW_TASK", "LIST_TASKS"})
ALLOWED_KEYS = frozenset({"intent", "request", "task_id"})


class IntentValidationError(ValueError):
    """Rejected model output; no side effect has occurred."""


def parse_intent(raw: str) -> dict[str, Any]:
    if not isinstance(raw, str) or len(raw) > 8192:
        raise IntentValidationError("intent must be text of at most 8192 characters")
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise IntentValidationError("invalid JSON") from exc
    if not isinstance(value, dict) or set(value) - ALLOWED_KEYS:
        raise IntentValidationError("expected object with allowlisted keys")
    intent = value.get("intent")
    if not isinstance(intent, str) or intent not in ALLOWED_INTENTS:
        raise IntentValidationError("unsupported intent")
    expected = {
        "CREATE_TASK": {"intent", "request"},
        "SHOW_TASK": {"intent", "task_id"},
        "LIST_TASKS": {"intent"},
    }[intent]
    if set(value) != expected:
        raise IntentValidationError("missing or unexpected fields")
    if intent == "CREATE_TASK":
        request = value["request"]
        if not isinstance(request, str) or not request.strip() or len(request) > 4096:
            raise IntentValidationError("invalid task request")
    if intent == "SHOW_TASK":
        import re
        task_id = value["task_id"]
        if not isinstance(task_id, str) or re.fullmatch(r"task_[a-f0-9]{32}", task_id) is None:
            raise IntentValidationError("invalid task ID")
    return value
