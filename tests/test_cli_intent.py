from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pantheon_workhub.cli import main


class IntentCliTests(unittest.TestCase):
    def test_queue_read_and_execute_explicitly(self):
        with tempfile.TemporaryDirectory() as root:
            db = str(Path(root) / "state.sqlite")
            workspace = str(Path(root) / "workspace")
            base = ["--db", db, "--workspace", workspace]

            def invoke(*args):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    code = main(base + list(args))
                self.assertEqual(code, 0)
                return json.loads(output.getvalue())

            queued = invoke("intent", "--json",
                            '{"intent":"CREATE_TASK","request":"hello from hermes"}',
                            "--actor", "local-owner")
            task_id = queued["task_id"]
            self.assertEqual(queued["status"], "QUEUED")
            self.assertEqual(list(Path(workspace).rglob("*.txt")), [])
            shown = invoke("intent", "--json", json.dumps(
                {"intent": "SHOW_TASK", "task_id": task_id}), "--actor", "local-owner")
            self.assertEqual(shown["task"]["status"], "QUEUED")
            listed = invoke("intent", "--json", '{"intent":"LIST_TASKS"}',
                            "--actor", "local-owner")
            self.assertEqual(listed["tasks"][0]["task_id"], task_id)
            # Execution is a separate, explicit Engine operation.
            from pantheon_workhub.engine import OperationsEngine
            from pantheon_workhub.store import Store
            from pantheon_workhub.tools import TextArtifactTool
            engine = OperationsEngine(Store(db), TextArtifactTool(workspace))
            completed = engine.run_task(task_id, "local-owner")
            self.assertEqual(completed["status"], "COMPLETED")
            action = engine.store.get_action(task_id)
            self.assertTrue(engine.tool.inspect(
                task_id, action["action_key"], action["input_sha256"])["matches"])


if __name__ == "__main__":
    unittest.main()
