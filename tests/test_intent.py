from __future__ import annotations

import json
import unittest

from pantheon_workhub.intent import IntentValidationError, parse_intent


class IntentTests(unittest.TestCase):
    def test_create_task(self):
        self.assertEqual(parse_intent('{"intent":"CREATE_TASK","request":"write report"}'),
                         {"intent": "CREATE_TASK", "request": "write report"})

    def test_show_task(self):
        task_id = "task_" + "a" * 32
        self.assertEqual(parse_intent(json.dumps({"intent": "SHOW_TASK", "task_id": task_id}))["task_id"], task_id)

    def test_list_tasks(self):
        self.assertEqual(parse_intent('{"intent":"LIST_TASKS"}'), {"intent": "LIST_TASKS"})

    def test_rejects_unsafe_and_malformed_output(self):
        cases = [
            "not json", "[]", "null", "{}", '{"intent":"RUN_SHELL","command":"rm -rf /"}',
            '{"intent":"LIST_TASKS","extra":true}', '{"intent":"CREATE_TASK","request":""}',
            '{"intent":"CREATE_TASK","request":123}', '{"intent":"SHOW_TASK","task_id":"../bad"}',
            '{"intent":"CREATE_TASK","request":"ok","approved":true}', " " * 8193,
        ]
        for raw in cases:
            with self.subTest(raw=raw[:50]), self.assertRaises(IntentValidationError):
                parse_intent(raw)


if __name__ == "__main__":
    unittest.main()
