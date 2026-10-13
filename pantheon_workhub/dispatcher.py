"""A narrow adapter between untrusted HERMES output and WorkHub operations."""
from __future__ import annotations

from typing import Any

from .engine import OperationsEngine
from .intent import parse_intent


def dispatch_intent(engine: OperationsEngine, raw: str, actor: str) -> dict[str, Any]:
    """Validate before any state mutation; actor must come from trusted caller."""
    if not isinstance(actor, str) or not actor.strip():
        raise ValueError("trusted actor is required")
    intent = parse_intent(raw)
    if intent["intent"] == "CREATE_TASK":
        task_id = engine.create_task(intent["request"], actor)
        return {"task_id": task_id, "status": "QUEUED", "executed": False}
    if intent["intent"] == "SHOW_TASK":
        task = engine.store.get_task(intent["task_id"])
        if task is None:
            raise ValueError("unknown task")
        return {"task": task}
    if intent["intent"] == "LIST_TASKS":
        return {"tasks": engine.store.list_tasks()}
    raise ValueError("unsupported intent")
