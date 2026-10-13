from __future__ import annotations

import argparse
import json
import sys

from .dispatcher import dispatch_intent
from .engine import OperationsEngine
from .store import Store
from .tools import TextArtifactTool


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pantheon-workhub")
    parser.add_argument("--db", default=".data/workhub.sqlite")
    parser.add_argument("--workspace", default=".data/workspace")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="create and run a local artifact task")
    create.add_argument("--request", required=True)
    create.add_argument("--actor", required=True)

    intent = sub.add_parser("intent", help="validate HERMES JSON and queue/read tasks; never auto-executes")
    intent.add_argument("--json", required=True, help="raw JSON intent from an untrusted model")
    intent.add_argument("--actor", required=True, help="trusted local caller audit label")

    retry = sub.add_parser("retry", help="retry only after recovery confirmed no effect")
    retry.add_argument("task_id")
    retry.add_argument("--actor", required=True)

    recover = sub.add_parser("recover", help="inspect an interrupted or uncertain task")
    recover.add_argument("task_id")
    recover.add_argument("--actor", required=True)

    show = sub.add_parser("show", help="show the current task record")
    show.add_argument("task_id")

    events = sub.add_parser("events", help="show append-only task events")
    events.add_argument("task_id")

    args = parser.parse_args(argv)
    engine = OperationsEngine(Store(args.db), TextArtifactTool(args.workspace))
    try:
        if args.command == "create":
            task_id = engine.create_task(args.request, args.actor)
            result = engine.run_task(task_id, args.actor)
            print(json.dumps(result, indent=2, sort_keys=True))
        elif args.command == "intent":
            print(json.dumps(dispatch_intent(engine, args.json, args.actor), indent=2, sort_keys=True))
        elif args.command == "retry":
            print(json.dumps(engine.retry_task(args.task_id, args.actor), indent=2, sort_keys=True))
        elif args.command == "recover":
            print(json.dumps(engine.recover_task(args.task_id, args.actor), indent=2, sort_keys=True))
        elif args.command == "show":
            result = engine.store.get_task(args.task_id)
            if result is None:
                raise ValueError(f"unknown task: {args.task_id}")
            print(json.dumps(result, indent=2, sort_keys=True))
        elif args.command == "events":
            print(json.dumps(engine.store.events(args.task_id), indent=2, sort_keys=True))
        return 0
    except (ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
