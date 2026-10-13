# Pantheon WorkHub — HERMES V1.2 vertical slice

A local-only, standard-library prototype of the HERMES task lifecycle. It proves one safe path:

`create task → persist IDs/events → execute one local artifact tool → read back → verify → complete`

If the process stops after the tool changes the workspace but before the receipt is saved, recovery reads the artifact before deciding whether to complete or retry. It never blindly replays an uncertain side effect.

## Run

Requires Python 3.11+; no third-party dependencies.

```sh
python -m unittest discover -s tests -v
python -m pantheon_workhub --db .data/workhub.sqlite --workspace .data/workspace create --actor owner --request "first local artifact"
```

The `create` command creates and runs a task. The returned `task_id` can be used with:

```sh
python -m pantheon_workhub --db .data/workhub.sqlite --workspace .data/workspace show TASK_ID
python -m pantheon_workhub --db .data/workhub.sqlite --workspace .data/workspace events TASK_ID
python -m pantheon_workhub --db .data/workhub.sqlite --workspace .data/workspace recover TASK_ID --actor owner
python -m pantheon_workhub --db .data/workhub.sqlite --workspace .data/workspace retry TASK_ID --actor owner
```

## Deliberate limits of this first slice

- One synchronous local worker and one create-only text-artifact tool.
- No UI, background daemon, network API, authentication provider, AI/model integration, external connectors, arbitrary shell, or destructive tool.
- `--actor` is an audit label, **not authentication**. Keep this prototype local; do not expose it to a network or use it for sensitive data.
- Pause/cancel are not claimed as implemented: they need an interruptible worker and observable safe points to prove that a real process stopped.
- The database is the source of truth for HERMES task state only. The prototype does not claim authority over external systems.

## Safety properties in the slice

- Task creation and its initial events are committed in one SQLite transaction before execution.
- Task ID is stable; each execution attempt gets a new Run ID; Event IDs are unique. The Action Key is stable for the same task, tool, target, and input hash.
- State changes and their events commit together. Event rows reject UPDATE/DELETE at the SQLite layer.
- An `ACTION_REQUESTED` event is committed before the file write. A receipt and independent readback are required before `COMPLETED`.
- If an effect is uncertain, the task enters `NEEDS_RECONCILIATION`. A matching artifact completes via readback; a missing artifact is marked `FAILED` and requires an explicit retry; a conflicting artifact remains unresolved.
- This is a prototype, not a production security boundary. Request text is stored locally; do not include credentials or secrets.
