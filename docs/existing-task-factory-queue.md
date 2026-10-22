# Existing-task Factory queue contract

`POST /v1/factory/jobs` and OwnerBridge `queue_factory` accept exactly one of:

- `{ "request": "LOGIC training-bench note" }`: unchanged legacy behavior, creates a new task and returns HTTP 201. This variant is explicitly a LOGIC training job, not a generic intent router.
- `{ "task_id": "task_<32 lowercase hex digits>" }`: retains an existing task and returns HTTP 200 only for an eligible queued Factory action. It never dispatches. Both fields together are invalid.

Existing-task eligibility comes from the persisted action, not request prose. Only `factory.logic.trainee` is supported by the current Factory envelope. A `d1.create_text_artifact` task returns HTTP 422 with `UNSUPPORTED`; no task, action, queue or audit writes occur. Adding arbitrary artifact routing requires a separate design and explicit authority, not changing the stored tool name here.

An eligible task is QUEUED with no run, artifact, error or receipt history and a PREPARED Factory action whose input hash matches the verified stored request hash. If a job exists it must still be QUEUED with no receipt/result/error metadata. Other states return HTTP 409, without resetting anything. Unknown tasks return 404; existing owner authorization remains required.

The new path only inserts a missing `factory_jobs` row and a correlated audit event. It does not change the task, action key, request, request hash, or the deterministic `cp-<task_id>` / `work-pass://pantheon-<task_id>` identities used by the existing envelope. D1's transactional batch contains the guarded INSERT, conditional audit and response snapshot. The primary key prevents duplicate queue records. The SQL eligibility predicate rechecks the request and action after hashing to close the read/write race; `changes()` creates an audit only for the winning insert. A failed audit rolls back the insert. Repeated requests return `already_queued: true` and never report dispatch or artifact success.

Validation is local using in-memory SQLite with a D1 adapter that serializes whole batch transactions. Tests cover eight simultaneous requests, insertion rollback, state changes between initial read and transaction, unsupported actions, unknown IDs, authentication, malformed/ambiguous input, existing legacy creation, and zero Factory calls. This is not deployed D1 or Factory runtime validation.

Release order after separate approval: PANTHEON receiver first, then GO caller. No schema migration is required. Reverting the code restores the original contract; any valid queue rows created after a future approved release are ordinary existing-schema records and must not be deleted as part of rollback. Queue success is distinct from dispatch, receipt, artifact, and owner verification.

## Approved exact-task exception

The exact L1 task/hash pair is now statically authorized for the dedicated Factory text-artifact operation. Other d1.create_text_artifact tasks remain UNSUPPORTED. See l1-text-artifact-proposal.md for lifecycle, retry and release details. Legacy request-only creation is unchanged.
