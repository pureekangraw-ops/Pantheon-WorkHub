# Cloud-to-local development plan

Pantheon WorkHub is the Workspace. Factory District is the Workbench. Observatory is the Browser. They remain independent applications.

The current Python SQLite prototype is a local-only task execution slice. The deployed Cloudflare Worker is not assumed to run that Python code.

## Cloud stage

1. Inspect existing Cloudflare Worker implementation, bindings, authentication, and storage before changing it.
2. Keep production unchanged until a separate staging deployment passes verification.
3. Implement compatible task, run, action, and append-only event records.
4. Persist action intent before executing a tool. Require independent readback to mark completion.
5. Do not replay unknown side effects. Reconcile first.
6. Keep the AI model behind a replaceable adapter. Model output is a proposal, not authorization to execute.

## Laptop stage

1. Export a consistent snapshot of tasks, runs, actions, and events with checksums.
2. Import into local SQLite and validate counts, hashes, and ordering.
3. Reconcile in-flight actions before any retry.
4. Switch execution authority to local only after end-to-end tests pass.

## Acceptance

- Verified create, execute, readback, and completion.
- Recovery after a crash does not duplicate a side effect.
- Concurrent workers do not claim the same action.
- Pause and cancel wait for worker acknowledgement.
- Unsafe actions require owner approval.
- Cloud-to-local round-trip preserves identifiers and audit events.

Status: planning document only; not a claim of deployment or test success.
