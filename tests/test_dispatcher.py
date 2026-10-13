from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pantheon_workhub.dispatcher import dispatch_intent
from pantheon_workhub.engine import OperationsEngine
from pantheon_workhub.intent import IntentValidationError
from pantheon_workhub.store import Store
from pantheon_workhub.tools import TextArtifactTool


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.store = Store(root / "workhub.sqlite")
        self.workspace = root / "workspace"
        self.engine = OperationsEngine(self.store, TextArtifactTool(self.workspace))

    def tearDown(self):
        self.temp.cleanup()

    def test_create_only_queues(self):
        result = dispatch_intent(self.engine, '{"intent":"CREATE_TASK","request":"hello"}', "owner")
        self.assertEqual(result["status"], "QUEUED")
        self.assertFalse(result["executed"])
        self.assertEqual(self.store.get_task(result["task_id"])["status"], "QUEUED")
        self.assertEqual(list(self.workspace.rglob("*.txt")), [])

    def test_show_and_list(self):
        created = dispatch_intent(self.engine, '{"intent":"CREATE_TASK","request":"hello"}', "owner")
        task_id = created["task_id"]
        shown = dispatch_intent(self.engine, json.dumps({"intent": "SHOW_TASK", "task_id": task_id}), "owner")
        self.assertEqual(shown["task"]["task_id"], task_id)
        listed = dispatch_intent(self.engine, '{"intent":"LIST_TASKS"}', "owner")
        self.assertIn(task_id, [task["task_id"] for task in listed["tasks"]])

    def test_invalid_intent_creates_no_tasks(self):
        with self.assertRaises(IntentValidationError):
            dispatch_intent(self.engine, '{"intent":"RUN_SHELL","command":"anything"}', "owner")
        self.assertEqual(self.store.list_tasks(), [])

    def test_missing_actor_rejected(self):
        with self.assertRaises(ValueError):
            dispatch_intent(self.engine, '{"intent":"CREATE_TASK","request":"hello"}', "")
        self.assertEqual(self.store.list_tasks(), [])


if __name__ == "__main__":
    unittest.main()
