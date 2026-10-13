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
    "QUEUED": {"RUNNING", "CANCELLED"},
    "RUNNING": {"VERIFYING", "NEEDS_RECONCILIATION", "PAUSED", "CANCELLED", "FAILED"},
    "VERIFYING": {"COMPLETED", "NEEDS_RECONCILIATION", "FAILED"},
    "NEEDS_RECONCILIATION": {"VERIFYING", "FAILED"},
    "FAILED": {"QUEUED", "CANCELLED"},
    "PAUSE_REQUESTED": {"PAUSED", "RUNNING", "NEEDS_RECONCILIATION"},
    "PAUSED": {"QUEUED", "CANCELLED"},
    "CANCEL_REQUESTED": {"CANCELLED", "NEEDS_RECONCILIATION"},
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
    def _event(
        conn: sqlite3.Connection,
        task_id: str,
        event_type: str,
        actor: str,
        details: dict[str, Any] | None = None,
        run_id: str | None = None,
        action_key: str | None = None,
    ) -> None:
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
    def _transition(
        conn: sqlite3.Connection,
        task_id: str,
        target: str,
        actor: str,
        event_type: str,
        details: dict[str, Any] | None = None,
        run_id: str | None = None,
    ) -> None:
        row = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if row is None:
            raise StoreError(f"unknown task: {task_id}")
        current = row["status"]
        if target not in TRANSITIONS.get(current, set()):
            raise StoreError(f"invalid task transition: {current} -> {target}")
        conn.execute(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?",
            (target, now_utc(), task_id),
        )
        Store._event(conn, task_id, event_type, actor, details, run_id=run_id)

    def create_task(
        self,
        task_id: str,
        request_text: str,
        request_sha256: str,
        actor: str,
        action_key: str,
        tool_name: str,
    ) -> None:
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

    def mark_action_requested(self, task_id: str, run_id: str, actor: str) -> dict[str, Any]:
        with self._tx() as conn:
            action = conn.execute("SELECT * FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None:
                raise StoreError(f"missing action for task: {task_id}")
            if action["status"] != "PREPARED":
                raise StoreError(f"action is not safe to start: {action['status']}")
            conn.execute(
                "UPDATE actions SET status = 'REQUESTED', updated_at = ? WHERE action_key = ?",
                (now_utc(), action["action_key"]),
            )
            self._event(
                conn, task_id, "ACTION_REQUESTED", actor,
                {"tool": action["tool_name"], "input_sha256": action["input_sha256"]},
                run_id, action["action_key"],
            )
            return dict(action)

    def record_effect(self, task_id: str, run_id: str | None, actor: str, receipt: dict[str, Any]) -> None:
        with self._tx() as conn:
            action = conn.execute("SELECT * FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None:
                raise StoreError(f"missing action for task: {task_id}")
            if action["status"] not in {"REQUESTED", "EFFECT_RECORDED"}:
                raise StoreError(f"cannot record effect from action state {action['status']}")
            conn.execute(
                "UPDATE actions SET status = 'EFFECT_RECORDED', receipt_path = ?, receipt_sha256 = ?, updated_at = ? "
                "WHERE action_key = ?",
                (receipt["path"], receipt["sha256"], now_utc(), action["action_key"]),
            )
            self._event(
                conn, task_id, "TOOL_RECEIPT_RECORDED", actor,
                {"path": receipt["path"], "sha256": receipt["sha256"]},
                run_id, action["action_key"],
            )

    def transition(self, task_id: str, target: str, actor: str, event_type: str, details=None, run_id=None) -> None:
        with self._tx() as conn:
            self._transition(conn, task_id, target, actor, event_type, details, run_id)

    def complete(self, task_id: str, run_id: str, actor: str, receipt: dict[str, Any]) -> None:
        with self._tx() as conn:
            action = conn.execute("SELECT action_key FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None:
                raise StoreError(f"missing action for task: {task_id}")
            conn.execute(
                "UPDATE actions SET status = 'VERIFIED', updated_at = ? WHERE action_key = ?",
                (now_utc(), action["action_key"]),
            )
            self._event(
                conn, task_id, "VERIFICATION_PASSED", actor,
                {"path": receipt["path"], "sha256": receipt["sha256"]},
                run_id, action["action_key"],
            )
            self._transition(conn, task_id, "COMPLETED", actor, "TASK_COMPLETED", run_id=run_id)
            conn.execute(
                "UPDATE runs SET status = 'COMPLETED', finished_at = ? WHERE run_id = ?",
                (now_utc(), run_id),
            )
            self._event(conn, task_id, "RUN_FINISHED", actor, {"status": "COMPLETED"}, run_id)

    def needs_reconciliation(self, task_id: str, run_id: str | None, actor: str, reason: str) -> None:
        with self._tx() as conn:
            row = conn.execute("SELECT status FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if row is None:
                raise StoreError(f"unknown task: {task_id}")
            if row["status"] != "NEEDS_RECONCILIATION":
                self._transition(
                    conn, task_id, "NEEDS_RECONCILIATION", actor,
                    "TASK_NEEDS_RECONCILIATION", {"reason": reason}, run_id,
                )
            conn.execute(
                "UPDATE tasks SET last_error = ?, updated_at = ? WHERE task_id = ?",
                (reason, now_utc(), task_id),
            )
            if run_id:
                conn.execute(
                    "UPDATE runs SET status = 'UNKNOWN', finished_at = ? WHERE run_id = ? AND status = 'RUNNING'",
                    (now_utc(), run_id),
                )

    def recover_interrupted(self, task_id: str, actor: str) -> str:
        with self._tx() as conn:
            task = conn.execute("SELECT status, latest_run_id FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if task is None:
                raise StoreError(f"unknown task: {task_id}")
            if task["status"] in {"RUNNING", "VERIFYING"}:
                run_id = task["latest_run_id"]
                self._transition(
                    conn, task_id, "NEEDS_RECONCILIATION", actor,
                    "RUN_INTERRUPTED", {"reason": "process stopped before final readback"}, run_id,
                )
                if run_id:
                    conn.execute(
                        "UPDATE runs SET status = 'INTERRUPTED', finished_at = ? WHERE run_id = ?",
                        (now_utc(), run_id),
                    )
                return "NEEDS_RECONCILIATION"
            return task["status"]

    def reconcile_no_effect(self, task_id: str, actor: str, reason: str) -> None:
        with self._tx() as conn:
            task = conn.execute("SELECT status, latest_run_id FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            action = conn.execute("SELECT action_key, status FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if task is None or action is None:
                raise StoreError(f"unknown or incomplete task: {task_id}")
            if task["status"] != "NEEDS_RECONCILIATION" or action["status"] != "REQUESTED":
                raise StoreError("absence is not sufficient to retry this action")
            conn.execute(
                "UPDATE actions SET status = 'PREPARED', receipt_path = NULL, receipt_sha256 = NULL, updated_at = ? "
                "WHERE action_key = ?",
                (now_utc(), action["action_key"]),
            )
            self._event(
                conn, task_id, "RECONCILIATION_NO_EFFECT", actor, {"reason": reason},
                task["latest_run_id"], action["action_key"],
            )
            self._transition(
                conn, task_id, "FAILED", actor, "TASK_FAILED",
                {"reason": "readback confirmed no effect; explicit retry required"}, task["latest_run_id"],
            )
            if task["latest_run_id"]:
                conn.execute(
                    "UPDATE runs SET status = 'NO_EFFECT', finished_at = ? WHERE run_id = ?",
                    (now_utc(), task["latest_run_id"]),
                )

    def retry(self, task_id: str, actor: str) -> None:
        with self._tx() as conn:
            action = conn.execute("SELECT status FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            if action is None or action["status"] != "PREPARED":
                raise StoreError("retry requires reconciliation to confirm no effect")
            self._transition(conn, task_id, "QUEUED", actor, "TASK_RETRY_QUEUED")
            conn.execute("UPDATE tasks SET last_error = NULL WHERE task_id = ?", (task_id,))

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            return dict(row) if row else None

    def get_action(self, task_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM actions WHERE task_id = ?", (task_id,)).fetchone()
            return dict(row) if row else None

    def events(self, task_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM events WHERE task_id = ? ORDER BY rowid", (task_id,)
            ).fetchall()
            result = []
            for row in rows:
                item = dict(row)
                item["details"] = json.loads(item.pop("details_json"))
                result.append(item)
            return result
