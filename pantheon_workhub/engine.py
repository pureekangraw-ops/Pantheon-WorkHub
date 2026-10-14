from __future__ import annotations

import hashlib
import uuid
from typing import Any

from .store import Store, StoreError
from .tools import TextArtifactTool


class PauseRequested(Exception):
    """Raised only at a tool-declared safe point before an unrecorded effect."""


class CancelRequested(Exception):
    """Raised only at a tool-declared safe point before an unrecorded effect."""


class RunControl:
    def __init__(self, store: Store, task_id: str):
        self.store = store
        self.task_id = task_id

    def checkpoint(self) -> None:
        task = self.store.get_task(self.task_id)
        if task is None:
            raise StoreError(f"unknown task: {self.task_id}")
        if task["status"] == "PAUSE_REQUESTED":
            raise PauseRequested()
        if task["status"] == "CANCEL_REQUESTED":
            raise CancelRequested()


class OperationsEngine:
    """Owns task state, run attempts, action intent, and verified completion."""

    def __init__(self, store: Store, tool: TextArtifactTool):
        self.store = store
        self.tool = tool

    def create_task(self, request_text: str, actor: str) -> str:
        request_text = request_text.strip()
        actor = actor.strip()
        if not request_text:
            raise ValueError("request must not be empty")
        if not actor:
            raise ValueError("actor must not be empty")
        task_id = f"task_{uuid.uuid4().hex}"
        request_hash = hashlib.sha256(request_text.encode("utf-8")).hexdigest()
        action_key = "act_" + hashlib.sha256(
            f"{task_id}\0{self.tool.name}\0{request_hash}".encode("utf-8")
        ).hexdigest()
        self.store.create_task(task_id, request_text, request_hash, actor, action_key, self.tool.name)
        return task_id

    def run_task(self, task_id: str, actor: str) -> dict[str, Any]:
        task = self.store.get_task(task_id)
        if task is None:
            raise StoreError(f"unknown task: {task_id}")
        run_id = self.store.begin_run(task_id, actor)
        action = self.store.get_action(task_id)
        if action is None:
            raise StoreError(f"missing action for task: {task_id}")
        control = RunControl(self.store, task_id)
        try:
            self.store.mark_action_requested(task_id, run_id, actor)
            receipt = self.tool.execute(
                task_id, action["action_key"], task["request_text"], task["request_sha256"], control
            )
            self.store.record_effect(task_id, run_id, actor, receipt)
            self.store.begin_verification(task_id, run_id, actor)
            observed = self.tool.inspect(task_id, action["action_key"], task["request_sha256"])
            if not (observed["exists"] and observed["matches"]):
                self.store.needs_reconciliation(task_id, run_id, actor, "readback did not match requested artifact")
                return self.store.get_task(task_id)
            self.store.complete(task_id, run_id, actor, receipt)
        except PauseRequested:
            self.store.acknowledge_control(task_id, run_id, actor, "PAUSED")
        except CancelRequested:
            self.store.acknowledge_control(task_id, run_id, actor, "CANCELLED")
        except Exception as exc:
            self.store.needs_reconciliation(task_id, run_id, actor, f"{type(exc).__name__}: {exc}")
        return self.store.get_task(task_id)

    def request_pause(self, task_id: str, actor: str) -> dict[str, Any]:
        self.store.request_pause(task_id, actor)
        return self.store.get_task(task_id)

    def request_cancel(self, task_id: str, actor: str) -> dict[str, Any]:
        self.store.request_cancel(task_id, actor)
        return self.store.get_task(task_id)

    def resume_task(self, task_id: str, actor: str) -> dict[str, Any]:
        self.store.resume(task_id, actor)
        return self.run_task(task_id, actor)

    def recover_task(self, task_id: str, actor: str) -> dict[str, Any]:
        task = self.store.get_task(task_id)
        if task is None:
            raise StoreError(f"unknown task: {task_id}")
        recovery = self.store.recover_interrupted(task_id, actor)
        task = self.store.get_task(task_id)
        if recovery["status"] not in {"RUNNING", "VERIFYING", "NEEDS_RECONCILIATION"} and task["status"] != "NEEDS_RECONCILIATION":
            raise StoreError(f"task is not recoverable from state {task['status']}")
        action = self.store.get_action(task_id)
        if action is None:
            raise StoreError("missing action")
        observed = self.tool.inspect(task_id, action["action_key"], action["input_sha256"])
        if not observed["exists"]:
            if action["status"] in {"REQUESTED", "PREPARED"}:
                interrupted_from = recovery.get("interrupted_from")
                final_state = {
                    "PAUSE_REQUESTED": "PAUSED",
                    "CANCEL_REQUESTED": "CANCELLED",
                }.get(interrupted_from, "FAILED")
                self.store.reconcile_no_effect(task_id, actor, "readback confirms artifact is absent", final_state)
            return self.store.get_task(task_id)
        if not observed["matches"]:
            return self.store.get_task(task_id)
        run_id = task["latest_run_id"]
        if action["status"] == "REQUESTED":
            self.store.record_effect(
                task_id, run_id, actor,
                {"path": observed["path"], "sha256": observed["sha256"], "deduplicated": True},
            )
        if self.store.get_task(task_id)["status"] == "NEEDS_RECONCILIATION":
            self.store.transition(task_id, "VERIFYING", actor, "RECONCILIATION_VERIFICATION_STARTED", run_id=run_id)
        verify = self.tool.inspect(task_id, action["action_key"], action["input_sha256"])
        if verify["exists"] and verify["matches"]:
            self.store.complete(
                task_id, run_id, actor,
                {"path": verify["path"], "sha256": verify["sha256"], "deduplicated": True},
            )
        else:
            self.store.needs_reconciliation(task_id, run_id, actor, "recovery readback is inconclusive")
        return self.store.get_task(task_id)

    def retry_task(self, task_id: str, actor: str) -> dict[str, Any]:
        self.store.retry(task_id, actor)
        return self.run_task(task_id, actor)
