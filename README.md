# Pantheon WorkHub — HERMES V1.2 local execution slice

A local-only, standard-library prototype proving this path:

`create → queue → claim → execute one local tool → read back → verify → complete`

The Operations Engine owns task state. Task IDs stay stable; every run gets a new Run ID; a same-task/same-tool/same-input action keeps its Action Key. Events are stored in SQLite and reject UPDATE/DELETE at the database layer.

## Run

Requires Python 3.11+; no third-party dependencies.

```sh
python -m unittest discover -s tests -v
python -m pantheon_workhub --db .data/pantheon-workhub/workhub.sqlite --workspace .data/pantheon-workhub/workspace create --actor owner --request "first local artifact"
# copy task_id from output
python -m pantheon_workhub --db .data/pantheon-workhub/workhub.sqlite --workspace .data/pantheon-workhub/workspace run TASK_ID --actor owner
python -m pantheon_workhub --db .data/pantheon-workhub/workhub.sqlite --workspace .data/pantheon-workhub/workspace show TASK_ID
python -m pantheon_workhub --db .data/pantheon-workhub/workhub.sqlite --workspace .data/pantheon-workhub/workspace events TASK_ID
```

`pause`, `resume`, `cancel`, `recover`, and `retry` commands are also available. Pause/cancel are cooperative: a tool must call its supplied control checkpoint at safe points. A request arriving after the tool's atomic effect is too late to undo it; the engine records that fact and verifies the outcome instead of falsely reporting cancellation.

## Recovery behavior

- The engine commits `ACTION_REQUESTED` before invoking the tool.
- If the process stops with an uncertain action, `recover` reads the workspace artifact.
- Matching output is read back and verified; absent output is reconciled to `FAILED`, `PAUSED`, or `CANCELLED` according to the pending command, then requires explicit retry/resume; conflicting output remains `NEEDS_RECONCILIATION`.
- A tool that cannot reach a safe point must remain in a request-pending state; it must not claim PAUSED/CANCELLED.

## Deliberate limits

- One synchronous local worker; SQLite `BEGIN IMMEDIATE` prevents duplicate claims, but there is no background scheduler or lease expiry yet.
- One create-only text-artifact tool; no UI, network API, authentication provider, AI/model integration, external connectors, arbitrary shell, or destructive tool.
- `--actor` is an audit label, **not authentication**. Keep this prototype local; do not expose it to a network or use it for sensitive data.
- On POSIX, the app requires owner-only permissions for the SQLite directory/file and workspace; artifacts are created owner-only. It fails closed rather than using a broadly accessible data directory.
- The existing local AI is not connected yet. When integrated, it must return a constrained proposal; only the Operations Engine may invoke the allowlisted tool, and model output is never authorization.
- The database is authoritative for HERMES task state only, not external systems.
- Request text is stored locally; do not include credentials or secrets.
