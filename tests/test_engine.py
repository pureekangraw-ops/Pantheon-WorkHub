from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from pantheon_workhub.engine import OperationsEngine
from pantheon_workhub.store import Store
from pantheon_workhub.tools import TextArtifactTool


class SimulatedProcessCrash(BaseException):
    pass


class CrashAfterWriteTool(TextArtifactTool):
    def execute(self, task_id, action_key, content, expected_sha256):
        receipt = super().execute(task_id, action_key, content, expected_sha256)
        raise SimulatedProcessCrash("simulated process loss after effect, before receipt")


class FailBeforeWriteTool(TextArtifactTool):
    def execute(self, task_id, action_key, content, expected_sha256):
        raise RuntimeError("simulated tool timeout before local effect")


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
        observed = self.tool.inspect(task_id, action["action_key"], action["input_sha256"])
        self.assertTrue(observed["matches"])

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
        with sqlite3.connect(self.db) as conn:
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
        with sqlite3.connect(self.db) as conn:
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("UPDATE events SET event_type = 'TAMPERED' WHERE task_id = ?", (task_id,))
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("DELETE FROM events WHERE task_id = ?", (task_id,))


if __name__ == "__main__":
    unittest.main()
