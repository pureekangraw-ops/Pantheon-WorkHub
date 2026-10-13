from __future__ import annotations

import argparse
import json
import sys

from .engine import OperationsEngine
from .store import Store
from .tools import TextArtifactTool


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pantheon-workhub")
    parser.add_argument("--db", default=".data/workhub.sqlite")
    parser.add_argument("--workspace", default=".data/workspace")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="create and queue a local artifact task")
    create.add_argument("--request", required=True)
    create.add_argument("--actor", required=True)

    run = sub.add_parser("run", help="run one queued task")
    run.add_argument("task_id")
    run.add_argument("--actor", required=True)

    retry = sub.add_parser("retry", help="retry only after recovery confirmed no effect")
    retry.add_argument("task_id")
    retry.add_argument("--actor", required=True)

    recover = sub.add_parser("recover", help="inspect an interrupted or uncertain task")
    recover.add_argument("task_id")
    recover.add_argument("--actor", required=True)

    pause = sub.add_parser("pause", help="request pause; running tools stop at a safe point")
    pause.add_argument("task_id")
    pause.add_argument("--actor", required=True)

    resume = sub.add_parser("resume", help="resume a confirmed paused task")
    resume.add_argument("task_id")
    resume.add_argument("--actor", required=True)

    cancel = sub.add_parser("cancel", help="request cancellation at a safe point")
    cancel.add_argument("task_id")
    cancel.add_argument("--actor", required=True)

    show = sub.add_parser("show", help="show the current task record")
    show.add_argument("task_id")

    events = sub.add_parser("events", help="show append-only task events")
    events.add_argument("task_id")

    args = parser.parse_args(argv)
    engine = OperationsEngine(Store(args.db), TextArtifactTool(args.workspace))
    try:
        if args.command == "create":
            task_id = engine.create_task(args.request, args.actor)
            print(json.dumps(engine.store.get_task(task_id), indent=2, sort_keys=True))
        elif args.command == "run":
            print(json.dumps(engine.run_task(args.task_id, args.actor), indent=2, sort_keys=True))
        elif args.command == "retry":
            print(json.dumps(engine.retry_task(args.task_id, args.actor), indent=2, sort_keys=True))
        elif args.command == "recover":
            print(json.dumps(engine.recover_task(args.task_id, args.actor), indent=2, sort_keys=True))
        elif args.command == "pause":
            print(json.dumps(engine.request_pause(args.task_id, args.actor), indent=2, sort_keys=True))
        elif args.command == "resume":
            print(json.dumps(engine.resume_task(args.task_id, args.actor), indent=2, sort_keys=True))
        elif args.command == "cancel":
            print(json.dumps(engine.request_cancel(args.task_id, args.actor), indent=2, sort_keys=True))
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
