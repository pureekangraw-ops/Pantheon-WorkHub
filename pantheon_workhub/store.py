from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


TRANSITIONS = {
    "CREATED": {"QUEUED"},
    "QUEUED": {"RUNNING", "PAUSED", "CANCELLED"},
    "RUNNING": {"VERIFYING", "PAUSE_REQUESTED", "CANCEL_REQUESTED", "NEEDS_RECONCILIATION", "FAILED"},
    "VERIFYING": {"COMPLETED", "NEEDS_RECONCILIATION", "FAILED"},
    "NEEDS_RECONCILIATION": {"VERIFYING", "FAILED", "PAUSED", "CANCELLED"},
    "FAILED": {"QUEUED", "CANCELLED"},
    "PAUSE_REQUESTED": {"PAUSED", "CANCEL_REQUESTED", "VERIFYING", "NEEDS_RECONCILIATION"},
    "PAUSED": {"QUEUED", "CANCELLED"},
    "CANCEL_REQUESTED": {"CANCELLED", "VERIFYING", "NEEDS_RECONCILIATION"},
    "COMPLETED": set(),
    "CANCELLED": set(),
}


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class StoreError(RuntimeError):
    pass


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 10000")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self) -> None:
        conn = self._connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    request_text TEXT NOT NULL,
                    request_sha256 TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    latest_run_id TEXT,
                    last_error TEXT
                );
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES tasks(task_id),
                    ordinal INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    UNIQUE(task_id, ordinal)
                );
                CREATE TABLE IF NOT EXISTS actions (
                    action_key TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES tasks(task_id),
                    tool_name TEXT NOT NULL,
                    input_sha256 TEXT NOT NULL,
                    status TEXT NOT NULL,
                    receipt_path TEXT,
                    receipt_sha256 TEXT,
                    updated_at TEXT NOT NULL,
                    UNIQUE(task_id, tool_name)
                );
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES tasks(task_id),
                    run_id TEXT,
                    action_key TEXT,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    details_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_task_time ON events(task_id, occurred_at);
                CREATE TRIGGER IF NOT EXISTS events_no_update
                BEFORE UPDATE ON events BEGIN
                    SELECT RAISE(ABORT, 'events are append-only');
                END;
                CREATE TRIGGER IF NOT EXISTS events_no_delete
                BEFORE DELETE ON events BEGIN
                    SELECT RAISE(ABORT, 'events are append-only');
                END;
                """
            )
        finally:
            conn.close()

    @staticmethod
    def _event(conn, task_id, event_type, actor, details=None, run_id=None, action_key=None) -> None:
        conn.execute(
            "INSERT INTO events(event_id, task_id, run_id, action_key, event_type, actor, occurred_at, details_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                f"evt_{uuid.uuid4().hex}", task_id, run_id, action_key,
                event_type, actor, now_utc(),
                json.dumps(details or {}, sort_keys=True, separators=(",", ":")),
            ),
        )

    @staticmethod
    def _transition(conn, task_id, target, actor, event_type, details=None, run_id=None) -> None:
        row = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if row is None:
            raise StoreError(f"unknown task: {task_id}")
        current = row["status"]
        if target not in TRANSITIONS.get(current, set()):
            raise StoreError(f"invalid task transition: {current} -> {target}")
        conn.execute("UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?", (target, now_utc(), task_id))
        Store._event(conn, task_id, event_type, actor, details, run_id=run_id)

    def create_task(self, task_id, request_text, request_sha256, actor, action_key, tool_name) -> None:
        at = now_utc()
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO tasks(task_id, status, request_text, request_sha256, created_by, created_at, updated_at) "
                "VALUES (?, 'CREATED', ?, ?, ?, ?, ?)",
                (task_id, request_text, request_sha256, actor, at, at),
            )
            conn.execute(
                "INSERT INTO actions(action_key, task_id, tool_name, input_sha256, status, updated_at) "
                "VALUES (?, ?, ?, ?, 'PREPARED', ?)",
                (action_key, task_id, tool_name, request_sha256, at),
            )
            self._event(conn, task_id, "TASK_CREATED", actor, {"request_sha256": request_sha256})
            self._transition(conn, task_id, "QUEUED", actor, "TASK_QUEUED")

    def begin_run(self, task_id: str, actor: str) -> str:
        with self._tx() as conn:
            row = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if row is None:
                raise StoreError(f"unknown task: {task_id}")
            if row["status"] != "QUEUED":
                raise StoreError(f"task must be QUEUED to run; got {row['status']}")
            ordinal = conn.execute(
                "SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM runs WHERE task_id = ?", (task_id,)
            ).fetchone()["n"]
            run_id = f"run_{uuid.uuid4().hex}"
            at = now_utc()
            conn.execute(
                "INSERT INTO runs(run_id, task_id, ordinal, status, started_at) VALUES (?, ?, ?, 'RUNNING', ?)",
                (run_id, task_id, ordinal, at),
            )
            conn.execute("UPDATE tasks SET latest_run_id = ? WHERE task_id = ?", (run_id, task_id))
            self._transition(conn, task_id, "RUNNING", actor, "RUN_STARTED", {"ordinal": ordinal}, run_id)
            return run_id

    def mark_action_requested(self, task_id, run_id, actor):
        with self._tx() as conn:
            action = conn.execute("SELECT * FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None:
                raise StoreError(f"missing action for task: {task_id}")
            if action["status"] != "PREPARED":
                raise StoreError(f"action is not safe to start: {action['status']}")
            conn.execute("UPDATE actions SET status = 'REQUESTED', updated_at = ? WHERE action_key = ?", (now_utc(), action["action_key"]))
            self._event(
                conn, task_id, "ACTION_REQUESTED", actor,
                {"tool": action["tool_name"], "input_sha256": action["input_sha256"]},
                run_id, action["action_key"],
            )
            return dict(action)

    def record_effect(self, task_id, run_id, actor, receipt):
        with self._tx() as conn:
            action = conn.execute("SELECT * FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None or action["status"] not in {"REQUESTED", "EFFECT_RECORDED"}:
                raise StoreError("cannot record effect in current action state")
            conn.execute(
                "UPDATE actions SET status = 'EFFECT_RECORDED', receipt_path = ?, receipt_sha256 = ?, updated_at = ? WHERE action_key = ?",
                (receipt["path"], receipt["sha256"], now_utc(), action["action_key"]),
            )
            self._event(
                conn, task_id, "TOOL_RECEIPT_RECORDED", actor,
                {"path": receipt["path"], "sha256": receipt["sha256"]}, run_id, action["action_key"],
            )

    def begin_verification(self, task_id, run_id, actor):
        with self._tx() as conn:
            row = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if row is None:
                raise StoreError(f"unknown task: {task_id}")
            current = row["status"]
            if current in {"PAUSE_REQUESTED", "CANCEL_REQUESTED"}:
                self._event(
                    conn, task_id, "CONTROL_REQUEST_TOO_LATE", actor,
                    {"request": current, "reason": "current atomic action returned a receipt; verify before deciding"}, run_id,
                )
            self._transition(conn, task_id, "VERIFYING", actor, "VERIFICATION_STARTED", run_id=run_id)

    def complete(self, task_id, run_id, actor, receipt):
        with self._tx() as conn:
            action = conn.execute("SELECT action_key, status FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None or action["status"] != "EFFECT_RECORDED":
                raise StoreError("completion requires a recorded tool effect")
            conn.execute("UPDATE actions SET status = 'VERIFIED', updated_at = ? WHERE action_key = ?", (now_utc(), action["action_key"]))
            self._event(
                conn, task_id, "VERIFICATION_PASSED", actor,
                {"path": receipt["path"], "sha256": receipt["sha256"]}, run_id, action["action_key"],
            )
            self._transition(conn, task_id, "COMPLETED", actor, "TASK_COMPLETED", run_id=run_id)
            conn.execute("UPDATE runs SET status = 'COMPLETED', finished_at = ? WHERE run_id = ?", (now_utc(), run_id))
            self._event(conn, task_id, "RUN_FINISHED", actor, {"status": "COMPLETED"}, run_id)

    def request_pause(self, task_id, actor):
        with self._tx() as conn:
            row = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if row is None:
                raise StoreError(f"unknown task: {task_id}")
            current = row["status"]
            if current == "QUEUED":
                self._transition(conn, task_id, "PAUSED", actor, "TASK_PAUSED", {"safe_point": "not started"})
            elif current == "RUNNING":
                self._transition(conn, task_id, "PAUSE_REQUESTED", actor, "TASK_PAUSE_REQUESTED")
            else:
                raise StoreError(f"cannot pause task in state {current}")

    def request_cancel(self, task_id, actor):
        with self._tx() as conn:
            row = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if row is None:
                raise StoreError(f"unknown task: {task_id}")
            current = row["status"]
            if current in {"QUEUED", "PAUSED", "FAILED"}:
                self._transition(conn, task_id, "CANCELLED", actor, "TASK_CANCELLED", {"safe_point": "no active action"})
            elif current in {"RUNNING", "PAUSE_REQUESTED"}:
                self._transition(conn, task_id, "CANCEL_REQUESTED", actor, "TASK_CANCEL_REQUESTED")
            else:
                raise StoreError(f"cannot cancel task in state {current}")

    def acknowledge_control(self, task_id, run_id, actor, final_state):
        requested = {"PAUSED": "PAUSE_REQUESTED", "CANCELLED": "CANCEL_REQUESTED"}.get(final_state)
        if requested is None:
            raise StoreError(f"invalid control result: {final_state}")
        with self._tx() as conn:
            task = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            action = conn.execute("SELECT action_key, status FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if task is None or action is None or task["status"] != requested:
                raise StoreError("control request is no longer pending")
            if action["status"] == "REQUESTED":
                conn.execute(
                    "UPDATE actions SET status = 'PREPARED', updated_at = ? WHERE action_key = ?",
                    (now_utc(), action["action_key"]),
                )
                self._event(
                    conn, task_id, "ACTION_STOPPED_BEFORE_EFFECT", actor,
                    {"safe_point": "tool cooperatively stopped before side effect"}, run_id, action["action_key"],
                )
            elif action["status"] != "PREPARED":
                raise StoreError("cannot acknowledge stop after an unverified effect")
            self._transition(conn, task_id, final_state, actor, f"TASK_{final_state}", {"safe_point": "confirmed"}, run_id)
            conn.execute("UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?", (final_state, now_utc(), run_id))
            self._event(conn, task_id, "RUN_FINISHED", actor, {"status": final_state}, run_id)

    def resume(self, task_id, actor):
        with self._tx() as conn:
            action = conn.execute("SELECT status FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None or action["status"] != "PREPARED":
                raise StoreError("resume requires a verified safe point with no unrecorded effect")
            self._transition(conn, task_id, "QUEUED", actor, "TASK_RESUME_QUEUED")

    def needs_reconciliation(self, task_id, run_id, actor, reason):
        with self._tx() as conn:
            row = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if row is None:
                raise StoreError(f"unknown task: {task_id}")
            if row["status"] != "NEEDS_RECONCILIATION":
                self._transition(conn, task_id, "NEEDS_RECONCILIATION", actor, "TASK_NEEDS_RECONCILIATION", {"reason": reason}, run_id)
            conn.execute("UPDATE tasks SET last_error = ?, updated_at = ? WHERE task_id = ?", (reason, now_utc(), task_id))
            if run_id:
                conn.execute(
                    "UPDATE runs SET status = 'UNKNOWN', finished_at = ? WHERE run_id = ? AND status = 'RUNNING'",
                    (now_utc(), run_id),
                )

    def recover_interrupted(self, task_id, actor):
        with self._tx() as conn:
            task = conn.execute("SELECT status, latest_run_id FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if task is None:
                raise StoreError(f"unknown task: {task_id}")
            original = task["status"]
            if original in {"RUNNING", "VERIFYING", "PAUSE_REQUESTED", "CANCEL_REQUESTED"}:
                run_id = task["latest_run_id"]
                self._transition(
                    conn, task_id, "NEEDS_RECONCILIATION", actor, "RUN_INTERRUPTED",
                    {"reason": "process stopped before safe state confirmation", "interrupted_from": original}, run_id,
                )
                if run_id:
                    conn.execute("UPDATE runs SET status = 'INTERRUPTED', finished_at = ? WHERE run_id = ?", (now_utc(), run_id))
                return {"status": "NEEDS_RECONCILIATION", "interrupted_from": original}
            return {"status": original, "interrupted_from": None}

    def reconcile_no_effect(self, task_id, actor, reason, final_state="FAILED"):
        if final_state not in {"FAILED", "PAUSED", "CANCELLED"}:
            raise StoreError(f"invalid no-effect recovery state: {final_state}")
        with self._tx() as conn:
            task = conn.execute("SELECT status, latest_run_id FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            action = conn.execute("SELECT action_key, status FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if task is None or action is None:
                raise StoreError(f"unknown or incomplete task: {task_id}")
            if task["status"] != "NEEDS_RECONCILIATION" or action["status"] not in {"REQUESTED", "PREPARED"}:
                raise StoreError("readback is not sufficient to conclude no effect")
            conn.execute(
                "UPDATE actions SET status = 'PREPARED', receipt_path = NULL, receipt_sha256 = NULL, updated_at = ? WHERE action_key = ?",
                (now_utc(), action["action_key"]),
            )
            self._event(conn, task_id, "RECONCILIATION_NO_EFFECT", actor, {"reason": reason}, task["latest_run_id"], action["action_key"])
            self._transition(conn, task_id, final_state, actor, f"TASK_{final_state}", {"reason": reason}, task["latest_run_id"])
            if task["latest_run_id"]:
                run_status = "NO_EFFECT" if final_state == "FAILED" else final_state
                conn.execute("UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?", (run_status, now_utc(), task["latest_run_id"]))

    def retry(self, task_id, actor):
        with self._tx() as conn:
            action = conn.execute("SELECT status FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None or action["status"] != "PREPARED":
                raise StoreError("retry requires reconciliation to confirm no effect")
            self._transition(conn, task_id, "QUEUED", actor, "TASK_RETRY_QUEUED")
            conn.execute("UPDATE tasks SET last_error = NULL WHERE task_id = ?", (task_id,))

    def transition(self, task_id, target, actor, event_type, details=None, run_id=None):
        with self._tx() as conn:
            self._transition(conn, task_id, target, actor, event_type, details, run_id)

    def get_task(self, task_id):
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_action(self, task_id):
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def events(self, task_id):
        conn = self._connect()
        try:
            rows = conn.execute("SELECT * FROM events WHERE task_id = ? ORDER BY rowid", (task_id,)).fetchall()
            result = []
            for row in rows:
                item = dict(row)
                item["details"] = json.loads(item.pop("details_json"))
                result.append(item)
            return result
        finally:
            conn.close()
