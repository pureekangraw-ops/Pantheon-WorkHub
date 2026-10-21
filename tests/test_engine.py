from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pantheon_workhub.engine import OperationsEngine, PauseRequested
from pantheon_workhub.store import Store, StoreError
from pantheon_workhub.tools import TextArtifactTool


class SimulatedProcessCrash(BaseException):
    pass


class CrashAfterWriteTool(TextArtifactTool):
    def execute(self, task_id, action_key, content, expected_sha256, control=None):
        receipt = super().execute(task_id, action_key, content, expected_sha256, control)
        raise SimulatedProcessCrash("simulated process loss after effect, before receipt")


class FailBeforeWriteTool(TextArtifactTool):
    def execute(self, task_id, action_key, content, expected_sha256, control=None):
        raise RuntimeError("simulated tool timeout before local effect")


class WaitingTool(TextArtifactTool):
    def __init__(self, workspace):
        super().__init__(workspace)
        self.entered = threading.Event()

    def execute(self, task_id, action_key, content, expected_sha256, control=None):
        self.entered.set()
        while True:
            control.checkpoint()
            time.sleep(0.005)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.db = root / "workhub.sqlite"
        self.workspace = root / "workspace"
        self.store = Store(self.db)
        self.tool = TextArtifactTool(self.workspace)
        self.engine = OperationsEngine(self.store, self.tool)

    def tearDown(self):
        self.temp.cleanup()

    def test_create_run_inspect_and_complete(self):
        task_id = self.engine.create_task("hello artifact", "owner")
        task = self.engine.run_task(task_id, "owner")
        self.assertEqual(task["status"], "COMPLETED")
        events = self.store.events(task_id)
        types = [event["event_type"] for event in events]
        self.assertEqual(types[:3], ["TASK_CREATED", "TASK_QUEUED", "RUN_STARTED"])
        self.assertIn("ACTION_REQUESTED", types)
        self.assertIn("VERIFICATION_PASSED", types)
        self.assertEqual(types[-2:], ["TASK_COMPLETED", "RUN_FINISHED"])
        action = self.store.get_action(task_id)
        self.assertTrue(self.tool.inspect(task_id, action["action_key"], action["input_sha256"])["matches"])

    def test_crash_after_effect_recovers_without_repeating_side_effect(self):
        crashing = OperationsEngine(self.store, CrashAfterWriteTool(self.workspace))
        task_id = crashing.create_task("recover me", "owner")
        with self.assertRaises(SimulatedProcessCrash):
            crashing.run_task(task_id, "owner")
        self.assertEqual(self.store.get_task(task_id)["status"], "RUNNING")
        action_before = self.store.get_action(task_id)
        task = self.engine.recover_task(task_id, "owner")
        self.assertEqual(task["status"], "COMPLETED")
        self.assertEqual(self.store.get_action(task_id)["action_key"], action_before["action_key"])
        artifact = self.tool._path(task_id, action_before["action_key"])
        self.assertEqual(artifact.read_text(encoding="utf-8"), "recover me")
        self.assertEqual(len(list((self.workspace / "artifacts" / task_id).glob("*.txt"))), 1)

    def test_retry_requires_readback_then_reuses_task_and_action_key(self):
        failing = OperationsEngine(self.store, FailBeforeWriteTool(self.workspace))
        task_id = failing.create_task("retry me", "owner")
        task = failing.run_task(task_id, "owner")
        self.assertEqual(task["status"], "NEEDS_RECONCILIATION")
        task = self.engine.recover_task(task_id, "owner")
        self.assertEqual(task["status"], "FAILED")
        action_key = self.store.get_action(task_id)["action_key"]
        task = self.engine.retry_task(task_id, "owner")
        self.assertEqual(task["status"], "COMPLETED")
        self.assertEqual(self.store.get_action(task_id)["action_key"], action_key)
        with closing(sqlite3.connect(self.db)) as conn:
            runs = conn.execute("SELECT run_id FROM runs WHERE task_id = ? ORDER BY ordinal", (task_id,)).fetchall()
        self.assertEqual(len(runs), 2)
        self.assertNotEqual(runs[0][0], runs[1][0])

    def test_conflicting_artifact_stays_unresolved(self):
        crashing = OperationsEngine(self.store, CrashAfterWriteTool(self.workspace))
        task_id = crashing.create_task("original", "owner")
        with self.assertRaises(SimulatedProcessCrash):
            crashing.run_task(task_id, "owner")
        action = self.store.get_action(task_id)
        self.tool._path(task_id, action["action_key"]).write_text("different", encoding="utf-8")
        task = self.engine.recover_task(task_id, "owner")
        self.assertEqual(task["status"], "NEEDS_RECONCILIATION")

    def test_event_rows_are_append_only(self):
        task_id = self.engine.create_task("audit me", "owner")
        with closing(sqlite3.connect(self.db)) as conn:
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("UPDATE events SET event_type = 'TAMPERED' WHERE task_id = ?", (task_id,))
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("DELETE FROM events WHERE task_id = ?", (task_id,))

    def test_pause_at_safe_point_then_resume_with_new_run(self):
        waiting = WaitingTool(self.workspace)
        waiting_engine = OperationsEngine(self.store, waiting)
        task_id = waiting_engine.create_task("pause me", "owner")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(waiting_engine.run_task, task_id, "runner")
            self.assertTrue(waiting.entered.wait(2))
            task = waiting_engine.request_pause(task_id, "owner")
            self.assertEqual(task["status"], "PAUSE_REQUESTED")
            self.assertEqual(future.result(timeout=2)["status"], "PAUSED")
        action_key = self.store.get_action(task_id)["action_key"]
        task = self.engine.resume_task(task_id, "owner")
        self.assertEqual(task["status"], "COMPLETED")
        self.assertEqual(self.store.get_action(task_id)["action_key"], action_key)
        with closing(sqlite3.connect(self.db)) as conn:
            run_ids = conn.execute("SELECT run_id FROM runs WHERE task_id = ? ORDER BY ordinal", (task_id,)).fetchall()
        self.assertEqual(len(run_ids), 2)
        self.assertNotEqual(run_ids[0][0], run_ids[1][0])

    def test_cancel_at_safe_point_prevents_effect(self):
        waiting = WaitingTool(self.workspace)
        waiting_engine = OperationsEngine(self.store, waiting)
        task_id = waiting_engine.create_task("cancel me", "owner")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(waiting_engine.run_task, task_id, "runner")
            self.assertTrue(waiting.entered.wait(2))
            task = waiting_engine.request_cancel(task_id, "owner")
            self.assertEqual(task["status"], "CANCEL_REQUESTED")
            self.assertEqual(future.result(timeout=2)["status"], "CANCELLED")
        action = self.store.get_action(task_id)
        observed = self.tool.inspect(task_id, action["action_key"], action["input_sha256"])
        self.assertFalse(observed["exists"])

    def test_queued_pause_and_cancel_are_immediate_and_logged(self):
        pause_id = self.engine.create_task("pause queued", "owner")
        self.assertEqual(self.engine.request_pause(pause_id, "owner")["status"], "PAUSED")
        self.assertEqual(self.engine.resume_task(pause_id, "owner")["status"], "COMPLETED")
        cancel_id = self.engine.create_task("cancel queued", "owner")
        self.assertEqual(self.engine.request_cancel(cancel_id, "owner")["status"], "CANCELLED")
        self.assertIn("TASK_CANCELLED", [event["event_type"] for event in self.store.events(cancel_id)])

    def test_atomic_claim_allows_only_one_run(self):
        task_id = self.engine.create_task("single claim", "owner")
        def claim():
            try:
                return self.store.begin_run(task_id, "worker")
            except StoreError:
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: claim(), range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        with closing(sqlite3.connect(self.db)) as conn:
            count = conn.execute("SELECT COUNT(*) FROM runs WHERE task_id = ?", (task_id,)).fetchone()[0]
        self.assertEqual(count, 1)

    @unittest.skipUnless(os.name == "posix", "POSIX permission bits required")
    def test_database_workspace_and_artifacts_are_owner_only(self):
        self.assertEqual(self.db.stat().st_mode & 0o077, 0)
        self.assertEqual(self.workspace.stat().st_mode & 0o077, 0)
        task_id = self.engine.create_task("private artifact", "owner")
        self.assertEqual(self.engine.run_task(task_id, "owner")["status"], "COMPLETED")
        action = self.store.get_action(task_id)
        artifact = self.tool._path(task_id, action["action_key"])
        self.assertEqual(artifact.stat().st_mode & 0o077, 0)

    @unittest.skipUnless(os.name == "posix", "POSIX permission bits required")
    def test_refuses_shared_database_or_workspace_directories(self):
        shared = Path(self.temp.name) / "shared"
        shared.mkdir(mode=0o755)
        shared.chmod(0o755)
        with self.assertRaises(PermissionError):
            Store(shared / "unsafe.sqlite")
        with self.assertRaises(PermissionError):
            TextArtifactTool(shared)


if __name__ == "__main__":
    unittest.main()
